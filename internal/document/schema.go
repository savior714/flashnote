package document

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
)

const SchemaVersion = 1

var ErrInvalidDocument = errors.New("invalid Flashnote document")

func EmptyJSON() string {
	return `{"doc":{"content":[{"type":"paragraph"}],"type":"doc"},"schemaVersion":1}`
}

func ValidateAndNormalizeJSON(input string) (string, error) {
	decoder := json.NewDecoder(bytes.NewBufferString(input))
	decoder.UseNumber()

	var envelope map[string]any
	if err := decoder.Decode(&envelope); err != nil {
		return "", fmt.Errorf("%w: decode JSON: %v", ErrInvalidDocument, err)
	}
	if err := ensureEOF(decoder); err != nil {
		return "", err
	}
	if err := validateKeys(envelope, "schemaVersion", "doc"); err != nil {
		return "", fmt.Errorf("%w: envelope: %v", ErrInvalidDocument, err)
	}

	version, ok := integerValue(envelope["schemaVersion"])
	if !ok || version != SchemaVersion {
		return "", fmt.Errorf("%w: unsupported schemaVersion", ErrInvalidDocument)
	}

	doc, ok := envelope["doc"].(map[string]any)
	if !ok {
		return "", fmt.Errorf("%w: doc must be an object", ErrInvalidDocument)
	}
	if err := validateNode(doc, true); err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}

	normalized, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("%w: normalize JSON: %v", ErrInvalidDocument, err)
	}
	return string(normalized), nil
}

// AttachmentIDs returns the unique attachment identities referenced by a valid Flashnote document.
func AttachmentIDs(input string) ([]string, error) {
	normalized, err := ValidateAndNormalizeJSON(input)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Doc map[string]any `json:"doc"`
	}
	if err := json.Unmarshal([]byte(normalized), &envelope); err != nil {
		return nil, fmt.Errorf("%w: decode normalized document: %v", ErrInvalidDocument, err)
	}

	ids := make(map[string]struct{})
	collectAttachmentIDs(envelope.Doc, ids)
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result, nil
}

func collectAttachmentIDs(value any, ids map[string]struct{}) {
	node, ok := value.(map[string]any)
	if !ok {
		return
	}
	if node["type"] == "image" {
		if attrs, ok := node["attrs"].(map[string]any); ok {
			if id, ok := attrs["attachmentId"].(string); ok && id != "" {
				ids[id] = struct{}{}
			}
		}
	}
	if children, ok := node["content"].([]any); ok {
		for _, child := range children {
			collectAttachmentIDs(child, ids)
		}
	}
}

func ensureEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("%w: multiple JSON values", ErrInvalidDocument)
		}
		return fmt.Errorf("%w: trailing JSON: %v", ErrInvalidDocument, err)
	}
	return nil
}

func validateNode(node map[string]any, root bool) error {
	if err := validateKeys(node, "type", "attrs", "content", "text", "marks"); err != nil {
		return err
	}

	nodeType, ok := node["type"].(string)
	if !ok || nodeType == "" {
		return errors.New("node type must be a non-empty string")
	}

	switch nodeType {
	case "doc":
		if !root {
			return errors.New("doc node may only appear at the root")
		}
	case "paragraph", "bulletList", "listItem", "blockquote", "taskList":
	case "taskItem":
		if err := validateTaskItemAttrs(node["attrs"]); err != nil {
			return err
		}
	case "orderedList":
		if err := validateOrderedListAttrs(node["attrs"]); err != nil {
			return err
		}
	case "heading":
		if err := validateHeadingAttrs(node["attrs"]); err != nil {
			return err
		}
	case "codeBlock":
		if err := validateCodeBlockAttrs(node["attrs"]); err != nil {
			return err
		}
	case "image":
		if err := validateImageAttrs(node["attrs"]); err != nil {
			return err
		}
		if _, exists := node["content"]; exists {
			return errors.New("image node cannot contain content")
		}
	case "horizontalRule", "hardBreak":
		if _, exists := node["content"]; exists {
			return fmt.Errorf("%s node cannot contain content", nodeType)
		}
	case "text":
		text, ok := node["text"].(string)
		if !ok {
			return errors.New("text node must contain string text")
		}
		_ = text
		if _, exists := node["content"]; exists {
			return errors.New("text node cannot contain content")
		}
	default:
		return fmt.Errorf("unsupported node type %q", nodeType)
	}

	if nodeType != "heading" && nodeType != "orderedList" && nodeType != "codeBlock" && nodeType != "taskItem" && nodeType != "image" {
		if attrs, exists := node["attrs"]; exists {
			if attrs == nil {
				delete(node, "attrs")
			} else {
				obj, ok := attrs.(map[string]any)
				if !ok || len(obj) != 0 {
					return fmt.Errorf("node type %q does not allow attributes", nodeType)
				}
				delete(node, "attrs")
			}
		}
	}

	if marks, exists := node["marks"]; exists {
		if nodeType != "text" {
			return fmt.Errorf("marks are only allowed on text nodes")
		}
		markList, ok := marks.([]any)
		if !ok {
			return errors.New("marks must be an array")
		}
		for _, rawMark := range markList {
			mark, ok := rawMark.(map[string]any)
			if !ok {
				return errors.New("mark must be an object")
			}
			if err := validateMark(mark); err != nil {
				return err
			}
		}
	}

	if content, exists := node["content"]; exists {
		children, ok := content.([]any)
		if !ok {
			return errors.New("content must be an array")
		}
		for _, rawChild := range children {
			child, ok := rawChild.(map[string]any)
			if !ok {
				return errors.New("child node must be an object")
			}
			if err := validateNode(child, false); err != nil {
				return err
			}
		}
	}

	if root && nodeType != "doc" {
		return errors.New("root node must have type doc")
	}
	return nil
}

