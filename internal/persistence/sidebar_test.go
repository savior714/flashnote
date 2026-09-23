package persistence

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// TestListSidebarConvergesCanonicalProjection proves the single bounded
// sidebar read returns the same semantic result as the legacy per-list fan-out
// (root notes + folders + per-folder notes) while covering the materially
// distinct states affected by projection convergence.
func TestListSidebarConvergesCanonicalProjection(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	mustSave := func(id, title, doc string, rev int64) int64 {
		t.Helper()
		next, err := store.SaveNote(ctx, id, title, doc, rev)
		if err != nil {
			t.Fatalf("SaveNote(%q) error = %v", title, err)
		}
		return next
	}

	// Root notes: one explicit title, one derived, one Untitled (empty doc).
	rootExplicit, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rootExplicitRev := mustSave(rootExplicit.ID, "Root Explicit", rootExplicit.DocumentJSON, rootExplicit.Revision)
	_ = rootExplicitRev
	time.Sleep(2 * time.Millisecond)

	rootDerived, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	derivedDoc := `{"doc":{"content":[{"type":"paragraph","content":[{"type":"text","text":"Derived root body"}]}],"type":"doc"},"schemaVersion":1}`
	mustSave(rootDerived.ID, "", derivedDoc, rootDerived.Revision)
	time.Sleep(2 * time.Millisecond)

	rootUntitled, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Left with title '' and the empty document: derives "Untitled".
	time.Sleep(2 * time.Millisecond)

	// Folders: alphabetical order target (beta, Alpha sorts NOCASE first),
	// one populated, one empty, one populated with two notes.
	beta, err := store.CreateFolder(ctx, "beta")
	if err != nil {
		t.Fatal(err)
	}
	alpha, err := store.CreateFolder(ctx, "Alpha")
	if err != nil {
		t.Fatal(err)
	}
	empty, err := store.CreateFolder(ctx, "empty")
	if err != nil {
		t.Fatal(err)
	}
	_ = empty

	first, err := store.CreateNoteInFolder(ctx, alpha.ID)
	if err != nil {
		t.Fatal(err)
	}
	mustSave(first.ID, "First", first.DocumentJSON, first.Revision)
	time.Sleep(2 * time.Millisecond)
	second, err := store.CreateNoteInFolder(ctx, alpha.ID)
	if err != nil {
		t.Fatal(err)
	}
	mustSave(second.ID, "", `{"doc":{"content":[{"type":"paragraph","content":[{"type":"text","text":"Second folder body"}]}],"type":"doc"},"schemaVersion":1}`, second.Revision)

	mover, err := store.CreateNoteInFolder(ctx, beta.ID)
	if err != nil {
		t.Fatal(err)
	}
	mustSave(mover.ID, "Mover", mover.DocumentJSON, mover.Revision)

	assertProjectionMatchesLegacy := func(stage string) SidebarProjection {
		t.Helper()
		projection, err := store.ListSidebar(ctx)
		if err != nil {
			t.Fatalf("%s: ListSidebar() error = %v", stage, err)
		}
		// Legacy fan-out result for equivalence.
		wantRoot, err := store.ListRootNotes(ctx)
		if err != nil {
			t.Fatalf("%s: ListRootNotes() error = %v", stage, err)
		}
		wantFolders, err := store.ListFolders(ctx)
		if err != nil {
			t.Fatalf("%s: ListFolders() error = %v", stage, err)
		}
		compareSummaries(t, stage+" root", projection.RootNotes, wantRoot)
		if len(projection.Folders) != len(wantFolders) {
			t.Fatalf("%s: folders len = %d, want %d", stage, len(projection.Folders), len(wantFolders))
		}
		seen := map[string]int{}
		for i, want := range wantFolders {
			got := projection.Folders[i]
			if got.Folder.ID != want.ID || got.Folder.Name != want.Name {
				t.Fatalf("%s: folder[%d] = %+v, want %+v", stage, i, got.Folder, want)
			}
			wantNotes, err := store.ListFolderNotes(ctx, want.ID)
			if err != nil {
				t.Fatalf("%s: ListFolderNotes(%s) error = %v", stage, want.ID, err)
			}
			compareSummaries(t, stage+" folder "+want.Name, got.Notes, wantNotes)
			for _, summary := range got.Notes {
				seen[summary.ID]++
			}
		}
		for _, summary := range projection.RootNotes {
			seen[summary.ID]++
		}
		// Duplicate/missing identity prevention: every visible note exactly once.
		for id, count := range seen {
			if count != 1 {
				t.Fatalf("%s: note %s appears %d times, want once", stage, id, count)
			}
		}
		return projection
	}

	projection := assertProjectionMatchesLegacy("initial")

	// Ordering: folders alphabetical NOCASE (Alpha, beta, empty).
	if len(projection.Folders) != 3 ||
		projection.Folders[0].Folder.Name != "Alpha" ||
		projection.Folders[1].Folder.Name != "beta" ||
		projection.Folders[2].Folder.Name != "empty" {
		t.Fatalf("folder order = %+v, want Alpha/beta/empty", projection.Folders)
	}
	// Root order: most recently modified first (Untitled, Derived, Explicit).
	if len(projection.RootNotes) != 3 ||
		projection.RootNotes[0].ID != rootUntitled.ID ||
		projection.RootNotes[1].ID != rootDerived.ID ||
		projection.RootNotes[2].ID != rootExplicit.ID {
		t.Fatalf("root order = %+v", projection.RootNotes)
	}
	// Derived + Untitled semantics preserved through the stored projection.
	if projection.RootNotes[1].DisplayTitle != "Derived root body" {
		t.Fatalf("derived root title = %q", projection.RootNotes[1].DisplayTitle)
	}
	if projection.RootNotes[0].DisplayTitle != "Untitled" || !projection.RootNotes[0].IsGeneratedFallback {
		t.Fatalf("untitled root projection = %+v", projection.RootNotes[0])
	}
	if projection.RootNotes[1].IsGeneratedFallback || projection.RootNotes[2].IsGeneratedFallback {
		t.Fatalf("non-generated root projections marked as fallback: %+v", projection.RootNotes)
	}
	// Empty folder present with empty notes.
	if projection.Folders[2].Notes == nil || len(projection.Folders[2].Notes) != 0 {
		t.Fatalf("empty folder notes = %+v, want empty non-nil", projection.Folders[2].Notes)
	}
	// Folder note order: most recently modified first (second, first).
	alphaNotes := projection.Folders[0].Notes
	if len(alphaNotes) != 2 || alphaNotes[0].ID != second.ID || alphaNotes[1].ID != first.ID {
		t.Fatalf("alpha notes = %+v", alphaNotes)
	}

	// Title change converges through the write path without reparsing on read.
	// Saving bumps updated_at, so the renamed note moves to most-recent-first.
	mustSave(first.ID, "First Renamed", first.DocumentJSON, 2)
	projection = assertProjectionMatchesLegacy("title-change")
	if len(projection.Folders[0].Notes) != 2 ||
		projection.Folders[0].Notes[0].ID != first.ID ||
		projection.Folders[0].Notes[0].DisplayTitle != "First Renamed" {
		t.Fatalf("renamed notes = %+v", projection.Folders[0].Notes)
	}

	// Move folder note to root.
	if err := store.MoveNote(ctx, mover.ID, ""); err != nil {
		t.Fatalf("MoveNote(to root) error = %v", err)
	}
	projection = assertProjectionMatchesLegacy("move-to-root")
	if len(projection.RootNotes) != 4 {
		t.Fatalf("root after move = %+v", projection.RootNotes)
	}
	if len(projection.Folders[1].Notes) != 0 {
		t.Fatalf("beta after move = %+v", projection.Folders[1].Notes)
	}

	// Move root note into a folder.
	if err := store.MoveNote(ctx, rootExplicit.ID, beta.ID); err != nil {
		t.Fatalf("MoveNote(to folder) error = %v", err)
	}
	projection = assertProjectionMatchesLegacy("move-to-folder")
	if len(projection.RootNotes) != 3 {
		t.Fatalf("root after folder move = %+v", projection.RootNotes)
	}

	// Trash exclusion: trashed note disappears from the projection.
	if err := store.MoveNoteToTrash(ctx, rootDerived.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	projection = assertProjectionMatchesLegacy("note-trash")
	for _, summary := range projection.RootNotes {
		if summary.ID == rootDerived.ID {
			t.Fatalf("trashed note still projected: %+v", projection.RootNotes)
		}
	}

	// Folder trash exclusion: folder and its notes disappear together.
	trashedCount, err := store.MoveFolderToTrash(ctx, alpha.ID)
	if err != nil {
		t.Fatalf("MoveFolderToTrash() error = %v", err)
	}
	if trashedCount != 2 {
		t.Fatalf("trashed folder notes = %d, want 2", trashedCount)
	}
	projection = assertProjectionMatchesLegacy("folder-trash")
	if len(projection.Folders) != 2 {
		t.Fatalf("folders after trash = %+v", projection.Folders)
	}

	// Restore converges back.
	if err := store.RestoreNote(ctx, rootDerived.ID); err != nil {
		t.Fatalf("RestoreNote() error = %v", err)
	}
	restored, err := store.RestoreFolder(ctx, alpha.ID)
	if err != nil {
		t.Fatalf("RestoreFolder() error = %v", err)
	}
	if restored != 2 {
		t.Fatalf("restored folder notes = %d, want 2", restored)
	}
	assertProjectionMatchesLegacy("restore")

	// Permanent delete removes the row from the projection.
	if err := store.MoveNoteToTrash(ctx, rootDerived.ID); err != nil {
		t.Fatalf("MoveNoteToTrash(re-delete) error = %v", err)
	}
	if err := store.PermanentlyDeleteNote(ctx, rootDerived.ID); err != nil {
		t.Fatalf("PermanentlyDeleteNote() error = %v", err)
	}
	projection = assertProjectionMatchesLegacy("permanent-delete")
	for _, summary := range projection.RootNotes {
		if summary.ID == rootDerived.ID {
			t.Fatalf("permanently deleted note still projected")
		}
	}

	// Stored projection never returns an empty display title.
	for _, summary := range projection.RootNotes {
		if summary.DisplayTitle == "" {
			t.Fatalf("empty display title for root note %s", summary.ID)
		}
	}
	for _, folder := range projection.Folders {
		for _, summary := range folder.Notes {
			if summary.DisplayTitle == "" {
				t.Fatalf("empty display title for note %s in folder %s", summary.ID, folder.Folder.ID)
			}
		}
	}
}

func compareSummaries(t *testing.T, stage string, got, want []NoteSummary) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: len = %d, want %d (got=%+v want=%+v)", stage, len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s: [%d] = %+v, want %+v", stage, i, got[i], want[i])
		}
	}
}

