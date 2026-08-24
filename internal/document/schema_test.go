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

func TestValidateAndNormalizeJSONAcceptsTaskListCheckedState(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"open"}]}]},{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"done"}]}]}]}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(task list) error = %v", err)
	}
	for _, expected := range []string{`"type":"taskList"`, `"checked":false`, `"checked":true`, `"text":"done"`} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized task list missing %s: %s", expected, normalized)
		}
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidTaskItemAttributes(t *testing.T) {
	tests := []string{
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","content":[{"type":"paragraph"}]}]}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":"false"},"content":[{"type":"paragraph"}]}]}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false,"extra":true},"content":[{"type":"paragraph"}]}]}]}}`,
	}
	for _, input := range tests {
		if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
			t.Fatalf("expected ErrInvalidDocument for invalid task item %s, got %v", input, err)
		}
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
