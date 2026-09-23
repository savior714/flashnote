package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
