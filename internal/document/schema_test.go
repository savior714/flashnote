package document

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateAndNormalizeJSONAcceptsSupportedDocument(t *testing.T) {
	input := `{
		"schemaVersion": 1,
		"doc": {
			"type": "doc",
			"content": [{
				"type": "paragraph",
				"content": [{
					"type": "text",
					"marks": [{"type": "bold"}],
					"text": "hello"
				}]
			}]
		}
	}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON() error = %v", err)
	}
	if !strings.Contains(normalized, `"schemaVersion":1`) || !strings.Contains(normalized, `"text":"hello"`) {
		t.Fatalf("normalized document missing expected data: %s", normalized)
	}
}

func TestValidateAndNormalizeJSONRejectsWrongSchemaVersion(t *testing.T) {
	_, err := ValidateAndNormalizeJSON(`{"schemaVersion":2,"doc":{"type":"doc","content":[]}}`)
	if !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected ErrInvalidDocument, got %v", err)
	}
}

func TestValidateAndNormalizeJSONRejectsUnknownNodeAndMark(t *testing.T) {
	tests := []string{
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"table"}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"highlight"}]}]}]}}`,
	}
	for _, input := range tests {
		if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
			t.Fatalf("expected ErrInvalidDocument for %s, got %v", input, err)
		}
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidHeadingLevel(t *testing.T) {
	_, err := ValidateAndNormalizeJSON(`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":4}}]}}`)
	if !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected ErrInvalidDocument, got %v", err)
	}
}
