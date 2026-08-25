package document

import (
	"errors"
	"reflect"
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

func TestValidateAndNormalizeJSONAcceptsAttachmentImage(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"attachment-b","alt":"diagram","title":null,"width":640,"height":480}},{"type":"image","attrs":{"attachmentId":"attachment-a","alt":null,"title":null,"width":null,"height":null}},{"type":"image","attrs":{"attachmentId":"attachment-b","alt":null,"title":null,"width":null,"height":null}}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(image) error = %v", err)
	}
	if strings.Contains(normalized, `"src"`) {
		t.Fatalf("canonical image unexpectedly persisted src: %s", normalized)
	}
	ids, err := AttachmentIDs(normalized)
	if err != nil {
		t.Fatalf("AttachmentIDs() error = %v", err)
	}
	if want := []string{"attachment-a", "attachment-b"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("AttachmentIDs() = %v, want %v", ids, want)
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidImageAttributes(t *testing.T) {
	tests := []string{
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{}}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"x","src":"file:///tmp/x.png"}}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"x","width":0}}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"x"},"content":[]}]}}`,
	}
	for _, input := range tests {
		if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
			t.Fatalf("expected ErrInvalidDocument for invalid image %s, got %v", input, err)
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

func TestValidateAndNormalizeJSONAcceptsAllSlashCommandStructures(t *testing.T) {
	structures := []struct {
		name string
		json string
	}{
		{
			name: "paragraph (text)",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Plain text"}]}]}}`,
		},
		{
			name: "heading 1",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"H1 Title"}]}]}}`,
		},
		{
			name: "heading 2",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"H2 Subtitle"}]}]}}`,
		},
		{
			name: "heading 3",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"H3 Section"}]}]}}`,
		},
		{
			name: "bullet list",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Bullet item"}]}]}]}]}}`,
		},
		{
			name: "ordered list",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Numbered item"}]}]}]}]}}`,
		},
		{
			name: "todo list",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Todo item"}]}]}]}]}}`,
		},
		{
			name: "quote (blockquote)",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Quote text"}]}]}]}}`,
		},
		{
			name: "code block",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"codeBlock","content":[{"type":"text","text":"const x = 42"}]}]}}`,
		},
		{
			name: "divider (horizontalRule)",
			json: `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph"},{"type":"horizontalRule"},{"type":"paragraph"}]}}`,
		},
	}

	for _, tt := range structures {
		t.Run(tt.name, func(t *testing.T) {
			normalized, err := ValidateAndNormalizeJSON(tt.json)
			if err != nil {
				t.Fatalf("ValidateAndNormalizeJSON(%s) error = %v", tt.name, err)
			}
			if normalized == "" {
				t.Fatalf("ValidateAndNormalizeJSON(%s) returned empty string", tt.name)
			}
		})
	}
}

