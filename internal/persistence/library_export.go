package persistence

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/savior714/flashnote/internal/document"
)

const libraryExportDirectoryName = "Flashnote Export"

// ExportLibraryMarkdown exports every normal note into a new, self-contained
// directory below parentDirectory. Root notes stay at the export root, normal
// folders become one directory level, Trash is excluded, and a failed export
// never promotes its staging directory into a visible final artifact.
func (s *Store) ExportLibraryMarkdown(ctx context.Context, parentDirectory string) (string, int, int, error) {
	parentDirectory = strings.TrimSpace(parentDirectory)
	if parentDirectory == "" {
		return "", 0, 0, errors.New("Markdown library export parent directory is empty")
	}
	parentInfo, err := os.Stat(parentDirectory)
	if err != nil {
		return "", 0, 0, fmt.Errorf("inspect Markdown library export parent directory: %w", err)
	}
	if !parentInfo.IsDir() {
		return "", 0, 0, errors.New("Markdown library export parent path is not a directory")
	}

	folders, err := s.ListFolders(ctx)
	if err != nil {
		return "", 0, 0, err
	}
	rootNotes, err := s.ListRootNotes(ctx)
	if err != nil {
		return "", 0, 0, err
	}

	stagingDirectory, err := os.MkdirTemp(parentDirectory, ".flashnote-library-export-*")
	if err != nil {
		return "", 0, 0, fmt.Errorf("create Markdown library export staging directory: %w", err)
	}
	promoted := false
	defer func() {
		if !promoted {
			_ = os.RemoveAll(stagingDirectory)
		}
	}()

	rootEntries := make(map[string]struct{})
	folderDirectories := make(map[string]string, len(folders))
	for _, folder := range folders {
		directoryName := allocateLibraryDirectoryName(folder.Name, rootEntries)
		directoryPath := filepath.Join(stagingDirectory, directoryName)
		if err := os.Mkdir(directoryPath, 0o755); err != nil {
			return "", 0, 0, fmt.Errorf("create Markdown export folder %q: %w", folder.Name, err)
		}
		folderDirectories[folder.ID] = directoryPath
	}

	noteCount := 0
	for _, summary := range rootNotes {
		if err := s.exportLibraryNote(ctx, summary, stagingDirectory, rootEntries); err != nil {
			return "", 0, 0, err
		}
		noteCount++
	}
	for _, folder := range folders {
		notes, err := s.ListFolderNotes(ctx, folder.ID)
		if err != nil {
			return "", 0, 0, err
		}
		entries := make(map[string]struct{})
		for _, summary := range notes {
			if err := s.exportLibraryNote(ctx, summary, folderDirectories[folder.ID], entries); err != nil {
				return "", 0, 0, err
			}
			noteCount++
		}
	}

	finalDirectory, err := availableLibraryExportDirectory(parentDirectory)
	if err != nil {
		return "", 0, 0, err
	}
	if err := os.Rename(stagingDirectory, finalDirectory); err != nil {
		return "", 0, 0, fmt.Errorf("promote Markdown library export: %w", err)
	}
	promoted = true
	return finalDirectory, noteCount, len(folders), nil
}

func (s *Store) exportLibraryNote(ctx context.Context, summary NoteSummary, directory string, used map[string]struct{}) error {
	note, err := s.loadNormalNoteForExport(ctx, summary.ID)
	if err != nil {
		return err
	}
	attachmentIDs, err := document.AttachmentIDs(note.DocumentJSON)
	if err != nil {
		return fmt.Errorf("read export attachment references for note %s: %w", note.ID, err)
	}
	filename := allocateLibraryNoteFilename(summary.DisplayTitle, len(attachmentIDs) > 0, used)
	if err := s.ExportNoteMarkdown(ctx, note.ID, filepath.Join(directory, filename)); err != nil {
		return fmt.Errorf("export note %s as Markdown: %w", note.ID, err)
	}
	return nil
}

func allocateLibraryDirectoryName(name string, used map[string]struct{}) string {
	base := sanitizeExportBasename(name)
	for sequence := 1; ; sequence++ {
		candidate := base
		if sequence > 1 {
			candidate = fmt.Sprintf("%s (%d)", base, sequence)
		}
		if reserveLibraryEntries(used, candidate) {
			return candidate
		}
	}
}

func allocateLibraryNoteFilename(displayTitle string, hasAssets bool, used map[string]struct{}) string {
	base := sanitizeExportBasename(displayTitle)
	for sequence := 1; ; sequence++ {
		stem := base
		if sequence > 1 {
			stem = fmt.Sprintf("%s (%d)", base, sequence)
		}
		filename := stem + ".md"
		entries := []string{filename}
		if hasAssets {
			entries = append(entries, stem+".assets")
		}
		if reserveLibraryEntries(used, entries...) {
			return filename
		}
	}
}

func reserveLibraryEntries(used map[string]struct{}, entries ...string) bool {
	for _, entry := range entries {
		if _, exists := used[libraryCollisionKey(entry)]; exists {
			return false
		}
	}
	for _, entry := range entries {
		used[libraryCollisionKey(entry)] = struct{}{}
	}
	return true
}

func libraryCollisionKey(name string) string {
	return strings.ToLower(name)
}

func availableLibraryExportDirectory(parentDirectory string) (string, error) {
	for sequence := 1; ; sequence++ {
		name := libraryExportDirectoryName
		if sequence > 1 {
			name = fmt.Sprintf("%s (%d)", libraryExportDirectoryName, sequence)
		}
		candidate := filepath.Join(parentDirectory, name)
		_, err := os.Lstat(candidate)
		if errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		}
		if err != nil {
			return "", fmt.Errorf("inspect Markdown library export destination: %w", err)
		}
	}
}
