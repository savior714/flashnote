package persistence

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/savior714/flashnote/internal/document"
)

func TestMaterializeRecoverySnapshotRestoresNoteAndAttachment(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	sourceDatabase := filepath.Join(root, "source", "flashnote.db")
	store, err := Open(ctx, sourceDatabase)
	if err != nil {
		t.Fatalf("Open(source) error = %v", err)
	}
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	content := testPNG(t)
	attachment, err := store.IngestImage(ctx, content, "restore.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	withImage := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"restore proof"}]},{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":"restore.png","title":null,"width":null,"height":null}}]}}`
	backupRevision, err := store.SaveNote(ctx, note.ID, "Recovery point", withImage, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote(recovery point) error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	backupPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup() error = %v", err)
	}
	snapshotID, err := recoverySnapshotID(backupPath)
	if err != nil {
		t.Fatalf("recoverySnapshotID() error = %v", err)
	}

	if _, err := store.SaveNote(ctx, note.ID, "Changed after backup", document.EmptyJSON(), backupRevision); err != nil {
		t.Fatalf("SaveNote(post-backup change) error = %v", err)
	}
	if err := store.ReconcileStoredAttachments(ctx, false); err != nil {
		t.Fatalf("ReconcileStoredAttachments() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.attachmentsDir, attachment.StorageName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source attachment survived post-backup removal: %v", err)
	}

	targetRoot := filepath.Join(root, "materialized")
	restoredDatabase, err := MaterializeRecoverySnapshot(ctx, backupDir, snapshotID, targetRoot)
	if err != nil {
		t.Fatalf("MaterializeRecoverySnapshot() error = %v", err)
	}
	if restoredDatabase != filepath.Join(targetRoot, "flashnote.db") {
		t.Fatalf("restored database path = %q", restoredDatabase)
	}

	restoredStore, err := Open(ctx, restoredDatabase)
	if err != nil {
		t.Fatalf("Open(restored) error = %v", err)
	}
	defer restoredStore.Close()
	if err := restoredStore.ReconcileStoredAttachments(ctx, true); err != nil {
		t.Fatalf("ReconcileStoredAttachments(restored) error = %v", err)
	}
	restoredNote, err := restoredStore.OpenNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("OpenNote(restored) error = %v", err)
	}
	if restoredNote.Title != "Recovery point" || !strings.Contains(restoredNote.DocumentJSON, "restore proof") || !strings.Contains(restoredNote.DocumentJSON, attachment.ID) {
		t.Fatalf("restored note does not match recovery point: %+v", restoredNote)
	}
	if err := restoredStore.ValidateDocumentAttachments(ctx, restoredNote.DocumentJSON); err != nil {
		t.Fatalf("ValidateDocumentAttachments(restored) error = %v", err)
	}
	opened, err := restoredStore.OpenAttachment(ctx, attachment.ID)
	if err != nil {
		t.Fatalf("OpenAttachment(restored) error = %v", err)
	}
	restoredBytes := make([]byte, len(content))
	if _, err := opened.File.Read(restoredBytes); err != nil {
		opened.File.Close()
		t.Fatalf("read restored attachment: %v", err)
	}
	if err := opened.File.Close(); err != nil {
		t.Fatalf("close restored attachment: %v", err)
	}
	if !bytes.Equal(restoredBytes, content) {
		t.Fatal("restored attachment bytes differ from recovery point")
	}
}

func TestMaterializeRecoverySnapshotFailsClosedOnTamperedSet(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := Open(ctx, filepath.Join(root, "source", "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	attachment, err := store.IngestImage(ctx, testPNG(t), "tampered-restore.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	withImage := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":null,"title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "Tamper restore", withImage, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	backupPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup() error = %v", err)
	}
	snapshotID, err := recoverySnapshotID(backupPath)
	if err != nil {
		t.Fatalf("recoverySnapshotID() error = %v", err)
	}
	manifest, err := readRecoveryManifest(backupDir, snapshotID)
	if err != nil {
		t.Fatalf("readRecoveryManifest() error = %v", err)
	}
	if err := os.WriteFile(recoveryAttachmentBlobPath(backupDir, manifest.Attachments[0].SHA256), []byte("tampered"), 0o600); err != nil {
		t.Fatalf("WriteFile(tampered blob) error = %v", err)
	}

	targetRoot := filepath.Join(root, "must-not-exist")
	if _, err := MaterializeRecoverySnapshot(ctx, backupDir, snapshotID, targetRoot); err == nil {
		t.Fatal("MaterializeRecoverySnapshot() accepted tampered recovery set")
	}
	if _, err := os.Lstat(targetRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed materialization published a target library: %v", err)
	}
}

func TestMaterializeRecoverySnapshotNeverClobbersExistingTarget(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := Open(ctx, filepath.Join(root, "source", "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()
	if _, _, err := store.OpenInitialNote(ctx); err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	backupPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup() error = %v", err)
	}
	snapshotID, err := recoverySnapshotID(backupPath)
	if err != nil {
		t.Fatalf("recoverySnapshotID() error = %v", err)
	}

	targetRoot := filepath.Join(root, "existing")
	if err := os.Mkdir(targetRoot, 0o700); err != nil {
		t.Fatalf("Mkdir(target) error = %v", err)
	}
	sentinel := filepath.Join(targetRoot, "keep.txt")
	if err := os.WriteFile(sentinel, []byte("keep"), 0o600); err != nil {
		t.Fatalf("WriteFile(sentinel) error = %v", err)
	}
	if _, err := MaterializeRecoverySnapshot(ctx, backupDir, snapshotID, targetRoot); err == nil || !strings.Contains(err.Error(), "target already exists") {
		t.Fatalf("MaterializeRecoverySnapshot(existing target) error = %v", err)
	}
	value, err := os.ReadFile(sentinel)
	if err != nil {
		t.Fatalf("ReadFile(sentinel) error = %v", err)
	}
	if string(value) != "keep" {
		t.Fatalf("existing target was modified: %q", value)
	}
}
