package persistence

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/savior714/flashnote/internal/document"
)

const v2TableAndDatabaseNote = `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
	`{"type":"paragraph","content":[{"type":"text","text":"kernel note"}]},` +
	`{"type":"table","content":[` +
	`{"type":"tableRow","content":[` +
	`{"type":"tableHeader","attrs":{"colspan":2,"rowspan":1,"colwidth":[120]},"content":[{"type":"paragraph","content":[{"type":"text","text":"Feature"}]}]},` +
	`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Owner"}]}]}` +
	`]},` +
	`{"type":"tableRow","content":[` +
	`{"type":"tableCell","attrs":{"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"search"}]}]},` +
	`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"kernel"}]}]}` +
	`]}` +
	`]},` +
	`{"type":"database","attrs":{` +
	`"properties":[` +
	`{"id":"p-title","name":"Task","type":"title"},` +
	`{"id":"p-status","name":"Status","type":"status","options":[{"id":"o-todo","name":"To do"},{"id":"o-done","name":"Done","done":true}]},` +
	`{"id":"p-date","name":"Start","type":"date"},` +
	`{"id":"p-target","name":"Due","type":"date"}` +
	`],` +
	`"records":[` +
	`{"id":"rec-1","values":{"p-title":"ship the kernel","p-status":"o-done","p-date":"2026-10-01","p-target":"2026-10-08"},"memo":"remember the deploy checklist"},` +
	`{"id":"rec-2","values":{"p-title":"second kernel task","p-status":"o-todo"}}` +
	`],"dateRules":[{"id":"rule-1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":7}],` +
	`"manualDates":[],"view":"table","filters":[{"propertyId":"p-status","op":"is","value":"o-done"}]}}` +
	`]}}`

// saveAndReopen persists one note and reads it back through a fresh open, which
// is the same durability boundary the app's normal save and relaunch use.
func saveAndReopen(t *testing.T, ctx context.Context, path, documentJSON string) Note {
	t.Helper()
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	note, created, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if !created {
		t.Fatal("expected the initial note to be created")
	}
	revision, err := store.SaveNote(ctx, note.ID, "Kernel", documentJSON, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}
	if revision != note.Revision+1 {
		t.Fatalf("SaveNote() revision = %d, want %d", revision, note.Revision+1)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	store, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen Store error = %v", err)
	}
	defer store.Close()
	reopened, err := store.OpenNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("OpenNote() error = %v", err)
	}
	return reopened
}

func TestSaveAndReopenRoundTripsVersionTwoTablesAndDatabases(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	reopened := saveAndReopen(t, ctx, path, v2TableAndDatabaseNote)

	// The stored document must come back byte-identical after normalization, so
	// no cell text, column width, merge span, rule, or memo was dropped or
	// rewritten on the way through SQLite.
	want := strings.Join([]string{
		`"colspan":2`,
		`"colwidth":[120]`,
		`"text":"Feature"`,
		`"p-title":"ship the kernel"`,
		`"p-date":"2026-10-01"`,
		`"p-target":"2026-10-08"`,
		`"remember the deploy checklist"`,
		`"offsetDays":7`,
		`"view":"table"`,
	}, "|")
	for _, expected := range strings.Split(want, "|") {
		if !strings.Contains(reopened.DocumentJSON, expected) {
			t.Fatalf("round-tripped document missing %s:\n%s", expected, reopened.DocumentJSON)
		}
	}

	blocks, err := document.SearchBlocks(reopened.DocumentJSON)
	if err != nil {
		t.Fatalf("search text extraction error = %v", err)
	}
	joined := strings.Join(blocks, "\n")
	for _, expected := range []string{
		"ship the kernel",
		"remember the deploy checklist",
		"second kernel task",
		"Feature",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("search text missing %q:\n%s", expected, joined)
		}
	}
}

func TestSaveAndReopenKeepsVersionOneDocumentMeaning(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	v1 := `{"schemaVersion":1,"doc":{"type":"doc","content":[` +
		`{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Legacy plan"}]},` +
		`{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"first done thing"}]}]}]},` +
		`{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"bullet one"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"bullet two"}]}]}]},` +
		`{"type":"codeBlock","attrs":{"language":"go"},"content":[{"type":"text","text":"const x = 1"}]}` +
		`]}}`

	reopened := saveAndReopen(t, ctx, path, v1)

	// A v1 document keeps its version and its exact content: opening and saving
	// it must not rewrite it into a v2 document or silently drop structure.
	if !strings.Contains(reopened.DocumentJSON, `"schemaVersion":1`) {
		t.Fatalf("v1 document was rewritten:\n%s", reopened.DocumentJSON)
	}
	for _, expected := range []string{
		`"text":"Legacy plan"`,
		`"checked":true`,
		`"text":"first done thing"`,
		`"text":"bullet one"`,
		`"const x = 1`,
	} {
		if !strings.Contains(reopened.DocumentJSON, expected) {
			t.Fatalf("v1 document lost %s:\n%s", expected, reopened.DocumentJSON)
		}
	}
}

func TestSaveNoteRejectsUnsupportedSchemaVersion(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()
	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}

	// An unknown future version must fail the save rather than be quietly
	// downgraded to something this build can actually read.
	if _, err := store.SaveNote(ctx, note.ID, "Future", `{"schemaVersion":9,"doc":{"type":"doc","content":[]}}`, note.Revision); err == nil {
		t.Fatal("SaveNote() unexpectedly accepted an unknown schema version")
	}
}

func TestSearchFindsVersionTwoDatabaseRecords(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	reopened := saveAndReopen(t, ctx, path, v2TableAndDatabaseNote)

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen Store error = %v", err)
	}
	defer store.Close()

	results, err := store.SearchNotes(ctx, "second")
	if err != nil {
		t.Fatalf("SearchNotes() error = %v", err)
	}
	if len(results) != 1 || results[0].ID != reopened.ID {
		t.Fatalf("SearchNotes() = %+v, want the one note holding %s", results, reopened.ID)
	}

	// A memo is searchable even though it only lives in the record's detail data.
	memoResults, err := store.SearchNotes(ctx, "checklist")
	if err != nil {
		t.Fatalf("SearchNotes(memo) error = %v", err)
	}
	if len(memoResults) != 1 || memoResults[0].ID != reopened.ID {
		t.Fatalf("SearchNotes(memo) = %+v, want the one note holding %s", memoResults, reopened.ID)
	}
}

