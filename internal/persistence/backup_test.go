package persistence

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreateRollingBackupCreatesValidatedSnapshotAndPrunes(t *testing.T) {
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
	documentJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"rolling backup proof"}]}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "Backup proof", documentJSON, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	backupDir := filepath.Join(root, "backups")
	firstPath, err := store.CreateRollingBackup(ctx, backupDir, 2)
	if err != nil {
		t.Fatalf("CreateRollingBackup(first) error = %v", err)
	}
	if filepath.Dir(firstPath) != backupDir || !strings.HasSuffix(firstPath, backupFilenameSuffix) {
		t.Fatalf("unexpected backup path %q", firstPath)
	}
	assertBackupContainsNote(t, firstPath, note.ID, "Backup proof", "rolling backup proof")

	for i := 0; i < 2; i++ {
		if _, err := store.CreateRollingBackup(ctx, backupDir, 2); err != nil {
			t.Fatalf("CreateRollingBackup(%d) error = %v", i+2, err)
		}
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	finalized := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), backupFilenamePrefix) && strings.HasSuffix(entry.Name(), backupFilenameSuffix) {
			finalized++
		}
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Fatalf("temporary backup leaked: %s", entry.Name())
		}
	}
	if finalized != 2 {
		t.Fatalf("finalized backups = %d, want 2", finalized)
	}
	if _, err := os.Stat(firstPath); !os.IsNotExist(err) {
		t.Fatalf("oldest backup still exists or stat failed: %v", err)
	}
}

func TestCreateRollingBackupRejectsInvalidRetention(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	if _, err := store.CreateRollingBackup(ctx, t.TempDir(), 0); err == nil {
		t.Fatal("CreateRollingBackup() accepted zero retention")
	}
}

func assertBackupContainsNote(t *testing.T, path, noteID, wantTitle, wantText string) {
	t.Helper()
	if err := validateBackupDatabase(path); err != nil {
		t.Fatalf("validateBackupDatabase() error = %v", err)
	}

	db, err := sql.Open("sqlite", sqliteFileURI(path, true))
	if err != nil {
		t.Fatalf("open backup: %v", err)
	}
	defer db.Close()

	var title, documentJSON string
	if err := db.QueryRow(`SELECT title, document_json FROM notes WHERE id = ?`, noteID).Scan(&title, &documentJSON); err != nil {
		t.Fatalf("read backed-up note: %v", err)
	}
	if title != wantTitle {
		t.Fatalf("backup title = %q, want %q", title, wantTitle)
	}
	if !strings.Contains(documentJSON, wantText) {
		t.Fatalf("backup document does not contain %q: %s", wantText, documentJSON)
	}
}
