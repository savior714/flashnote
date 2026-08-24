package persistence

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestSearchNotesFindsTitlesDerivedTitlesAndBodyText(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	first, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	firstDoc := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"ordinary body"}]}]}}`
	firstRevision, err := store.SaveNote(ctx, first.ID, "Needle project", firstDoc, first.Revision)
	if err != nil {
		t.Fatalf("SaveNote(first) error = %v", err)
	}
	first.Revision = firstRevision

	time.Sleep(2 * time.Millisecond)
	second, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(second) error = %v", err)
	}
	secondDoc := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Needle derived title"}]},{"type":"paragraph","content":[{"type":"text","text":"Comet appears only in the searchable body"}]}]}}`
	secondRevision, err := store.SaveNote(ctx, second.ID, "", secondDoc, second.Revision)
	if err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}
	second.Revision = secondRevision

	time.Sleep(2 * time.Millisecond)
	third, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(third) error = %v", err)
	}
	thirdDoc := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"needle needle needle in body only"}]}]}}`
	if _, err := store.SaveNote(ctx, third.ID, "Other title", thirdDoc, third.Revision); err != nil {
		t.Fatalf("SaveNote(third) error = %v", err)
	}

	results, err := store.SearchNotes(ctx, "need")
	if err != nil {
		t.Fatalf("SearchNotes(title prefix) error = %v", err)
	}
	if len(results) < 3 {
		t.Fatalf("SearchNotes(title prefix) len = %d, want at least 3: %+v", len(results), results)
	}
	if results[0].ID != first.ID || results[1].ID != second.ID {
		t.Fatalf("title matches should rank before body-only match: %+v", results)
	}
	if results[1].DisplayTitle != "Needle derived title" {
		t.Fatalf("derived title result = %q, want Needle derived title", results[1].DisplayTitle)
	}

	results, err = store.SearchNotes(ctx, "(((comet)))")
	if err != nil {
		t.Fatalf("SearchNotes(literal punctuation) error = %v", err)
	}
	if len(results) != 1 || results[0].ID != second.ID {
		t.Fatalf("body search results = %+v, want second note only", results)
	}
	if !strings.Contains(strings.ToLower(results[0].Excerpt), "comet") {
		t.Fatalf("body search excerpt = %q, want matching text", results[0].Excerpt)
	}
}

func TestSearchIndexRebuildsAfterCanonicalNoteChanges(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	firstDoc := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"first galaxy"}]}]}}`
	revision, err := store.SaveNote(ctx, note.ID, "", firstDoc, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote(first) error = %v", err)
	}

	results, err := store.SearchNotes(ctx, "galaxy")
	if err != nil || len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("initial SearchNotes() results=%+v err=%v", results, err)
	}

	secondDoc := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"replacement nebula"}]}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "", secondDoc, revision); err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}

	results, err = store.SearchNotes(ctx, "nebula")
	if err != nil || len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("rebuilt SearchNotes() results=%+v err=%v", results, err)
	}
	results, err = store.SearchNotes(ctx, "galaxy")
	if err != nil {
		t.Fatalf("SearchNotes(old term) error = %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("stale search term survived rebuild: %+v", results)
	}
}

func TestSearchNotesEmptyQueryReturnsRecentNotes(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t)
	defer store.Close()

	first, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	second, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, second.ID, "Recent", second.DocumentJSON, second.Revision); err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}

	results, err := store.SearchNotes(ctx, "")
	if err != nil {
		t.Fatalf("SearchNotes(empty) error = %v", err)
	}
	if len(results) != 2 || results[0].ID != second.ID || results[1].ID != first.ID {
		t.Fatalf("recent results = %+v", results)
	}
}
