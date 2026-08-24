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

func NewExportService(store *persistence.Store) *ExportService {
	return &ExportService{store: store}
}

// ExportCurrentNoteMarkdown exports the exact normal note captured before the
// native Save dialog opens. Returning false with no error means the user
// cancelled the dialog.
func (s *ExportService) ExportCurrentNoteMarkdown() (bool, error) {
	ctx := context.Background()
	noteID, filename, err := s.store.CurrentNoteExportTarget(ctx)
	if err != nil {
		return false, err
	}

	app := application.Get()
	path, err := app.Dialog.SaveFile().
		SetTitle("Export Note as Markdown").
		SetFilename(filename).
		AddFilter("Markdown Files", "*.md").
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
			SetTitle("Export Failed").
			SetMessage(err.Error()).
			Show()
		return false, err
	}
	log.Printf("FLASHNOTE_NOTE_EXPORTED id=%s format=markdown", noteID)
	return true, nil
}