func TestDisplayTitleFallbackDiscriminatesGeneratedAndUserText(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	generated, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	explicit, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveNote(ctx, explicit.ID, "Untitled", explicit.DocumentJSON, explicit.Revision); err != nil {
		t.Fatal(err)
	}
	derived, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	derivedDocument := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Untitled"}]}]}}`
	if _, err := store.SaveNote(ctx, derived.ID, "", derivedDocument, derived.Revision); err != nil {
		t.Fatal(err)
	}

	summaries, err := store.ListNotes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]NoteSummary, len(summaries))
	for _, summary := range summaries {
		byID[summary.ID] = summary
	}
	if summary := byID[generated.ID]; !summary.IsGeneratedFallback || summary.DisplayTitle != "Untitled" {
		t.Fatalf("generated fallback summary = %+v", summary)
	}
	if summary := byID[explicit.ID]; summary.IsGeneratedFallback || summary.DisplayTitle != "Untitled" {
		t.Fatalf("explicit Untitled summary = %+v", summary)
	}
	if summary := byID[derived.ID]; summary.IsGeneratedFallback || summary.DisplayTitle != "Untitled" {
		t.Fatalf("body-derived Untitled summary = %+v", summary)
	}

	openedExplicit, err := store.OpenNote(ctx, explicit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if openedExplicit.Title != "Untitled" {
		t.Fatalf("explicit title was rewritten: %q", openedExplicit.Title)
	}
	openedDerived, err := store.OpenNote(ctx, derived.ID)
	if err != nil {
		t.Fatal(err)
	}
	if openedDerived.Title != "" {
		t.Fatalf("body-derived title became canonical data: %q", openedDerived.Title)
	}
}

