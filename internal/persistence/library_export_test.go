package persistence

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLibraryMarkdownExportPreservesFoldersImagesAndExcludesTrash(t *testing.T) {
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
	root, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	rootJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Root body"}]},{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":"Screenshot","title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, root.ID, "Root", rootJSON, root.Revision); err != nil {
		t.Fatalf("SaveNote(root) error = %v", err)
	}

	folder, err := store.CreateFolder(ctx, "Projects")
	if err != nil {
		t.Fatalf("CreateFolder() error = %v", err)
	}
	folderNote, err := store.CreateNoteInFolder(ctx, folder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder() error = %v", err)
	}
	if _, err := store.SaveNote(ctx, folderNote.ID, "Folder Note", `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Folder body"}]}]}}`, folderNote.Revision); err != nil {
		t.Fatalf("SaveNote(folder note) error = %v", err)
	}

	trashNote, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote(trash) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, trashNote.ID, "Trash Me", `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"trash body"}]}]}}`, trashNote.Revision); err != nil {
		t.Fatalf("SaveNote(trash) error = %v", err)
	}
	if err := store.MoveNoteToTrash(ctx, trashNote.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}

	deletedFolder, err := store.CreateFolder(ctx, "Deleted Folder")
	if err != nil {
		t.Fatalf("CreateFolder(deleted) error = %v", err)
	}
	deletedFolderNote, err := store.CreateNoteInFolder(ctx, deletedFolder.ID)
	if err != nil {
		t.Fatalf("CreateNoteInFolder(deleted) error = %v", err)
	}
	if _, err := store.SaveNote(ctx, deletedFolderNote.ID, "Deleted Child", `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"deleted child"}]}]}}`, deletedFolderNote.Revision); err != nil {
		t.Fatalf("SaveNote(deleted child) error = %v", err)
	}
	if _, err := store.MoveFolderToTrash(ctx, deletedFolder.ID); err != nil {
		t.Fatalf("MoveFolderToTrash() error = %v", err)
	}

	parent := t.TempDir()
	exportDirectory, noteCount, folderCount, err := store.ExportLibraryMarkdown(ctx, parent)
	if err != nil {
		t.Fatalf("ExportLibraryMarkdown() error = %v", err)
	}
	if noteCount != 2 || folderCount != 1 {
		t.Fatalf("ExportLibraryMarkdown() counts = notes %d folders %d, want notes 2 folders 1", noteCount, folderCount)
	}
	if filepath.Base(exportDirectory) != libraryExportDirectoryName {
		t.Fatalf("export directory = %q", exportDirectory)
	}

	rootMarkdown, err := os.ReadFile(filepath.Join(exportDirectory, "Root.md"))
	if err != nil {
		t.Fatalf("read root Markdown: %v", err)
	}
	wantImagePath := "Root.assets/" + attachment.ID + ".png"
	for _, expected := range []string{"# Root", "Root body", "![Screenshot](" + wantImagePath + ")"} {
		if !strings.Contains(string(rootMarkdown), expected) {
			t.Fatalf("root Markdown missing %q:\n%s", expected, rootMarkdown)
		}
	}
	exportedImage, err := os.ReadFile(filepath.Join(exportDirectory, "Root.assets", attachment.ID+".png"))
	if err != nil {
		t.Fatalf("read exported root image: %v", err)
	}
	if !bytes.Equal(exportedImage, testPNG(t)) {
		t.Fatal("library exported image bytes differ from canonical attachment")
	}
	folderMarkdown, err := os.ReadFile(filepath.Join(exportDirectory, "Projects", "Folder Note.md"))
	if err != nil {
		t.Fatalf("read folder Markdown: %v", err)
	}
	if !strings.Contains(string(folderMarkdown), "# Folder Note") || !strings.Contains(string(folderMarkdown), "Folder body") {
		t.Fatalf("folder Markdown content unexpected:\n%s", folderMarkdown)
	}
	for _, excluded := range []string{
		filepath.Join(exportDirectory, "Trash Me.md"),
		filepath.Join(exportDirectory, "Deleted Folder"),
	} {
		if _, err := os.Stat(excluded); !os.IsNotExist(err) {
			t.Fatalf("Trash content unexpectedly exported at %q (err=%v)", excluded, err)
		}
	}
}

func TestLibraryMarkdownExportResolvesCrossPlatformCollisions(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	if _, err := store.CreateFolder(ctx, "Root.assets"); err != nil {
		t.Fatalf("CreateFolder(Root.assets) error = %v", err)
	}
	firstCollisionFolder, err := store.CreateFolder(ctx, "A/B")
	if err != nil {
		t.Fatalf("CreateFolder(A/B) error = %v", err)
	}
	if _, err := store.CreateFolder(ctx, "A:B"); err != nil {
		t.Fatalf("CreateFolder(A:B) error = %v", err)
	}
	_ = firstCollisionFolder

	attachment, err := store.IngestImage(ctx, testPNG(t), "Screenshot.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	root, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	rootJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":"","title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, root.ID, "Root", rootJSON, root.Revision); err != nil {
		t.Fatalf("SaveNote(root) error = %v", err)
	}
	for index := 0; index < 2; index++ {
		note, err := store.CreateNote(ctx)
		if err != nil {
			t.Fatalf("CreateNote(Same %d) error = %v", index, err)
		}
		if _, err := store.SaveNote(ctx, note.ID, "Same", `{"schemaVersion":1,"doc":{"type":"doc","content":[]}}`, note.Revision); err != nil {
			t.Fatalf("SaveNote(Same %d) error = %v", index, err)
		}
	}

	parent := t.TempDir()
	if err := os.Mkdir(filepath.Join(parent, libraryExportDirectoryName), 0o755); err != nil {
		t.Fatalf("seed previous export directory: %v", err)
	}
	exportDirectory, noteCount, folderCount, err := store.ExportLibraryMarkdown(ctx, parent)
	if err != nil {
		t.Fatalf("ExportLibraryMarkdown() error = %v", err)
	}
	if filepath.Base(exportDirectory) != libraryExportDirectoryName+" (2)" {
		t.Fatalf("collision export directory = %q", exportDirectory)
	}
	if noteCount != 3 || folderCount != 3 {
		t.Fatalf("collision export counts = notes %d folders %d", noteCount, folderCount)
	}

	for _, path := range []string{
		filepath.Join(exportDirectory, "Root.assets"),
		filepath.Join(exportDirectory, "A_B"),
		filepath.Join(exportDirectory, "A_B (2)"),
		filepath.Join(exportDirectory, "Root (2).md"),
		filepath.Join(exportDirectory, "Root (2).assets", attachment.ID+".png"),
		filepath.Join(exportDirectory, "Same.md"),
		filepath.Join(exportDirectory, "Same (2).md"),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected collision-safe export path %q: %v", path, err)
		}
	}
}

func TestLibraryMarkdownExportDoesNotPromotePartialFailure(t *testing.T) {
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
	documentJSON := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":"","title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "Broken", documentJSON, note.Revision); err != nil {
		t.Fatalf("SaveNote() error = %v", err)
	}
	if err := os.Remove(filepath.Join(store.attachmentsDir, attachment.StorageName)); err != nil {
		t.Fatalf("remove canonical attachment to induce export failure: %v", err)
	}

	parent := t.TempDir()
	if _, _, _, err := store.ExportLibraryMarkdown(ctx, parent); err == nil {
		t.Fatal("ExportLibraryMarkdown() unexpectedly succeeded with missing attachment bytes")
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatalf("ReadDir(parent) error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("failed library export left visible residue: %v", entries)
	}
}
