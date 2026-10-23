package document

import (
	"strings"
	"testing"
)

func TestToMarkdownSerializesSupportedRichText(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Plan"}]},{"type":"paragraph","content":[{"type":"text","text":"Hello "},{"type":"text","text":"world","marks":[{"type":"bold"}]},{"type":"text","text":" and "},{"type":"text","text":"site","marks":[{"type":"link","attrs":{"href":"https://example.com/a(b)"}}]}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"open"}]}]},{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"done"}]}]}]},{"type":"codeBlock","attrs":{"language":"go"},"content":[{"type":"text","text":"fmt.Println(\"x\")"}]},{"type":"horizontalRule"}]}}`

	markdown, err := ToMarkdown("Weekly *Notes*", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	want := "# Weekly \\*Notes\\*\n\n## Plan\n\nHello **world** and [site](https://example.com/a\\(b\\))\n\n- [ ] open\n- [x] done\n\n```go\nfmt.Println(\"x\")\n```\n\n---\n"
	if markdown != want {
		t.Fatalf("ToMarkdown() =\n%s\nwant\n%s", markdown, want)
	}
}

func TestToMarkdownSerializesListsQuotesAndInlineMarks(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"two"}]}]}]},{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"third"}]}]}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"quoted"}]},{"type":"paragraph","content":[{"type":"text","text":"again","marks":[{"type":"italic"},{"type":"strike"}]}]}]}]}}`

	markdown, err := ToMarkdown("", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	want := "- one\n- two\n\n3. third\n\n> quoted\n>\n> ~~*again*~~\n"
	if markdown != want {
		t.Fatalf("ToMarkdown() =\n%s\nwant\n%s", markdown, want)
	}
}

func TestToMarkdownUsesRelativeImageResolver(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"image-a","alt":"diagram","title":"Chart","width":640,"height":480}}]}}`
	markdown, err := ToMarkdown("", input, func(attachmentID string) (string, error) {
		if attachmentID != "image-a" {
			t.Fatalf("resolver id = %q", attachmentID)
		}
		return "Note.assets/image-a.png", nil
	})
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	if want := "![diagram](Note.assets/image-a.png \"Chart\")\n"; markdown != want {
		t.Fatalf("ToMarkdown() = %q, want %q", markdown, want)
	}
}

func TestToMarkdownRequiresResolverForImages(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"image","attrs":{"attachmentId":"image-a"}}]}}`
	if _, err := ToMarkdown("", input, nil); err == nil || !strings.Contains(err.Error(), "no export path resolver") {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
}

func TestToMarkdownDoesNotInventDerivedTitle(t *testing.T) {
	input := `{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First body line"}]}]}}`
	markdown, err := ToMarkdown("", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	if markdown != "First body line\n" {
		t.Fatalf("ToMarkdown() = %q", markdown)
	}
}

func TestToMarkdownExportsPlainTableAsGFMTable(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"paragraph","content":[{"type":"text","text":"before"}]},` +
		`{"type":"table","content":[` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Key"}]}]},` +
		`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Note"}]}]}` +
		`]},` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"a|b"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"two\nlines"}]}]}` +
		`]}` +
		`]}]}}`

	markdown, err := ToMarkdown("", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	want := "before\n\n| Key | Note |\n| --- | --- |\n| a\\|b | two<br>lines |\n"
	if markdown != want {
		t.Fatalf("ToMarkdown() =\n%q\nwant\n%q", markdown, want)
	}
}

func TestToMarkdownExportsHeaderlessTableAsGFMTable(t *testing.T) {
	// Without a header row a GFM table is not valid Markdown, so the whole table
	// keeps its structure rather than being silently flattened.
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"table","content":[` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}` +
		`]}` +
		`]}]}}`

	markdown, err := ToMarkdown("", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	if !strings.Contains(markdown, "<table>") || !strings.Contains(markdown, "<td>a</td>") {
		t.Fatalf("ToMarkdown() did not fall back to a structure-preserving HTML table: %q", markdown)
	}
	if strings.Contains(markdown, "a|b") {
		t.Fatalf("unexpected flattened pipe table: %q", markdown)
	}
}

func TestToMarkdownExportsMergedTableAsHTMLTable(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"table","content":[` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableHeader","attrs":{"colspan":2},"content":[{"type":"paragraph","content":[{"type":"text","text":"Group"}]}]},` +
		`{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Solo"}]}]}` +
		`]},` +
		`{"type":"tableRow","content":[` +
		`{"type":"tableCell","attrs":{"rowspan":2},"content":[{"type":"paragraph","content":[{"type":"text","text":"vert"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]},` +
		`{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}` +
		`]}` +
		`]}]}}`

	markdown, err := ToMarkdown("", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}
	for _, expected := range []string{`<th colspan="2">Group</th>`, `<td rowspan="2">vert</td>`, "<td>a</td>", "<td>b</td>"} {
		if !strings.Contains(markdown, expected) {
			t.Fatalf("ToMarkdown() missing %s: %q", expected, markdown)
		}
	}
}

