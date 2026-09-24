package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/savior714/flashnote/internal/document"
	"github.com/savior714/flashnote/internal/persistence"
)

// syntheticParagraphDoc builds a canonical Flashnote envelope made only of
// plain paragraphs, sized near targetBytes UTF-8, mimicking real long-note use.
func syntheticParagraphDoc(targetBytes, paragraphBytes int) (string, int) {
	if paragraphBytes < 32 {
		paragraphBytes = 32
	}
	var b strings.Builder
	b.WriteString(`{"schemaVersion":1,"doc":{"type":"doc","content":[`)
	blockCount := 0
	sep := ""
	words := []string{"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"}
	for b.Len() < targetBytes {
		var para strings.Builder
		for para.Len() < paragraphBytes {
			if para.Len() > 0 {
				para.WriteByte(' ')
			}
			para.WriteString(words[(para.Len()+blockCount)%len(words)])
		}
		fmt.Fprintf(&b, `%s{"type":"paragraph","content":[{"type":"text","text":%q}]}`, sep, para.String())
		sep = ","
		blockCount++
	}
	b.WriteString(`]}}`)
	return b.String(), blockCount
}

func docStats(doc string) (bytesUTF8, nodes int) {
	var envelope struct {
		Doc json.RawMessage `json:"doc"`
	}
	if err := json.Unmarshal([]byte(doc), &envelope); err != nil {
		return len(doc), -1
	}
	var walk func(json.RawMessage)
	walk = func(raw json.RawMessage) {
		var node struct {
			Type    string            `json:"type"`
			Content []json.RawMessage `json:"content"`
			Marks   []json.RawMessage `json:"marks"`
		}
		if err := json.Unmarshal(raw, &node); err != nil {
			return
		}
		nodes++
		for _, child := range node.Content {
			walk(child)
		}
		nodes += len(node.Marks)
	}
	walk(envelope.Doc)
	return len(doc), nodes
}

// bumpDoc appends one trailing paragraph so each save is a genuine revision write.
func bumpDoc(doc string) string {
	const suffix = "]}}"
	if !strings.HasSuffix(doc, suffix) {
		return doc
	}
	return doc[:len(doc)-len(suffix)] + `,{"type":"paragraph","content":[{"type":"text","text":"bump"}]}` + suffix
}

// TestLargeDocumentSaveSweep measures the backend durable-save boundary on
// synthetic long documents: direct Store.SaveNote vs AppService.SaveNote
// (attachment validation included). Investigation harness for the
// FLASHNOTE-LARGE-DOCUMENT-SAVE-FAILURE-CONVERGENCE-01 task.
func TestLargeDocumentSaveSweep(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.Open(ctx, filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("persistence.Open() error = %v", err)
	}
	defer store.Close()
	service := NewAppService(store)

	note, err := store.CreateNote(ctx)
	if err != nil {
		t.Fatalf("CreateNote() error = %v", err)
	}

	type fixture struct {
		label         string
		targetBytes   int
		paragraphSize int
	}
	fixtures := []fixture{
		{"small-4k", 4_000, 120},
		{"observed-max-23k", 23_000, 120},
		{"64k", 64_000, 120},
		{"256k", 256_000, 120},
		{"512k", 512_000, 120},
		{"1m", 1 << 20, 160},
		{"2m", 2 << 20, 160},
		{"4m", 4 << 20, 160},
		{"8m", 8 << 20, 160},
		{"23k-many-blocks", 23_000, 24},
		{"1m-many-blocks", 1 << 20, 24},
	}

	rev := note.Revision
	for _, fx := range fixtures {
		doc, _ := syntheticParagraphDoc(fx.targetBytes, fx.paragraphSize)
		bytesUTF8, nodes := docStats(doc)

		storeStart := time.Now()
		nextRev, storeErr := store.SaveNote(ctx, note.ID, "Sweep Note", doc, rev)
		storeLatency := time.Since(storeStart)

		if storeErr != nil {
			t.Fatalf("FIRST STORE FAILURE fixture=%s bytes=%d nodes=%d rev=%d err=%v store_ms=%d",
				fx.label, bytesUTF8, nodes, rev, storeErr, storeLatency.Milliseconds())
		}
		rev = nextRev

		serviceStart := time.Now()
		serviceRev, serviceErr := service.SaveNote(note.ID, "Sweep Note", bumpDoc(doc), rev)
		serviceLatency := time.Since(serviceStart)

		if serviceErr != nil {
			t.Fatalf("FIRST APPSERVICE FAILURE fixture=%s bytes=%d nodes=%d rev=%d err=%v service_ms=%d",
				fx.label, bytesUTF8, nodes, rev, serviceErr, serviceLatency.Milliseconds())
		}
		rev = serviceRev

		t.Logf("fixture=%s bytes=%d nodes=%d store_ms=%d service_ms=%d rev=%d OK",
			fx.label, bytesUTF8, nodes, storeLatency.Milliseconds(), serviceLatency.Milliseconds(), rev)
	}
}