func TestDisplayTitleFallbackBackfillDiscriminatesLegacyUntitledStrings(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	generated, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	explicit, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveNote(ctx, explicit.ID, "Untitled", explicit.DocumentJSON, explicit.Revision); err != nil {
		t.Fatal(err)
	}
	derived, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	derivedDocument := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Untitled"}]}]}}`
	if _, err := store.SaveNote(ctx, derived.ID, "", derivedDocument, derived.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `
		UPDATE notes
		SET display_title = 'Untitled', display_title_is_fallback = NULL
	`); err != nil {
		t.Fatal(err)
	}
	if err := store.backfillDisplayTitleProjections(ctx); err != nil {
		t.Fatal(err)
	}

	summaries, err := store.ListNotes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]NoteSummary, len(summaries))
	for _, summary := range summaries {
		byID[summary.ID] = summary
	}
	if !byID[generated.ID].IsGeneratedFallback {
		t.Fatalf("generated fallback was not backfilled: %+v", byID[generated.ID])
	}
	if byID[explicit.ID].IsGeneratedFallback {
		t.Fatalf("explicit Untitled was classified as generated: %+v", byID[explicit.ID])
	}
	if byID[derived.ID].IsGeneratedFallback {
		t.Fatalf("body-derived Untitled was classified as generated: %+v", byID[derived.ID])
	}
}