func TestTrashAndRestorePreserveDatabaseRecords(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, note.ID, "Kernel", v2TableAndDatabaseNote, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	if err := store.MoveNoteToTrash(ctx, note.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	trashed, err := store.OpenTrashNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("OpenTrashNote() error = %v", err)
	}
	if !strings.Contains(trashed.DocumentJSON, "ship the kernel") {
		t.Fatalf("trash view lost the database record:\n%s", trashed.DocumentJSON)
	}

	if err := store.RestoreNote(ctx, note.ID); err != nil {
		t.Fatalf("RestoreNote() error = %v", err)
	}
	restored, err := store.OpenNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("OpenNote() error = %v", err)
	}
	if restored.DocumentJSON != trashed.DocumentJSON {
		t.Fatalf("restore changed the document:\nrestored:\n%s\ntrashed:\n%s", restored.DocumentJSON, trashed.DocumentJSON)
	}
	if !strings.Contains(restored.DocumentJSON, "remember the deploy checklist") {
		t.Fatalf("restore lost the record memo:\n%s", restored.DocumentJSON)
	}

	// Permanent deletion must not leave a ghost database behind in the library.
	if err := store.MoveNoteToTrash(ctx, note.ID); err != nil {
		t.Fatalf("second MoveNoteToTrash() error = %v", err)
	}
	if err := store.PermanentlyDeleteNote(ctx, note.ID); err != nil {
		t.Fatalf("PermanentlyDeleteNote() error = %v", err)
	}
	if _, err := store.OpenNote(ctx, note.ID); err == nil {
		t.Fatal("permanent delete left the note readable")
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestDeriveDisplayTitleUsesDatabaseRecordText(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")

	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	databaseOnly := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"database","attrs":{` +
		`"properties":[{"id":"p-title","name":"Task","type":"title"}],` +
		`"records":[{"id":"rec-1","values":{"p-title":"only database content here"}}],` +
		`"dateRules":[],"manualDates":[],"view":"table"}}]}}`

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, note.ID, "", databaseOnly, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	derived, err := deriveDisplayTitle("", databaseOnly)
	if err != nil {
		t.Fatalf("deriveDisplayTitle() error = %v", err)
	}
	if derived.Value != "only database content here" {
		t.Fatalf("deriveDisplayTitle() = %q, want the record title", derived.Value)
	}
	if derived.IsGeneratedFallback {
		t.Fatal("a database record must not produce a generated fallback title")
	}
}
