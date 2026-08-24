package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/savior714/flashnote/internal/document"
)

var ErrNoteNotInTrash = errors.New("note is not in trash")

func (s *Store) MoveNoteToTrash(ctx context.Context, noteID string) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	result, err := s.db.ExecContext(ctx, `UPDATE notes SET deleted_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ? AND deleted_at IS NULL`, noteID)
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
	rows, err := s.db.QueryContext(ctx, `SELECT id,title,document_json FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC,id ASC`)
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
	return s.changeTrashState(ctx, noteID, false)
}

func (s *Store) PermanentlyDeleteNote(ctx context.Context, noteID string) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL`, noteID)
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

func (s *Store) changeTrashState(ctx context.Context, noteID string, deleted bool) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	var query string
	if deleted {
		query = `UPDATE notes SET deleted_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ? AND deleted_at IS NULL`
	} else {
		query = `UPDATE notes SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`
	}
	result, err := s.db.ExecContext(ctx, query, noteID)
	if err != nil {
		return fmt.Errorf("change note trash state: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect trash state change: %w", err)
	}
	if affected == 1 {
		return nil
	}
	return s.trashStateError(ctx, noteID)
}

func (s *Store) trashStateError(ctx context.Context, noteID string) error {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM notes WHERE id = ?`, noteID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	if err != nil {
		return fmt.Errorf("resolve note trash state: %w", err)
	}
	return fmt.Errorf("%w: %s", ErrNoteNotInTrash, noteID)
}
