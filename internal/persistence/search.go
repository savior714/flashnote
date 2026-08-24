package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/savior714/flashnote/internal/document"
)

const (
	searchIndexVersionKey = "search_index_version"
	searchIndexVersion    = "1"
	searchRecentLimit     = 12
	searchResultLimit     = 20
)

type SearchResult struct {
	ID           string
	DisplayTitle string
	Excerpt      string
}

type searchFields struct {
	explicitTitle string
	displayTitle  string
	bodyText      string
}

func (s *Store) ensureSearchIndex(ctx context.Context) error {
	s.searchMu.Lock()
	defer s.searchMu.Unlock()

	var version string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_meta WHERE key = ?`, searchIndexVersionKey).Scan(&version)
	if err == nil && version == searchIndexVersion {
		return nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read search index version: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT id, title, document_json FROM notes ORDER BY id ASC`)
	if err != nil {
		return fmt.Errorf("read notes for search index: %w", err)
	}
	type sourceNote struct {
		id           string
		title        string
		documentJSON string
	}
	notes := make([]sourceNote, 0)
	for rows.Next() {
		var note sourceNote
		if err := rows.Scan(&note.id, &note.title, &note.documentJSON); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan note for search index: %w", err)
		}
		notes = append(notes, note)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate notes for search index: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close search index source rows: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin search index rebuild: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM note_search`); err != nil {
		return fmt.Errorf("clear search index: %w", err)
	}
	for _, note := range notes {
		if err := indexNoteSearchTx(ctx, tx, note.id, note.title, note.documentJSON); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO app_meta(key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`, searchIndexVersionKey, searchIndexVersion); err != nil {
		return fmt.Errorf("persist search index version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit search index rebuild: %w", err)
	}
	return nil
}

func (s *Store) SearchNotes(ctx context.Context, query string) ([]SearchResult, error) {
	trimmedQuery := strings.TrimSpace(query)
	if trimmedQuery == "" {
		return s.recentNotes(ctx)
	}

	matchQuery := literalFTSQuery(trimmedQuery)
	if matchQuery == "" {
		return []SearchResult{}, nil
	}
	if err := s.ensureSearchIndex(ctx); err != nil {
		return nil, fmt.Errorf("prepare search index: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			note_search.note_id,
			notes.title,
			notes.document_json,
			COALESCE(snippet(note_search, 3, '', '', ' … ', 18), '')
		FROM note_search
		JOIN notes ON notes.id = note_search.note_id
		WHERE note_search MATCH ?
		ORDER BY
			CASE
				WHEN instr(lower(note_search.explicit_title), lower(?)) > 0
					OR instr(lower(note_search.display_title), lower(?)) > 0 THEN 0
				ELSE 1
			END ASC,
			bm25(note_search, 0.0, 12.0, 10.0, 1.0) ASC,
			notes.updated_at DESC,
			notes.id ASC
		LIMIT ?
	`, matchQuery, trimmedQuery, trimmedQuery, searchResultLimit)
	if err != nil {
		return nil, fmt.Errorf("search notes: %w", err)
	}
	defer rows.Close()

	results := make([]SearchResult, 0)
	for rows.Next() {
		var id, title, documentJSON, excerpt string
		if err := rows.Scan(&id, &title, &documentJSON, &excerpt); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		displayTitle, err := deriveDisplayTitle(title, documentJSON)
		if err != nil {
			return nil, fmt.Errorf("derive search result title for note %s: %w", id, err)
		}
		results = append(results, SearchResult{
			ID:           id,
			DisplayTitle: displayTitle,
			Excerpt:      strings.TrimSpace(excerpt),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate search results: %w", err)
	}
	return results, nil
}

func (s *Store) recentNotes(ctx context.Context) ([]SearchResult, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, document_json
		FROM notes
		ORDER BY updated_at DESC, id ASC
		LIMIT ?
	`, searchRecentLimit)
	if err != nil {
		return nil, fmt.Errorf("list recent notes: %w", err)
	}
	defer rows.Close()

	results := make([]SearchResult, 0)
	for rows.Next() {
		var id, title, documentJSON string
		if err := rows.Scan(&id, &title, &documentJSON); err != nil {
			return nil, fmt.Errorf("scan recent note: %w", err)
		}
		displayTitle, err := deriveDisplayTitle(title, documentJSON)
		if err != nil {
			return nil, fmt.Errorf("derive recent note title for %s: %w", id, err)
		}
		results = append(results, SearchResult{ID: id, DisplayTitle: displayTitle})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent notes: %w", err)
	}
	return results, nil
}

func indexNoteSearchTx(ctx context.Context, tx *sql.Tx, noteID, title, documentJSON string) error {
	fields, err := buildSearchFields(title, documentJSON)
	if err != nil {
		return fmt.Errorf("derive search fields for note %s: %w", noteID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM note_search WHERE note_id = ?`, noteID); err != nil {
		return fmt.Errorf("remove stale search entry for note %s: %w", noteID, err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO note_search(note_id, explicit_title, display_title, body_text)
		VALUES (?, ?, ?, ?)
	`, noteID, fields.explicitTitle, fields.displayTitle, fields.bodyText); err != nil {
		return fmt.Errorf("index note %s: %w", noteID, err)
	}
	return nil
}

func buildSearchFields(title, documentJSON string) (searchFields, error) {
	normalized, err := document.ValidateAndNormalizeJSON(documentJSON)
	if err != nil {
		return searchFields{}, err
	}
	var envelope struct {
		Doc map[string]any `json:"doc"`
	}
	if err := json.Unmarshal([]byte(normalized), &envelope); err != nil {
		return searchFields{}, fmt.Errorf("decode normalized document: %w", err)
	}

	content, _ := envelope.Doc["content"].([]any)
	blocks := make([]string, 0, len(content))
	derivedTitle := ""
	for _, child := range content {
		var text strings.Builder
		appendNodeText(&text, child)
		blockText := strings.Join(strings.Fields(text.String()), " ")
		if blockText == "" {
			continue
		}
		if derivedTitle == "" {
			derivedTitle = blockText
		}
		blocks = append(blocks, blockText)
	}

	explicitTitle := strings.TrimSpace(title)
	if explicitTitle != "" {
		derivedTitle = ""
	}
	return searchFields{
		explicitTitle: explicitTitle,
		displayTitle:  derivedTitle,
		bodyText:      strings.Join(blocks, "\n"),
	}, nil
}

func literalFTSQuery(query string) string {
	tokens := strings.FieldsFunc(query, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r))
	})
	parts := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if token == "" {
			continue
		}
		parts = append(parts, `"`+token+`"*`)
	}
	return strings.Join(parts, " ")
}
