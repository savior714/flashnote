package document

import (
	"errors"
	"strings"
	"testing"
)

// databaseFixture builds a minimal valid v2 database node payload. Every test
// starts from a known-valid document so a rejection can be attributed to the one
// field the test changed.
func databaseFixture(records ...string) string {
	if len(records) == 0 {
		records = []string{`{"id":"rec-1","values":{"p-title":"Write docs","p-date":"2026-10-01"}}`}
	}
	return `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{` +
		`"properties":[` +
		`{"id":"p-title","name":"Task","type":"title"},` +
		`{"id":"p-status","name":"Status","type":"status","options":[{"id":"o-todo","name":"To do","done":false},{"id":"o-done","name":"Done","done":true}]},` +
		`{"id":"p-date","name":"Start","type":"date"},` +
		`{"id":"p-target","name":"Due","type":"date"},` +
		`{"id":"p-tags","name":"Tags","type":"multiSelect","options":[{"id":"o-a","name":"A"}]}` +
		`],"records":[` + strings.Join(records, ",") + `],` +
		`"dateRules":[],"manualDates":[],"view":"table"}}]}}`
}

func TestValidateAndNormalizeJSONAcceptsVersionTwoDatabase(t *testing.T) {
	normalized, err := ValidateAndNormalizeJSON(databaseFixture())
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(database) error = %v", err)
	}
	for _, expected := range []string{
		`"schemaVersion":2`,
		`"type":"database"`,
		`"p-title":"Write docs"`,
		`"p-date":"2026-10-01"`,
		`"name":"To do"`,
	} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized database missing %s: %s", expected, normalized)
		}
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidDatabase(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{
			name:  "database without attrs",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database"}]}}`,
		},
		{
			name:  "database with content children",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"p","name":"T","type":"title"}],"records":[],"dateRules":[],"manualDates":[],"view":"table"},"content":[{"type":"paragraph"}]}]}}`,
		},
		{
			name:  "no title property",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"p","name":"T","type":"text"}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "two title properties",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"},{"id":"b","name":"B","type":"title"}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "duplicate property id",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"},{"id":"a","name":"B","type":"text"}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "empty properties",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "unsupported property type",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"rollup"}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "select property without options",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"},{"id":"b","name":"B","type":"select"}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "text property with options",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"},{"id":"b","name":"B","type":"text","options":[{"id":"o","name":"O"}]}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "duplicate option id",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"},{"id":"b","name":"B","type":"select","options":[{"id":"o","name":"One"},{"id":"o","name":"Two"}]}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "done flag on select option",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"},{"id":"b","name":"B","type":"select","options":[{"id":"o","name":"One","done":true}]}],"records":[],"dateRules":[],"manualDates":[],"view":"table"}}]}}`,
		},
		{
			name:  "duplicate record id",
			input: databaseFixture(`{"id":"r","values":{}}`, `{"id":"r","values":{}}`),
		},
		{
			name:  "record references unknown property",
			input: databaseFixture(`{"id":"r","values":{"p-nope":"x"}}`),
		},
		{
			name:  "record value has wrong type",
			input: databaseFixture(`{"id":"r","values":{"p-status":"o-todo","p-date":"not-a-date"}}`),
		},
		{
			name:  "record references unknown option",
			input: databaseFixture(`{"id":"r","values":{"p-status":"o-missing"}}`),
		},
		{
			name:  "multi select repeats an option",
			input: databaseFixture(`{"id":"r","values":{"p-tags":["o-a","o-a"]}}`),
		},
		{
			name:  "unsupported view",
			input: strings.ReplaceAll(databaseFixture(), `"view":"table"`, `"view":"gantt"`),
		},
		{
			name:  "sort references unknown property",
			input: strings.ReplaceAll(databaseFixture(), `,"manualDates":[]`, `,"manualDates":[],"sort":{"propertyId":"p-nope","direction":"asc"}`),
		},
		{
			name:  "unsupported sort direction",
			input: strings.ReplaceAll(databaseFixture(), `,"manualDates":[]`, `,"manualDates":[],"sort":{"propertyId":"p-date","direction":"sideways"}`),
		},
		{
			name:  "filter references unknown property",
			input: strings.ReplaceAll(databaseFixture(), `,"manualDates":[]`, `,"manualDates":[],"filters":[{"propertyId":"p-nope","op":"is","value":1}]`),
		},
		{
			name:  "unsupported filter operation",
			input: strings.ReplaceAll(databaseFixture(), `,"manualDates":[]`, `,"manualDates":[],"filters":[{"propertyId":"p-date","op":"matches","value":"2026-01-01"}]`),
		},
		{
			name:  "row highlight references unknown record",
			input: strings.ReplaceAll(databaseFixture(), `,"manualDates":[]`, `,"manualDates":[],"rowHighlights":{"nope":"yellow"}`),
		},
		{
			name:  "unsupported highlight token",
			input: strings.ReplaceAll(databaseFixture(), `,"manualDates":[]`, `,"manualDates":[],"rowHighlights":{"rec-1":"pink"}`),
		},
		{
			name:  "unknown attribute key",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"database","attrs":{"properties":[{"id":"a","name":"A","type":"title"}],"records":[],"dateRules":[],"manualDates":[],"view":"table","gantt":true}}]}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateAndNormalizeJSON(tt.input); !errors.Is(err, ErrInvalidDocument) {
				t.Fatalf("expected ErrInvalidDocument, got %v", err)
			}
		})
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidDateRule(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{
			name: "self referencing rule",
			input: replaceRule(`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-date","offsetDays":1}`),
		},
		{
			name: "base is not a date property",
			input: replaceRule(`{"id":"r1","basePropertyId":"p-status","targetPropertyId":"p-target","offsetDays":1}`),
		},
		{
			name: "target is not a date property",
			input: replaceRule(`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-status","offsetDays":1}`),
		},
		{
			name: "unknown base property",
			input: replaceRule(`{"id":"r1","basePropertyId":"p-nope","targetPropertyId":"p-target","offsetDays":1}`),
		},
		{
			name:  "duplicate rule id",
			input: replaceRule(`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":1},{"id":"r1","basePropertyId":"p-target","targetPropertyId":"p-date","offsetDays":2}`),
		},
		{
			name:  "two rules share one target",
			input: replaceRule(`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":1},{"id":"r2","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":2}`),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateAndNormalizeJSON(tt.input); !errors.Is(err, ErrInvalidDocument) {
				t.Fatalf("expected ErrInvalidDocument, got %v", err)
			}
		})
	}
}

