package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/savior714/flashnote/internal/document"
)

var (
	ErrFolderNotFound    = errors.New("folder not found")
	ErrInvalidFolderName = errors.New("invalid folder name")
)

type Folder struct {
	ID   string
	Name string
}

func (s *Store) CreateFolder(ctx context.Context, name string) (Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Folder{}, ErrInvalidFolderName
	}
	id, err := newNoteID()
	if err != nil {
		return Folder{}, fmt.Errorf("generate folder id: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO folders(id, name, created_at, updated_at)
		VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'))
	`, id, name); err != nil {
		return Folder{}, fmt.Errorf("create folder: %w", err)
	}
	return Folder{ID: id, Name: name}, nil
}

func (s *Store) ListFolders(ctx context.Context) ([]Folder, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name
		FROM folders
		ORDER BY name COLLATE NOCASE ASC, name ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	defer rows.Close()

	folders := make([]Folder, 0)
	for rows.Next() {
		var folder Folder
		if err := rows.Scan(&folder.ID, &folder.Name); err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		folders = append(folders, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate folders: %w", err)
	}
	return folders, nil
}

func (s *Store) ListRootNotes(ctx context.Context) ([]NoteSummary, error) {
	return s.listNotesByFolder(ctx, "", true)
}

func (s *Store) ListFolderNotes(ctx context.Context, folderID string) ([]NoteSummary, error) {
	if folderID == "" {
		return nil, fmt.Errorf("%w: empty id", ErrFolderNotFound)
	}
	if err := s.ensureFolderExists(ctx, folderID); err != nil {
		return nil, err
	}
	return s.listNotesByFolder(ctx, folderID, false)
}

func (s *Store) CreateNoteInFolder(ctx context.Context, folderID string) (Note, error) {
	if folderID == "" {
		return Note{}, fmt.Errorf("%w: empty id", ErrFolderNotFound)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Note{}, fmt.Errorf("begin folder note creation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := ensureFolderExistsTx(ctx, tx, folderID); err != nil {
		return Note{}, err
	}
	id, err := newNoteID()
	if err != nil {
		return Note{}, err
	}
	note := Note{ID: id, Title: "", DocumentJSON: document.EmptyJSON(), Revision: 1}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO notes(id, title, document_json, revision, created_at, updated_at, folder_id)
		VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'), ?)
	`, note.ID, note.Title, note.DocumentJSON, note.Revision, folderID); err != nil {
		return Note{}, fmt.Errorf("insert folder note: %w", err)
	}
	if err := setLastNoteIDTx(ctx, tx, note.ID); err != nil {
		return Note{}, err
	}
	if err := tx.Commit(); err != nil {
		return Note{}, fmt.Errorf("commit folder note creation: %w", err)
	}
	return note, nil
}

func (s *Store) MoveNote(ctx context.Context, noteID, folderID string) error {
	if noteID == "" {
		return fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin note move: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if folderID != "" {
		if err := ensureFolderExistsTx(ctx, tx, folderID); err != nil {
			return err
		}
	}
	var folderValue any
	if folderID != "" {
		folderValue = folderID
	}
	result, err := tx.ExecContext(ctx, `UPDATE notes SET folder_id = ? WHERE id = ?`, folderValue, noteID)
	if err != nil {
		return fmt.Errorf("move note: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect note move: %w", err)
	}
	if rowsAffected != 1 {
		return fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit note move: %w", err)
	}
	return nil
}

func (s *Store) listNotesByFolder(ctx context.Context, folderID string, root bool) ([]NoteSummary, error) {
	var rows *sql.Rows
	var err error
	if root {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, title, document_json
			FROM notes
			WHERE folder_id IS NULL
			ORDER BY updated_at DESC, id ASC
		`)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT id, title, document_json
			FROM notes
			WHERE folder_id = ?
			ORDER BY updated_at DESC, id ASC
		`, folderID)
	}
	if err != nil {
		return nil, fmt.Errorf("list notes by folder: %w", err)
	}
	defer rows.Close()

	summaries := make([]NoteSummary, 0)
	for rows.Next() {
		var id, title, documentJSON string
		if err := rows.Scan(&id, &title, &documentJSON); err != nil {
			return nil, fmt.Errorf("scan folder note summary: %w", err)
		}
		displayTitle, err := deriveDisplayTitle(title, documentJSON)
		if err != nil {
			return nil, fmt.Errorf("derive display title for note %s: %w", id, err)
		}
		summaries = append(summaries, NoteSummary{ID: id, DisplayTitle: displayTitle})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate folder note summaries: %w", err)
	}
	return summaries, nil
}

func (s *Store) ensureFolderExists(ctx context.Context, folderID string) error {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ?`, folderID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrFolderNotFound, folderID)
	}
	if err != nil {
		return fmt.Errorf("check folder: %w", err)
	}
	return nil
}

func ensureFolderExistsTx(ctx context.Context, tx *sql.Tx, folderID string) error {
	var exists int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM folders WHERE id = ?`, folderID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrFolderNotFound, folderID)
	}
	if err != nil {
		return fmt.Errorf("check folder: %w", err)
	}
	return nil
}
