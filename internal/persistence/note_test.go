package persistence

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestInitialNotePersistsAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	first, created, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if !created {
		t.Fatal("expected initial note to be created")
	}
	if first.ID == "" || first.Revision != 1 {
		t.Fatalf("unexpected initial note: %+v", first)
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
		t.Fatal("did not expect a replacement note")
	}
	if reopened.ID != first.ID || reopened.Revision != first.Revision {
		t.Fatalf("reopened note mismatch: first=%+v reopened=%+v", first, reopened)
	}
}

func TestSaveNoteAdvancesRevisionAndRejectsStaleWrite(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}

	documentJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"durable"}]}]}}`
	revision, err := store.SaveNote(ctx, note.ID, "Title", documentJSON, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}
	if revision != 2 {
		t.Fatalf("revision = %d, want 2", revision)
	}

	_, err = store.SaveNote(ctx, note.ID, "stale", documentJSON, note.Revision)
	if !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("expected ErrRevisionConflict, got %v", err)
	}

	loaded, created, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() after save error = %v", err)
	}
	if created {
		t.Fatal("saved note should remain initial note")
	}
	if loaded.Title != "Title" || loaded.Revision != 2 || !strings.Contains(loaded.DocumentJSON, `"text":"durable"`) {
		t.Fatalf("stale write mutated note: %+v", loaded)
	}
}

func TestSaveNoteRejectsInvalidDocumentWithoutMutation(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}

	_, err = store.SaveNote(ctx, note.ID, "bad", `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"table"}]}}`, note.Revision)
	if err == nil {
		t.Fatal("expected invalid document error")
	}

	loaded, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() after rejected save error = %v", err)
	}
	if loaded.Title != "" || loaded.Revision != 1 {
		t.Fatalf("invalid save mutated note: %+v", loaded)
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	return store
}
