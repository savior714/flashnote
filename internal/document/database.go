package document

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Database property types supported by the in-note task database. The list is
// deliberately short: it is the whole vocabulary, not a starting point.
const (
	PropertyTitle       = "title"
	PropertyText        = "text"
	PropertyNumber      = "number"
	PropertyDate        = "date"
	PropertyStatus      = "status"
	PropertyCheckbox    = "checkbox"
	PropertySelect      = "select"
	PropertyMultiSelect = "multiSelect"
)

// Database view identifiers. All three views read the same records, so a view
// change is never a data change.
const (
	ViewTable = "table"
	ViewWeek  = "week"
	ViewMonth = "month"
)

const (
	SortAscending  = "asc"
	SortDescending = "desc"
)

// Supported filter operators.
const (
	FilterIs          = "is"
	FilterIsNot       = "isNot"
	FilterContains    = "contains"
	FilterIsEmpty     = "isEmpty"
	FilterIsNotEmpty  = "isNotEmpty"
	FilterIsChecked   = "isChecked"
	FilterIsUnchecked = "isUnchecked"
	FilterBefore      = "before"
	FilterAfter       = "after"
)

// Manual row highlight tokens. Conditional highlights (overdue, due soon,
// complete) are computed at display time and are never stored.
const (
	HighlightYellow = "yellow"
	HighlightBlue   = "blue"
	HighlightGreen  = "green"
	HighlightRed    = "red"
	HighlightPurple = "purple"
)

// minRuleOffsetDays and maxRuleOffsetDays bound a date rule's offset. The bound
// exists so a typo cannot silently produce a date centuries away.
const (
	minRuleOffsetDays = -36500
	maxRuleOffsetDays = 36500
)

// databasePayload is the whole in-note task database. It lives entirely in the
// `database` node's attributes, inside the owning note's canonical document
// JSON, so it inherits that note's save, revision, backup, trash, and restore
// behavior without a second persistence path.
type databasePayload struct {
	Properties    []databaseProperty    `json:"properties"`
	Records       []databaseRecord      `json:"records"`
	DateRules     []databaseDateRule    `json:"dateRules"`
	ManualDates   []databaseManualDate  `json:"manualDates"`
	View          string                `json:"view"`
	Sort          *databaseSort         `json:"sort,omitempty"`
	Filters       []databaseFilter      `json:"filters,omitempty"`
	RowHighlights map[string]string     `json:"rowHighlights,omitempty"`
}

type databaseProperty struct {
	ID      string           `json:"id"`
	Name    string           `json:"name"`
	Type    string           `json:"type"`
	Options []databaseOption `json:"options,omitempty"`
}

type databaseOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Done bool   `json:"done,omitempty"`
}

type databaseRecord struct {
	ID     string         `json:"id"`
	Values map[string]any `json:"values"`
	Memo   string         `json:"memo,omitempty"`
}

type databaseDateRule struct {
	ID               string `json:"id"`
	BasePropertyID   string `json:"basePropertyId"`
	TargetPropertyID string `json:"targetPropertyId"`
	OffsetDays       int    `json:"offsetDays"`
}

// databaseManualDate names one record property whose linked date the user set by
// hand. Detachment is stored rather than inferred from value comparison, so a
// manual date that happens to equal the rule's result is not silently re-linked.
type databaseManualDate struct {
	RecordID   string `json:"recordId"`
	PropertyID string `json:"propertyId"`
}

type databaseSort struct {
	PropertyID string `json:"propertyId"`
	Direction  string `json:"direction"`
}

type databaseFilter struct {
	PropertyID string `json:"propertyId"`
	Op         string `json:"op"`
	Value      any    `json:"value,omitempty"`
}

// validateDatabaseNode validates one `database` node and replaces its attribute
// map with the canonical re-encoding of the same data. Rewriting from typed
// structs is what drops unknown fields and missing-presence coupling that a raw
// map pass-through would keep.
func validateDatabaseNode(node map[string]any) error {
	raw, exists := node["attrs"]
	if !exists || raw == nil {
		return errors.New("database node requires properties")
	}
	attrs, ok := raw.(map[string]any)
	if !ok {
		return errors.New("database attributes must be an object")
	}
	payload, err := decodeDatabasePayload(attrs)
	if err != nil {
		return err
	}
	if err := payload.validate(); err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode database attributes: %w", err)
	}
	node["attrs"] = json.RawMessage(encoded)
	return nil
}

