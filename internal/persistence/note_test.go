package persistence

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestListAndOpenNotesPreserveRecentOrderAndLastSelection(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	first, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	firstDocument := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Alpha "},{"type":"text","marks":[{"type":"bold"}],"text":"body"}]}]}}`
	firstRevision, err := store.SaveNote(ctx, first.ID, "", firstDocument, first.Revision)
	if err != nil {
		t.Fatalf("SaveNote(first) error = %v", err)
	}
	first.Revision = firstRevision

	time.Sleep(2 * time.Millisecond)
	second, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}
	secondRevision, err := store.SaveNote(ctx, second.ID, "Second note", second.DocumentJSON, second.Revision)
	if err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}
	second.Revision = secondRevision

	summaries, err := store.ListNotes(ctx)
	if err != nil {
		t.Fatalf("ListNotes() error = %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("ListNotes() len = %d, want 2", len(summaries))
	}
	if summaries[0].ID != second.ID || summaries[0].DisplayTitle != "Second note" {
		t.Fatalf("most recent summary = %+v, want second note", summaries[0])
	}
	if summaries[1].ID != first.ID || summaries[1].DisplayTitle != "Alpha body" {
		t.Fatalf("derived first summary = %+v, want Alpha body", summaries[1])
	}

	time.Sleep(2 * time.Millisecond)
	firstRevision, err = store.SaveNote(ctx, first.ID, "", firstDocument, first.Revision)
	if err != nil {
		t.Fatalf("SaveNote(first recent) error = %v", err)
	}
	first.Revision = firstRevision
	summaries, err = store.ListNotes(ctx)
	if err != nil {
		t.Fatalf("ListNotes() after recent save error = %v", err)
	}
	if summaries[0].ID != first.ID {
		t.Fatalf("recently saved note not first: %+v", summaries)
	}

	opened, err := store.OpenNote(ctx, second.ID)
	if err != nil {
		t.Fatalf("OpenNote(second) error = %v", err)
	}
	if opened.ID != second.ID || opened.Revision != second.Revision {
		t.Fatalf("opened note mismatch: %+v", opened)
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
	if created || reopened.ID != second.ID {
		t.Fatalf("last selection not restored: created=%t reopened=%+v", created, reopened)
	}
}

func TestOpenNoteWaitsForConcurrentWriter(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	store := openTestStore(t)
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}

	writerTx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin competing writer: %v", err)
	}
	defer writerTx.Rollback()
	if _, err := writerTx.ExecContext(ctx, `
		INSERT INTO app_meta(key, value, updated_at)
		VALUES ('concurrent_writer_probe', 'held', CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = CURRENT_TIMESTAMP
	`); err != nil {
		t.Fatalf("hold competing writer: %v", err)
	}

	type openResult struct {
		note Note
		err  error
	}
	resultCh := make(chan openResult, 1)
	go func() {
		opened, openErr := store.OpenNote(ctx, note.ID)
		resultCh <- openResult{note: opened, err: openErr}
	}()

	time.Sleep(100 * time.Millisecond)
	select {
	case result := <-resultCh:
		t.Fatalf("OpenNote returned before competing writer committed: note=%+v err=%v", result.note, result.err)
	default:
	}

	if err := writerTx.Commit(); err != nil {
		t.Fatalf("commit competing writer: %v", err)
	}

	select {
	case result := <-resultCh:
		if result.err != nil {
			t.Fatalf("OpenNote after competing writer error = %v", result.err)
		}
		if result.note.ID != note.ID {
			t.Fatalf("OpenNote after competing writer ID = %q, want %q", result.note.ID, note.ID)
		}
	case <-ctx.Done():
		t.Fatalf("OpenNote did not resume after competing writer committed: %v", ctx.Err())
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