func validateMark(mark map[string]any) error {
	if err := validateKeys(mark, "type", "attrs"); err != nil {
		return err
	}
	markType, ok := mark["type"].(string)
	if !ok || markType == "" {
		return errors.New("mark type must be a non-empty string")
	}
	switch markType {
	case "bold", "italic", "strike", "code":
		if attrs, exists := mark["attrs"]; exists {
			if attrs == nil {
				delete(mark, "attrs")
			} else {
				obj, ok := attrs.(map[string]any)
				if !ok || len(obj) != 0 {
					return fmt.Errorf("mark type %q does not allow attributes", markType)
				}
				delete(mark, "attrs")
			}
		}
	case "link":
		attrs, ok := mark["attrs"].(map[string]any)
		if !ok {
			return errors.New("link mark requires attributes")
		}
		if err := validateKeys(attrs, "href", "target", "rel", "class"); err != nil {
			return fmt.Errorf("link attributes: %w", err)
		}
		href, ok := attrs["href"].(string)
		if !ok || href == "" {
			return errors.New("link href must be a non-empty string")
		}
		for _, key := range []string{"target", "rel", "class"} {
			if value, exists := attrs[key]; exists && value != nil {
				if _, ok := value.(string); !ok {
					return fmt.Errorf("link %s must be a string or null", key)
				}
			}
		}
	default:
		return fmt.Errorf("unsupported mark type %q", markType)
	}
	return nil
}

func validateTaskItemAttrs(raw any) error {
	attrs, ok := raw.(map[string]any)
	if !ok {
		return errors.New("taskItem requires attributes")
	}
	if err := validateKeys(attrs, "checked"); err != nil {
		return fmt.Errorf("taskItem attributes: %w", err)
	}
	checked, exists := attrs["checked"]
	if !exists {
		return errors.New("taskItem checked is required")
	}
	if _, ok := checked.(bool); !ok {
		return errors.New("taskItem checked must be a boolean")
	}
	return nil
}

func validateHeadingAttrs(raw any) error {
	attrs, ok := raw.(map[string]any)
	if !ok {
		return errors.New("heading requires attributes")
	}
	if err := validateKeys(attrs, "level"); err != nil {
		return fmt.Errorf("heading attributes: %w", err)
	}
	level, ok := integerValue(attrs["level"])
	if !ok || level < 1 || level > 3 {
		return errors.New("heading level must be 1, 2, or 3")
	}
	return nil
}

func validateOrderedListAttrs(raw any) error {
	if raw == nil {
		return nil
	}
	attrs, ok := raw.(map[string]any)
	if !ok {
		return errors.New("orderedList attributes must be an object")
	}
	if err := validateKeys(attrs, "start"); err != nil {
		return fmt.Errorf("orderedList attributes: %w", err)
	}
	if start, exists := attrs["start"]; exists && start != nil {
		value, ok := integerValue(start)
		if !ok || value < 1 {
			return errors.New("orderedList start must be a positive integer")
		}
	}
	return nil
}

func validateCodeBlockAttrs(raw any) error {
	if raw == nil {
		return nil
	}
	attrs, ok := raw.(map[string]any)
	if !ok {
		return errors.New("codeBlock attributes must be an object")
	}
	if err := validateKeys(attrs, "language"); err != nil {
		return fmt.Errorf("codeBlock attributes: %w", err)
	}
	if language, exists := attrs["language"]; exists && language != nil {
		if _, ok := language.(string); !ok {
			return errors.New("codeBlock language must be a string or null")
		}
	}
	return nil
}

func validateImageAttrs(raw any) error {
	attrs, ok := raw.(map[string]any)
	if !ok {
		return errors.New("image requires attributes")
	}
	if err := validateKeys(attrs, "attachmentId", "alt", "title", "width", "height"); err != nil {
		return fmt.Errorf("image attributes: %w", err)
	}
	attachmentID, ok := attrs["attachmentId"].(string)
	if !ok || attachmentID == "" {
		return errors.New("image attachmentId must be a non-empty string")
	}
	for _, key := range []string{"alt", "title"} {
		if value, exists := attrs[key]; exists && value != nil {
			if _, ok := value.(string); !ok {
				return fmt.Errorf("image %s must be a string or null", key)
			}
		}
	}
	for _, key := range []string{"width", "height"} {
		if value, exists := attrs[key]; exists && value != nil {
			integer, ok := integerValue(value)
			if !ok || integer <= 0 {
				return fmt.Errorf("image %s must be a positive integer or null", key)
			}
		}
	}
	return nil
}

func validateKeys(object map[string]any, allowed ...string) error {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	for key := range object {
		if _, ok := allowedSet[key]; !ok {
			return fmt.Errorf("unsupported field %q", key)
		}
	}
	return nil
}

func integerValue(value any) (int, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	integer, err := number.Int64()
	if err != nil {
		return 0, false
	}
	return int(integer), true
}
