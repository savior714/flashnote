package main

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"github.com/savior714/flashnote/internal/persistence"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type ExportService struct {
	store *persistence.Store
}

type ExportPresentation struct {
	MarkdownFiles string `json:"markdownFiles"`
	FailedTitle   string `json:"failedTitle"`
	FailedMessage string `json:"failedMessage"`
}

func NewExportService(store *persistence.Store) *ExportService {
	return &ExportService{store: store}
}

// ExportCurrentNoteMarkdown exports the exact admitted normal note as
// Markdown. The note identity is bound by the frontend export gate before
// the durability drain and passed in explicitly, so a concurrent note
// transition cannot redirect this export via the persisted last-note
// pointer at backend entry. Returning false with no error means the user
// cancelled the dialog.
func (s *ExportService) ExportCurrentNoteMarkdown(admittedNoteID string, presentation ExportPresentation) (bool, error) {
	ctx := context.Background()
	noteID, filename, err := s.store.ExactNoteExportTarget(ctx, admittedNoteID)
	if err != nil {
		return false, err
	}

	app := application.Get()
	path, err := app.Dialog.SaveFile().
		SetFilename(filename).
		AddFilter(presentation.MarkdownFiles, "*.md").
		PromptForSingleSelection()
	if err != nil {
		return false, fmt.Errorf("choose Markdown export destination: %w", err)
	}
	if path == "" {
		return false, nil
	}
	if filepath.Ext(path) == "" {
		path += ".md"
	}

	if err := s.store.ExportNoteMarkdown(ctx, noteID, path); err != nil {
		app.Dialog.Error().
			SetTitle(presentation.FailedTitle).
			SetMessage(presentation.FailedMessage).
			Show()
		return false, err
	}
	log.Printf("FLASHNOTE_NOTE_EXPORTED id=%s format=markdown", noteID)
	return true, nil
}

// ExportLibraryMarkdown asks for a parent directory, then creates a new
// collision-safe Flashnote Export directory containing every normal note.
// Returning an empty path with no error means the user cancelled the dialog.
func (s *ExportService) ExportLibraryMarkdown(presentation ExportPresentation) (string, error) {
	ctx := context.Background()
	app := application.Get()
	parentDirectory, err := app.Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("choose Markdown library export location: %w", err)
	}
	if parentDirectory == "" {
		return "", nil
	}

	exportDirectory, noteCount, folderCount, err := s.store.ExportLibraryMarkdown(ctx, parentDirectory)
	if err != nil {
		app.Dialog.Error().
			SetTitle(presentation.FailedTitle).
			SetMessage(presentation.FailedMessage).
			Show()
		return "", err
	}
	log.Printf("FLASHNOTE_LIBRARY_EXPORTED format=markdown notes=%d folders=%d", noteCount, folderCount)
	return exportDirectory, nil
}
