package persistence

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func activeNoteRowIDs(t *testing.T, ctx context.Context, store *Store) []string {
	t.Helper()
	rows, err := store.db.QueryContext(ctx, `SELECT id FROM notes WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		t.Fatalf("query active note ids error = %v", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan active note id error = %v", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate active note ids error = %v", err)
	}
	return ids
}

func activeFolderRowIDs(t *testing.T, ctx context.Context, store *Store) []string {
	t.Helper()
	rows, err := store.db.QueryContext(ctx, `SELECT id FROM folders WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		t.Fatalf("query active folder ids error = %v", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan active folder id error = %v", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate active folder ids error = %v", err)
	}
	return ids
}

func physicalTrashRowCounts(t *testing.T, ctx context.Context, store *Store) (int, int) {
	t.Helper()
	var noteCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL`).Scan(&noteCount); err != nil {
		t.Fatalf("count physically trashed notes error = %v", err)
	}
	var folderCount int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM folders WHERE deleted_at IS NOT NULL`).Scan(&folderCount); err != nil {
		t.Fatalf("count physically trashed folders error = %v", err)
	}
	return noteCount, folderCount
}

func TestEmptyTrashPreservesEntireActiveLibrarySet(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	activeRoot, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	activeFolder, err := store.CreateFolder(ctx, "Active folder")
	if err != nil {
		t.Fatalf("CreateFolder(active) error = %v", err)
	}
	activeChild, err := store.CreateNoteInFolder(ctx, activeFolder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(active) error = %v", err)
	}

	activeNotesBefore := activeNoteRowIDs(t, ctx, store)
	activeFoldersBefore := activeFolderRowIDs(t, ctx, store)
	if len(activeNotesBefore) != 2 || len(activeFoldersBefore) != 1 {
		t.Fatalf("unexpected active baseline notes=%v folders=%v", activeNotesBefore, activeFoldersBefore)
	}

	standaloneTrash, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(standalone trash) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, standaloneTrash.ID); err != nil {
		t.Fatalf("MoveNoteToTrash(standalone) error = %v", err)
	}

	recoveryFolder, err := store.CreateFolder(ctx, "Recovery unit")
	if err != nil {
		t.Fatalf("CreateFolder(recovery) error = %v", err)
	}
	recoveryChild, err := store.CreateNoteInFolder(ctx, recoveryFolder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(recovery) error = %v", err)
	}
	if moved, err := store.MoveFolderToTrash(ctx, recoveryFolder.ID); err != nil || moved != 1 {
		t.Fatalf("MoveFolderToTrash(recovery) moved=%d err=%v, want 1/nil", moved, err)
	}

	emptyTrashFolder, err := store.CreateFolder(ctx, "Empty trash folder")
	if err != nil {
		t.Fatalf("CreateFolder(empty trash) error = %v", err)
	}
	if moved, err := store.MoveFolderToTrash(ctx, emptyTrashFolder.ID); err != nil || moved != 0 {
		t.Fatalf("MoveFolderToTrash(empty trash) moved=%d err=%v, want 0/nil", moved, err)
	}

	noteCount, folderCount, err := store.TrashCounts(ctx)
	if err != nil || noteCount != 2 || folderCount != 2 {
		t.Fatalf("TrashCounts(before) notes=%d folders=%d err=%v, want 2/2", noteCount, folderCount, err)
	}
	physicalNotes, physicalFolders := physicalTrashRowCounts(t, ctx, store)
	if noteCount != physicalNotes || folderCount != physicalFolders {
		t.Fatalf("TrashCounts(before)=%d/%d physical=%d/%d", noteCount, folderCount, physicalNotes, physicalFolders)
	}

	standalone, err := store.ListTrashNotes(ctx)
	if err != nil || len(standalone) != 1 || standalone[0].ID != standaloneTrash.ID {
		t.Fatalf("ListTrashNotes()=%+v err=%v", standalone, err)
	}
	grouped, err := store.ListTrashFolderNotes(ctx, recoveryFolder.ID)
	if err != nil || len(grouped) != 1 || grouped[0].ID != recoveryChild.ID {
		t.Fatalf("ListTrashFolderNotes(recovery)=%+v err=%v", grouped, err)
	}

	deletedNotes, deletedFolders, err := store.EmptyTrash(ctx)
	if err != nil || deletedNotes != 2 || deletedFolders != 2 {
		t.Fatalf("EmptyTrash() notes=%d folders=%d err=%v, want 2/2", deletedNotes, deletedFolders, err)
	}

	activeNotesAfter := activeNoteRowIDs(t, ctx, store)
	activeFoldersAfter := activeFolderRowIDs(t, ctx, store)
	if !reflect.DeepEqual(activeNotesAfter, activeNotesBefore) {
		t.Fatalf("active note IDs changed by EmptyTrash: before=%v after=%v", activeNotesBefore, activeNotesAfter)
	}
	if !reflect.DeepEqual(activeFoldersAfter, activeFoldersBefore) {
		t.Fatalf("active folder IDs changed by EmptyTrash: before=%v after=%v", activeFoldersBefore, activeFoldersAfter)
	}

	rootNotes, err := store.ListRootNotes(ctx)
	if err != nil || len(rootNotes) != 1 || rootNotes[0].ID != activeRoot.ID {
		t.Fatalf("active root after EmptyTrash=%+v err=%v", rootNotes, err)
	}
	folders, err := store.ListFolders(ctx)
	if err != nil || len(folders) != 1 || folders[0].ID != activeFolder.ID {
		t.Fatalf("active folders after EmptyTrash=%+v err=%v", folders, err)
	}
	children, err := store.ListFolderNotes(ctx, activeFolder.ID)
	if err != nil || len(children) != 1 || children[0].ID != activeChild.ID {
		t.Fatalf("active folder children after EmptyTrash=%+v err=%v", children, err)
	}
	if opened, err := store.OpenNote(ctx, activeRoot.ID); err != nil || opened.ID != activeRoot.ID {
		t.Fatalf("OpenNote(active root)=%+v err=%v", opened, err)
	}
	if opened, err := store.OpenNote(ctx, activeChild.ID); err != nil || opened.ID != activeChild.ID {
		t.Fatalf("OpenNote(active child)=%+v err=%v", opened, err)
	}

	var canonicalActiveNotes int
	if err := store.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM notes
		WHERE id IN (?, ?)
		  AND deleted_at IS NULL
		  AND deleted_with_folder_id IS NULL
	`, activeRoot.ID, activeChild.ID).Scan(&canonicalActiveNotes); err != nil {
		t.Fatalf("read active note truth error = %v", err)
	}
	if canonicalActiveNotes != 2 {
		t.Fatalf("canonical active note truth count=%d, want 2", canonicalActiveNotes)
	}

	noteCount, folderCount, err = store.TrashCounts(ctx)
	if err != nil || noteCount != 0 || folderCount != 0 {
		t.Fatalf("TrashCounts(after) notes=%d folders=%d err=%v, want 0/0", noteCount, folderCount, err)
	}
	physicalNotes, physicalFolders = physicalTrashRowCounts(t, ctx, store)
	if physicalNotes != 0 || physicalFolders != 0 {
		t.Fatalf("physical trash rows after EmptyTrash=%d/%d, want 0/0", physicalNotes, physicalFolders)
	}
	if _, err := store.OpenTrashNote(ctx, standaloneTrash.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("standalone trash survived EmptyTrash: %v", err)
	}
	if _, err := store.ListTrashFolderNotes(ctx, recoveryFolder.ID); !errors.Is(err, ErrFolderNotFound) {
		t.Fatalf("recovery folder survived EmptyTrash: %v", err)
	}
}

func TestPermanentFolderDeletePreservesUnrelatedActiveLibrarySet(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	activeRoot, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	activeFolder, err := store.CreateFolder(ctx, "Unrelated active folder")
	if err != nil {
		t.Fatalf("CreateFolder(active) error = %v", err)
	}
	activeChild, err := store.CreateNoteInFolder(ctx, activeFolder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(active) error = %v", err)
	}

	targetFolder, err := store.CreateFolder(ctx, "Delete recovery unit")
	if err != nil {
		t.Fatalf("CreateFolder(target) error = %v", err)
	}
	standaloneTrash, err := store.CreateNoteInFolder(ctx, targetFolder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(standalone) error = %v", err)
	}
	groupedTrash, err := store.CreateNoteInFolder(ctx, targetFolder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(grouped) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, standaloneTrash.ID); err != nil {
		t.Fatalf("MoveNoteToTrash(standalone) error = %v", err)
	}
	if moved, err := store.MoveFolderToTrash(ctx, targetFolder.ID); err != nil || moved != 1 {
		t.Fatalf("MoveFolderToTrash(target) moved=%d err=%v, want 1/nil", moved, err)
	}

	activeNotesBefore := activeNoteRowIDs(t, ctx, store)
	activeFoldersBefore := activeFolderRowIDs(t, ctx, store)
	if len(activeNotesBefore) != 2 || len(activeFoldersBefore) != 1 {
		t.Fatalf("unexpected unrelated active baseline notes=%v folders=%v", activeNotesBefore, activeFoldersBefore)
	}
	noteCount, folderCount, err := store.TrashCounts(ctx)
	if err != nil || noteCount != 2 || folderCount != 1 {
		t.Fatalf("TrashCounts(before permanent folder delete)=%d/%d err=%v, want 2/1", noteCount, folderCount, err)
	}
	physicalNotes, physicalFolders := physicalTrashRowCounts(t, ctx, store)
	if noteCount != physicalNotes || folderCount != physicalFolders {
		t.Fatalf("TrashCounts(before permanent delete)=%d/%d physical=%d/%d", noteCount, folderCount, physicalNotes, physicalFolders)
	}

	deleted, err := store.PermanentlyDeleteFolder(ctx, targetFolder.ID)
	if err != nil || deleted != 1 {
		t.Fatalf("PermanentlyDeleteFolder() deleted=%d err=%v, want 1/nil", deleted, err)
	}

	activeNotesAfter := activeNoteRowIDs(t, ctx, store)
	activeFoldersAfter := activeFolderRowIDs(t, ctx, store)
	if !reflect.DeepEqual(activeNotesAfter, activeNotesBefore) {
		t.Fatalf("active note IDs changed by permanent folder delete: before=%v after=%v", activeNotesBefore, activeNotesAfter)
	}
	if !reflect.DeepEqual(activeFoldersAfter, activeFoldersBefore) {
		t.Fatalf("active folder IDs changed by permanent folder delete: before=%v after=%v", activeFoldersBefore, activeFoldersAfter)
	}
	if opened, err := store.OpenNote(ctx, activeRoot.ID); err != nil || opened.ID != activeRoot.ID {
		t.Fatalf("OpenNote(unrelated root)=%+v err=%v", opened, err)
	}
	children, err := store.ListFolderNotes(ctx, activeFolder.ID)
	if err != nil || len(children) != 1 || children[0].ID != activeChild.ID {
		t.Fatalf("unrelated active folder child after permanent delete=%+v err=%v", children, err)
	}

	standalone, err := store.ListTrashNotes(ctx)
	if err != nil || len(standalone) != 1 || standalone[0].ID != standaloneTrash.ID {
		t.Fatalf("standalone trash changed by permanent folder delete=%+v err=%v", standalone, err)
	}
	if _, err := store.OpenTrashNote(ctx, groupedTrash.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("grouped recovery-unit note survived permanent folder delete: %v", err)
	}
	var folderID any
	if err := store.db.QueryRowContext(ctx, `SELECT folder_id FROM notes WHERE id = ?`, standaloneTrash.ID).Scan(&folderID); err != nil {
		t.Fatalf("read standalone trash folder_id error = %v", err)
	}
	if folderID != nil {
		t.Fatalf("standalone trash folder_id=%v, want NULL after target folder deletion", folderID)
	}

	noteCount, folderCount, err = store.TrashCounts(ctx)
	if err != nil || noteCount != 1 || folderCount != 0 {
		t.Fatalf("TrashCounts(after permanent folder delete)=%d/%d err=%v, want 1/0", noteCount, folderCount, err)
	}
	physicalNotes, physicalFolders = physicalTrashRowCounts(t, ctx, store)
	if noteCount != physicalNotes || folderCount != physicalFolders {
		t.Fatalf("TrashCounts(after permanent delete)=%d/%d physical=%d/%d", noteCount, folderCount, physicalNotes, physicalFolders)
	}
}
