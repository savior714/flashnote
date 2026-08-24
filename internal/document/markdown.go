package document

import (
	"encoding/json"
	"fmt"
	"strings"
)

type ImagePathResolver func(attachmentID string) (string, error)

type markdownEnvelope struct {
	Doc markdownNode `json:"doc"`
}

type markdownNode struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Content []markdownNode `json:"content,omitempty"`
	Text    string         `json:"text,omitempty"`
	Marks   []markdownMark `json:"marks,omitempty"`
}

type markdownMark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

// ToMarkdown serializes a valid Flashnote document into deterministic Markdown.
// An explicit title is emitted as an H1. Empty titles are not replaced by a
// derived display title, avoiding duplicate body text in exported documents.
func ToMarkdown(title, input string, resolveImage ImagePathResolver) (string, error) {
	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		return "", err
	}

	var envelope markdownEnvelope
	if err := json.Unmarshal([]byte(normalized), &envelope); err != nil {
		return "", fmt.Errorf("decode normalized document for Markdown: %w", err)
	}

	body, err := renderMarkdownBlocks(envelope.Doc.Content, resolveImage)
	if err != nil {
		return "", err
	}

	var sections []string
	if normalizedTitle := normalizeMarkdownTitle(title); normalizedTitle != "" {
		sections = append(sections, "# "+escapeMarkdownInline(normalizedTitle))
	}
	if body != "" {
		sections = append(sections, body)
	}
	if len(sections) == 0 {
		return "", nil
	}
	return strings.Join(sections, "\n\n") + "\n", nil
}

func normalizeMarkdownTitle(title string) string {
	title = strings.ReplaceAll(title, "\r", " ")
	title = strings.ReplaceAll(title, "\n", " ")
	return strings.TrimSpace(title)
}

func renderMarkdownBlocks(nodes []markdownNode, resolveImage ImagePathResolver) (string, error) {
	parts := make([]string, 0, len(nodes))
	for _, node := range nodes {
		rendered, err := renderMarkdownBlock(node, resolveImage)
		if err != nil {
			return "", err
		}
		parts = append(parts, rendered)
	}
	return strings.Join(parts, "\n\n"), nil
}

func renderMarkdownBlock(node markdownNode, resolveImage ImagePathResolver) (string, error) {
	switch node.Type {
	case "paragraph":
		return renderMarkdownInline(node.Content, resolveImage)
	case "heading":
		level := markdownIntAttr(node.Attrs, "level", 1)
		content, err := renderMarkdownInline(node.Content, resolveImage)
		if err != nil {
			return "", err
		}
		return strings.Repeat("#", level) + " " + content, nil
	case "bulletList":
		return renderMarkdownList(node.Content, false, 1, false, resolveImage)
	case "orderedList":
		return renderMarkdownList(node.Content, true, markdownIntAttr(node.Attrs, "start", 1), false, resolveImage)
	case "taskList":
		return renderMarkdownList(node.Content, false, 1, true, resolveImage)
	case "listItem", "taskItem", "doc":
		return renderMarkdownBlocks(node.Content, resolveImage)
	case "blockquote":
		content, err := renderMarkdownBlocks(node.Content, resolveImage)
		if err != nil {
			return "", err
		}
		lines := strings.Split(content, "\n")
		for index, line := range lines {
			if line == "" {
				lines[index] = ">"
			} else {
				lines[index] = "> " + line
			}
		}
		return strings.Join(lines, "\n"), nil
	case "codeBlock":
		content := markdownPlainText(node.Content)
		fence := strings.Repeat("`", maxMarkdownBacktickRun(content)+1)
		if len(fence) < 3 {
			fence = "```"
		}
		language := strings.TrimSpace(markdownStringAttr(node.Attrs, "language"))
		language = strings.ReplaceAll(language, "`", "")
		if fields := strings.Fields(language); len(fields) > 0 {
			language = fields[0]
		} else {
			language = ""
		}
		return fence + language + "\n" + content + "\n" + fence, nil
	case "horizontalRule":
		return "---", nil
	case "image":
		return renderMarkdownImage(node, resolveImage)
	case "hardBreak":
		return "  \n", nil
	case "text":
		return renderMarkdownText(node), nil
	default:
		return "", fmt.Errorf("unsupported Flashnote node %q during Markdown export", node.Type)
	}
}

func renderMarkdownInline(nodes []markdownNode, resolveImage ImagePathResolver) (string, error) {
	var builder strings.Builder
	for _, node := range nodes {
		switch node.Type {
		case "text":
			builder.WriteString(renderMarkdownText(node))
		case "hardBreak":
			builder.WriteString("  \n")
		case "image":
			image, err := renderMarkdownImage(node, resolveImage)
			if err != nil {
				return "", err
			}
			builder.WriteString(image)
		default:
			rendered, err := renderMarkdownBlock(node, resolveImage)
			if err != nil {
				return "", err
			}
			builder.WriteString(rendered)
		}
	}
	return builder.String(), nil
}