func TestToMarkdownExportsDatabaseValuesAndMemos(t *testing.T) {
	input := `{"schemaVersion":2,"doc":{"type":"doc","content":[` +
		`{"type":"database","attrs":{` +
		`"properties":[` +
		`{"id":"p-title","name":"Task","type":"title"},` +
		`{"id":"p-status","name":"Status","type":"status","options":[{"id":"o-todo","name":"To do"},{"id":"o-done","name":"Done","done":true}]},` +
		`{"id":"p-tags","name":"Tags","type":"multiSelect","options":[{"id":"o-a","name":"Alpha"},{"id":"o-b","name":"Beta"}]},` +
		`{"id":"p-count","name":"Count","type":"number"},` +
		`{"id":"p-done","name":"Done?","type":"checkbox"},` +
		`{"id":"p-date","name":"Start","type":"date"}` +
		`],` +
		`"records":[` +
		`{"id":"rec-1","values":{"p-title":"Ship it","p-status":"o-done","p-tags":["o-a","o-b"],"p-count":42,"p-done":true,"p-date":"2026-10-01"},"memo":"- deploy\n- announce"},` +
		`{"id":"rec-2","values":{"p-title":"Second","p-status":"o-todo","p-done":false}}` +
		`],"dateRules":[],"manualDates":[],"view":"table"}}]}}`

	markdown, err := ToMarkdown("", input, nil)
	if err != nil {
		t.Fatalf("ToMarkdown() error = %v", err)
	}

	rows := []string{
		"| Task | Status | Tags | Count | Done? | Start |",
		"| --- | --- | --- | --- | --- | --- |",
		"| Ship it | Done | Alpha Beta | 42 | true | 2026-10-01 |",
		"| Second | To do |  |  | false |  |",
	}
	for _, row := range rows {
		if !strings.Contains(markdown, row) {
			t.Fatalf("ToMarkdown() missing row %q:\n%s", row, markdown)
		}
	}
	// A record's detail memo is preserved verbatim under its own heading, and a
	// record without a memo adds no empty heading.
	if !strings.Contains(markdown, "#### Ship it\n\n- deploy\n- announce") {
		t.Fatalf("ToMarkdown() omitted the record memo:\n%s", markdown)
	}
	if strings.Contains(markdown, "#### Second") {
		t.Fatalf("ToMarkdown() emitted a memo heading for a record without a memo:\n%s", markdown)
	}
	// A select-type value exports its display name, never its stored option id.
	if strings.Contains(markdown, "o-done") || strings.Contains(markdown, "o-a") {
		t.Fatalf("ToMarkdown() leaked a raw option identifier:\n%s", markdown)
	}
}

func TestToMarkdownRejectsInvalidDocument(t *testing.T) {
	if _, err := ToMarkdown("", `{"schemaVersion":3,"doc":{"type":"doc","content":[]}}`, nil); err == nil {
		t.Fatal("ToMarkdown() unexpectedly accepted an unknown schema version")
	}
}