func decodeDatabasePayload(attrs map[string]any) (*databasePayload, error) {
	encoded, err := json.Marshal(attrs)
	if err != nil {
		return nil, fmt.Errorf("encode database attributes: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	var payload databasePayload
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode database attributes: %w", err)
	}
	return &payload, nil
}

func (p *databasePayload) validate() error {
	if p.View == "" {
		p.View = ViewTable
	}
	if err := p.validateProperties(); err != nil {
		return err
	}
	if err := p.validateRecords(); err != nil {
		return err
	}
	if err := p.validateDateRules(); err != nil {
		return err
	}
	if err := p.validateManualDates(); err != nil {
		return err
	}
	if err := p.validateDateRuleInvariant(); err != nil {
		return err
	}
	return p.validatePresentation()
}

func (p *databasePayload) validateProperties() error {
	if len(p.Properties) == 0 {
		return errors.New("database requires at least one property")
	}
	properties := make(map[string]databaseProperty, len(p.Properties))
	titles := 0
	for _, property := range p.Properties {
		if property.ID == "" {
			return errors.New("database property requires an id")
		}
		if _, duplicate := properties[property.ID]; duplicate {
			return fmt.Errorf("duplicate database property id %q", property.ID)
		}
		if !isDatabasePropertyType(property.Type) {
			return fmt.Errorf("unsupported database property type %q", property.Type)
		}
		if err := validateDatabaseOptions(property); err != nil {
			return err
		}
		if property.Type == PropertyTitle {
			titles++
		}
		properties[property.ID] = property
	}
	if titles != 1 {
		return fmt.Errorf("database requires exactly one title property, found %d", titles)
	}
	return nil
}

func validateDatabaseOptions(property databaseProperty) error {
	allowsOptions := false
	switch property.Type {
	case PropertyStatus, PropertySelect, PropertyMultiSelect:
		allowsOptions = true
	}
	if allowsOptions && len(property.Options) == 0 {
		return fmt.Errorf("database property %q of type %q requires at least one option", property.ID, property.Type)
	}
	if !allowsOptions && len(property.Options) > 0 {
		return fmt.Errorf("database property %q of type %q does not allow options", property.ID, property.Type)
	}
	seen := make(map[string]struct{}, len(property.Options))
	for _, option := range property.Options {
		if option.ID == "" {
			return fmt.Errorf("database property %q has an option without an id", property.ID)
		}
		if _, duplicate := seen[option.ID]; duplicate {
			return fmt.Errorf("duplicate option id %q on database property %q", option.ID, property.ID)
		}
		if option.Name == "" {
			return fmt.Errorf("option %q on database property %q requires a name", option.ID, property.ID)
		}
		if option.Done && property.Type != PropertyStatus {
			return fmt.Errorf("only status options may be marked done, property %q is %q", property.ID, property.Type)
		}
		seen[option.ID] = struct{}{}
	}
	return nil
}

func (p *databasePayload) validateRecords() error {
	records := make(map[string]struct{}, len(p.Records))
	for _, record := range p.Records {
		if record.ID == "" {
			return errors.New("database record requires an id")
		}
		if _, duplicate := records[record.ID]; duplicate {
			return fmt.Errorf("duplicate database record id %q", record.ID)
		}
		records[record.ID] = struct{}{}
	}
	for _, record := range p.Records {
		keys := make([]string, 0, len(record.Values))
		for propertyID := range record.Values {
			keys = append(keys, propertyID)
		}
		sort.Strings(keys)
		for _, propertyID := range keys {
			property, exists := p.propertyByID(propertyID)
			if !exists {
				return fmt.Errorf("record %q references unknown property %q", record.ID, propertyID)
			}
			if err := validateDatabaseValue(property, record.Values[propertyID], record.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateDatabaseValue(property databaseProperty, value any, recordID string) error {
	switch property.Type {
	case PropertyTitle, PropertyText:
		if value == nil {
			return nil
		}
		if _, ok := value.(string); !ok {
			return fmt.Errorf("record %q property %q must be a string or null", recordID, property.ID)
		}
	case PropertyNumber:
		if value == nil {
			return nil
		}
		if _, ok := value.(json.Number); !ok {
			return fmt.Errorf("record %q property %q must be a number or null", recordID, property.ID)
		}
	case PropertyDate:
		if value == nil {
			return nil
		}
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("record %q property %q must be a YYYY-MM-DD string or null", recordID, property.ID)
		}
		if !IsValidCalendarDate(text) {
			return fmt.Errorf("record %q property %q is not a YYYY-MM-DD date", recordID, property.ID)
		}
	case PropertyCheckbox:
		if value == nil {
			return nil
		}
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("record %q property %q must be a boolean or null", recordID, property.ID)
		}
	case PropertyStatus, PropertySelect:
		if value == nil {
			return nil
		}
		optionID, ok := value.(string)
		if !ok {
			return fmt.Errorf("record %q property %q must be an option id or null", recordID, property.ID)
		}
		if !databaseOptionExists(property, optionID) {
			return fmt.Errorf("record %q references unknown option %q on property %q", recordID, optionID, property.ID)
		}
	case PropertyMultiSelect:
		if value == nil {
			return nil
		}
		options, ok := value.([]any)
		if !ok {
			return fmt.Errorf("record %q property %q must be an array of option ids or null", recordID, property.ID)
		}
		seen := make(map[string]struct{}, len(options))
		for _, rawOption := range options {
			optionID, ok := rawOption.(string)
			if !ok {
				return fmt.Errorf("record %q property %q must contain option ids", recordID, property.ID)
			}
			if !databaseOptionExists(property, optionID) {
				return fmt.Errorf("record %q references unknown option %q on property %q", recordID, optionID, property.ID)
			}
			if _, duplicate := seen[optionID]; duplicate {
				return fmt.Errorf("record %q repeats option %q on property %q", recordID, optionID, property.ID)
			}
			seen[optionID] = struct{}{}
		}
	}
	return nil
}

func (p *databasePayload) validateDateRules() error {
	properties := make(map[string]databaseProperty, len(p.Properties))
	for _, property := range p.Properties {
		properties[property.ID] = property
	}
	targetOwner := make(map[string]string, len(p.DateRules))
	rules := make(map[string]struct{}, len(p.DateRules))
	for _, rule := range p.DateRules {
		if rule.ID == "" {
			return errors.New("date rule requires an id")
		}
		if _, duplicate := rules[rule.ID]; duplicate {
			return fmt.Errorf("duplicate date rule id %q", rule.ID)
		}
		rules[rule.ID] = struct{}{}
		if rule.BasePropertyID == rule.TargetPropertyID {
			return fmt.Errorf("date rule %q cannot use property %q as both base and target", rule.ID, rule.BasePropertyID)
		}
		base, exists := properties[rule.BasePropertyID]
		if !exists {
			return fmt.Errorf("date rule %q references unknown base property %q", rule.ID, rule.BasePropertyID)
		}
		if base.Type != PropertyDate {
			return fmt.Errorf("date rule %q base %q must be a date property", rule.ID, rule.BasePropertyID)
		}
		target, exists := properties[rule.TargetPropertyID]
		if !exists {
			return fmt.Errorf("date rule %q references unknown target property %q", rule.ID, rule.TargetPropertyID)
		}
		if target.Type != PropertyDate {
			return fmt.Errorf("date rule %q target %q must be a date property", rule.ID, rule.TargetPropertyID)
		}
		if owner, exists := targetOwner[rule.TargetPropertyID]; exists {
			return fmt.Errorf("date property %q is already the target of date rule %q", rule.TargetPropertyID, owner)
		}
		if rule.OffsetDays < minRuleOffsetDays || rule.OffsetDays > maxRuleOffsetDays {
			return fmt.Errorf("date rule %q offset %d is outside the supported range", rule.ID, rule.OffsetDays)
		}
		targetOwner[rule.TargetPropertyID] = rule.ID
	}
	return validateNoDateRuleCycle(p.DateRules)
}

// validateNoDateRuleCycle rejects a rule set whose base-to-target edges form a
// cycle. A cycle could never settle, so the rule is refused on save rather than
// resolved by dropping an edge at display time.
func validateNoDateRuleCycle(rules []databaseDateRule) error {
	next := make(map[string]string, len(rules))
	for _, rule := range rules {
		next[rule.BasePropertyID] = rule.TargetPropertyID
	}
	for _, rule := range rules {
		visited := map[string]struct{}{rule.BasePropertyID: {}}
		for current := next[rule.BasePropertyID]; current != ""; current = next[current] {
			if _, seen := visited[current]; seen {
				return fmt.Errorf("date rules form a cycle at property %q", current)
			}
			visited[current] = struct{}{}
		}
	}
	return nil
}

func (p *databasePayload) validateManualDates() error {
	records := make(map[string]struct{}, len(p.Records))
	for _, record := range p.Records {
		records[record.ID] = struct{}{}
	}
	ruleTargets := make(map[string]struct{}, len(p.DateRules))
	for _, rule := range p.DateRules {
		ruleTargets[rule.TargetPropertyID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(p.ManualDates))
	for _, entry := range p.ManualDates {
		if _, exists := records[entry.RecordID]; !exists {
			return fmt.Errorf("manual date entry references unknown record %q", entry.RecordID)
		}
		if _, isTarget := ruleTargets[entry.PropertyID]; !isTarget {
			return fmt.Errorf("manual date entry references property %q that no date rule targets", entry.PropertyID)
		}
		key := entry.RecordID + "\x00" + entry.PropertyID
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("duplicate manual date entry for record %q property %q", entry.RecordID, entry.PropertyID)
		}
		seen[key] = struct{}{}
	}
	return nil
}

// validateDateRuleInvariant checks that every still-linked target date equals
// its base date shifted on the calendar. A record whose base date is missing or
// invalid must not carry a derived value: Flashnote never invents a date.
func (p *databasePayload) validateDateRuleInvariant() error {
	manual := make(map[string]map[string]struct{}, len(p.ManualDates))
	for _, entry := range p.ManualDates {
		if manual[entry.RecordID] == nil {
			manual[entry.RecordID] = map[string]struct{}{}
		}
		manual[entry.RecordID][entry.PropertyID] = struct{}{}
	}

	for _, rule := range p.DateRules {
		for _, record := range p.Records {
			if _, detached := manual[record.ID][rule.TargetPropertyID]; detached {
				continue
			}
			var expected string
			baseValid := false
			if base, ok := record.Values[rule.BasePropertyID].(string); ok && IsValidCalendarDate(base) {
				shifted, err := AddCalendarDays(base, rule.OffsetDays)
				if err != nil {
					return fmt.Errorf("record %q base date %q: %w", record.ID, base, err)
				}
				expected = shifted
				baseValid = true
			}
			actual := record.Values[rule.TargetPropertyID]
			if !baseValid {
				if actual != nil {
					return fmt.Errorf(
						"record %q stores derived date %v without a valid base date for rule %q",
						record.ID, actual, rule.ID,
					)
				}
				continue
			}
			if actual != expected {
				return fmt.Errorf(
					"record %q date %v does not match date rule %q expectation %q",
					record.ID, actual, rule.ID, expected,
				)
			}
		}
	}
	return nil
}

func (p *databasePayload) validatePresentation() error {
	switch p.View {
	case ViewTable, ViewWeek, ViewMonth:
	default:
		return fmt.Errorf("unsupported database view %q", p.View)
	}
	if p.Sort != nil {
		if _, exists := p.propertyByID(p.Sort.PropertyID); !exists {
			return fmt.Errorf("database sort references unknown property %q", p.Sort.PropertyID)
		}
		switch p.Sort.Direction {
		case SortAscending, SortDescending:
		default:
			return fmt.Errorf("unsupported database sort direction %q", p.Sort.Direction)
		}
	}
	for _, filter := range p.Filters {
		property, exists := p.propertyByID(filter.PropertyID)
		if !exists {
			return fmt.Errorf("database filter references unknown property %q", filter.PropertyID)
		}
		if err := validateDatabaseFilter(property, filter); err != nil {
			return err
		}
	}
	highlighted := make([]string, 0, len(p.RowHighlights))
	for recordID := range p.RowHighlights {
		highlighted = append(highlighted, recordID)
	}
	sort.Strings(highlighted)
	for _, recordID := range highlighted {
		if _, exists := p.recordByID(recordID); !exists {
			return fmt.Errorf("database row highlight references unknown record %q", recordID)
		}
		if !isDatabaseHighlightToken(p.RowHighlights[recordID]) {
			return fmt.Errorf("unsupported highlight token %q", p.RowHighlights[recordID])
		}
	}
	return nil
}

func validateDatabaseFilter(property databaseProperty, filter databaseFilter) error {
	switch filter.Op {
	case FilterIs, FilterIsNot:
		return validateDatabaseFilterEquality(property, filter)
	case FilterContains:
		if filter.Value == nil {
			return fmt.Errorf("database filter %q on %q requires a value", filter.Op, property.ID)
		}
		if _, ok := filter.Value.(string); !ok {
			return fmt.Errorf("database filter %q on %q requires a string value", filter.Op, property.ID)
		}
	case FilterIsEmpty, FilterIsNotEmpty:
		if filter.Value != nil {
			return fmt.Errorf("database filter %q on %q does not take a value", filter.Op, property.ID)
		}
	case FilterIsChecked, FilterIsUnchecked:
		if property.Type != PropertyCheckbox {
			return fmt.Errorf("database filter %q requires a checkbox property, %q is %q", filter.Op, property.ID, property.Type)
		}
		if filter.Value != nil {
			return fmt.Errorf("database filter %q does not take a value", filter.Op)
		}
	case FilterBefore, FilterAfter:
		if property.Type != PropertyDate {
			return fmt.Errorf("database filter %q requires a date property, %q is %q", filter.Op, property.ID, property.Type)
		}
		value, ok := filter.Value.(string)
		if !ok || !IsValidCalendarDate(value) {
			return fmt.Errorf("database filter %q on %q requires a YYYY-MM-DD value", filter.Op, property.ID)
		}
	default:
		return fmt.Errorf("unsupported database filter operation %q", filter.Op)
	}
	return nil
}

func validateDatabaseFilterEquality(property databaseProperty, filter databaseFilter) error {
	if filter.Value == nil {
		return fmt.Errorf("database filter %q on %q requires a value", filter.Op, property.ID)
	}
	switch property.Type {
	case PropertyTitle, PropertyText:
		if _, ok := filter.Value.(string); !ok {
			return fmt.Errorf("database filter %q on %q requires a string value", filter.Op, property.ID)
		}
	case PropertyNumber:
		if _, ok := filter.Value.(json.Number); !ok {
			return fmt.Errorf("database filter %q on %q requires a number value", filter.Op, property.ID)
		}
	case PropertyDate:
		value, ok := filter.Value.(string)
		if !ok || !IsValidCalendarDate(value) {
			return fmt.Errorf("database filter %q on %q requires a YYYY-MM-DD value", filter.Op, property.ID)
		}
	case PropertyCheckbox:
		if _, ok := filter.Value.(bool); !ok {
			return fmt.Errorf("database filter %q on %q requires a boolean value", filter.Op, property.ID)
		}
	case PropertyStatus, PropertySelect:
		optionID, ok := filter.Value.(string)
		if !ok {
			return fmt.Errorf("database filter %q on %q requires an option id value", filter.Op, property.ID)
		}
		if !databaseOptionExists(property, optionID) {
			return fmt.Errorf("database filter on %q references unknown option %q", property.ID, optionID)
		}
	case PropertyMultiSelect:
		optionID, ok := filter.Value.(string)
		if !ok {
			return fmt.Errorf("database filter %q on %q requires an option id value", filter.Op, property.ID)
		}
		if !databaseOptionExists(property, optionID) {
			return fmt.Errorf("database filter on %q references unknown option %q", property.ID, optionID)
		}
	}
	return nil
}

func (p *databasePayload) propertyByID(id string) (databaseProperty, bool) {
	for _, property := range p.Properties {
		if property.ID == id {
			return property, true
		}
	}
	return databaseProperty{}, false
}

func (p *databasePayload) recordByID(id string) (databaseRecord, bool) {
	for _, record := range p.Records {
		if record.ID == id {
			return record, true
		}
	}
	return databaseRecord{}, false
}

func isDatabasePropertyType(value string) bool {
	switch value {
	case PropertyTitle, PropertyText, PropertyNumber, PropertyDate, PropertyStatus, PropertyCheckbox, PropertySelect, PropertyMultiSelect:
		return true
	}
	return false
}

func isDatabaseHighlightToken(value string) bool {
	switch value {
	case HighlightYellow, HighlightBlue, HighlightGreen, HighlightRed, HighlightPurple:
		return true
	}
	return false
}

func databaseOptionExists(property databaseProperty, optionID string) bool {
	for _, option := range property.Options {
		if option.ID == optionID {
			return true
		}
	}
	return false
}

// IsValidCalendarDate reports whether value is a real calendar date in
// YYYY-MM-DD form. Date values are stored as calendar dates, never as
// timestamps, so their arithmetic cannot drift across daylight-saving changes.
func IsValidCalendarDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

// AddCalendarDays shifts a YYYY-MM-DD date by a whole number of calendar days.
// It is the single canonical implementation of date-rule arithmetic; the
// frontend computes the same shift inside its editor transaction and this
// function is what independently checks the result on save.
func AddCalendarDays(value string, days int) (string, error) {
	base, err := time.Parse("2006-01-02", value)
	if err != nil {
		return "", fmt.Errorf("parse calendar date %q: %w", value, err)
	}
	return base.AddDate(0, 0, days).Format("2006-01-02"), nil
}

// NormalizeCalendarDate trims a date-only string. It returns an empty string
// for a blank input and reports whether the remaining text is a valid date.
func NormalizeCalendarDate(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", true
	}
	if !IsValidCalendarDate(trimmed) {
		return "", false
	}
	return trimmed, true
}
