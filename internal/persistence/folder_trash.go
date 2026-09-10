package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var ErrFolderNotInTrash = errors.New("folder is not in trash")

func (s *Store) MoveFolderToTrash(ctx context.Context, folderID string) (int, error) {
	if folderID == "" {
		return 0, fmt.Errorf("%w: empty id", ErrFolderNotFound)
	}
	// Serializes the notes+search writes against index rebuilds.
	s.searchMu.Lock()
	defer s.searchMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin folder trash transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := ensureFolderExistsTx(ctx, tx, folderID); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE notes
		SET deleted_at = strftime('%Y-%m-%d %H:%M:%f','now'), deleted_with_folder_id = ?
		WHERE folder_id = ? AND deleted_at IS NULL
	`, folderID, folderID)
	if err != nil {
		return 0, fmt.Errorf("trash folder notes: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect trashed folder notes: %w", err)
	}
	// Trashed notes leave active search; drop exactly this recovery unit's index
	// entries in the same transaction. This is O(unit), never O(library).
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM note_search
		WHERE note_id IN (SELECT id FROM notes WHERE deleted_with_folder_id = ? AND deleted_at IS NOT NULL)
	`, folderID); err != nil {
		return 0, fmt.Errorf("remove trashed folder notes from search index: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE folders
		SET deleted_at = strftime('%Y-%m-%d %H:%M:%f','now')
		WHERE id = ? AND deleted_at IS NULL
	`, folderID); err != nil {
		return 0, fmt.Errorf("trash folder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit folder trash: %w", err)
	}
	return int(affected), nil
}

func (s *Store) ListTrashFolders(ctx context.Context) ([]Folder, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name
		FROM folders
		WHERE deleted_at IS NOT NULL
		ORDER BY deleted_at DESC, name COLLATE NOCASE ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list trash folders: %w", err)
	}
	defer rows.Close()

	folders := make([]Folder, 0)
	for rows.Next() {
		var folder Folder
		if err := rows.Scan(&folder.ID, &folder.Name); err != nil {
			return nil, fmt.Errorf("scan trash folder: %w", err)
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate trash folders: %w", err)
	}
	return folders, nil
}

func (s *Store) ListTrashFolderNotes(ctx context.Context, folderID string) ([]NoteSummary, error) {
	if folderID == "" {
		return nil, fmt.Errorf("%w: empty id", ErrFolderNotFound)
	}
	if err := s.ensureTrashFolderExists(ctx, folderID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, document_json
		FROM notes
		WHERE deleted_at IS NOT NULL AND deleted_with_folder_id = ?
		ORDER BY updated_at DESC, id ASC
	`, folderID)
	if err != nil {
		return nil, fmt.Errorf("list trash folder notes: %w", err)
	}
	defer rows.Close()

	summaries := make([]NoteSummary, 0)
	for rows.Next() {
		var id, title, documentJSON string
		if err := rows.Scan(&id, &title, &documentJSON); err != nil {
			return nil, fmt.Errorf("scan trash folder note: %w", err)
		}
		displayTitle, err := deriveDisplayTitle(title, documentJSON)
		if err != nil {
			return nil, fmt.Errorf("derive trash folder note title for %s: %w", id, err)
		}
		summaries = append(summaries, NoteSummary{ID: id, DisplayTitle: displayTitle})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate trash folder notes: %w", err)
	}
	return summaries, nil
}

