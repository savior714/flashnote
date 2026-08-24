package persistence

import (
	"context"
	"testing"
)

func TestStandaloneNoteRestoreFallsBackToRootWhenOriginalFolderIsInTrash(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	folder, err := store.CreateFolder(ctx, "Later deleted")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	note, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder() error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, note.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	if _, err := store.MoveFolderToTrash(ctx, folder.ID); err != nil {
		t.Fatalf("MoveFolderToTrash() error = %v", err)
	}
	if err := store.RestoreNote(ctx, note.ID); err != nil {
		t.Fatalf("RestoreNote() error = %v", err)
	}
	rootNotes, err := store.ListRootNotes(ctx)
	if err != nil || len(rootNotes) != 1 || rootNotes[0].ID != note.ID {
		t.Fatalf("root notes after restore=%+v err=%v", rootNotes, err)
	}
}
