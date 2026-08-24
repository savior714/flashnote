package persistence

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/savior714/flashnote/internal/document"
)

const lastNoteIDKey = "last_note_id"

var (
	ErrNoteNotFound     = errors.New("note not found")
	ErrRevisionConflict = errors.New("note revision conflict")
)

type Note struct {
	ID           string
	Title        string
	DocumentJSON string
	Revision     int64
}

type NoteSummary struct {
	ID           string
	DisplayTitle string
}

func (s *Store) ListNotes(ctx context.Context) ([]NoteSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, document_json
		FROM notes
		WHERE deleted_at IS NULL
		ORDER BY updated_at DESC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer rows.Close()

	summaries := make([]NoteSummary, 0)
	for rows.Next() {
		var id, title, documentJSON string
		if err := rows.Scan(&id, &title, &documentJSON); err != nil {
			return nil, fmt.Errorf("scan note summary: %w", err)
		}
		displayTitle, err := deriveDisplayTitle(title, documentJSON)
		if err != nil {
			return nil, fmt.Errorf("derive display title for note %s: %w", id, err)
		}
		summaries = append(summaries, NoteSummary{ID: id, DisplayTitle: displayTitle})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate note summaries: %w", err)
	}
	return summaries, nil
}

func (s *Store) OpenInitialNote(ctx context.Context) (Note, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Note{}, false, fmt.Errorf("begin initial note transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var lastID string
	err = tx.QueryRowContext(ctx, `SELECT value FROM app_meta WHERE key = ?`, lastNoteIDKey).Scan(&lastID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Note{}, false, fmt.Errorf("read last note id: %w", err)
	}

	if err == nil {
		note, loadErr := loadNoteTx(ctx, tx, lastID)
		switch {
		case loadErr == nil:
			if err := setLastNoteIDTx(ctx, tx, note.ID); err != nil {
				return Note{}, false, err
			}
			if err := tx.Commit(); err != nil {
				return Note{}, false, fmt.Errorf("commit initial note transaction: %w", err)
			}
			return note, false, nil
		case !errors.Is(loadErr, ErrNoteNotFound):
			return Note{}, false, loadErr
		}
	}

	note, err := createNoteTx(ctx, tx)
	if err != nil {
		return Note{}, false, err
	}
	if err := setLastNoteIDTx(ctx, tx, note.ID); err != nil {
		return Note{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Note{}, false, fmt.Errorf("commit initial note creation: %w", err)
	}
	return note, true, nil
}

func (s *Store) OpenNote(ctx context.Context, noteID string) (Note, error) {
	if noteID == "" {
		return Note{}, fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Note{}, fmt.Errorf("begin open note transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	note, err := loadNoteTx(ctx, tx, noteID)
	if err != nil {
		return Note{}, err
	}
	if err := setLastNoteIDTx(ctx, tx, note.ID); err != nil {
		return Note{}, err
	}
	if err := tx.Commit(); err != nil {
		return Note{}, fmt.Errorf("commit open note transaction: %w", err)
	}
	return note, nil
}

func (s *Store) CreateNote(ctx context.Context) (Note, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Note{}, fmt.Errorf("begin create note transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	note, err := createNoteTx(ctx, tx)
	if err != nil {
		return Note{}, err
	}
	if err := setLastNoteIDTx(ctx, tx, note.ID); err != nil {
		return Note{}, err
	}
	if err := tx.Commit(); err != nil {
		return Note{}, fmt.Errorf("commit note creation: %w", err)
	}
	return note, nil
}

func (s *Store) SaveNote(ctx context.Context, noteID, title, documentJSON string, expectedRevision int64) (int64, error) {
	if noteID == "" {
		return 0, fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	if expectedRevision < 1 {
		return 0, fmt.Errorf("%w: invalid expected revision %d", ErrRevisionConflict, expectedRevision)
	}

	normalizedDocument, err := document.ValidateAndNormalizeJSON(documentJSON)
	if err != nil {
		return 0, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin save note transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `
		UPDATE notes
		SET title = ?,
			document_json = ?,
			revision = revision + 1,
			updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
		WHERE id = ? AND revision = ? AND deleted_at IS NULL
	`, title, normalizedDocument, noteID, expectedRevision)
	if err != nil {
		return 0, fmt.Errorf("update note: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("inspect note update: %w", err)
	}
	if rowsAffected != 1 {
		var currentRevision int64
		err := tx.QueryRowContext(ctx, `SELECT revision FROM notes WHERE id = ? AND deleted_at IS NULL`, noteID).Scan(&currentRevision)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return 0, fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
		case err != nil:
			return 0, fmt.Errorf("resolve note update conflict: %w", err)
		default:
			return 0, fmt.Errorf("%w: expected %d, current %d", ErrRevisionConflict, expectedRevision, currentRevision)
		}
	}

	if err := setLastNoteIDTx(ctx, tx, noteID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit note save: %w", err)
	}
	return expectedRevision + 1, nil
}

func createNoteTx(ctx context.Context, tx *sql.Tx) (Note, error) {
	id, err := newNoteID()
	if err != nil {
		return Note{}, err
	}
	note := Note{
		ID:           id,
		Title:        "",
		DocumentJSON: document.EmptyJSON(),
		Revision:     1,
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO notes(id, title, document_json, revision, created_at, updated_at)
		VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'))
	`, note.ID, note.Title, note.DocumentJSON, note.Revision); err != nil {
		return Note{}, fmt.Errorf("insert note: %w", err)
	}
	return note, nil
}

func loadNoteTx(ctx context.Context, tx *sql.Tx, noteID string) (Note, error) {
	var note Note
	err := tx.QueryRowContext(ctx, `
		SELECT id, title, document_json, revision
		FROM notes
		WHERE id = ? AND deleted_at IS NULL
	`, noteID).Scan(&note.ID, &note.Title, &note.DocumentJSON, &note.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	if err != nil {
		return Note{}, fmt.Errorf("load note: %w", err)
	}
	normalizedDocument, err := document.ValidateAndNormalizeJSON(note.DocumentJSON)
	if err != nil {
		return Note{}, fmt.Errorf("validate persisted note %s: %w", note.ID, err)
	}
	note.DocumentJSON = normalizedDocument
	return note, nil
}

func setLastNoteIDTx(ctx context.Context, tx *sql.Tx, noteID string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO app_meta(key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`, lastNoteIDKey, noteID)
	if err != nil {
		return fmt.Errorf("persist last note id: %w", err)
	}
	return nil
}

func deriveDisplayTitle(title, documentJSON string) (string, error) {
	if explicit := strings.TrimSpace(title); explicit != "" {
		return explicit, nil
	}

	normalized, err := document.ValidateAndNormalizeJSON(documentJSON)
	if err != nil {
		return "", err
	}
	var envelope struct {
		Doc map[string]any `json:"doc"`
	}
	if err := json.Unmarshal([]byte(normalized), &envelope); err != nil {
		return "", fmt.Errorf("decode normalized document: %w", err)
	}

	content, _ := envelope.Doc["content"].([]any)
	for _, child := range content {
		var text strings.Builder
		appendNodeText(&text, child)
		if value := strings.Join(strings.Fields(text.String()), " "); value != "" {
			return value, nil
		}
	}
	return "Untitled", nil
}

func appendNodeText(builder *strings.Builder, value any) {
	node, ok := value.(map[string]any)
	if !ok {
		return
	}
	if text, ok := node["text"].(string); ok {
		builder.WriteString(text)
	}
	children, _ := node["content"].([]any)
	for _, child := range children {
		appendNodeText(builder, child)
	}
}

func newNoteID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate note id: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		value[0:4],
		value[4:6],
		value[6:8],
		value[8:10],
		value[10:16],
	), nil
}
