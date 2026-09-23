package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"strings"
	"testing"
)

func TestDecodeSavedDocumentPassesPlainJSON(t *testing.T) {
	plain := `{"schemaVersion":1,"doc":{"type":"doc","content":[]}}`
	got, err := decodeSavedDocument(plain)
	if err != nil {
		t.Fatalf("decodeSavedDocument(plain) error = %v", err)
	}
	if got != plain {
		t.Fatalf("decodeSavedDocument(plain) = %q, want unchanged", got)
	}
}

func TestDecodeSavedDocumentDecodesGzipWire(t *testing.T) {
	plain := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph"}]}}`
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write([]byte(plain)); err != nil {
		t.Fatalf("gzip write error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("gzip close error = %v", err)
	}
	wire := documentWirePrefix + base64.StdEncoding.EncodeToString(compressed.Bytes())

	got, err := decodeSavedDocument(wire)
	if err != nil {
		t.Fatalf("decodeSavedDocument(wire) error = %v", err)
	}
	if got != plain {
		t.Fatalf("decodeSavedDocument(wire) mismatch: got %d bytes, want %d bytes", len(got), len(plain))
	}
}

func TestDecodeSavedDocumentRejectsCorruptWire(t *testing.T) {
	if _, err := decodeSavedDocument(documentWirePrefix + "not-base64!!"); err == nil {
		t.Fatal("decodeSavedDocument(corrupt) error = nil, want error")
	}
	if _, err := decodeSavedDocument(documentWirePrefix + base64.StdEncoding.EncodeToString([]byte("not gzip"))); err == nil {
		t.Fatal("decodeSavedDocument(not-gzip) error = nil, want error")
	}
}

func TestDecodeSavedDocumentWirePrefixMatchesFrontendContract(t *testing.T) {
	if !strings.HasPrefix(documentWirePrefix, "fn") || !strings.HasSuffix(documentWirePrefix, ":") {
		t.Fatalf("documentWirePrefix %q does not match frontend fn1: contract", documentWirePrefix)
	}
}
