package persistence

import (
	"context"
	"errors"
	"testing"
)

func TestNoteTrashLifecyclePreservesFolderAndNormalBoundaries(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	folder, err := store.CreateFolder(ctx, "Archive source")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	note, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder() error = %v", err)
	}
	doc := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Trash lifecycle needle"}]}]}}`
	revision, err := store.SaveNote(ctx, note.ID, "Trash title", doc, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}
	note.Revision = revision

	results, err := store.SearchNotes(ctx, "needle")
	if err != nil || len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("pre-trash search results=%+v err=%v", results, err)
	}
	if err := store.MoveNoteToTrash(ctx, note.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}

	folderNotes, err := store.ListFolderNotes(ctx, folder.ID)
	if err != nil || len(folderNotes) != 0 {
		t.Fatalf("folder notes while trashed=%+v err=%v", folderNotes, err)
	}
	allNotes, err := store.ListNotes(ctx)
	if err != nil || len(allNotes) != 0 {
		t.Fatalf("normal notes while trashed=%+v err=%v", allNotes, err)
	}
	recent, err := store.SearchNotes(ctx, "")
	if err != nil || len(recent) != 0 {
		t.Fatalf("recent notes while trashed=%+v err=%v", recent, err)
	}
	results, err = store.SearchNotes(ctx, "needle")
	if err != nil || len(results) != 0 {
		t.Fatalf("search while trashed=%+v err=%v", results, err)
	}

	if _, err := store.OpenNote(ctx, note.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("OpenNote(trash) error=%v, want ErrNoteNotFound", err)
	}
	if _, err := store.SaveNote(ctx, note.ID, "blocked", doc, note.Revision); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("SaveNote(trash) error=%v, want ErrNoteNotFound", err)
	}
	if err := store.MoveNote(ctx, note.ID, ""); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("MoveNote(trash) error=%v, want ErrNoteNotFound", err)
	}

	trash, err := store.ListTrashNotes(ctx)
	if err != nil || len(trash) != 1 || trash[0].ID != note.ID {
		t.Fatalf("ListTrashNotes()=%+v err=%v", trash, err)
	}
	trashed, err := store.OpenTrashNote(ctx, note.ID)
	if err != nil || trashed.ID != note.ID || trashed.Title != "Trash title" || trashed.Revision != note.Revision {
		t.Fatalf("OpenTrashNote()=%+v err=%v", trashed, err)
	}
	var folderID string
	if err := store.db.QueryRowContext(ctx, `SELECT folder_id FROM notes WHERE id = ?`, note.ID).Scan(&folderID); err != nil || folderID != folder.ID {
		t.Fatalf("trash folder_id=%q err=%v want=%q", folderID, err, folder.ID)
	}

	if err := store.RestoreNote(ctx, note.ID); err != nil {
		t.Fatalf("RestoreNote() error = %v", err)
	}
	restored, err := store.OpenNote(ctx, note.ID)
	if err != nil || restored.ID != note.ID {
		t.Fatalf("OpenNote(restored)=%+v err=%v", restored, err)
	}
	folderNotes, err = store.ListFolderNotes(ctx, folder.ID)
	if err != nil || len(folderNotes) != 1 || folderNotes[0].ID != note.ID {
		t.Fatalf("restored folder notes=%+v err=%v", folderNotes, err)
	}
	results, err = store.SearchNotes(ctx, "needle")
	if err != nil || len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("restored search=%+v err=%v", results, err)
	}
	var searchVersion string
	if err := store.db.QueryRowContext(ctx, `SELECT value FROM app_meta WHERE key = ?`, searchIndexVersionKey).Scan(&searchVersion); err != nil || searchVersion != "2" {
		t.Fatalf("search index version=%q err=%v", searchVersion, err)
	}
}

func TestPermanentDeleteRequiresTrash(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()
	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if err := store.PermanentlyDeleteNote(ctx, note.ID); !errors.Is(err, ErrNoteNotInTrash) {
		t.Fatalf("PermanentlyDeleteNote(active) error=%v, want ErrNoteNotInTrash", err)
	}
	if err := store.RestoreNote(ctx, note.ID); !errors.Is(err, ErrNoteNotInTrash) {
		t.Fatalf("RestoreNote(active) error=%v, want ErrNoteNotInTrash", err)
	}
	if err := store.MoveNoteToTrash(ctx, note.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	if err := store.PermanentlyDeleteNote(ctx, note.ID); err != nil {
		t.Fatalf("PermanentlyDeleteNote(trash) error = %v", err)
	}
	if _, err := store.OpenTrashNote(ctx, note.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("OpenTrashNote(deleted) error=%v, want ErrNoteNotFound", err)
	}
	trash, err := store.ListTrashNotes(ctx)
	if err != nil || len(trash) != 0 {
		t.Fatalf("trash after permanent delete=%+v err=%v", trash, err)
	}
}
