package persistence

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/savior714/flashnote/internal/document"
)

const onePixelPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func testPNG(t *testing.T) []byte {
	t.Helper()
	value, err := base64.StdEncoding.DecodeString(onePixelPNGBase64)
	if err != nil {
		t.Fatalf("decode test PNG: %v", err)
	}
	return value
}

func TestImageAttachmentRoundTripAndReconciliation(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	content := testPNG(t)
	attachment, err := store.IngestImage(ctx, content, "Screenshot.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	if attachment.ID == "" || attachment.MediaType != "image/png" || attachment.Width != 1 || attachment.Height != 1 {
		t.Fatalf("unexpected attachment metadata: %+v", attachment)
	}

	opened, err := store.OpenAttachment(ctx, attachment.ID)
	if err != nil {
		t.Fatalf("OpenAttachment() error = %v", err)
	}
	readBack := make([]byte, len(content))
	if _, err := opened.File.Read(readBack); err != nil {
		opened.File.Close()
		t.Fatalf("read attachment: %v", err)
	}
	opened.File.Close()
	if !bytes.Equal(readBack, content) {
		t.Fatal("attachment bytes changed during ingest")
	}

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	withImage := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"` + attachment.ID + `","alt":"Screenshot.png","title":null,"width":null,"height":null}}]}}`
	revision, err := store.SaveNote(ctx, note.ID, "", withImage, note.Revision)
	if err != nil {
		t.Fatalf("SaveNote(image) error = %v", err)
	}
	if err := store.ReconcileStoredAttachments(ctx, false); err != nil {
		t.Fatalf("ReconcileStoredAttachments(referenced) error = %v", err)
	}
	if _, err := store.OpenAttachment(ctx, attachment.ID); err != nil {
		t.Fatalf("referenced attachment was removed: %v", err)
	}

	if err := store.MoveNoteToTrash(ctx, note.ID); err != nil {
		t.Fatalf("MoveNoteToTrash() error = %v", err)
	}
	if err := store.ReconcileStoredAttachments(ctx, false); err != nil {
		t.Fatalf("ReconcileStoredAttachments(trash) error = %v", err)
	}
	if _, err := store.OpenAttachment(ctx, attachment.ID); err != nil {
		t.Fatalf("Trash attachment was removed before permanent deletion: %v", err)
	}
	if err := store.RestoreNote(ctx, note.ID); err != nil {
		t.Fatalf("RestoreNote() error = %v", err)
	}

	revision, err = store.SaveNote(ctx, note.ID, "", document.EmptyJSON(), revision)
	if err != nil {
		t.Fatalf("SaveNote(remove image) error = %v", err)
	}
	_ = revision
	if err := store.ReconcileStoredAttachments(ctx, false); err != nil {
		t.Fatalf("ReconcileStoredAttachments(unreferenced) error = %v", err)
	}
	if _, err := store.OpenAttachment(ctx, attachment.ID); !errors.Is(err, ErrAttachmentNotFound) {
		t.Fatalf("unreferenced attachment still opens: %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.attachmentsDir, attachment.StorageName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unreferenced attachment bytes still exist: %v", err)
	}
}

func TestPendingAndUnknownAttachmentsFailClosed(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "flashnote.db")
	store, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	pending, err := store.IngestImage(ctx, testPNG(t), "pending.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}
	if err := store.ReconcileStoredAttachments(ctx, false); err != nil {
		t.Fatalf("ReconcileStoredAttachments(runtime) error = %v", err)
	}
	if _, err := store.OpenAttachment(ctx, pending.ID); err != nil {
		t.Fatalf("runtime reconciliation removed pending attachment: %v", err)
	}
	if err := store.ReconcileStoredAttachments(ctx, true); err != nil {
		t.Fatalf("ReconcileStoredAttachments(startup) error = %v", err)
	}
	if _, err := store.OpenAttachment(ctx, pending.ID); !errors.Is(err, ErrAttachmentNotFound) {
		t.Fatalf("pending attachment survived startup reconciliation: %v", err)
	}

	note, _, err := store.OpenInitialNote(ctx)
	if err != nil {
		t.Fatalf("OpenInitialNote() error = %v", err)
	}
	unknown := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"missing","alt":null,"title":null,"width":null,"height":null}}]}}`
	if _, err := store.SaveNote(ctx, note.ID, "", unknown, note.Revision); err == nil {
		t.Fatal("SaveNote() accepted unknown attachment reference")
	}
}
