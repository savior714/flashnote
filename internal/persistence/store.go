package persistence

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

const busyTimeoutMilliseconds = 5000

// Store is the single Go-owned persistence entry point for Flashnote.
type Store struct {
	db             *sql.DB
	attachmentsDir string
	attachmentMu   sync.Mutex
	searchMu       sync.Mutex
}

func Open(ctx context.Context, path string) (*Store, error) {
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	// Conservative initial pool. These values are implementation tuning, not product contract.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)

	attachmentsDir := filepath.Join(filepath.Dir(path), "attachments")
	if err := os.MkdirAll(attachmentsDir, 0o700); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create attachments directory: %w", err)
	}

	store := &Store{db: db, attachmentsDir: attachmentsDir}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite database: %w", err)
	}
	migrationBackupDir := filepath.Join(filepath.Dir(path), "backups", "migrations")
	if err := store.migrate(ctx, migrationBackupDir); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate sqlite database: %w", err)
	}
	if err := store.ensureSearchIndex(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("prepare note search index: %w", err)
	}
	if _, err := store.RuntimeInfo(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("verify sqlite runtime policy: %w", err)
	}

	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func sqliteDSN(path string) string {
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	q := u.Query()
	q.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", busyTimeoutMilliseconds))
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	u.RawQuery = q.Encode()
	return u.String()
}
