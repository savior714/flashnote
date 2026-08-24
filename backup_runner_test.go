package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRollingBackupDue(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 8, 25, 0, 0, 0, 0, time.UTC)
	if !rollingBackupDue(dir, now, 6*time.Hour) {
		t.Fatal("empty backup directory should be due")
	}

	path := filepath.Join(dir, "flashnote-0000000000000000001-test.db")
	if err := os.WriteFile(path, []byte("snapshot"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if err := os.Chtimes(path, now.Add(-5*time.Hour), now.Add(-5*time.Hour)); err != nil {
		t.Fatalf("Chtimes() error = %v", err)
	}
	if rollingBackupDue(dir, now, 6*time.Hour) {
		t.Fatal("recent backup should not be due")
	}

	if err := os.Chtimes(path, now.Add(-6*time.Hour), now.Add(-6*time.Hour)); err != nil {
		t.Fatalf("Chtimes() error = %v", err)
	}
	if !rollingBackupDue(dir, now, 6*time.Hour) {
		t.Fatal("backup at interval boundary should be due")
	}
}
