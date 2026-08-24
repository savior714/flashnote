package persistence

import (
	"context"
	"errors"
	"testing"
)

func TestFolderTrashRecoveryUnitRestoresOnlyNotesDeletedWithFolder(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	folder, err := store.CreateFolder(ctx, "Recovery unit")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	individuallyDeleted, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(individual) error = %v", err)
	}
	grouped, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(grouped) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, grouped.ID, "Grouped note", grouped.DocumentJSON, grouped.Revision); err != nil {
		t.Fatalf("SaveNote(grouped) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, individuallyDeleted.ID); err != nil {
		t.Fatalf("MoveNoteToTrash(individual) error = %v", err)
	}

	moved, err := store.MoveFolderToTrash(ctx, folder.ID)
	if err != nil {
		t.Fatalf("MoveFolderToTrash() error = %v", err)
	}
	if moved != 1 {
		t.Fatalf("MoveFolderToTrash() moved=%d, want 1", moved)
	}

	folders, err := store.ListFolders(ctx)
	if err != nil || len(folders) != 0 {
		t.Fatalf("normal folders after trash=%+v err=%v", folders, err)
	}
	if _, err := store.ListFolderNotes(ctx, folder.ID); !errors.Is(err, ErrFolderNotFound) {
		t.Fatalf("ListFolderNotes(trashed folder) error=%v, want ErrFolderNotFound", err)
	}
	trashFolders, err := store.ListTrashFolders(ctx)
	if err != nil || len(trashFolders) != 1 || trashFolders[0].ID != folder.ID {
		t.Fatalf("ListTrashFolders()=%+v err=%v", trashFolders, err)
	}
	groupedNotes, err := store.ListTrashFolderNotes(ctx, folder.ID)
	if err != nil || len(groupedNotes) != 1 || groupedNotes[0].ID != grouped.ID {
		t.Fatalf("ListTrashFolderNotes()=%+v err=%v", groupedNotes, err)
	}
	standaloneTrash, err := store.ListTrashNotes(ctx)
	if err != nil || len(standaloneTrash) != 1 || standaloneTrash[0].ID != individuallyDeleted.ID {
		t.Fatalf("ListTrashNotes()=%+v err=%v", standaloneTrash, err)
	}
	if err := store.RestoreNote(ctx, grouped.ID); !errors.Is(err, ErrNotePartOfFolderTrash) {
		t.Fatalf("RestoreNote(grouped) error=%v, want ErrNotePartOfFolderTrash", err)
	}
	if err := store.PermanentlyDeleteNote(ctx, grouped.ID); !errors.Is(err, ErrNotePartOfFolderTrash) {
		t.Fatalf("PermanentlyDeleteNote(grouped) error=%v, want ErrNotePartOfFolderTrash", err)
	}

	restoredCount, err := store.RestoreFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("RestoreFolder() error = %v", err)
	}
	if restoredCount != 1 {
		t.Fatalf("RestoreFolder() restored=%d, want 1", restoredCount)
	}
	folderNotes, err := store.ListFolderNotes(ctx, folder.ID)
	if err != nil || len(folderNotes) != 1 || folderNotes[0].ID != grouped.ID {
		t.Fatalf("folder notes after restore=%+v err=%v", folderNotes, err)
	}
	standaloneTrash, err = store.ListTrashNotes(ctx)
	if err != nil || len(standaloneTrash) != 1 || standaloneTrash[0].ID != individuallyDeleted.ID {
		t.Fatalf("individual trash changed by folder restore=%+v err=%v", standaloneTrash, err)
	}
	if err := store.RestoreNote(ctx, individuallyDeleted.ID); err != nil {
		t.Fatalf("RestoreNote(individual) error = %v", err)
	}
	folderNotes, err = store.ListFolderNotes(ctx, folder.ID)
	if err != nil || len(folderNotes) != 2 {
		t.Fatalf("folder notes after individual restore=%+v err=%v", folderNotes, err)
	}
}

