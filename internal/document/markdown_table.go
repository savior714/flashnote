package document

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

var _ = strconv.FormatBool

// renderMarkdownTable renders one plain table. A table whose every cell spans one
// row and one column, and whose first row is a header row, becomes a GFM table.
// Anything merged or header-less becomes an HTML table, because GFM cannot
// express it and the contract requires structure to survive export rather than
// being silently flattened.
func renderMarkdownTable(node markdownNode, resolveImage ImagePathResolver) (string, error) {
	rows := make([][]markdownNode, 0, len(node.Content))
	for _, row := range node.Content {
		rows = append(rows, row.Content)
	}

	if len(rows) == 0 {
		return "", fmt.Errorf("table node has no rows during Markdown export")
	}
	if tableIsPlainGrid(rows) && tableFirstRowIsHeader(rows) {
		return renderMarkdownGFMTable(rows, resolveImage)
	}
	return renderMarkdownHTMLTable(rows, resolveImage)
}

func tableIsPlainGrid(rows [][]markdownNode) bool {
	for _, row := range rows {
		for _, cell := range row {
			if markdownIntAttr(cell.Attrs, "colspan", 1) != 1 {
				return false
			}
			if markdownIntAttr(cell.Attrs, "rowspan", 1) != 1 {
				return false
			}
		}
	}
	return true
}

func tableFirstRowIsHeader(rows [][]markdownNode) bool {
	if len(rows[0]) == 0 {
		return false
	}
	for _, cell := range rows[0] {
		if cell.Type != "tableHeader" {
			return false
		}
	}
	return true
}

func renderMarkdownGFMTable(rows [][]markdownNode, resolveImage ImagePathResolver) (string, error) {
	width := 0
	for _, row := range rows {
		if len(row) > width {
			width = len(row)
		}
	}
	if width == 0 {
		return "", fmt.Errorf("table node has no cells during Markdown export")
	}

	var builder strings.Builder
	builder.WriteString(tableMarkdownRow(rows[0], width, resolveImage))
	separator := make([]string, width)
	for index := range separator {
		separator[index] = "---"
	}
	builder.WriteString("\n| " + strings.Join(separator, " | ") + " |")
	for _, row := range rows[1:] {
		builder.WriteString("\n" + tableMarkdownRow(row, width, resolveImage))
	}
	return builder.String(), nil
}

func tableMarkdownRow(cells []markdownNode, width int, resolveImage ImagePathResolver) string {
	values := make([]string, width)
	for index, cell := range cells {
		values[index] = escapeMarkdownTableCell(tableCellText(cell, resolveImage))
	}
	return "| " + strings.Join(values, " | ") + " |"
}

func renderMarkdownHTMLTable(rows [][]markdownNode, resolveImage ImagePathResolver) (string, error) {
	var builder strings.Builder
	builder.WriteString("<table>")
	for _, row := range rows {
		builder.WriteString("\n  <tr>")
		for _, cell := range row {
			tag := "td"
			if cell.Type == "tableHeader" {
				tag = "th"
			}
			attributes := ""
			if colspan := markdownIntAttr(cell.Attrs, "colspan", 1); colspan != 1 {
				attributes += fmt.Sprintf(` colspan="%d"`, colspan)
			}
			if rowspan := markdownIntAttr(cell.Attrs, "rowspan", 1); rowspan != 1 {
				attributes += fmt.Sprintf(` rowspan="%d"`, rowspan)
			}
			builder.WriteString("\n    <" + tag + attributes + ">")
			content := escapeMarkdownHTMLText(tableCellText(cell, resolveImage))
			builder.WriteString(content)
			builder.WriteString("</" + tag + ">")
		}
		builder.WriteString("\n  </tr>")
	}
	builder.WriteString("\n</table>")
	return builder.String(), nil
}