func TestValidateAndNormalizeJSONRejectsDateRuleCycle(t *testing.T) {
	// A chain that returns to its start can never settle, so it is refused on save
	// instead of being resolved by silently dropping an edge at display time.
	input := replaceRule(
		`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-mid","offsetDays":1},` +
			`{"id":"r2","basePropertyId":"p-mid","targetPropertyId":"p-target","offsetDays":1},` +
			`{"id":"r3","basePropertyId":"p-target","targetPropertyId":"p-date","offsetDays":1}`,
	)
	input = strings.ReplaceAll(input, `"p-tags"`, `"p-mid","name":"Mid","type":"date"},{"id":"p-tags"`)

	if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected ErrInvalidDocument for a cyclic rule set, got %v", err)
	}
}

func TestValidateAndNormalizeJSONAcceptsChainedDateRules(t *testing.T) {
	// A dependency chain is allowed as long as it terminates.
	input := replaceRule(
		`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-mid","offsetDays":1},` +
			`{"id":"r2","basePropertyId":"p-mid","targetPropertyId":"p-target","offsetDays":1}`,
	)
	input = strings.ReplaceAll(input, `"p-tags"`, `"p-mid","name":"Mid","type":"date"},{"id":"p-tags"`)
	input = strings.ReplaceAll(
		input,
		`"p-date":"2026-10-01"`,
		`"p-date":"2026-10-01","p-mid":"2026-10-02","p-target":"2026-10-03"`,
	)

	if _, err := ValidateAndNormalizeJSON(input); err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(chained rules) error = %v", err)
	}
}

func TestValidateAndNormalizeJSONEnforcesDateRuleInvariant(t *testing.T) {
	if _, err := ValidateAndNormalizeJSON(replaceRule(`{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":7}`)); !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected a stale derived date to be rejected, got nil")
	}

	// The exactly-correct derived value is accepted.
	fresh := strings.ReplaceAll(
		databaseFixture(`{"id":"rec-1","values":{"p-title":"t","p-date":"2026-10-01","p-target":"2026-10-08"}}`),
		`"dateRules":[]`,
		`"dateRules":[{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":7}]`,
	)
	if _, err := ValidateAndNormalizeJSON(fresh); err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(correct rule) error = %v", err)
	}
}

func TestValidateAndNormalizeJSONRejectsDerivedDateWithoutBaseDate(t *testing.T) {
	// Flashnote never invents a date for a record whose base date is missing.
	input := strings.ReplaceAll(
		databaseFixture(`{"id":"rec-1","values":{"p-title":"t","p-target":"2026-10-08"}}`),
		`"dateRules":[]`,
		`"dateRules":[{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":7}]`,
	)
	if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected ErrInvalidDocument, got %v", err)
	}
}

