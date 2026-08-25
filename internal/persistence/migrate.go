package persistence

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

func (s *Store) migrate(ctx context.Context, migrationBackupDir string) error {
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("ensure schema_migrations table: %w", err)
	}

	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}

	type migration struct {
		version int
		name    string
	}
	migrations := make([]migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		prefix, _, ok := strings.Cut(entry.Name(), "_")
		if !ok {
			return fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		version, err := strconv.Atoi(prefix)
		if err != nil || version <= 0 {
			return fmt.Errorf("invalid migration version in %q", entry.Name())
		}
		migrations = append(migrations, migration{version: version, name: entry.Name()})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })

	var appliedMigrationCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&appliedMigrationCount); err != nil {
		return fmt.Errorf("count applied migrations: %w", err)
	}
	needsSafetyBackup := appliedMigrationCount > 0
	safetyBackupCreated := false

	seen := map[int]struct{}{}
	for _, migration := range migrations {
		if _, duplicate := seen[migration.version]; duplicate {
			return fmt.Errorf("duplicate migration version %d", migration.version)
		}
		seen[migration.version] = struct{}{}

		var applied int
		err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, migration.version).Scan(&applied)
		if err != nil {
			return fmt.Errorf("check migration %d: %w", migration.version, err)
		}
		if applied != 0 {
			continue
		}

		if needsSafetyBackup && !safetyBackupCreated {
			if migrationBackupDir == "" {
				return fmt.Errorf("create pre-migration safety backup: backup directory is required")
			}
			if _, err := s.createMigrationSafetyBackup(ctx, migrationBackupDir); err != nil {
				return fmt.Errorf("create pre-migration safety backup: %w", err)
			}
			safetyBackupCreated = true
		}

		script, err := migrationFS.ReadFile("migrations/" + migration.name)
		if err != nil {
			return fmt.Errorf("read migration %d: %w", migration.version, err)
		}

		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", migration.version, err)
		}
		if _, err := tx.ExecContext(ctx, string(script)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", migration.version, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES (?)`, migration.version); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d: %w", migration.version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", migration.version, err)
		}
	}
	return nil
}
