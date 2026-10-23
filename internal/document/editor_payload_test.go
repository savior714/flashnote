package document

import (
	"strings"
	"testing"
)

// TestValidateAndNormalizeJSONAcceptsEditorProducedPayload proves the Go
// validation boundary accepts exactly what the frontend emits, so a round trip
// through the editor and back through validation cannot fail on shape alone.
func TestValidateAndNormalizeJSONAcceptsEditorProducedPayload(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties": [{"id": "p-title", "name": "Task", "type": "title"}, {"id": "p-status", "name": "Status", "type": "status", "options": [{"id": "o-todo", "name": "To do"}, {"id": "o-done", "name": "Done", "done": true}]}, {"id": "p-count", "name": "Count", "type": "number"}, {"id": "p-check", "name": "Done?", "type": "checkbox"}, {"id": "p-start", "name": "Start", "type": "date"}, {"id": "p-due", "name": "Due", "type": "date"}, {"id": "p-tags", "name": "Tags", "type": "multiSelect", "options": [{"id": "o-a", "name": "Alpha"}]}], "records": [{"id": "rec-1", "values": {"p-title": "Ship it", "p-status": "o-done", "p-count": 42, "p-check": true, "p-start": "2026-10-01", "p-due": "2026-10-08", "p-tags": ["o-a"]}, "memo": "remember the deploy checklist"}, {"id": "rec-2", "values": {"p-title": "Second", "p-status": "o-todo"}}], "dateRules": [{"id": "r1", "basePropertyId": "p-start", "targetPropertyId": "p-due", "offsetDays": 7}], "manualDates": [], "view": "table", "sort": {"propertyId": "p-due", "direction": "asc"}, "filters": [{"propertyId": "p-status", "op": "is", "value": "o-done"}], "rowHighlights": {"rec-2": "yellow"}}}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(editor payload) error = %v", err)
	}
	for _, expected := range []string{
		`"type":"database"`,
		`"name":"Status"`,
		`"p-title":"Ship it"`,
		`"p-count":42`,
		`"p-check":true`,
		`"p-tags":["o-a"]`,
		`"p-start":"2026-10-01"`,
		`"p-due":"2026-10-08"`,
		`"remember the deploy checklist"`,
		`"offsetDays":7`,
		`"direction":"asc"`,
		`"value":"o-done"`,
		`"rec-2":"yellow"`,
	} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized payload missing %s:\n%s", expected, normalized)
		}
	}
}