func TestValidateAndNormalizeJSONAllowsManualDateForDetachedRecord(t *testing.T) {
	input := strings.ReplaceAll(
		databaseFixture(`{"id":"rec-1","values":{"p-title":"t","p-date":"2026-10-01","p-target":"2026-12-25"}}`),
		`"dateRules":[]`,
		`"dateRules":[{"id":"r1","basePropertyId":"p-date","targetPropertyId":"p-target","offsetDays":7}]`,
	)
	input = strings.ReplaceAll(input, `"manualDates":[]`, `"manualDates":[{"recordId":"rec-1","propertyId":"p-target"}]`)

	if _, err := ValidateAndNormalizeJSON(input); err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(manual override) error = %v", err)
	}
}

func TestValidateAndNormalizeJSONRejectsManualDateWithoutRule(t *testing.T) {
	input := strings.ReplaceAll(databaseFixture(), `"manualDates":[]`, `"manualDates":[{"recordId":"rec-1","propertyId":"p-date"}]`)
	if _, err := ValidateAndNormalizeJSON(input); !errors.Is(err, ErrInvalidDocument) {
		t.Fatalf("expected ErrInvalidDocument, got %v", err)
	}
}

func TestAddCalendarDays(t *testing.T) {
	tests := []struct {
		name  string
		base  string
		days  int
		want  string
	}{
		{name: "positive day", base: "2026-10-01", days: 7, want: "2026-10-08"},
		{name: "negative day", base: "2026-10-01", days: -2, want: "2026-09-29"},
		{name: "zero day", base: "2026-10-01", days: 0, want: "2026-10-01"},
		{name: "across month end", base: "2026-10-29", days: 5, want: "2026-11-03"},
		{name: "across year end", base: "2026-12-29", days: 5, want: "2027-01-03"},
		{name: "from last day of long month", base: "2026-01-31", days: 1, want: "2026-02-01"},
		{name: "from last day of short month", base: "2026-02-28", days: 1, want: "2026-03-01"},
		{name: "leap year february", base: "2024-02-28", days: 1, want: "2024-02-29"},
		{name: "non leap year february", base: "2026-02-28", days: 1, want: "2026-03-01"},
		{name: "leap year crossing", base: "2024-02-27", days: 2, want: "2024-02-29"},
		{name: "century non leap year", base: "2100-02-28", days: 1, want: "2100-03-01"},
		{name: "backwards across month end", base: "2026-03-01", days: -1, want: "2026-02-28"},
		{name: "backwards across leap day", base: "2024-03-01", days: -1, want: "2024-02-29"},
		{name: "across daylight saving spring forward", base: "2026-03-08", days: 1, want: "2026-03-09"},
		{name: "across daylight saving fall back", base: "2026-11-01", days: 1, want: "2026-11-02"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := AddCalendarDays(tt.base, tt.days)
			if err != nil {
				t.Fatalf("AddCalendarDays(%q, %d) error = %v", tt.base, tt.days, err)
			}
			if got != tt.want {
				t.Fatalf("AddCalendarDays(%q, %d) = %q, want %q", tt.base, tt.days, got, tt.want)
			}
		})
	}
}

func TestAddCalendarDaysRejectsInvalidDate(t *testing.T) {
	for _, base := range []string{"", "2026-13-01", "2026-02-30", "not-a-date", "2026-1-1"} {
		if _, err := AddCalendarDays(base, 1); err == nil {
			t.Fatalf("AddCalendarDays(%q, 1) unexpectedly succeeded", base)
		}
	}
}

