package persistence

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/savior714/flashnote/internal/document"
)

func TestRollingBackupCreatesContentAddressedRecoverySetAndPrunesArchivedBytes(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := Open(ctx, filepath.Join(root, "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	firstAttachment, err := store.IngestImage(ctx, testPNG(t), "recovery-a.png")
	if err != nil {
		t.Fatalf("IngestImage(first) error = %v", err)
	}
	secondAttachment, err := store.IngestImage(ctx, testPNG(t), "recovery-b.png")
	if err != nil {
		t.Fatalf("IngestImage(second) error = %v", err)
	}
	withImages := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + firstAttachment.ID + `","alt":"a","title":null,"width":null,"height":null}},{"type":"image","attrs":{"attachmentId":"` + secondAttachment.ID + `","alt":"b","title":null,"width":null,"height":null}}]}}`
	revision, err := store.SaveNote(ctx, note.ID, "Recovery images", withImages, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote(images) error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	firstPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup(first) error = %v", err)
	}
	firstID, err := recoverySnapshotID(firstPath)
	if err != nil {
		t.Fatalf("recoverySnapshotID() error = %v", err)
	}
	first, err := ValidateRecoverySnapshot(backupDir, firstID)
	if err != nil {
		t.Fatalf("ValidateRecoverySnapshot(first) error = %v", err)
	}
	if first.ID != firstID || first.AttachmentCount != 2 || first.CreatedAt.IsZero() {
		t.Fatalf("unexpected recovery snapshot: %+v", first)
	}

	manifest, err := readRecoveryManifest(backupDir, firstID)
	if err != nil {
		t.Fatalf("readRecoveryManifest() error = %v", err)
	}
	if manifest.DatabaseSHA256 == "" || manifest.DatabaseByteSize <= 0 {
		t.Fatalf("database digest missing from recovery manifest: %+v", manifest)
	}
	if len(manifest.Attachments) != 2 || manifest.Attachments[0].SHA256 == "" || manifest.Attachments[0].SHA256 != manifest.Attachments[1].SHA256 {
		t.Fatalf("identical attachment bytes were not content-addressed to one digest: %+v", manifest.Attachments)
	}
	archiveEntries, err := os.ReadDir(recoveryAttachmentArchiveDir(backupDir))
	if err != nil {
		t.Fatalf("ReadDir(attachment archive) error = %v", err)
	}
	if len(archiveEntries) != 1 || archiveEntries[0].Name() != manifest.Attachments[0].SHA256 {
		t.Fatalf("attachment archive entries = %+v, want one content-addressed blob", archiveEntries)
	}

	if _, err := store.SaveNote(ctx, note.ID, "No recovery images", document.EmptyJSON(), revision); err != nil {
		t.Fatalf("SaveNote(remove images) error = %v", err)
	}
	if err := store.ReconcileStoredAttachments(ctx, false); err != nil {
		t.Fatalf("ReconcileStoredAttachments() error = %v", err)
	}
	for _, storageName := range []string{firstAttachment.StorageName, secondAttachment.StorageName} {
		if _, err := os.Stat(filepath.Join(store.attachmentsDir, storageName)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("live attachment bytes %s survived reconciliation: %v", storageName, err)
		}
	}

	secondPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup(second) error = %v", err)
	}
	thirdPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup(third) error = %v", err)
	}

	if _, err := os.Stat(firstPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oldest snapshot still exists: %v", err)
	}
	if _, err := os.Stat(recoveryManifestPath(backupDir, firstID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oldest recovery manifest still exists: %v", err)
	}
	if _, err := os.Stat(recoveryAttachmentBlobPath(backupDir, manifest.Attachments[0].SHA256)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("content-addressed blob outlived every retained manifest: %v", err)
	}

	for _, path := range []string{secondPath, thirdPath} {
		id, err := recoverySnapshotID(path)
		if err != nil {
			t.Fatalf("recoverySnapshotID(%q) error = %v", path, err)
		}
		snapshot, err := ValidateRecoverySnapshot(backupDir, id)
		if err != nil {
			t.Fatalf("ValidateRecoverySnapshot(%s) error = %v", id, err)
		}
		if snapshot.AttachmentCount != 0 {
			t.Fatalf("snapshot %s attachment count = %d, want 0", id, snapshot.AttachmentCount)
		}
	}
	assertRecoverySetCounts(t, backupDir, 2, 2)
}

func TestValidateRecoverySnapshotRejectsTampering(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := Open(ctx, filepath.Join(root, "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	attachment, err := store.IngestImage(ctx, testPNG(t), "tamper.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	withImage := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":null,"title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "Tamper proof", withImage, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	path, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup() error = %v", err)
	}
	id, err := recoverySnapshotID(path)
	if err != nil {
		t.Fatalf("recoverySnapshotID() error = %v", err)
	}
	manifest, err := readRecoveryManifest(backupDir, id)
	if err != nil {
		t.Fatalf("readRecoveryManifest() error = %v", err)
	}
	blobPath := recoveryAttachmentBlobPath(backupDir, manifest.Attachments[0].SHA256)
	originalBlob, err := os.ReadFile(blobPath)
	if err != nil {
		t.Fatalf("ReadFile(blob) error = %v", err)
	}
	if err := os.WriteFile(blobPath, []byte("tampered"), 0o600); err != nil {
		t.Fatalf("WriteFile(tamper blob) error = %v", err)
	}
	if _, err := ValidateRecoverySnapshot(backupDir, id); err == nil || !strings.Contains(err.Error(), "archived attachment verification failed") {
		t.Fatalf("ValidateRecoverySnapshot(blob tamper) error = %v", err)
	}
	if err := os.WriteFile(blobPath, originalBlob, 0o600); err != nil {
		t.Fatalf("WriteFile(restore blob) error = %v", err)
	}

	databaseBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(database) error = %v", err)
	}
	databaseBytes[len(databaseBytes)-1] ^= 0x01
	if err := os.WriteFile(path, databaseBytes, 0o600); err != nil {
		t.Fatalf("WriteFile(tamper database) error = %v", err)
	}
	if _, err := ValidateRecoverySnapshot(backupDir, id); err == nil || !strings.Contains(err.Error(), "database digest does not match") {
		t.Fatalf("ValidateRecoverySnapshot(database tamper) error = %v", err)
	}
}

func TestRollingBackupDoesNotPublishIncompleteRecoverySet(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := Open(ctx, filepath.Join(root, "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	attachment, err := store.IngestImage(ctx, testPNG(t), "missing.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	withImage := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":null,"title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "Missing bytes", withImage, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}
	if err := os.Remove(filepath.Join(store.attachmentsDir, attachment.StorageName)); err != nil {
		t.Fatalf("Remove(live attachment) error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	if _, err := store.CreateRollingBackup(ctx, backupDir, 2); err == nil || !strings.Contains(err.Error(), "recovery attachment bytes missing") {
		t.Fatalf("CreateRollingBackup() error = %v, want missing attachment failure", err)
	}
	assertRecoverySetCounts(t, backupDir, 0, 0)
	archiveEntries, err := os.ReadDir(recoveryAttachmentArchiveDir(backupDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("ReadDir(attachment archive) error = %v", err)
	}
	if len(archiveEntries) != 0 {
		t.Fatalf("orphaned content-addressed blobs survived failed backup: %+v", archiveEntries)
	}
}

func assertRecoverySetCounts(t *testing.T, backupDir string, wantDatabases, wantManifests int) {
	t.Helper()
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("ReadDir(%q) error = %v", backupDir, err)
	}
	databases := 0
	manifests := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, backupFilenamePrefix) && strings.HasSuffix(name, backupFilenameSuffix) {
			databases++
		}
		if strings.HasPrefix(name, backupFilenamePrefix) && strings.HasSuffix(name, recoveryManifestSuffix) {
			manifests++
		}
	}
	if databases != wantDatabases || manifests != wantManifests {
		t.Fatalf("recovery set counts databases=%d manifests=%d, want %d/%d", databases, manifests, wantDatabases, wantManifests)
	}
}
