package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/savior714/flashnote/internal/persistence"
)

// TestSeedProbeFixture seeds one note into an explicit test database for
// native save-path reproduction. It is env-gated so ordinary test runs never
// execute it, and it only ever writes the database path given in
// FLASHNOTE_SEED_DB (never the real user database).
//
// Env:
//
//	FLASHNOTE_SEED_DB    (required) target sqlite path
//	FLASHNOTE_SEED_BYTES (required) synthetic doc size when no other shape
//	FLASHNOTE_SEED_TITLE (optional) note title
//	FLASHNOTE_SEED_JSON  (optional) load document JSON from this file
//	FLASHNOTE_SEED_IMAGE (optional "ingest") seed a real ingested PNG image node
//	FLASHNOTE_SEED_DROP_BYTES (optional "1") delete the ingested bytes after save
func TestSeedProbeFixture(t *testing.T) {
	dbPath := os.Getenv("FLASHNOTE_SEED_DB")
	if dbPath == "" {
		t.Skip("FLASHNOTE_SEED_DB not set")
	}
	if dbPath == "" || filepath.Base(dbPath) == "" {
		t.Fatal("invalid FLASHNOTE_SEED_DB")
	}
	size, err := strconv.Atoi(os.Getenv("FLASHNOTE_SEED_BYTES"))
	if err != nil || size < 1 {
		t.Fatalf("invalid FLASHNOTE_SEED_BYTES: %v", err)
	}
	title := os.Getenv("FLASHNOTE_SEED_TITLE")
	if title == "" {
		title = "probe note"
	}

	ctx := context.Background()
	store, err := persistence.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("persistence.Open(%s) error = %v", dbPath, err)
	}
	defer store.Close()

	note, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}

	var doc string
	var blocks int
	var attachmentID string

	switch {
	case os.Getenv("FLASHNOTE_SEED_IMAGE") == "ingest":
		var pngBytes bytes.Buffer
		img := image.NewRGBA(image.Rect(0, 0, 4, 4))
		if err := png.Encode(&pngBytes, img); err != nil {
			t.Fatalf("encode png: %v", err)
		}
		att, err := store.IngestImage(ctx, pngBytes.Bytes(), "probe.png")
		if err != nil {
			t.Fatalf("IngestImage() error = %v", err)
		}
		attachmentID = att.ID
		doc = fmt.Sprintf(
			`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"image probe"}]},{"type":"image","attrs":{"attachmentId":%q,"alt":null,"title":null,"width":null,"height":null}},{"type":"paragraph","content":[{"type":"text","text":"after image"}]}]}}`,
			att.ID,
		)
		blocks = 3
	case os.Getenv("FLASHNOTE_SEED_JSON") != "":
		raw, err := os.ReadFile(os.Getenv("FLASHNOTE_SEED_JSON"))
		if err != nil {
			t.Fatalf("read FLASHNOTE_SEED_JSON: %v", err)
		}
		doc = string(raw)
		blocks = -1
	default:
		doc, blocks = syntheticParagraphDoc(size, 120)
	}

	rev, err := store.SaveNote(ctx, note.ID, title, doc, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote(seed) error = %v", err)
	}

	if attachmentID != "" && os.Getenv("FLASHNOTE_SEED_DROP_BYTES") == "1" {
		att, err := store.OpenAttachment(ctx, attachmentID)
		if err != nil {
			t.Fatalf("OpenAttachment before drop: %v", err)
		}
		_ = att.File.Close()
		// storage file lives beside the database under attachments/
		entries, err := os.ReadDir(filepath.Join(filepath.Dir(dbPath), "attachments"))
		if err != nil {
			t.Fatalf("read attachments dir: %v", err)
		}
		removed := 0
		for _, entry := range entries {
			if entry.Name() == attachmentID+".png" || entry.Name() == attachmentID+".jpg" {
				if err := os.Remove(filepath.Join(filepath.Dir(dbPath), "attachments", entry.Name())); err != nil {
					t.Fatalf("drop bytes: %v", err)
				}
				removed++
			}
		}
		if removed == 0 {
			// fall back: drop every non-hidden file (single-attachment fixture)
			for _, entry := range entries {
				if entry.IsDir() || entry.Name()[0] == '.' {
					continue
				}
				if err := os.Remove(filepath.Join(filepath.Dir(dbPath), "attachments", entry.Name())); err != nil {
					t.Fatalf("drop bytes: %v", err)
				}
				removed++
			}
		}
		if removed == 0 {
			t.Fatal("FLASHNOTE_SEED_DROP_BYTES found no attachment bytes to remove")
		}
		fmt.Printf("DROPPED_BYTES attachment=%s\n", attachmentID)
	}

	statsBytes, nodes := docStats(doc)
	fmt.Printf("SEEDED db=%s note_id=%s title=%q bytes=%d blocks=%d nodes=%d revision=%d attachment=%q\n",
		dbPath, note.ID, title, statsBytes, blocks, nodes, rev, attachmentID)
}
