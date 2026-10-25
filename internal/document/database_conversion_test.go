package document

import (
	"strings"
	"testing"
)

// TestValidateAndNormalizeJSONAcceptsConvertedTableDatabase proves the Go
// validation boundary accepts the payload a frontend table→database conversion
// produces once its shape is flattened for storage: one title property plus text
// properties, string values (Korean header text, number-like and date-like
// strings preserved verbatim), and no date rules yet. The tail of the conversion's
// regression proof is the frontend asserting that produced attrs; this is the Go
// half that proves the storage schema admits it.
func TestValidateAndNormalizeJSONAcceptsConvertedTableDatabase(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{` +
		`"properties":[` +
		`{"id":"p-name","name":"이름","type":"title"},` +
		`{"id":"p-qty","name":"수량","type":"text"},` +
		`{"id":"p-start","name":"시작","type":"text"}],` +
		`"records":[` +
		`{"id":"r-1","values":{"p-name":"A","p-qty":"100","p-start":"2026-10-01"}},` +
		`{"id":"r-2","values":{"p-name":"B","p-qty":"200","p-start":"2026-10-05"}}],` +
		`"dateRules":[],"manualDates":[],"view":"table"}}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(converted table database) error = %v", err)
	}
	for _, expected := range []string{
		`"type":"database"`,
		`"name":"이름","type":"title"`,
		`"name":"수량","type":"text"`,
		`"p-name":"A"`,
		`"p-qty":"100"`,
		`"p-start":"2026-10-05"`,
		`"view":"table"`,
	} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized converted database missing %s:\n%s", expected, normalized)
		}
	}
	// The payload must not carry the editor's `payload` wrapper at the boundary;
	// a stray wrapper is exactly the `unknown field "payload"` rejection.
	if strings.Contains(normalized, `"payload"`) {
		t.Fatalf("normalized database still carries a payload wrapper:\n%s", normalized)
	}
}
