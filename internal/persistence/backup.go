package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	sqlite "modernc.org/sqlite"
)

const (
	backupFilenamePrefix = "flashnote-"
	backupFilenameSuffix = ".db"
	backupStepPages      = int32(128)
)

type sqliteBackupConnection interface {
	NewBackup(string) (*sqlite.Backup, error)
}

// CreateRollingBackup creates one validated SQLite snapshot and retains only the
// newest retention finalized snapshots in backupDir.
func (s *Store) CreateRollingBackup(ctx context.Context, backupDir string, retention int) (string, error) {
	if retention < 1 {
		return "", errors.New("backup retention must be positive")
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return "", fmt.Errorf("create backup directory: %w", err)
	}

	tempFile, err := os.CreateTemp(backupDir, ".flashnote-backup-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create backup temp file: %w", err)
	}
	tempPath := tempFile.Name()
	if err := tempFile.Close(); err != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("close backup temp file: %w", err)
	}
	if err := os.Remove(tempPath); err != nil {
		return "", fmt.Errorf("prepare backup temp path: %w", err)
	}
	cleanupTemp := true
	defer func() {
		if cleanupTemp {
			_ = os.Remove(tempPath)
		}
	}()

	if err := s.copyOnlineBackup(ctx, tempPath); err != nil {
		return "", err
	}
	if err := validateBackupDatabase(tempPath); err != nil {
		return "", err
	}
	if err := os.Chmod(tempPath, 0o600); err != nil {
		return "", fmt.Errorf("secure backup snapshot: %w", err)
	}

	randomToken := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(tempPath), ".flashnote-backup-"), ".tmp")
	finalName := fmt.Sprintf("%s%019d-%s%s", backupFilenamePrefix, time.Now().UTC().UnixNano(), randomToken, backupFilenameSuffix)
	finalPath := filepath.Join(backupDir, finalName)
	if err := os.Rename(tempPath, finalPath); err != nil {
		return "", fmt.Errorf("promote backup snapshot: %w", err)
	}
	cleanupTemp = false

	if err := pruneRollingBackups(backupDir, retention); err != nil {
		return finalPath, fmt.Errorf("prune rolling backups: %w", err)
	}
	return finalPath, nil
}

func (s *Store) copyOnlineBackup(ctx context.Context, destinationPath string) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire source backup connection: %w", err)
	}
	defer conn.Close()

	return conn.Raw(func(driverConn any) error {
		source, ok := driverConn.(sqliteBackupConnection)
		if !ok {
			return errors.New("sqlite driver does not expose online backup")
		}
		backup, err := source.NewBackup(sqliteFileURI(destinationPath, false))
		if err != nil {
			return fmt.Errorf("initialize online backup: %w", err)
		}
		finished := false
		defer func() {
			if !finished {
				_ = backup.Finish()
			}
		}()

		for {
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("online backup cancelled: %w", err)
			}
			more, err := backup.Step(backupStepPages)
			if err != nil {
				return fmt.Errorf("step online backup: %w", err)
			}
			if !more {
				break
			}
		}
		finishErr := backup.Finish()
		finished = true
		if finishErr != nil {
			return fmt.Errorf("finish online backup: %w", finishErr)
		}
		return nil
	})
}

func validateBackupDatabase(path string) error {
	db, err := sql.Open("sqlite", sqliteFileURI(path, true))
	if err != nil {
		return fmt.Errorf("open backup for validation: %w", err)
	}
	defer db.Close()

	var result string
	if err := db.QueryRow(`PRAGMA quick_check(1)`).Scan(&result); err != nil {
		return fmt.Errorf("validate backup database: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("validate backup database: quick_check returned %q", result)
	}
	return nil
}

func sqliteFileURI(path string, readOnly bool) string {
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	if readOnly {
		query := u.Query()
		query.Set("mode", "ro")
		u.RawQuery = query.Encode()
	}
	return u.String()
}

func pruneRollingBackups(backupDir string, retention int) error {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return fmt.Errorf("read backup directory: %w", err)
	}

	snapshots := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), backupFilenamePrefix) || !strings.HasSuffix(entry.Name(), backupFilenameSuffix) {
			continue
		}
		snapshots = append(snapshots, entry.Name())
	}
	sort.Sort(sort.Reverse(sort.StringSlice(snapshots)))
	if len(snapshots) <= retention {
		return nil
	}
	for _, name := range snapshots[retention:] {
		if err := os.Remove(filepath.Join(backupDir, name)); err != nil {
			return fmt.Errorf("remove expired backup %q: %w", name, err)
		}
	}
	return nil
}
