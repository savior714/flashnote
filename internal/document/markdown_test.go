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
