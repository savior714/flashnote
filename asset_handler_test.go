package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/savior714/flashnote/internal/persistence"
)

func TestAttachmentMiddlewareServesOnlyKnownAttachments(t *testing.T) {
	ctx := context.Background()
	store, err := persistence.Open(ctx, filepath.Join(t.TempDir(), "flashnote.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	content, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("decode PNG: %v", err)
	}
	attachment, err := store.IngestImage(ctx, content, "test.png")
	if err != nil {
		t.Fatalf("IngestImage() error = %v", err)
	}

	fallbackCalled := false
	handler := attachmentMiddleware(store)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackCalled = true
		w.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequest(http.MethodGet, "/attachments/"+attachment.ID, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200; body=%s", response.Code, response.Body.String())
	}
	if !bytes.Equal(response.Body.Bytes(), content) {
		t.Fatal("served attachment bytes changed")
	}
	if got := response.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", got)
	}
	if fallbackCalled {
		t.Fatal("attachment request fell through to bundled assets")
	}

	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/attachments/missing", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.Code)
	}

	fallback := httptest.NewRecorder()
	handler.ServeHTTP(fallback, httptest.NewRequest(http.MethodGet, "/", nil))
	if fallback.Code != http.StatusNoContent || !fallbackCalled {
		t.Fatalf("normal assets did not reach fallback: status=%d called=%t", fallback.Code, fallbackCalled)
	}
}
