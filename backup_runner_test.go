package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/savior714/flashnote/internal/persistence"
)

func TestRollingBackupDueRequiresRecentCoherentRecoverySet(t *testing.T) {
	root := t.TempDir()
	backupDir := filepath.Join(root, "backups")
	now := time.Date(2026, 8, 25, 0, 0, 0, 0, time.UTC)
	if !rollingBackupDue(backupDir, now, 6*time.Hour) {
		t.Fatal("missing backup directory should be due")
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	legacyPath := filepath.Join(backupDir, "flashnote-0000000000000000001-legacy.db")
	if err := os.WriteFile(legacyPath, []byte("legacy snapshot without coherent manifest"), 0o600); err != nil {
		t.Fatalf("WriteFile(legacy) error = %v", err)
	}
	if err := os.Chtimes(legacyPath, now.Add(-time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatalf("Chtimes(legacy) error = %v", err)
	}
	if !rollingBackupDue(backupDir, now, 6*time.Hour) {
		t.Fatal("legacy DB-only backup must not postpone a coherent recovery set")
	}

	store, err := persistence.Open(context.Background(), filepath.Join(root, "flashnote.db"))
	if err != nil {
		t.Fatalf("persistence.Open() error = %v", err)
	}
	defer store.Close()
	path, err := store.CreateRollingBackup(context.Background(), backupDir, 8)
	if err != nil {
		t.Fatalf("CreateRollingBackup() error = %v", err)
	}
	if err := os.Chtimes(path, now.Add(-5*time.Hour), now.Add(-5*time.Hour)); err != nil {
		t.Fatalf("Chtimes(recent) error = %v", err)
	}
	if rollingBackupDue(backupDir, now, 6*time.Hour) {
		t.Fatal("recent coherent recovery set should not be due")
	}

	if err := os.Chtimes(path, now.Add(-6*time.Hour), now.Add(-6*time.Hour)); err != nil {
		t.Fatalf("Chtimes(boundary) error = %v", err)
	}
	if !rollingBackupDue(backupDir, now, 6*time.Hour) {
		t.Fatal("coherent recovery set at interval boundary should be due")
	}
}
