package document

import (
	"errors"
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

// TestValidateAndNormalizeJSONAcceptsBatchEditedPayload proves the save boundary
// accepts the payload a batch date edit produces. The batch path runs the same
// reconciliation a single-cell date edit runs, so a linked deadline follows a
// moved start date and a deadline the user set by hand is stored as a detached
// one. A batch edit that skipped that reconciliation would leave a stale derived
// date here, which the same boundary rejects.
func TestValidateAndNormalizeJSONAcceptsBatchEditedPayload(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{` +
		`"properties":[` +
		`{"id":"p-title","name":"Task","type":"title"},` +
		`{"id":"p-start","name":"Start","type":"date"},` +
		`{"id":"p-due","name":"Due","type":"date"}` +
		`],"records":[` +
		`{"id":"rec-1","values":{"p-title":"Ship it","p-start":"2026-10-10","p-due":"2026-10-31"}},` +
		`{"id":"rec-2","values":{"p-title":"Review it","p-start":"2026-10-10","p-due":"2026-10-17"}},` +
		`{"id":"rec-3","values":{"p-title":"","p-due":"2026-10-24"}}` +
		`],` +
		`"dateRules":[{"id":"rule-1","basePropertyId":"p-start","targetPropertyId":"p-due","offsetDays":7}],` +
		`"manualDates":[` +
		`{"recordId":"rec-1","propertyId":"p-due"},` +
		`{"recordId":"rec-3","propertyId":"p-due"}` +
		`],` +
		`"view":"table"}}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(batch edited payload) error = %v", err)
	}
	for _, expected := range []string{
		`"p-start":"2026-10-10"`,
		`"p-due":"2026-10-17"`,
		`"p-due":"2026-10-31"`,
		`"offsetDays":7`,
		`"recordId":"rec-3"`,
	} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized payload missing %s:\n%s", expected, normalized)
		}
	}

	// The same payload with rec-2's deadline left at the value the old start date
	// produced is a stale derived date, so it is refused rather than saved.
	stale := strings.Replace(input, `"p-start":"2026-10-10","p-due":"2026-10-17"`, `"p-start":"2026-10-10","p-due":"2026-10-08"`, 1)
	if _, err := ValidateAndNormalizeJSON(stale); !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected a stale derived date after a batch edit to be rejected, got %v", err)
	}
}

// TestValidateAndNormalizeJSONAcceptsCalendarCreatedTask proves the boundary
// accepts a task created from a calendar date in a database that had no date
// property: the creation adds the property and the deadline in one payload.
func TestValidateAndNormalizeJSONAcceptsCalendarCreatedTask(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{` +
		`"properties":[` +
		`{"id":"p-title","name":"Task","type":"title"},` +
		`{"id":"p-due","name":"Due date","type":"date"}` +
		`],` +
		`"records":[{"id":"rec-1","values":{"p-title":"","p-due":"2026-10-24"}}],` +
		`"dateRules":[],"manualDates":[],"view":"week"}}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(calendar created task) error = %v", err)
	}
	for _, expected := range []string{
		`"name":"Due date"`,
		`"type":"date"`,
		`"p-due":"2026-10-24"`,
		`"view":"week"`,
	} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized payload missing %s:\n%s", expected, normalized)
		}
	}
}
