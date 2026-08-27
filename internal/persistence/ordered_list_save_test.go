package persistence

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveNoteAcceptsCurrentTiptapOrderedListShapeAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	note, created, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if !created {
		t.Fatal("expected initial note to be created")
	}

	documentJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":1,"type":null},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Numbered item"}]}]}]}]}}`
	revision, err := store.SaveNote(ctx, note.ID, "Numbered", documentJSON, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote(current Tiptap ordered list) error = %v", err)
	}
	if revision != note.Revision+1 {
		t.Fatalf("SaveNote() revision = %d, want %d", revision, note.Revision+1)
	}

	loaded, err := store.OpenNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("OpenNote() after ordered-list save error = %v", err)
	}
	if loaded.Revision != revision || !strings.Contains(loaded.DocumentJSON, `"type":"orderedList"`) || !strings.Contains(loaded.DocumentJSON, `"text":"Numbered item"`) {
		t.Fatalf("saved ordered list missing after readback: %+v", loaded)
	}
	if strings.Contains(loaded.DocumentJSON, `"type":null`) {
		t.Fatalf("compatibility-only type:null persisted into canonical document: %s", loaded.DocumentJSON)
	}

	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	store, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen Store error = %v", err)
	}
	defer store.Close()

	reopened, created, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("reopen OpenInitialNote() error = %v", err)
	}
	if created {
		t.Fatal("ordered-list note was replaced instead of reopened")
	}
	if reopened.ID != note.ID || reopened.Revision != revision || !strings.Contains(reopened.DocumentJSON, `"text":"Numbered item"`) {
		t.Fatalf("ordered-list note did not survive reopen: %+v", reopened)
	}
	if strings.Contains(reopened.DocumentJSON, `"type":null`) {
		t.Fatalf("compatibility-only type:null reappeared after reopen: %s", reopened.DocumentJSON)
	}
}