func TestLargeEscapeHeavyWireSaveSurvivesReopen(t *testing.T) {
	const mib = 1024 * 1024
	const capBytes = 64 * mib

	text := strings.Repeat("\\", 16*mib-56)
	rawDocument, err := json.Marshal(struct {
		SchemaVersion int `json:"schemaVersion"`
		Doc           any `json:"doc"`
	}{
		SchemaVersion: 1,
		Doc: map[string]any{
			"type": "doc",
			"content": []any{
				map[string]any{
					"type":    "paragraph",
					"content": []any{map[string]any{"type": "text", "text": text}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal escape-heavy document: %v", err)
	}
	documentJSON, err := document.ValidateAndNormalizeJSON(string(rawDocument))
	if err != nil {
		t.Fatalf("validate escape-heavy document: %v", err)
	}
	if len(documentJSON) > 32*mib {
		t.Fatalf("fixture inner bytes = %d, want <= %d", len(documentJSON), 32*mib)
	}

	plainBody, err := json.Marshal(struct {
		Object int `json:"object"`
		Method int `json:"method"`
		Args   struct {
			CallID   string `json:"call-id"`
			MethodID int    `json:"methodID"`
			Args     []any  `json:"args"`
		} `json:"args"`
	}{
		Object: 0,
		Method: 0,
		Args: struct {
			CallID   string `json:"call-id"`
			MethodID int    `json:"methodID"`
			Args     []any  `json:"args"`
		}{
			CallID:   strings.Repeat("c", 21),
			MethodID: 1592610343,
			Args:     []any{"12345678-1234-1234-1234-123456789012", "escape-heavy", documentJSON, 1},
		},
	})
	if err != nil {
		t.Fatalf("marshal plain runtime envelope: %v", err)
	}
	if len(plainBody) <= capBytes {
		t.Fatalf("plain runtime envelope = %d bytes, want > %d", len(plainBody), capBytes)
	}

	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write([]byte(documentJSON)); err != nil {
		t.Fatalf("gzip escape-heavy document: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close escape-heavy gzip writer: %v", err)
	}
	wire := documentWirePrefix + base64.StdEncoding.EncodeToString(compressed.Bytes())

	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "flashnote.db")
	store, err := persistence.Open(ctx, databasePath)
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	note, err := store.CreateNote(ctx)
	if err != nil {
		_ = store.Close()
		t.Fatalf("create note: %v", err)
	}
	service := NewAppService(store)
	started := time.Now()
	revision, err := service.SaveNote(note.ID, "escape-heavy", wire, note.Revision)
	latency := time.Since(started)
	if err != nil {
		_ = store.Close()
		t.Fatalf("save escape-heavy wire: %v", err)
	}
	if revision != note.Revision+1 {
		_ = store.Close()
		t.Fatalf("saved revision = %d, want %d", revision, note.Revision+1)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close persistence after save: %v", err)
	}

	reopened, err := persistence.Open(ctx, databasePath)
	if err != nil {
		t.Fatalf("reopen persistence: %v", err)
	}
	defer reopened.Close()
	restored, err := reopened.OpenNote(ctx, note.ID)
	if err != nil {
		t.Fatalf("reopen saved note: %v", err)
	}
	if restored.Revision != revision {
		t.Fatalf("restored revision = %d, want %d", restored.Revision, revision)
	}
	if restored.DocumentJSON != documentJSON {
		t.Fatalf("restored document bytes = %d, want %d", len(restored.DocumentJSON), len(documentJSON))
	}
	results, err := reopened.SearchNotes(ctx, "escape-heavy")
	if err != nil {
		t.Fatalf("search restored note: %v", err)
	}
	if len(results) != 1 || results[0].ID != note.ID {
		t.Fatalf("search result count = %d, want saved note", len(results))
	}
	t.Logf("inner_bytes=%d plain_envelope_bytes=%d wire_bytes=%d revision=%d latency_ms=%d durable=1", len(documentJSON), len(plainBody), len(wire), restored.Revision, latency.Milliseconds())
}