func renderMarkdownList(items []markdownNode, ordered bool, start int, task bool, resolveImage ImagePathResolver) (string, error) {
	var builder strings.Builder
	for index, item := range items {
		body, err := renderMarkdownBlocks(item.Content, resolveImage)
		if err != nil {
			return "", err
		}

		prefix := "- "
		if ordered {
			prefix = fmt.Sprintf("%d. ", start+index)
		} else if task {
			checked := markdownBoolAttr(item.Attrs, "checked")
			if checked {
				prefix = "- [x] "
			} else {
				prefix = "- [ ] "
			}
		}
		builder.WriteString(prefixMarkdownLines(prefix, body))
		if index < len(items)-1 {
			builder.WriteByte('\n')
		}
	}
	return builder.String(), nil
}

func prefixMarkdownLines(prefix, body string) string {
	if body == "" {
		return strings.TrimSpace(prefix)
	}
	lines := strings.Split(body, "\n")
	padding := strings.Repeat(" ", len(prefix))
	for index := range lines {
		if index == 0 {
			lines[index] = prefix + lines[index]
		} else if lines[index] != "" {
			lines[index] = padding + lines[index]
		}
	}
	return strings.Join(lines, "\n")
}

func renderMarkdownText(node markdownNode) string {
	markTypes := make(map[string]markdownMark, len(node.Marks))
	for _, mark := range node.Marks {
		markTypes[mark.Type] = mark
	}

	content := escapeMarkdownInline(node.Text)
	if _, ok := markTypes["code"]; ok {
		content = markdownCodeSpan(node.Text)
	}
	if _, ok := markTypes["bold"]; ok {
		content = "**" + content + "**"
	}
	if _, ok := markTypes["italic"]; ok {
		content = "*" + content + "*"
	}
	if _, ok := markTypes["strike"]; ok {
		content = "~~" + content + "~~"
	}
	if link, ok := markTypes["link"]; ok {
		href := markdownStringAttr(link.Attrs, "href")
		content = "[" + content + "](" + escapeMarkdownDestination(href) + ")"
	}
	return content
}

func renderMarkdownImage(node markdownNode, resolveImage ImagePathResolver) (string, error) {
	attachmentID := markdownStringAttr(node.Attrs, "attachmentId")
	if resolveImage == nil {
		return "", fmt.Errorf("Markdown image %s has no export path resolver", attachmentID)
	}
	path, err := resolveImage(attachmentID)
	if err != nil {
		return "", fmt.Errorf("resolve Markdown image %s: %w", attachmentID, err)
	}
	if path == "" {
		return "", fmt.Errorf("resolve Markdown image %s: empty path", attachmentID)
	}

	alt := markdownStringAttr(node.Attrs, "alt")
	alt = strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]").Replace(alt)
	image := "![" + alt + "](" + escapeMarkdownDestination(path)
	if title := markdownStringAttr(node.Attrs, "title"); title != "" {
		title = strings.NewReplacer("\\", "\\\\", "\"", "\\\"").Replace(title)
		image += " \"" + title + "\""
	}
	return image + ")", nil
}

func markdownPlainText(nodes []markdownNode) string {
	var builder strings.Builder
	for _, node := range nodes {
		switch node.Type {
		case "text":
			builder.WriteString(node.Text)
		case "hardBreak":
			builder.WriteByte('\n')
		default:
			builder.WriteString(markdownPlainText(node.Content))
		}
	}
	return builder.String()
}

func markdownCodeSpan(value string) string {
	fence := strings.Repeat("`", maxMarkdownBacktickRun(value)+1)
	if fence == "" {
		fence = "`"
	}
	if strings.HasPrefix(value, " ") || strings.HasSuffix(value, " ") || strings.HasPrefix(value, "`") || strings.HasSuffix(value, "`") {
		return fence + " " + value + " " + fence
	}
	return fence + value + fence
}

func maxMarkdownBacktickRun(value string) int {
	maxRun := 0
	current := 0
	for _, runeValue := range value {
		if runeValue == '`' {
			current++
			if current > maxRun {
				maxRun = current
			}
		} else {
			current = 0
		}
	}
	return maxRun
}

func escapeMarkdownInline(value string) string {
	return strings.NewReplacer(
		"\\", "\\\\",
		"*", "\\*",
		"_", "\\_",
		"[", "\\[",
		"]", "\\]",
		"~", "\\~",
		"`", "\\`",
	).Replace(value)
}

func escapeMarkdownDestination(value string) string {
	return strings.NewReplacer(
		"\\", "\\\\",
		" ", "%20",
		"(", "\\(",
		")", "\\)",
	).Replace(value)
}

func markdownStringAttr(attrs map[string]any, key string) string {
	if value, ok := attrs[key].(string); ok {
		return value
	}
	return ""
}

func markdownIntAttr(attrs map[string]any, key string, fallback int) int {
	value, ok := attrs[key].(float64)
	if !ok || value < 1 || value != float64(int(value)) {
		return fallback
	}
	return int(value)
}

func markdownBoolAttr(attrs map[string]any, key string) bool {
	value, _ := attrs[key].(bool)
	return value
}
