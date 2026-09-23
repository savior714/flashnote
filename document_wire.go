package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
)

// documentWirePrefix marks a SaveNote documentJSON argument that carries
// base64(gzip(document)) instead of plain JSON. It must stay in sync with
// frontend/src/lib/documentWire.ts.
const documentWirePrefix = "fn1:"

func decodeSavedDocument(wire string) (string, error) {
	if !strings.HasPrefix(wire, documentWirePrefix) {
		return wire, nil
	}
	payload := wire[len(documentWirePrefix):]
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", fmt.Errorf("decode saved document: %w", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("decode saved document: %w", err)
	}
	defer reader.Close()
	plain, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("decode saved document: %w", err)
	}
	return string(plain), nil
}
