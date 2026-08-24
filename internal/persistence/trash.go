package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/savior714/flashnote/internal/document"
)

var (
	ErrNoteNotInTrash        = errors.New("note is not in trash")
	ErrNotePartOfFolderTrash = errors.New("note belongs to a deleted folder recovery unit")
)

func (s *Store) MoveNoteToTrash(ctx context.Context, noteID string) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE notes
		SET deleted_at = strftime('%Y-%m-%d %H:%M:%f','now'), deleted_with_folder_id = NULL
		WHERE id = ? AND deleted_at IS NULL
	`, noteID)
	if err != nil {
		return fmt.Errorf("move note to trash: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect trash move: %w", err)
	}
	if affected != 1 {
		return fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	return nil
}

func (s *Store) ListTrashNotes(ctx context.Context) ([]NoteSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,title,document_json
		FROM notes
		WHERE deleted_at IS NOT NULL AND deleted_with_folder_id IS NULL
		ORDER BY deleted_at DESC,id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list trash notes: %w", err)
	}
	defer rows.Close()
	summaries := make([]NoteSummary, 0)
	for rows.Next() {
		var id, title, documentJSON string
		if err := rows.Scan(&id, &title, &documentJSON); err != nil {
			return nil, fmt.Errorf("scan trash note: %w", err)
		}
		displayTitle, err := deriveDisplayTitle(title, documentJSON)
		if err != nil {
			return nil, fmt.Errorf("derive trash note title for %s: %w", id, err)
		}
		summaries = append(summaries, NoteSummary{ID: id, DisplayTitle: displayTitle})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate trash notes: %w", err)
	}
	return summaries, nil
}

func (s *Store) OpenTrashNote(ctx context.Context, noteID string) (Note, error) {
	if noteID == "" {
		return Note{}, fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	var note Note
	err := s.db.QueryRowContext(ctx, `SELECT id,title,document_json,revision FROM notes WHERE id = ? AND deleted_at IS NOT NULL`, noteID).Scan(&note.ID, &note.Title, &note.DocumentJSON, &note.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	if err != nil {
		return Note{}, fmt.Errorf("open trash note: %w", err)
	}
	normalized, err := document.ValidateAndNormalizeJSON(note.DocumentJSON)
	if err != nil {
		return Note{}, fmt.Errorf("validate trashed note %s: %w", note.ID, err)
	}
	note.DocumentJSON = normalized
	return note, nil
}

func (s *Store) RestoreNote(ctx context.Context, noteID string) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE notes
		SET deleted_at = NULL,
			folder_id = CASE
				WHEN folder_id IS NULL THEN NULL
				WHEN EXISTS (SELECT 1 FROM folders WHERE folders.id = notes.folder_id AND folders.deleted_at IS NULL) THEN folder_id
				ELSE NULL
			END
		WHERE id = ? AND deleted_at IS NOT NULL AND deleted_with_folder_id IS NULL
	`, noteID)
	if err != nil {
		return fmt.Errorf("restore note: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect note restore: %w", err)
	}
	if affected == 1 {
		return nil
	}
	return s.trashStateError(ctx, noteID)
}

func (s *Store) PermanentlyDeleteNote(ctx context.Context, noteID string) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM notes
		WHERE id = ? AND deleted_at IS NOT NULL AND deleted_with_folder_id IS NULL
	`, noteID)
	if err != nil {
		return fmt.Errorf("permanently delete note: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect permanent delete: %w", err)
	}
	if affected == 1 {
		return nil
	}
	return s.trashStateError(ctx, noteID)
}

func (s *Store) trashStateError(ctx context.Context, noteID string) error {
	var deletedAt, deletedWithFolderID sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT deleted_at, deleted_with_folder_id FROM notes WHERE id = ?`, noteID).Scan(&deletedAt, &deletedWithFolderID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	if err != nil {
		return fmt.Errorf("resolve note trash state: %w", err)
	}
	if deletedAt.Valid && deletedWithFolderID.Valid {
		return fmt.Errorf("%w: note=%s folder=%s", ErrNotePartOfFolderTrash, noteID, deletedWithFolderID.String)
	}
	return fmt.Errorf("%w: %s", ErrNoteNotInTrash, noteID)
}
