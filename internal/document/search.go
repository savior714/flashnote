package document

import (
	"encoding/json"
	"strings"
)

// SearchBlocks returns the document's searchable text blocks in document order.
// It is the single owner of "what text does this document contain": the sidebar's
// derived display title and the search index both read it, so they can no longer
// disagree, and a note whose only meaningful content is a database record no
// longer derives a meaningless title.
//
// A plain table's cell text is ordinary document text and is collected by the
// normal recursive walk. A database contributes one block per record — its title,
// text, and select-type display strings — followed by its detail memos.
func SearchBlocks(input string) ([]string, error) {
	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Doc map[string]any `json:"doc"`
	}
	if err := json.Unmarshal([]byte(normalized), &envelope); err != nil {
		return nil, ErrInvalidDocument
	}

	content, _ := envelope.Doc["content"].([]any)
	blocks := make([]string, 0, len(content))
	for _, child := range content {
		node, ok := child.(map[string]any)
		if !ok {
			continue
		}
		if node["type"] == "database" {
			blocks = append(blocks, databaseSearchBlocks(node)...)
			continue
		}
		var text strings.Builder
		appendSearchableText(&text, node)
		if collapsed := joinCollapsedText(text.String()); collapsed != "" {
			blocks = append(blocks, collapsed)
		}
	}
	return blocks, nil
}

// appendSearchableText walks a document subtree collecting text nodes. It is the
// same walk the previous per-consumer extractors performed, now shared.
func appendSearchableText(builder *strings.Builder, value any) {
	node, ok := value.(map[string]any)
	if !ok {
		return
	}
	if text, ok := node["text"].(string); ok {
		builder.WriteString(text)
	}
	children, _ := node["content"].([]any)
	for _, child := range children {
		appendSearchableText(builder, child)
	}
}

func joinCollapsedText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func databaseSearchBlocks(node map[string]any) []string {
	payload, ok := databasePayloadFromNode(node)
	if !ok {
		return nil
	}
	optionNames := databaseOptionNames(payload)

	blocks := make([]string, 0, len(payload.Records)*2)
	for _, record := range payload.Records {
		parts := make([]string, 0, len(payload.Properties))
		for _, property := range payload.Properties {
			if text := databaseValueDisplayText(property, record.Values[property.ID], optionNames); text != "" {
				parts = append(parts, text)
			}
		}
		if collapsed := joinCollapsedText(strings.Join(parts, " ")); collapsed != "" {
			blocks = append(blocks, collapsed)
		}
	}
	for _, record := range payload.Records {
		if collapsed := joinCollapsedText(record.Memo); collapsed != "" {
			blocks = append(blocks, collapsed)
		}
	}
	return blocks
}

// databasePayloadFromNode decodes an already-validated database node's attrs into
// the typed payload. Validation ran first, so a decode failure here is an
// internal inconsistency rather than bad user data, and the caller skips the node
// instead of failing a whole-note search.
func databasePayloadFromNode(node map[string]any) (*databasePayload, bool) {
	attrs, ok := node["attrs"]
	if !ok || attrs == nil {
		return nil, false
	}
	encoded, err := json.Marshal(attrs)
	if err != nil {
		return nil, false
	}
	decoder := json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.UseNumber()
	var payload databasePayload
	if err := decoder.Decode(&payload); err != nil {
		return nil, false
	}
	return &payload, true
}

func databaseOptionNames(payload *databasePayload) map[string]map[string]string {
	names := make(map[string]map[string]string, len(payload.Properties))
	for _, property := range payload.Properties {
		if len(property.Options) == 0 {
			continue
		}
		options := make(map[string]string, len(property.Options))
		for _, option := range property.Options {
			options[option.ID] = option.Name
		}
		names[property.ID] = options
	}
	return names
}

// databaseValueDisplayText renders one stored value as the text a user would
// read. Select-type values resolve to their option name rather than the stored
// option identifier, so search matches what the table shows.
func databaseValueDisplayText(property databaseProperty, value any, optionNames map[string]map[string]string) string {
	if value == nil {
		return ""
	}
	switch property.Type {
	case PropertyTitle, PropertyText:
		text, _ := value.(string)
		return text
	case PropertyNumber:
		number, ok := value.(json.Number)
		if !ok {
			return ""
		}
		return number.String()
	case PropertyDate:
		text, _ := value.(string)
		return text
	case PropertyStatus, PropertySelect:
		optionID, ok := value.(string)
		if !ok {
			return ""
		}
		return optionNames[property.ID][optionID]
	case PropertyMultiSelect:
		options, ok := value.([]any)
		if !ok {
			return ""
		}
		names := make([]string, 0, len(options))
		for _, rawOption := range options {
			optionID, ok := rawOption.(string)
			if !ok {
				continue
			}
			if name, exists := optionNames[property.ID][optionID]; exists {
				names = append(names, name)
			}
		}
		return strings.Join(names, " ")
	default:
		return ""
	}
}
