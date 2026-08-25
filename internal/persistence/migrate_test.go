package persistence

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenCreatesPreMigrationSafetyBackup(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	databasePath := filepath.Join(root, "flashnote.db")
	createVersionOneDatabase(t, databasePath, false)

	store, err := Open(ctx, databasePath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	info, err := store.RuntimeInfo(ctx)
	if err != nil {
		t.Fatalf("RuntimeInfo() error = %v", err)
	}
	if info.SchemaVersion <= 1 {
		t.Fatalf("live schema version = %d, want > 1", info.SchemaVersion)
	}

	backupPath := onlyMigrationSafetyBackup(t, filepath.Join(root, "backups", "migrations"))
	assertMigrationSafetyBackupState(t, backupPath, 1, "before-upgrade")
}

func TestOpenDoesNotCreateMigrationBackupForFreshOrCurrentDatabase(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	databasePath := filepath.Join(root, "flashnote.db")
	migrationBackupDir := filepath.Join(root, "backups", "migrations")

	store, err := Open(ctx, databasePath)
	if err != nil {
		t.Fatalf("Open(fresh) error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close(fresh) error = %v", err)
	}
	assertNoMigrationSafetyBackups(t, migrationBackupDir)

	store, err = Open(ctx, databasePath)
	if err != nil {
		t.Fatalf("Open(current) error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close(current) error = %v", err)
	}
	assertNoMigrationSafetyBackups(t, migrationBackupDir)
}

func TestOpenFailsClosedWhenPreMigrationBackupCannotBeCreated(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	databasePath := filepath.Join(root, "flashnote.db")
	createVersionOneDatabase(t, databasePath, false)

	if err := os.WriteFile(filepath.Join(root, "backups"), []byte("block migration backup directory"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	store, err := Open(ctx, databasePath)
	if store != nil {
		_ = store.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "create pre-migration safety backup") {
		t.Fatalf("Open() error = %v, want pre-migration backup failure", err)
	}
	assertLiveSchemaVersion(t, databasePath, 1)
	assertTableAbsent(t, databasePath, "notes")
}

func TestMigrationFailurePreservesSafetyBackupAndPreMigrationVersion(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	databasePath := filepath.Join(root, "flashnote.db")
	createVersionOneDatabase(t, databasePath, true)

	store, err := Open(ctx, databasePath)
	if store != nil {
		_ = store.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "apply migration 2") {
		t.Fatalf("Open() error = %v, want migration 2 failure", err)
	}

	assertLiveSchemaVersion(t, databasePath, 1)
	backupPath := onlyMigrationSafetyBackup(t, filepath.Join(root, "backups", "migrations"))
	assertMigrationSafetyBackupState(t, backupPath, 1, "before-upgrade")
}

func createVersionOneDatabase(t *testing.T, databasePath string, conflictWithMigrationTwo bool) {
	t.Helper()
	db, err := sql.Open("sqlite", sqliteDSN(databasePath))
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	statements := []string{
		`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE app_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO schema_migrations(version) VALUES (1)`,
		`INSERT INTO app_meta(key, value) VALUES ('migration-proof', 'before-upgrade')`,
	}
	if conflictWithMigrationTwo {
		statements = append(statements, `CREATE TABLE notes (sentinel TEXT)`)
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("prepare version-one database: %v", err)
		}
	}
}

func onlyMigrationSafetyBackup(t *testing.T, backupDir string) string {
	t.Helper()
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("ReadDir(%q) error = %v", backupDir, err)
	}
	var paths []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), migrationBackupFilenamePrefix) || !strings.HasSuffix(entry.Name(), backupFilenameSuffix) {
			continue
		}
		paths = append(paths, filepath.Join(backupDir, entry.Name()))
	}
	if len(paths) != 1 {
		t.Fatalf("migration safety backups = %d, want 1", len(paths))
	}
	return paths[0]
}

func assertNoMigrationSafetyBackups(t *testing.T, backupDir string) {
	t.Helper()
	entries, err := os.ReadDir(backupDir)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		t.Fatalf("ReadDir(%q) error = %v", backupDir, err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), migrationBackupFilenamePrefix) && strings.HasSuffix(entry.Name(), backupFilenameSuffix) {
			t.Fatalf("unexpected migration safety backup %q", entry.Name())
		}
	}
}

func assertMigrationSafetyBackupState(t *testing.T, backupPath string, wantVersion int, wantValue string) {
	t.Helper()
	if err := validateBackupDatabase(backupPath); err != nil {
		t.Fatalf("validateBackupDatabase() error = %v", err)
	}

	db, err := sql.Open("sqlite", sqliteFileURI(backupPath, true))
	if err != nil {
		t.Fatalf("open migration safety backup: %v", err)
	}
	defer db.Close()

	var version int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatalf("read backup schema version: %v", err)
	}
	if version != wantVersion {
		t.Fatalf("backup schema version = %d, want %d", version, wantVersion)
	}

	var value string
	if err := db.QueryRow(`SELECT value FROM app_meta WHERE key = 'migration-proof'`).Scan(&value); err != nil {
		t.Fatalf("read migration proof value: %v", err)
	}
	if value != wantValue {
		t.Fatalf("backup migration proof = %q, want %q", value, wantValue)
	}
}

func assertLiveSchemaVersion(t *testing.T, databasePath string, wantVersion int) {
	t.Helper()
	db, err := sql.Open("sqlite", sqliteFileURI(databasePath, true))
	if err != nil {
		t.Fatalf("open live database: %v", err)
	}
	defer db.Close()

	var version int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatalf("read live schema version: %v", err)
	}
	if version != wantVersion {
		t.Fatalf("live schema version = %d, want %d", version, wantVersion)
	}
}

func assertTableAbsent(t *testing.T, databasePath, tableName string) {
	t.Helper()
	db, err := sql.Open("sqlite", sqliteFileURI(databasePath, true))
	if err != nil {
		t.Fatalf("open live database: %v", err)
	}
	defer db.Close()

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, tableName).Scan(&count); err != nil {
		t.Fatalf("inspect table %q: %v", tableName, err)
	}
	if count != 0 {
		t.Fatalf("table %q exists after failed pre-migration backup", tableName)
	}
}
