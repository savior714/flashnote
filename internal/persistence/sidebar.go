package persistence

import (
	"context"
	"fmt"
)

// SidebarFolderNotes groups one active folder with its note summaries in the
// canonical sidebar order (folders alphabetical, notes most-recently-modified
// first). Empty folders carry an empty non-nil Notes slice.
type SidebarFolderNotes struct {
	Folder Folder
	Notes  []NoteSummary
}

// SidebarProjection is the single canonical bounded read that materializes
// the normal library sidebar: active root note summaries plus every active
// folder with its note summaries. Trash is excluded. Ordering matches the
// historical per-list contracts: root notes by updated_at DESC, id ASC;
// folders by name NOCASE; folder notes by updated_at DESC, id ASC.
type SidebarProjection struct {
	RootNotes []NoteSummary
	Folders   []SidebarFolderNotes
}

// ListSidebar materializes the whole normal-library sidebar in a constant
// number of database round trips (one folders query plus one notes query),
// regardless of folder count. It reads only small durable columns
// (id, display_title, folder_id) and never loads or parses document_json:
// display titles are maintained at write time (see backfillDisplayTitles and
// the create/save paths) with the same canonical derivation previously run
// on every read.
func (s *Store) ListSidebar(ctx context.Context) (SidebarProjection, error) {
	folders, err := s.ListFolders(ctx)
	if err != nil {
		return SidebarProjection{}, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, display_title, folder_id
		FROM notes
		WHERE deleted_at IS NULL
		ORDER BY updated_at DESC, id ASC
	`)
	if err != nil {
		return SidebarProjection{}, fmt.Errorf("list sidebar notes: %w", err)
	}
	defer rows.Close()

	byFolder := make(map[string][]NoteSummary, len(folders))
	for _, folder := range folders {
		byFolder[folder.ID] = make([]NoteSummary, 0)
	}
	projection := SidebarProjection{
		RootNotes: make([]NoteSummary, 0),
		Folders:   make([]SidebarFolderNotes, 0, len(folders)),
	}
	for rows.Next() {
		var id, displayTitle string
		var folderID *string
		if err := rows.Scan(&id, &displayTitle, &folderID); err != nil {
			return SidebarProjection{}, fmt.Errorf("scan sidebar note: %w", err)
		}
		summary := NoteSummary{ID: id, DisplayTitle: displayTitle}
		if folderID == nil {
			projection.RootNotes = append(projection.RootNotes, summary)
			continue
		}
		notes, known := byFolder[*folderID]
		if !known {
			// No active note can reference a deleted folder through the
			// admitted write paths (folder trash deletes its notes, restore
			// re-roots orphans), so this is defensive only. Keep the note
			// visible at root rather than silently dropping user data.
			projection.RootNotes = append(projection.RootNotes, summary)
			continue
		}
		byFolder[*folderID] = append(notes, summary)
	}
	if err := rows.Err(); err != nil {
		return SidebarProjection{}, fmt.Errorf("iterate sidebar notes: %w", err)
	}

	// Global updated_at order restricted to each folder preserves the
	// per-folder updated_at DESC, id ASC contract without per-folder queries.
	for _, folder := range folders {
		projection.Folders = append(projection.Folders, SidebarFolderNotes{
			Folder: folder,
			Notes:  byFolder[folder.ID],
		})
	}
	return projection, nil
}

// backfillDisplayTitles derives display_title for rows that predate migration
// 009 (stored as ''). The derivation is the same canonical
// deriveDisplayTitle used on the write path, so backfilled rows are
// indistinguishable from rows written after the migration. A derivation
// failure fails closed: Open reports the error and preserves the database
// rather than starting against a partially projected library.
func (s *Store) backfillDisplayTitles(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, document_json
		FROM notes
		WHERE TRIM(COALESCE(display_title, '')) = ''
		ORDER BY id ASC
	`)
	if err != nil {
		return fmt.Errorf("read notes missing display titles: %w", err)
	}
	type pending struct {
		id           string
		title        string
		documentJSON string
	}
	pendingRows := make([]pending, 0)
	for rows.Next() {
		var row pending
		if err := rows.Scan(&row.id, &row.title, &row.documentJSON); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan note missing display title: %w", err)
		}
		pendingRows = append(pendingRows, row)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate notes missing display titles: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close display title source rows: %w", err)
	}
	if len(pendingRows) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin display title backfill: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, row := range pendingRows {
		displayTitle, err := deriveDisplayTitle(row.title, row.documentJSON)
		if err != nil {
			return fmt.Errorf("derive display title for note %s: %w", row.id, err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE notes SET display_title = ? WHERE id = ?`, displayTitle, row.id); err != nil {
			return fmt.Errorf("backfill display title for note %s: %w", row.id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit display title backfill: %w", err)
	}
	return nil
}
