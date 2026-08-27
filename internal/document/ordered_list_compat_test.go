package document

import (
	"errors"
	"strings"
	"testing"
)

const currentTiptapOrderedListJSON = `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":1,"type":null},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Numbered item"}]}]}]}]}}`

func TestValidateAndNormalizeJSONAcceptsCurrentTiptapOrderedListShape(t *testing.T) {
	normalized, err := ValidateAndNormalizeJSON(currentTiptapOrderedListJSON)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(current Tiptap ordered list) error = %v", err)
	}
	if strings.Contains(normalized, `"type":null`) {
		t.Fatalf("normalized ordered list retained compatibility-only type:null: %s", normalized)
	}
	if !strings.Contains(normalized, `"type":"orderedList"`) || !strings.Contains(normalized, `"start":1`) {
		t.Fatalf("normalized ordered list lost numbered-list semantics: %s", normalized)
	}

	normalizedAgain, err := ValidateAndNormalizeJSON(normalized)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(normalized ordered list) error = %v", err)
	}
	if normalizedAgain != normalized {
		t.Fatalf("ordered-list normalization is not stable:\nfirst:  %s\nsecond: %s", normalized, normalizedAgain)
	}
}

func TestValidateAndNormalizeJSONAcceptsNumericOrderedListTypeCompatibility(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":3,"type":"1"},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}}`
	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(type=1 ordered list) error = %v", err)
	}
	if strings.Contains(normalized, `"type":"1"`) || !strings.Contains(normalized, `"start":3`) {
		t.Fatalf("numeric compatibility metadata was not normalized correctly: %s", normalized)
	}
}

func TestValidateAndNormalizeJSONRejectsUnsupportedOrderedListTypes(t *testing.T) {
	for _, listType := range []string{"a", "A", "i", "I"} {
		input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":1,"type":"` + listType + `"},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}}`
		if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
			t.Fatalf("expected ErrInvalidDocument for ordered-list type %q, got %v", listType, err)
		}
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidOrderedListCompatibilityAttributes(t *testing.T) {
	inputs := []string{
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":0,"type":null},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":1,"type":2},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}}`,
		`{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"orderedList","attrs":{"start":1,"type":null,"extra":true},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}}`,
	}
	for _, input := range inputs {
		if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
			t.Fatalf("expected ErrInvalidDocument for invalid ordered-list attributes %s, got %v", input, err)
		}
	}
}