func TestPermanentFolderDeleteRemovesRecoveryUnitButKeepsEarlierStandaloneTrash(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	folder, err := store.CreateFolder(ctx, "Delete unit")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	standalone, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(standalone) error = %v", err)
	}
	grouped, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(grouped) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, standalone.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	if _, err := store.MoveFolderToTrash(ctx, folder.ID); err != nil {
		t.Fatalf("MoveFolderToTrash() error = %v", err)
	}

	deletedCount, err := store.PermanentlyDeleteFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("PermanentlyDeleteFolder() error = %v", err)
	}
	if deletedCount != 1 {
		t.Fatalf("PermanentlyDeleteFolder() deleted=%d, want 1", deletedCount)
	}
	if _, err := store.OpenTrashNote(ctx, grouped.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("grouped note survived permanent folder delete: %v", err)
	}
	standaloneTrash, err := store.ListTrashNotes(ctx)
	if err != nil || len(standaloneTrash) != 1 || standaloneTrash[0].ID != standalone.ID {
		t.Fatalf("standalone trash after folder delete=%+v err=%v", standaloneTrash, err)
	}
	var folderID any
	if err := store.db.QueryRowContext(ctx, `SELECT folder_id FROM notes WHERE id = ?`, standalone.ID).Scan(&folderID); err != nil {
		t.Fatalf("read standalone folder_id error = %v", err)
	}
	if folderID != nil {
		t.Fatalf("standalone folder_id=%v, want NULL after folder deletion", folderID)
	}
	if _, err := store.ListTrashFolderNotes(ctx, folder.ID); !errors.Is(err, ErrFolderNotFound) {
		t.Fatalf("ListTrashFolderNotes(deleted folder) error=%v, want ErrFolderNotFound", err)
	}
}

func TestEmptyTrashDeletesTrashAndPreservesNormalLibrary(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	survivor, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	standalone, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(standalone) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, standalone.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	unitFolder, err := store.CreateFolder(ctx, "Unit")
	if err != nil {
		t.Fatalf("CreateFolder(unit) error = %v", err)
	}
	if _, err := store.CreateNoteInFolder(ctx, unitFolder.ID); err != nil {
		t.Fatalf("CreateNoteInFolder(unit) error = %v", err)
	}
	if _, err := store.MoveFolderToTrash(ctx, unitFolder.ID); err != nil {
		t.Fatalf("MoveFolderToTrash(unit) error = %v", err)
	}
	emptyFolder, err := store.CreateFolder(ctx, "Empty")
	if err != nil {
		t.Fatalf("CreateFolder(empty) error = %v", err)
	}
	if moved, err := store.MoveFolderToTrash(ctx, emptyFolder.ID); err != nil || moved != 0 {
		t.Fatalf("MoveFolderToTrash(empty) moved=%d err=%v", moved, err)
	}

	noteCount, folderCount, err := store.TrashCounts(ctx)
	if err != nil || noteCount != 2 || folderCount != 2 {
		t.Fatalf("TrashCounts() notes=%d folders=%d err=%v, want 2/2", noteCount, folderCount, err)
	}
	deletedNotes, deletedFolders, err := store.EmptyTrash(ctx)
	if err != nil || deletedNotes != 2 || deletedFolders != 2 {
		t.Fatalf("EmptyTrash() notes=%d folders=%d err=%v, want 2/2", deletedNotes, deletedFolders, err)
	}
	noteCount, folderCount, err = store.TrashCounts(ctx)
	if err != nil || noteCount != 0 || folderCount != 0 {
		t.Fatalf("TrashCounts(after empty) notes=%d folders=%d err=%v", noteCount, folderCount, err)
	}
	opened, err := store.OpenNote(ctx, survivor.ID)
	if err != nil || opened.ID != survivor.ID {
		t.Fatalf("normal survivor after EmptyTrash=%+v err=%v", opened, err)
	}
}