func TestValidateAndNormalizeJSONRejectsInvalidTableStructures(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{
			name:  "table without rows",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table"}]}}`,
		},
		{
			name:  "table with direct cell content",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableCell"}]}]}}`,
		},
		{
			name:  "row without cells",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow"}]}]}}`,
		},
		{
			name:  "row with non cell content",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"paragraph"}]}]}]}}`,
		},
		{
			name:  "empty cell",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell"}]}]}]}}`,
		},
		{
			name:  "cell holding bare text",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"text","text":"x"}]}]}]}]}}`,
		},
		{
			name:  "cell holding a nested table",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"table"}]}]}]}]}}`,
		},
		{
			name:  "cell holding a database",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"database"}]}]}]}]}}`,
		},
		{
			name:  "cell with unknown attribute",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":2,"bogus":1},"content":[{"type":"paragraph"}]}]}]}]}}`,
		},
		{
			name:  "cell with zero colspan",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":0},"content":[{"type":"paragraph"}]}]}]}]}}`,
		},
		{
			name:  "cell with non positive colwidth",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colwidth":[0]},"content":[{"type":"paragraph"}]}]}]}]}}`,
		},
		{
			name:  "table with attributes",
			input: `{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"table","attrs":{"bogus":1},"content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph"}]}]}]}]}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateAndNormalizeJSON(tt.input); !errors.Is(err, ErrInvalidDocument) {
				t.Fatalf("expected ErrInvalidDocument, got %v", err)
			}
		})
	}
}

func TestValidateAndNormalizeJSONAcceptsTableWithMergeAndWidth(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"table","content":[` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableHeader","attrs":{"colspan":2,"rowspan":1,"colwidth":[120,80]},"content":[{"type":"paragraph","content":[{"type":"text","text":"Group"}]}]},` +
		`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Solo"}]}]}` +
		`]},` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableCell","attrs":{"colspan":1,"rowspan":2,"colwidth":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"vert"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}` +
		`]}` +
		`]}]}}`

	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeJSON(merged table) error = %v", err)
	}
	for _, expected := range []string{`"colspan":2`, `"rowspan":2`, `"colwidth":[120,80]`, `"text":"Group"`} {
		if !strings.Contains(normalized, expected) {
			t.Fatalf("normalized table missing %s: %s", expected, normalized)
		}
	}
}

func TestSearchBlocksIncludesPlainTableAndDatabaseText(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"paragraph","content":[{"type":"text","text":"intro"}]},` +
		`{"type":"table","content":[{"type":"tableRow","content":[` +
		`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Key"}]}]},` +
		`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Value"}]}]}` +
		`]},{"type":"tableRow","content":[` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"alpha"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"beta"}]}]}` +
		`]}]},` +
		`{"type":"database","attrs":{` +
		`"properties":[{"id":"p-title","name":"Task","type":"title"},` +
		`{"id":"p-status","name":"Status","type":"status","options":[{"id":"o-todo","name":"To do"},{"id":"o-done","name":"Done","done":true}]},` +
		`{"id":"p-tags","name":"Tags","type":"multiSelect","options":[{"id":"o-a","name":"Alpha tag"}]},` +
		`{"id":"p-count","name":"Count","type":"number"},` +
		`{"id":"p-date","name":"Start","type":"date"}` +
		`],` +
		`"records":[` +
		`{"id":"rec-1","values":{"p-title":"Ship it","p-status":"o-done","p-tags":["o-a"],"p-count":42,"p-date":"2026-10-01"},"memo":"remember the deploy note"},` +
		`{"id":"rec-2","values":{"p-title":"Second task","p-status":"o-todo"}}` +
		`],"dateRules":[],"manualDates":[],"view":"table"}}]}}`

	blocks, err := SearchBlocks(input)
	if err != nil {
		t.Fatalf("SearchBlocks() error = %v", err)
	}
	joined := "\n" + strings.Join(blocks, "\n") + "\n"

	// A table is one document block, so its cell text concatenates exactly as a
	// plain document's sibling text nodes already did before this feature.
	for _, expected := range []string{
		"intro",
		"KeyValuealphabeta",
		"Ship it Done Alpha tag 42 2026-10-01",
		"Second task To do",
		"remember the deploy note",
	} {
		if !strings.Contains(joined, "\n"+expected+"\n") {
			t.Fatalf("SearchBlocks() missing block %q, got %v", expected, blocks)
		}
	}
	// The first block decides a derived display title, so a database-only note
	// must not fall back to a meaningless placeholder.
	if blocks[0] != "intro" {
		t.Fatalf("SearchBlocks() first block = %q, want %q", blocks[0], "intro")
	}
}

func TestSearchBlocksDerivesTitleFromDatabaseOnlyNote(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"database","attrs":{` +
		`"properties":[{"id":"p-title","name":"Task","type":"title"}],` +
		`"records":[{"id":"rec-1","values":{"p-title":"Only database content"}}],` +
		`"dateRules":[],"manualDates":[],"view":"table"}}]}}`

	blocks, err := SearchBlocks(input)
	if err != nil {
		t.Fatalf("SearchBlocks() error = %v", err)
	}
	if len(blocks) != 1 || blocks[0] != "Only database content" {
		t.Fatalf("SearchBlocks() = %v, want one record title block", blocks)
	}
}

func replaceRule(rules string) string {
	return strings.ReplaceAll(databaseFixture(), `"dateRules":[]`, `"dateRules":[`+rules+`]`)
}
