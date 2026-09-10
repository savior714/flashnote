package persistence

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

type searchRowSnapshot struct {
	rowid         int64
	explicitTitle string
	displayTitle  string
	bodyText      string
}

func snapshotSearchRows(t *testing.T, store *Store) map[string]searchRowSnapshot {
	t.Helper()
	rows, err := store.db.QueryContext(context.Background(), `
		SELECT rowid, note_id, explicit_title, display_title, body_text
		FROM note_search ORDER BY note_id
	`)
	if err != nil {
		t.Fatalf("snapshot note_search: %v", err)
	}
	defer rows.Close()
	snapshot := map[string]searchRowSnapshot{}
	for rows.Next() {
		var id string
		var entry searchRowSnapshot
		if err := rows.Scan(&entry.rowid, &id, &entry.explicitTitle, &entry.displayTitle, &entry.bodyText); err != nil {
			t.Fatalf("scan note_search snapshot: %v", err)
		}
		snapshot[id] = entry
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate note_search snapshot: %v", err)
	}
	return snapshot
}

func readSearchVersion(t *testing.T, store *Store) string {
	t.Helper()
	var version string
	if err := store.db.QueryRowContext(context.Background(),
		`SELECT value FROM app_meta WHERE key = 'search_index_version'`).Scan(&version); err != nil {
		t.Fatalf("read search index version: %v", err)
	}
	return version
}

func searchIDs(results []SearchResult) map[string]bool {
	ids := make(map[string]bool, len(results))
	for _, result := range results {
		ids[result.ID] = true
	}
	return ids
}

