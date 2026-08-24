package persistence

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const busyTimeoutMilliseconds = 5000

// Store is the single Go-owned persistence entry point for Flashnote.
type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, path string) (*Store, error) {
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	// Conservative initial pool. These values are implementation tuning, not product contract.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)

	store := &Store{db: db}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite database: %w", err)
	}
	if err := store.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate sqlite database: %w", err)
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
