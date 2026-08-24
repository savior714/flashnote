package persistence

import (
	"context"
	"fmt"
	"strings"
)

type RuntimeInfo struct {
	SQLiteVersion string `json:"sqliteVersion"`
	JournalMode   string `json:"journalMode"`
	Synchronous   int    `json:"synchronous"`
	ForeignKeys   bool   `json:"foreignKeys"`
	SchemaVersion int    `json:"schemaVersion"`
}

func (s *Store) RuntimeInfo(ctx context.Context) (RuntimeInfo, error) {
	var info RuntimeInfo
	var foreignKeys int

	if err := s.db.QueryRowContext(ctx, `SELECT sqlite_version()`).Scan(&info.SQLiteVersion); err != nil {
		return RuntimeInfo{}, fmt.Errorf("read sqlite version: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&info.JournalMode); err != nil {
		return RuntimeInfo{}, fmt.Errorf("read journal_mode: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA synchronous`).Scan(&info.Synchronous); err != nil {
		return RuntimeInfo{}, fmt.Errorf("read synchronous: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		return RuntimeInfo{}, fmt.Errorf("read foreign_keys: %w", err)
	}
	info.ForeignKeys = foreignKeys == 1
	if !info.ForeignKeys || !strings.EqualFold(info.JournalMode, "wal") || info.Synchronous != 1 {
		return RuntimeInfo{}, fmt.Errorf(
			"unexpected sqlite runtime policy: journal_mode=%s synchronous=%d foreign_keys=%t",
			info.JournalMode,
			info.Synchronous,
			info.ForeignKeys,
		)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&info.SchemaVersion); err != nil {
		return RuntimeInfo{}, fmt.Errorf("read schema version: %w", err)
	}
	return info, nil
}