func incrementalDoc(text string) string {
	return fmt.Sprintf(
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}}`,
		text,
	)
}

func mustCreateIndexedNote(t *testing.T, ctx context.Context, store *Store, title, body string) Note {
	t.Helper()
	note, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}
	revision, err := store.SaveNote(ctx, note.ID, title, incrementalDoc(body), note.Revision)
	if err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}
	note.Title = title
	note.DocumentJSON = incrementalDoc(body)
	note.Revision = revision
	return note
}

func TestSearchIncrementalSaveTouchesOnlyTargetRow(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	const librarySize = 25
	notes := make([]Note, 0, librarySize)
	for i := 0; i < librarySize; i++ {
		notes = append(notes, mustCreateIndexedNote(t, ctx, store,
			fmt.Sprintf("Steady title %d", i), fmt.Sprintf("steady body marker %d", i)))
	}
	if _, err := store.SearchNotes(ctx, "steady"); err != nil {
		t.Fatalf("warm SearchNotes() error = %v", err)
	}

	before := snapshotSearchRows(t, store)
	if len(before) != librarySize {
		t.Fatalf("indexed rows = %d, want %d", len(before), librarySize)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("search version = %q, want %q", version, searchIndexVersion)
	}

	target := notes[librarySize/2]
	newRevision, err := store.SaveNote(ctx, target.ID, target.Title, incrementalDoc("replacement nebula payload"), target.Revision)
	if err != nil {
		t.Fatalf("SaveNote(target) error = %v", err)
	}
	_ = newRevision

	// Steady-state save must not invalidate the index version.
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("save invalidated search version: got %q, want %q", version, searchIndexVersion)
	}

	after := snapshotSearchRows(t, store)
	if len(after) != len(before) {
		t.Fatalf("indexed row count changed %d -> %d", len(before), len(after))
	}
	changed := 0
	for id, beforeEntry := range before {
		afterEntry, ok := after[id]
		if !ok {
			t.Fatalf("index entry for note %s disappeared", id)
		}
		if afterEntry != beforeEntry {
			changed++
			if id != target.ID {
				t.Fatalf("unrelated note %s index entry changed: %+v -> %+v", id, beforeEntry, afterEntry)
			}
		}
	}
	if changed != 1 {
		t.Fatalf("changed index entries = %d, want exactly 1 (the saved note)", changed)
	}

	results, err := store.SearchNotes(ctx, "nebula")
	if err != nil || len(results) != 1 || results[0].ID != target.ID {
		t.Fatalf("SearchNotes(new term) results=%+v err=%v", results, err)
	}
	results, err = store.SearchNotes(ctx, "steady body marker")
	if err != nil {
		t.Fatalf("SearchNotes(old shared term) error = %v", err)
	}
	if found := searchIDs(results); found[target.ID] {
		t.Fatalf("saved note still matches its replaced body text: %+v", results)
	}
}

func TestSearchIncrementalLifecycleCreateTrashRestoreDelete(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	control := mustCreateIndexedNote(t, ctx, store, "Control title", "control lifecycle marker")
	controlBefore := snapshotSearchRows(t, store)[control.ID]

	// Create: a new note becomes searchable without global rebuild.
	created, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}
	revision, err := store.SaveNote(ctx, created.ID, "Fresh lifecycle note", incrementalDoc("fresh lifecycle marker"), created.Revision)
	if err != nil {
		t.Fatalf("SaveNote(created) error = %v", err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("create invalidated search version: got %q", version)
	}
	results, err := store.SearchNotes(ctx, "fresh lifecycle marker")
	if err != nil || len(results) != 1 || results[0].ID != created.ID {
		t.Fatalf("created note not searchable: %+v err=%v", results, err)
	}
	if entry := snapshotSearchRows(t, store)[control.ID]; entry != controlBefore {
		t.Fatalf("create rewrote unrelated index entry: %+v -> %+v", controlBefore, entry)
	}

	// Trash: the note leaves search results while the index stays valid.
	if err := store.MoveNoteToTrash(ctx, created.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("trash invalidated search version: got %q", version)
	}
	results, err = store.SearchNotes(ctx, "fresh lifecycle marker")
	if err != nil {
		t.Fatalf("SearchNotes(trashed) error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("trashed note still searchable: %+v", results)
	}
	if _, ok := snapshotSearchRows(t, store)[created.ID]; ok {
		t.Fatal("trashed note still has an index entry")
	}

	// Restore: the note returns to search results without a rebuild.
	if err := store.RestoreNote(ctx, created.ID); err != nil {
		t.Fatalf("RestoreNote() error = %v", err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("restore invalidated search version: got %q", version)
	}
	results, err = store.SearchNotes(ctx, "fresh lifecycle marker")
	if err != nil || len(results) != 1 || results[0].ID != created.ID {
		t.Fatalf("restored note not searchable: %+v err=%v", results, err)
	}

	// Permanent delete: no stale FTS hit remains.
	if err := store.MoveNoteToTrash(ctx, created.ID); err != nil {
		t.Fatalf("MoveNoteToTrash(delete setup) error = %v", err)
	}
	if err := store.PermanentlyDeleteNote(ctx, created.ID); err != nil {
		t.Fatalf("PermanentlyDeleteNote() error = %v", err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("permanent delete invalidated search version: got %q", version)
	}
	results, err = store.SearchNotes(ctx, "fresh lifecycle marker")
	if err != nil {
		t.Fatalf("SearchNotes(deleted) error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("deleted note still searchable: %+v", results)
	}
	if _, ok := snapshotSearchRows(t, store)[created.ID]; ok {
		t.Fatal("deleted note still has an index entry")
	}

	// The untouched control note survived the whole lifecycle byte-identical.
	if entry := snapshotSearchRows(t, store)[control.ID]; entry != controlBefore {
		t.Fatalf("lifecycle rewrote unrelated index entry: %+v -> %+v", controlBefore, entry)
	}
	results, err = store.SearchNotes(ctx, "control lifecycle marker")
	if err != nil || len(results) != 1 || results[0].ID != control.ID {
		t.Fatalf("control note lost from search: %+v err=%v", results, err)
	}
	_ = revision

	assertFTSIntegrity(t, store)
}

func TestSearchIncrementalFolderTrashUnit(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	folder, err := store.CreateFolder(ctx, "Search Unit Folder")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	first, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(first) error = %v", err)
	}
	firstRevision, err := store.SaveNote(ctx, first.ID, "Grouped first", incrementalDoc("grouped unit marker one"), first.Revision)
	if err != nil {
		t.Fatalf("SaveNote(first) error = %v", err)
	}
	second, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(second) error = %v", err)
	}
	secondRevision, err := store.SaveNote(ctx, second.ID, "Grouped second", incrementalDoc("grouped unit marker two"), second.Revision)
	if err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}
	outsider := mustCreateIndexedNote(t, ctx, store, "Outsider", "outsider marker stays")
	outsiderBefore := snapshotSearchRows(t, store)[outsider.ID]

	moved, err := store.MoveFolderToTrash(ctx, folder.ID)
	if err != nil || moved != 2 {
		t.Fatalf("MoveFolderToTrash() moved=%d err=%v", moved, err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("folder trash invalidated search version: got %q", version)
	}
	results, err := store.SearchNotes(ctx, "grouped unit marker")
	if err != nil {
		t.Fatalf("SearchNotes(folder trashed) error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("folder-trash unit leaked into search: %+v", results)
	}
	if entry := snapshotSearchRows(t, store)[outsider.ID]; entry != outsiderBefore {
		t.Fatalf("folder trash rewrote unrelated index entry: %+v -> %+v", outsiderBefore, entry)
	}

	restored, err := store.RestoreFolder(ctx, folder.ID)
	if err != nil || restored != 2 {
		t.Fatalf("RestoreFolder() restored=%d err=%v", restored, err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("folder restore invalidated search version: got %q", version)
	}
	results, err = store.SearchNotes(ctx, "grouped unit marker")
	if err != nil || len(results) != 2 {
		t.Fatalf("restored folder unit not searchable: %+v err=%v", results, err)
	}

	// Permanent folder delete leaves no stale hits and keeps the index valid.
	if moved, err := store.MoveFolderToTrash(ctx, folder.ID); err != nil || moved != 2 {
		t.Fatalf("MoveFolderToTrash(delete setup) moved=%d err=%v", moved, err)
	}
	if deleted, err := store.PermanentlyDeleteFolder(ctx, folder.ID); err != nil || deleted != 2 {
		t.Fatalf("PermanentlyDeleteFolder() deleted=%d err=%v", deleted, err)
	}
	results, err = store.SearchNotes(ctx, "grouped unit marker")
	if err != nil {
		t.Fatalf("SearchNotes(folder deleted) error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("deleted folder unit still searchable: %+v", results)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("folder delete invalidated search version: got %q", version)
	}

	// EmptyTrash over remaining trash keeps the live index valid and intact.
	standalone, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(standalone) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, standalone.ID, "Doomed", incrementalDoc("doomed marker"), standalone.Revision); err != nil {
		t.Fatalf("SaveNote(standalone) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, standalone.ID); err != nil {
		t.Fatalf("MoveNoteToTrash(standalone) error = %v", err)
	}
	if _, _, err := store.EmptyTrash(ctx); err != nil {
		t.Fatalf("EmptyTrash() error = %v", err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("empty trash invalidated search version: got %q", version)
	}
	results, err = store.SearchNotes(ctx, "outsider marker stays")
	if err != nil || len(results) != 1 || results[0].ID != outsider.ID {
		t.Fatalf("live note lost from search after EmptyTrash: %+v err=%v", results, err)
	}
	_, _ = firstRevision, secondRevision
}

func TestSearchRevisionConflictLeavesIndexAligned(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	note := mustCreateIndexedNote(t, ctx, store, "Conflict title", "conflict original marker")
	before := snapshotSearchRows(t, store)[note.ID]

	revision, err := store.SaveNote(ctx, note.ID, "Conflict title", incrementalDoc("conflict updated marker"), note.Revision)
	if err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	// A stale retry must fail and must not mutate FTS state.
	if _, err := store.SaveNote(ctx, note.ID, "Conflict title", incrementalDoc("conflict stale marker"), note.Revision); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale SaveNote() error = %v, want revision conflict", err)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("failed save disturbed search version: got %q", version)
	}
	persisted, err := store.OpenNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("OpenNote() error = %v", err)
	}
	if persisted.Revision != revision {
		t.Fatalf("persisted revision = %d, want %d", persisted.Revision, revision)
	}
	after := snapshotSearchRows(t, store)[note.ID]
	fields, err := buildSearchFields(persisted.Title, persisted.DocumentJSON)
	if err != nil {
		t.Fatalf("buildSearchFields(persisted) error = %v", err)
	}
	if after.explicitTitle != fields.explicitTitle || after.displayTitle != fields.displayTitle || after.bodyText != fields.bodyText {
		t.Fatalf("index entry diverged from persisted truth: %+v vs %+v", after, fields)
	}
	if after != before {
		// The entry legitimately changed exactly once: the successful save above.
		// It must not reflect the failed stale write.
		if after.bodyText == "conflict stale marker" {
			t.Fatal("failed stale save mutated the index entry")
		}
	}
	results, err := store.SearchNotes(ctx, "conflict stale marker")
	if err != nil {
		t.Fatalf("SearchNotes(stale term) error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("failed write is searchable: %+v", results)
	}
	results, err = store.SearchNotes(ctx, "conflict updated marker")
	if err != nil || len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("successful write lost from search: %+v err=%v", results, err)
	}
}

func TestSearchBootstrapRebuildsOnVersionMismatch(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	note := mustCreateIndexedNote(t, ctx, store, "", "bootstrap nebula marker")

	// Simulate a pre-incremental database: version unknown and one entry missing.
	if _, err := store.db.ExecContext(ctx, `DELETE FROM app_meta WHERE key = 'search_index_version'`); err != nil {
		t.Fatalf("drop search version: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `DELETE FROM note_search WHERE note_id = ?`, note.ID); err != nil {
		t.Fatalf("drop index entry: %v", err)
	}

	// The next search must take the legitimate full-rebuild path and repair.
	results, err := store.SearchNotes(ctx, "nebula")
	if err != nil {
		t.Fatalf("SearchNotes(bootstrap) error = %v", err)
	}
	if len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("bootstrap rebuild did not repair search: %+v", results)
	}
	if version := readSearchVersion(t, store); version != searchIndexVersion {
		t.Fatalf("bootstrap did not restore search version: got %q", version)
	}
	assertFTSIntegrity(t, store)
}

func assertFTSIntegrity(t *testing.T, store *Store) {
	t.Helper()
	// FTS5's built-in index integrity facility: corrupt indexes report an error.
	if _, err := store.db.ExecContext(context.Background(), `INSERT INTO note_search(note_search) VALUES('integrity-check')`); err != nil {
		t.Fatalf("fts integrity-check failed: %v", err)
	}
}
