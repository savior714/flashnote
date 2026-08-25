package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/savior714/flashnote/internal/persistence"
)

const (
	rollingBackupInterval  = 6 * time.Hour
	rollingBackupRetention = 8
)

func startRollingBackups(parent context.Context, store *persistence.Store, backupDir string) func() {
	ctx, cancel := context.WithCancel(parent)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		runRollingBackups(ctx, store, backupDir)
	}()
	return func() {
		cancel()
		wg.Wait()
	}
}

func runRollingBackups(ctx context.Context, store *persistence.Store, backupDir string) {
	create := func(reason string) {
		path, err := store.CreateRollingBackup(ctx, backupDir, rollingBackupRetention)
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("FLASHNOTE_BACKUP_FAILED reason=%s error=%v", reason, err)
			}
			return
		}
		log.Printf("FLASHNOTE_BACKUP_CREATED reason=%s file=%s", reason, filepath.Base(path))
	}

	if rollingBackupDue(backupDir, time.Now(), rollingBackupInterval) {
		create("startup")
	}

	ticker := time.NewTicker(rollingBackupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			create("interval")
		}
	}
}

func rollingBackupDue(backupDir string, now time.Time, interval time.Duration) bool {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return true
	}

	var latest time.Time
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "flashnote-") || !strings.HasSuffix(entry.Name(), ".db") {
			continue
		}
		snapshotID := strings.TrimSuffix(entry.Name(), ".db")
		if !persistence.RecoverySnapshotPublished(backupDir, snapshotID) {
			// Legacy DB-only or partially published snapshots do not postpone the
			// first coherent database+attachment recovery set.
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return true
		}
		if info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	return latest.IsZero() || now.Sub(latest) >= interval
}
