package document

import (
	"encoding/json"
	"errors"
	"fmt"
)

// tableCellContentTypes is the block vocabulary a table cell may hold. A cell
// is a block container, so inline text may only appear inside one of these.
// Nested tables and databases are deliberately excluded: Flashnote has one
// level of table, and a database is not embeddable inside a cell.
var tableCellContentTypes = map[string]struct{}{
	"paragraph":     {},
	"heading":       {},
	"bulletList":    {},
	"orderedList":   {},
	"taskList":      {},
	"blockquote":    {},
	"codeBlock":     {},
	"horizontalRule": {},
}

func validateTableNode(node map[string]any, nodeType string) error {
	switch nodeType {
	case "table":
		return validateTableRows(node)
	case "tableRow":
		return validateTableCells(node)
	default:
		if err := validateTableCellAttrs(node["attrs"], nodeType); err != nil {
			return err
		}
		return validateTableCellContent(node, nodeType)
	}
}

func validateTableRows(node map[string]any) error {
	children, ok := node["content"].([]any)
	if !ok || len(children) == 0 {
		return errors.New("table node requires at least one row")
	}
	for _, raw := range children {
		child, ok := raw.(map[string]any)
		if !ok {
			return errors.New("table row must be an object")
		}
		if child["type"] != "tableRow" {
			return fmt.Errorf("table content may only contain tableRow, found %q", child["type"])
		}
	}
	return nil
}

func validateTableCells(node map[string]any) error {
	children, ok := node["content"].([]any)
	if !ok || len(children) == 0 {
		return errors.New("tableRow node requires at least one cell")
	}
	for _, raw := range children {
		child, ok := raw.(map[string]any)
		if !ok {
			return errors.New("table cell must be an object")
		}
		switch child["type"] {
		case "tableCell", "tableHeader":
		default:
			return fmt.Errorf("tableRow content may only contain tableCell or tableHeader, found %q", child["type"])
		}
	}
	return nil
}

func validateTableCellContent(node map[string]any, nodeType string) error {
	children, ok := node["content"].([]any)
	if !ok || len(children) == 0 {
		return fmt.Errorf("%s node requires at least one block child", nodeType)
	}
	for _, raw := range children {
		child, ok := raw.(map[string]any)
		if !ok {
			return errors.New("table cell child must be an object")
		}
		childType, _ := child["type"].(string)
		if _, allowed := tableCellContentTypes[childType]; !allowed {
			return fmt.Errorf("%s may not contain %q", nodeType, childType)
		}
	}
	return nil
}

func validateTableCellAttrs(raw any, nodeType string) error {
	if raw == nil {
		return nil
	}
	attrs, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("%s attributes must be an object", nodeType)
	}
	if err := validateKeys(attrs, "colspan", "rowspan", "colwidth"); err != nil {
		return fmt.Errorf("%s attributes: %w", nodeType, err)
	}
	for _, key := range []string{"colspan", "rowspan"} {
		if value, exists := attrs[key]; exists && value != nil {
			integer, ok := integerValue(value)
			if !ok || integer < 1 {
				return fmt.Errorf("%s %s must be a positive integer or null", nodeType, key)
			}
		}
	}
	if value, exists := attrs["colwidth"]; exists && value != nil {
		widths, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s colwidth must be an array or null", nodeType)
		}
		for _, rawWidth := range widths {
			number, ok := rawWidth.(json.Number)
			if !ok {
				return fmt.Errorf("%s colwidth entries must be numbers", nodeType)
			}
			width, err := number.Float64()
			if err != nil || width <= 0 {
				return fmt.Errorf("%s colwidth entries must be positive numbers", nodeType)
			}
		}
	}
	return nil
}