func (s *Store) RestoreFolder(ctx context.Context, folderID string) (int, error) {
	if folderID == "" {
		return 0, fmt.Errorf("%w: empty id", ErrFolderNotFound)
	}
	// Serializes the notes+search writes against index rebuilds.
	s.searchMu.Lock()
	defer s.searchMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin folder restore transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := ensureTrashFolderExistsTx(ctx, tx, folderID); err != nil {
		return 0, err
	}
	// Snapshot restorable content before the UPDATE clears the recovery-unit key.
	// Title/document are untouched by restore, so the pre-update read is exact.
	type restoreSource struct {
		id           string
		title        string
		documentJSON string
	}
	restoreRows, err := tx.QueryContext(ctx, `
		SELECT id, title, document_json
		FROM notes
		WHERE deleted_at IS NOT NULL AND deleted_with_folder_id = ?
		ORDER BY id ASC
	`, folderID)
	if err != nil {
		return 0, fmt.Errorf("read folder restore notes for search index: %w", err)
	}
	sources := make([]restoreSource, 0)
	for restoreRows.Next() {
		var source restoreSource
		if err := restoreRows.Scan(&source.id, &source.title, &source.documentJSON); err != nil {
			_ = restoreRows.Close()
			return 0, fmt.Errorf("scan folder restore note for search index: %w", err)
		}
		sources = append(sources, source)
	}
	if err := restoreRows.Err(); err != nil {
		_ = restoreRows.Close()
		return 0, fmt.Errorf("iterate folder restore notes for search index: %w", err)
	}
	if err := restoreRows.Close(); err != nil {
		return 0, fmt.Errorf("close folder restore source rows: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE notes
		SET deleted_at = NULL, deleted_with_folder_id = NULL
		WHERE deleted_at IS NOT NULL AND deleted_with_folder_id = ?
	`, folderID)
	if err != nil {
		return 0, fmt.Errorf("restore folder notes: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect restored folder notes: %w", err)
	}
	// Restored notes rejoin active search; reindex exactly this recovery unit in
	// the same transaction. This is O(unit), never O(library).
	for _, source := range sources {
		if err := indexNoteSearchTx(ctx, tx, source.id, source.title, source.documentJSON); err != nil {
			return 0, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE folders SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, folderID); err != nil {
		return 0, fmt.Errorf("restore folder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit folder restore: %w", err)
	}
	return int(affected), nil
}

func (s *Store) PermanentlyDeleteFolder(ctx context.Context, folderID string) (int, error) {
	if folderID == "" {
		return 0, fmt.Errorf("%w: empty id", ErrFolderNotFound)
	}
	// Serializes the notes+search writes against index rebuilds.
	s.searchMu.Lock()
	defer s.searchMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin permanent folder delete: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := ensureTrashFolderExistsTx(ctx, tx, folderID); err != nil {
		return 0, err
	}
	// Capture doomed index keys before the notes DELETE removes the mapping.
	doomedRows, err := tx.QueryContext(ctx, `SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_with_folder_id = ? ORDER BY id ASC`, folderID)
	if err != nil {
		return 0, fmt.Errorf("read doomed folder notes for search index: %w", err)
	}
	doomed := make([]string, 0)
	for doomedRows.Next() {
		var id string
		if err := doomedRows.Scan(&id); err != nil {
			_ = doomedRows.Close()
			return 0, fmt.Errorf("scan doomed folder note for search index: %w", err)
		}
		doomed = append(doomed, id)
	}
	if err := doomedRows.Err(); err != nil {
		_ = doomedRows.Close()
		return 0, fmt.Errorf("iterate doomed folder notes for search index: %w", err)
	}
	if err := doomedRows.Close(); err != nil {
		return 0, fmt.Errorf("close doomed folder note rows: %w", err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_with_folder_id = ?`, folderID)
	if err != nil {
		return 0, fmt.Errorf("delete folder recovery notes: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect deleted folder recovery notes: %w", err)
	}
	// The note rows are gone; drop their index entries, if any, in the same
	// transaction. Trashed notes normally have no entries, so this is a no-op.
	for _, id := range doomed {
		if err := removeNoteSearchTx(ctx, tx, id); err != nil {
			return 0, err
		}
	}
	folderResult, err := tx.ExecContext(ctx, `DELETE FROM folders WHERE id = ? AND deleted_at IS NOT NULL`, folderID)
	if err != nil {
		return 0, fmt.Errorf("permanently delete folder: %w", err)
	}
	folderAffected, err := folderResult.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect permanent folder delete: %w", err)
	}
	if folderAffected != 1 {
		return 0, fmt.Errorf("%w: %s", ErrFolderNotInTrash, folderID)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit permanent folder delete: %w", err)
	}
	return int(affected), nil
}

func (s *Store) TrashCounts(ctx context.Context) (int, int, error) {
	var noteCount, folderCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL`).Scan(&noteCount); err != nil {
		return 0, 0, fmt.Errorf("count trash notes: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM folders WHERE deleted_at IS NOT NULL`).Scan(&folderCount); err != nil {
		return 0, 0, fmt.Errorf("count trash folders: %w", err)
	}
	return noteCount, folderCount, nil
}

func (s *Store) EmptyTrash(ctx context.Context) (int, int, error) {
	// Serializes the notes+search writes against index rebuilds.
	s.searchMu.Lock()
	defer s.searchMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("begin empty trash: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var noteCount, folderCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL`).Scan(&noteCount); err != nil {
		return 0, 0, fmt.Errorf("count notes before empty trash: %w", err)
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM folders WHERE deleted_at IS NOT NULL`).Scan(&folderCount); err != nil {
		return 0, 0, fmt.Errorf("count folders before empty trash: %w", err)
	}
	// Drop index entries for doomed trash rows before the notes DELETE removes the
	// mapping. Trashed notes were already removed from the index at trash time,
	// so this is normally a no-op and never O(active library).
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM note_search
		WHERE note_id IN (SELECT id FROM notes WHERE deleted_at IS NOT NULL)
	`); err != nil {
		return 0, 0, fmt.Errorf("remove trash notes from search index: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE deleted_at IS NOT NULL`); err != nil {
		return 0, 0, fmt.Errorf("delete trash notes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM folders WHERE deleted_at IS NOT NULL`); err != nil {
		return 0, 0, fmt.Errorf("delete trash folders: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("commit empty trash: %w", err)
	}
	return noteCount, folderCount, nil
}

func (s *Store) ensureTrashFolderExists(ctx context.Context, folderID string) error {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NOT NULL`, folderID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return s.folderTrashStateError(ctx, folderID)
	}
	if err != nil {
		return fmt.Errorf("check trash folder: %w", err)
	}
	return nil
}

func ensureTrashFolderExistsTx(ctx context.Context, tx *sql.Tx, folderID string) error {
	var exists int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NOT NULL`, folderID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		var active int
		activeErr := tx.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ?`, folderID).Scan(&active)
		if errors.Is(activeErr, sql.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrFolderNotFound, folderID)
		}
		if activeErr != nil {
			return fmt.Errorf("resolve folder trash state: %w", activeErr)
		}
		return fmt.Errorf("%w: %s", ErrFolderNotInTrash, folderID)
	}
	if err != nil {
		return fmt.Errorf("check trash folder: %w", err)
	}
	return nil
}

func (s *Store) folderTrashStateError(ctx context.Context, folderID string) error {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ?`, folderID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrFolderNotFound, folderID)
	}
	if err != nil {
		return fmt.Errorf("resolve folder trash state: %w", err)
	}
	return fmt.Errorf("%w: %s", ErrFolderNotInTrash, folderID)
}
