package persistence

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestFoldersGroupNotesAndPreserveMembership(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	root, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, root.ID, "Root", root.DocumentJSON, root.Revision); err != nil {
		t.Fatalf("SaveNote(root) error = %v", err)
	}

	zeta, err := store.CreateFolder(ctx, "  Zeta  ")
	if err != nil {
		t.Fatalf("CreateFolder(Zeta) error = %v", err)
	}
	alpha, err := store.CreateFolder(ctx, "alpha")
	if err != nil {
		t.Fatalf("CreateFolder(alpha) error = %v", err)
	}
	folders, err := store.ListFolders(ctx)
	if err != nil {
		t.Fatalf("ListFolders() error = %v", err)
	}
	if len(folders) != 2 || folders[0].ID != alpha.ID || folders[1].ID != zeta.ID || zeta.Name != "Zeta" {
		t.Fatalf("unexpected folder order/content: %+v", folders)
	}

	first, err := store.CreateNoteInFolder(ctx, alpha.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(first) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, first.ID, "First", first.DocumentJSON, first.Revision); err != nil {
		t.Fatalf("SaveNote(first) error = %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	second, err := store.CreateNoteInFolder(ctx, alpha.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(second) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, second.ID, "Second", second.DocumentJSON, second.Revision); err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}

	folderNotes, err := store.ListFolderNotes(ctx, alpha.ID)
	if err != nil {
		t.Fatalf("ListFolderNotes() error = %v", err)
	}
	if len(folderNotes) != 2 || folderNotes[0].ID != second.ID || folderNotes[1].ID != first.ID {
		t.Fatalf("folder notes not modified-desc: %+v", folderNotes)
	}
	rootNotes, err := store.ListRootNotes(ctx)
	if err != nil {
		t.Fatalf("ListRootNotes() error = %v", err)
	}
	if len(rootNotes) != 1 || rootNotes[0].ID != root.ID {
		t.Fatalf("unexpected root notes before move: %+v", rootNotes)
	}

	if err := store.MoveNote(ctx, root.ID, zeta.ID); err != nil {
		t.Fatalf("MoveNote(to folder) error = %v", err)
	}
	rootNotes, err = store.ListRootNotes(ctx)
	if err != nil {
		t.Fatalf("ListRootNotes(after move) error = %v", err)
	}
	if len(rootNotes) != 0 {
		t.Fatalf("root note remained at root: %+v", rootNotes)
	}
	zetaNotes, err := store.ListFolderNotes(ctx, zeta.ID)
	if err != nil {
		t.Fatalf("ListFolderNotes(Zeta) error = %v", err)
	}
	if len(zetaNotes) != 1 || zetaNotes[0].ID != root.ID {
		t.Fatalf("moved note missing from folder: %+v", zetaNotes)
	}

	if err := store.MoveNote(ctx, root.ID, ""); err != nil {
		t.Fatalf("MoveNote(to root) error = %v", err)
	}
	rootNotes, err = store.ListRootNotes(ctx)
	if err != nil || len(rootNotes) != 1 || rootNotes[0].ID != root.ID {
		t.Fatalf("root restore results=%+v err=%v", rootNotes, err)
	}
}

func TestMovingNoteDoesNotChangeModifiedOrdering(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	older, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, older.ID, "Older", older.DocumentJSON, older.Revision); err != nil {
		t.Fatalf("SaveNote(older) error = %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	newer, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(newer) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, newer.ID, "Newer", newer.DocumentJSON, newer.Revision); err != nil {
		t.Fatalf("SaveNote(newer) error = %v", err)
	}
	folder, err := store.CreateFolder(ctx, "Folder")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	if err := store.MoveNote(ctx, older.ID, folder.ID); err != nil {
		t.Fatalf("MoveNote(to folder) error = %v", err)
	}
	if err := store.MoveNote(ctx, older.ID, ""); err != nil {
		t.Fatalf("MoveNote(to root) error = %v", err)
	}
	rootNotes, err := store.ListRootNotes(ctx)
	if err != nil {
		t.Fatalf("ListRootNotes() error = %v", err)
	}
	if len(rootNotes) != 2 || rootNotes[0].ID != newer.ID || rootNotes[1].ID != older.ID {
		t.Fatalf("move changed modified ordering: %+v", rootNotes)
	}
}

func TestFolderOperationsRejectInvalidTargets(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	if _, err := store.CreateFolder(ctx, "   "); !errors.Is(err, ErrInvalidFolderName) {
		t.Fatalf("CreateFolder(empty) error = %v, want ErrInvalidFolderName", err)
	}
	if _, err := store.CreateNoteInFolder(ctx, "missing"); !errors.Is(err, ErrFolderNotFound) {
		t.Fatalf("CreateNoteInFolder(missing) error = %v, want ErrFolderNotFound", err)
	}
	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if err := store.MoveNote(ctx, note.ID, "missing"); !errors.Is(err, ErrFolderNotFound) {
		t.Fatalf("MoveNote(missing folder) error = %v, want ErrFolderNotFound", err)
	}
	if err := store.MoveNote(ctx, "missing", ""); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("MoveNote(missing note) error = %v, want ErrNoteNotFound", err)
	}
}