// TestDisplayTitleBackfillConvergesLegacyRows proves databases written before
// migration 009 (display_title ”) start up with the same titles the former
// read-time derivation produced.
func TestDisplayTitleBackfillConvergesLegacyRows(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	explicit, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	nextRev, err := store.SaveNote(ctx, explicit.ID, "Kept Title", explicit.DocumentJSON, explicit.Revision)
	if err != nil {
		t.Fatal(err)
	}
	_ = nextRev
	derived, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	derivedBody := `{"doc":{"content":[{"type":"paragraph","content":[{"type":"text","text":"Legacy derived body"}]}],"type":"doc"},"schemaVersion":1}`
	if _, err := store.SaveNote(ctx, derived.ID, "", derivedBody, derived.Revision); err != nil {
		t.Fatal(err)
	}

	// Simulate a pre-009 row: clear the stored projection directly.
	if _, err := store.db.ExecContext(ctx, `UPDATE notes SET display_title = ''`); err != nil {
		t.Fatal(err)
	}
	if err := store.backfillDisplayTitleProjections(ctx); err != nil {
		t.Fatalf("backfillDisplayTitleProjections() error = %v", err)
	}

	summaries, err := store.ListNotes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]string{}
	for _, summary := range summaries {
		byID[summary.ID] = summary.DisplayTitle
	}
	if byID[explicit.ID] != "Kept Title" {
		t.Fatalf("backfilled explicit title = %q", byID[explicit.ID])
	}
	if byID[derived.ID] != "Legacy derived body" {
		t.Fatalf("backfilled derived title = %q", byID[derived.ID])
	}
	var remaining int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notes WHERE TRIM(COALESCE(display_title,'')) = ''`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("unbackfilled rows = %d", remaining)
	}
}

// TestSaveNoteTitleChangeUpdatesStoredProjection proves a save that changes
// the title or body converges the stored projection in the same transaction
// (no read-time reparse needed to observe the new title).
func TestSaveNoteTitleChangeUpdatesStoredProjection(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	note, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatal(err)
	}
	bodyV1 := `{"doc":{"content":[{"type":"paragraph","content":[{"type":"text","text":"Body version one"}]}],"type":"doc"},"schemaVersion":1}`
	rev, err := store.SaveNote(ctx, note.ID, "", bodyV1, note.Revision)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := store.ListSidebar(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.RootNotes) != 1 || projection.RootNotes[0].DisplayTitle != "Body version one" {
		t.Fatalf("v1 projection = %+v", projection.RootNotes)
	}

	bodyV2 := fmt.Sprintf(`{"doc":{"content":[{"type":"paragraph","content":[{"type":"text","text":"Body version two"}]}],"type":"doc"},"schemaVersion":1}`)
	if _, err := store.SaveNote(ctx, note.ID, "", bodyV2, rev); err != nil {
		t.Fatal(err)
	}
	projection, err = store.ListSidebar(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if projection.RootNotes[0].DisplayTitle != "Body version two" {
		t.Fatalf("v2 projection = %+v", projection.RootNotes)
	}

	if _, err := store.SaveNote(ctx, note.ID, "Explicit Wins", bodyV2, rev+1); err != nil {
		t.Fatal(err)
	}
	projection, err = store.ListSidebar(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if projection.RootNotes[0].DisplayTitle != "Explicit Wins" {
		t.Fatalf("explicit projection = %+v", projection.RootNotes)
	}
}
