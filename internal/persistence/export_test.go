package persistence

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSingleNoteMarkdownExportIncludesTitleBodyAndImage(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	attachment, err := store.IngestImage(ctx, testPNG(t), "Screenshot.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	documentJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Portable body"}]},{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":"Screenshot","title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "Plan: Q3/Review?", documentJSON, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}

	targetID, filename, err := store.CurrentNoteExportTarget(ctx)
	if err != nil {
		t.Fatalf("CurrentNoteExportTarget() error = %v", err)
	}
	if targetID != note.ID {
		t.Fatalf("CurrentNoteExportTarget() id = %q, want %q", targetID, note.ID)
	}
	if filename != "Plan_ Q3_Review_.md" {
		t.Fatalf("CurrentNoteExportTarget() filename = %q", filename)
	}

	exportDir := t.TempDir()
	destination := filepath.Join(exportDir, "Plan.md")
	if err := store.ExportNoteMarkdown(ctx, targetID, destination); err != nil {
		t.Fatalf("ExportNoteMarkdown() error = %v", err)
	}

	markdown, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("read Markdown export: %v", err)
	}
	wantImagePath := "Plan.assets/" + attachment.ID + ".png"
	for _, expected := range []string{"# Plan: Q3/Review?", "Portable body", "![Screenshot](" + wantImagePath + ")"} {
		if !strings.Contains(string(markdown), expected) {
			t.Fatalf("Markdown export missing %q:\n%s", expected, markdown)
		}
	}

	exportedImage, err := os.ReadFile(filepath.Join(exportDir, "Plan.assets", attachment.ID+".png"))
	if err != nil {
		t.Fatalf("read exported image: %v", err)
	}
	if !bytes.Equal(exportedImage, testPNG(t)) {
		t.Fatal("exported image bytes differ from canonical attachment")
	}
}

func TestSingleNoteMarkdownExportUsesExactRequestedNote(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	first, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, first.ID, "First", `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"first body"}]}]}}`, first.Revision); err != nil {
		t.Fatalf("SaveNote(first) error = %v", err)
	}
	second, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, second.ID, "Second", `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"second body"}]}]}}`, second.Revision); err != nil {
		t.Fatalf("SaveNote(second) error = %v", err)
	}

	destination := filepath.Join(t.TempDir(), "first.md")
	if err := store.ExportNoteMarkdown(ctx, first.ID, destination); err != nil {
		t.Fatalf("ExportNoteMarkdown(first) error = %v", err)
	}
	markdown, err := os.ReadFile(destination)
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	if !strings.Contains(string(markdown), "# First") || strings.Contains(string(markdown), "Second") {
		t.Fatalf("export did not preserve exact requested note:\n%s", markdown)
	}
}

func TestSanitizeExportBasenameIsCrossPlatformSafe(t *testing.T) {
	tests := map[string]string{
		"":                  "Untitled",
		"  trailing. ":      "trailing",
		`a<b>:c/d\\e|f?g*h`: "a_b__c_d__e_f_g_h",
		"CON":               "CON-note",
		"lpt9.txt":          "lpt9.txt-note",
	}
	for input, want := range tests {
		if got := sanitizeExportBasename(input); got != want {
			t.Fatalf("sanitizeExportBasename(%q) = %q, want %q", input, got, want)
		}
	}
}