// tableCellText renders one cell's blocks. Multiple blocks inside a cell keep
// their separation as a line break, because a Markdown table cell is one line.
func tableCellText(cell markdownNode, resolveImage ImagePathResolver) string {
	parts := make([]string, 0, len(cell.Content))
	for _, child := range cell.Content {
		rendered, err := renderMarkdownBlock(child, resolveImage)
		if err != nil {
			continue
		}
		rendered = strings.TrimSpace(rendered)
		if rendered != "" {
			parts = append(parts, rendered)
		}
	}
	return strings.Join(parts, "\n")
}

func escapeMarkdownTableCell(value string) string {
	escaped := escapeMarkdownInline(value)
	escaped = strings.ReplaceAll(escaped, "|", `\|`)
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	return escaped
}

func escapeMarkdownHTMLText(value string) string {
	escaped := strings.ReplaceAll(value, "&", "&amp;")
	escaped = strings.ReplaceAll(escaped, "<", "&lt;")
	escaped = strings.ReplaceAll(escaped, ">", "&gt;")
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	return escaped
}

// renderMarkdownDatabase renders one in-note task database as a Markdown table of
// its records, followed by each record's detail memo under its own heading. A
// missing value renders as an empty cell rather than being dropped, so a record's
// absence of a date is visible as an absence and not as a silently omitted row.
func renderMarkdownDatabase(node markdownNode, resolveImage ImagePathResolver) (string, error) {
	payload, err := databasePayloadFromMarkdownNode(node)
	if err != nil {
		return "", err
	}
	optionNames := databaseOptionNames(payload)

	headers := make([]string, len(payload.Properties))
	for index, property := range payload.Properties {
		headers[index] = escapeMarkdownTableCell(property.Name)
	}

	lines := make([]string, 1, len(payload.Records)+1)
	lines[0] = "| " + strings.Join(headers, " | ") + " |"
	separator := make([]string, len(headers))
	for index := range separator {
		separator[index] = "---"
	}
	lines = append(lines, "| "+strings.Join(separator, " | ")+" |")
	for _, record := range payload.Records {
		values := make([]string, len(payload.Properties))
		for index, property := range payload.Properties {
			values[index] = escapeMarkdownTableCell(
				databaseExportCellText(property, record.Values[property.ID], optionNames),
			)
		}
		lines = append(lines, "| "+strings.Join(values, " | ")+" |")
	}

	var sections []string
	sections = append(sections, strings.Join(lines, "\n"))

	var memos []string
	for _, record := range payload.Records {
		memo := strings.TrimSpace(record.Memo)
		if memo == "" {
			continue
		}
		title := databaseRecordTitle(payload, record)
		if title == "" {
			title = "Record"
		}
		memos = append(memos, "#### "+escapeMarkdownInline(title)+"\n\n"+record.Memo)
	}
	if len(memos) > 0 {
		sections = append(sections, strings.Join(memos, "\n\n"))
	}
	return strings.Join(sections, "\n\n"), nil
}

// databaseExportCellText renders one stored value for export. It renders a
// checkbox as a literal boolean because export must never drop a value that the
// search projection intentionally leaves out.
func databaseExportCellText(property databaseProperty, value any, optionNames map[string]map[string]string) string {
	if value == nil {
		return ""
	}
	if property.Type == PropertyCheckbox {
		if checked, ok := value.(bool); ok {
			return strconv.FormatBool(checked)
		}
		return ""
	}
	return databaseValueDisplayText(property, value, optionNames)
}

func databaseRecordTitle(payload *databasePayload, record databaseRecord) string {
	for _, property := range payload.Properties {
		if property.Type != PropertyTitle {
			continue
		}
		if text, ok := record.Values[property.ID].(string); ok {
			return strings.TrimSpace(text)
		}
		return ""
	}
	return ""
}

func databasePayloadFromMarkdownNode(node markdownNode) (*databasePayload, error) {
	encoded, err := json.Marshal(node.Attrs)
	if err != nil {
		return nil, fmt.Errorf("encode database attributes for Markdown export: %w", err)
	}
	decoder := json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.UseNumber()
	var payload databasePayload
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode database attributes for Markdown export: %w", err)
	}
	return &payload, nil
}
