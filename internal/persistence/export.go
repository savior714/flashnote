package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/savior714/flashnote/internal/document"
)

// ExactNoteExportTarget resolves the Markdown export target for the
// explicitly admitted normal note plus a safe default Markdown filename.
// It never consults the persisted last-note pointer, so a concurrent note
// transition (which moves that pointer via OpenNote/CreateNote/SaveNote)
// cannot redirect an admitted current-note export at backend entry.
func (s *Store) ExactNoteExportTarget(ctx context.Context, admittedNoteID string) (string, string, error) {
	noteID := strings.TrimSpace(admittedNoteID)
	if noteID == "" {
		return "", "", fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}

	note, err := s.loadNormalNoteForExport(ctx, noteID)
	if err != nil {
		return "", "", err
	}
	displayTitle, err := deriveDisplayTitle(note.Title, note.DocumentJSON)
	if err != nil {
		return "", "", fmt.Errorf("derive export filename: %w", err)
	}
	return note.ID, sanitizeExportBasename(displayTitle) + ".md", nil
}

// ExportNoteMarkdown writes one normal note from canonical SQLite state to a
// Markdown artifact. Referenced image bytes are copied into a sibling
// <markdown-basename>.assets directory and linked with relative paths.
func (s *Store) ExportNoteMarkdown(ctx context.Context, noteID, destination string) error {
	if strings.TrimSpace(destination) == "" {
		return errors.New("Markdown export destination is empty")
	}
	note, err := s.loadNormalNoteForExport(ctx, noteID)
	if err != nil {
		return err
	}

	attachmentIDs, err := document.AttachmentIDs(note.DocumentJSON)
	if err != nil {
		return fmt.Errorf("read export attachment references: %w", err)
	}

	assetPaths := make(map[string]string, len(attachmentIDs))
	if len(attachmentIDs) > 0 {
		assetDirName := exportAssetDirName(destination)
		assetDir := filepath.Join(filepath.Dir(destination), assetDirName)
		if err := os.MkdirAll(assetDir, 0o755); err != nil {
			return fmt.Errorf("create Markdown export assets directory: %w", err)
		}
		for _, attachmentID := range attachmentIDs {
			relativePath, err := s.exportAttachment(ctx, attachmentID, assetDirName, assetDir)
			if err != nil {
				return err
			}
			assetPaths[attachmentID] = relativePath
		}
	}

	markdown, err := document.ToMarkdown(note.Title, note.DocumentJSON, func(attachmentID string) (string, error) {
		path, ok := assetPaths[attachmentID]
		if !ok {
			return "", fmt.Errorf("attachment %s was not prepared for export", attachmentID)
		}
		return path, nil
	})
	if err != nil {
		return fmt.Errorf("serialize note as Markdown: %w", err)
	}
	if err := writeExportFile(destination, strings.NewReader(markdown)); err != nil {
		return fmt.Errorf("write Markdown export: %w", err)
	}
	return nil
}

func (s *Store) loadNormalNoteForExport(ctx context.Context, noteID string) (Note, error) {
	if noteID == "" {
		return Note{}, fmt.Errorf("%w: empty id", ErrNoteNotFound)
	}
	var note Note
	err := s.db.QueryRowContext(ctx, `
		SELECT id, title, document_json, revision
		FROM notes
		WHERE id = ? AND deleted_at IS NULL
	`, noteID).Scan(&note.ID, &note.Title, &note.DocumentJSON, &note.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, fmt.Errorf("%w: %s", ErrNoteNotFound, noteID)
	}
	if err != nil {
		return Note{}, fmt.Errorf("load note for Markdown export: %w", err)
	}
	return note, nil
}

func (s *Store) exportAttachment(ctx context.Context, attachmentID, assetDirName, assetDir string) (string, error) {
	opened, err := s.OpenAttachment(ctx, attachmentID)
	if err != nil {
		return "", fmt.Errorf("open export attachment %s: %w", attachmentID, err)
	}
	defer opened.File.Close()

	extension, err := exportImageExtension(opened.MediaType)
	if err != nil {
		return "", err
	}
	filename := attachmentID + extension
	if err := writeExportFile(filepath.Join(assetDir, filename), opened.File); err != nil {
		return "", fmt.Errorf("copy export attachment %s: %w", attachmentID, err)
	}
	return filepath.ToSlash(filepath.Join(assetDirName, filename)), nil
}

func exportImageExtension(mediaType string) (string, error) {
	switch mediaType {
	case "image/png":
		return ".png", nil
	case "image/jpeg":
		return ".jpg", nil
	case "image/gif":
		return ".gif", nil
	default:
		return "", fmt.Errorf("unsupported export attachment media type %q", mediaType)
	}
}

func exportAssetDirName(destination string) string {
	base := filepath.Base(destination)
	extension := filepath.Ext(base)
	base = strings.TrimSuffix(base, extension)
	base = strings.TrimSpace(base)
	if base == "" || base == "." {
		base = "note"
	}
	return base + ".assets"
}

func sanitizeExportBasename(name string) string {
	mapped := strings.Map(func(r rune) rune {
		if r < 32 || unicode.IsControl(r) || strings.ContainsRune(`<>:"/\\|?*`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(name))
	mapped = strings.Trim(mapped, " .")
	if mapped == "" {
		mapped = "Untitled"
	}

	runes := []rune(mapped)
	if len(runes) > 120 {
		mapped = strings.TrimRight(string(runes[:120]), " .")
	}
	if isWindowsReservedExportName(mapped) {
		mapped += "-note"
	}
	return mapped
}

func isWindowsReservedExportName(name string) bool {
	stem := strings.ToUpper(strings.TrimSpace(name))
	if dot := strings.IndexByte(stem, '.'); dot >= 0 {
		stem = stem[:dot]
	}
	switch stem {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9' {
		return true
	}
	return false
}

func writeExportFile(destination string, source io.Reader) error {
	directory := filepath.Dir(destination)
	tempFile, err := os.CreateTemp(directory, ".flashnote-export-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	promoted := false
	defer func() {
		_ = tempFile.Close()
		if !promoted {
			_ = os.Remove(tempPath)
		}
	}()

	if err := tempFile.Chmod(0o644); err != nil {
		return err
	}
	if _, err := io.Copy(tempFile, source); err != nil {
		return err
	}
	if err := tempFile.Sync(); err != nil {
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tempPath, destination); err != nil {
		return err
	}
	promoted = true
	return nil
}
