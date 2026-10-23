// Types and pure helpers for the in-note task database payload.
//
// The payload is the whole database: it lives in the `database` node's
// attributes inside the owning note's canonical document JSON, so it inherits
// that note's save, revision, backup, trash, and restore behavior with no second
// persistence path. internal/document holds the authoritative shape; these types
// and helpers mirror it for the editor.

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'date'
  | 'status'
  | 'checkbox'
  | 'select'
  | 'multiSelect'

export type DatabaseView = 'table' | 'week' | 'month'

export type SortDirection = 'asc' | 'desc'

export type FilterOp =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isChecked'
  | 'isUnchecked'
  | 'before'
  | 'after'

export type HighlightToken = 'yellow' | 'blue' | 'green' | 'red' | 'purple'

export interface DatabaseOption {
  id: string
  name: string
  done?: boolean
}

export interface DatabaseProperty {
  id: string
  name: string
  type: PropertyType
  options?: DatabaseOption[]
}

export interface DatabaseRecord {
  id: string
  values: Record<string, unknown>
  memo?: string
}

export interface DatabaseDateRule {
  id: string
  basePropertyId: string
  targetPropertyId: string
  offsetDays: number
}

/** Names one record property whose linked date the user set by hand. */
export interface DatabaseManualDate {
  recordId: string
  propertyId: string
}

export interface DatabaseSort {
  propertyId: string
  direction: SortDirection
}

export interface DatabaseFilter {
  propertyId: string
  op: FilterOp
  value?: unknown
}

export interface DatabasePayload {
  properties: DatabaseProperty[]
  records: DatabaseRecord[]
  dateRules: DatabaseDateRule[]
  manualDates: DatabaseManualDate[]
  view: DatabaseView
  sort?: DatabaseSort
  filters?: DatabaseFilter[]
  rowHighlights?: Record<string, HighlightToken>
}

export const PROPERTY_TYPES: readonly PropertyType[] = [
  'title',
  'text',
  'number',
  'date',
  'status',
  'checkbox',
  'select',
  'multiSelect',
]

export const OPTION_PROPERTY_TYPES: readonly PropertyType[] = ['status', 'select', 'multiSelect']

export const VIEWS: readonly DatabaseView[] = ['table', 'week', 'month']

export const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc']

export const HIGHLIGHT_TOKENS: readonly HighlightToken[] = [
  'yellow',
  'blue',
  'green',
  'red',
  'purple',
]

/** Days a conditional "due soon" warning covers, counting from today. */
export const DUE_SOON_WINDOW_DAYS = 3

/** An empty database with the single title property every database must have. */
export function createEmptyPayload(): DatabasePayload {
  return {
    properties: [newProperty(newId(), 'Name', 'title')],
    records: [],
    dateRules: [],
    manualDates: [],
    view: 'table',
  }
}

export function newId(): string {
  return crypto.randomUUID()
}

export function newProperty(
  id: string,
  name: string,
  type: PropertyType,
  options?: DatabaseOption[],
): DatabaseProperty {
  const property: DatabaseProperty = { id, name, type }
  if (options && options.length > 0) property.options = options
  return property
}

export function newRecord(id: string, values: Record<string, unknown> = {}): DatabaseRecord {
  return { id, values }
}

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value)
}

export function allowsOptions(property: DatabaseProperty): boolean {
  return (OPTION_PROPERTY_TYPES as readonly string[]).includes(property.type)
}

export function titleProperty(payload: DatabasePayload): DatabaseProperty | undefined {
  return payload.properties.find((property) => property.type === 'title')
}

export function propertyById(payload: DatabasePayload, id: string): DatabaseProperty | undefined {
  return payload.properties.find((property) => property.id === id)
}

export function recordById(payload: DatabasePayload, id: string): DatabaseRecord | undefined {
  return payload.records.find((record) => record.id === id)
}

/**
 * Renders one stored value as the text a user reads. Select-type values resolve
 * to their option name rather than the stored identifier, matching what the Go
 * side uses for search text and Markdown export.
 */
export function displayValue(property: DatabaseProperty, value: unknown): string {
  if (value === null || value === undefined) return ''
  switch (property.type) {
    case 'title':
    case 'text':
      return typeof value === 'string' ? value : ''
    case 'number':
      return typeof value === 'number' ? String(value) : ''
    case 'date':
      return typeof value === 'string' ? value : ''
    case 'status':
    case 'select': {
      if (typeof value !== 'string') return ''
      return optionName(property, value)
    }
    case 'multiSelect': {
      if (!Array.isArray(value)) return ''
      return value
        .map((optionId) => (typeof optionId === 'string' ? optionName(property, optionId) : ''))
        .filter((name) => name !== '')
        .join(', ')
    }
    case 'checkbox':
      return typeof value === 'boolean' ? String(value) : ''
    default:
      return ''
  }
}

export function optionName(property: DatabaseProperty, optionId: string): string {
  const option = property.options?.find((candidate) => candidate.id === optionId)
  return option ? option.name : ''
}

/** Reports whether a record is completed, which suppresses due warnings. */
export function isRecordComplete(
  payload: DatabasePayload,
  record: DatabaseRecord,
): boolean {
  for (const property of payload.properties) {
    if (property.type === 'checkbox' && record.values[property.id] === true) return true
    if (property.type === 'status') {
      const optionId = record.values[property.id]
      if (typeof optionId !== 'string') continue
      const option = property.options?.find((candidate) => candidate.id === optionId)
      if (option?.done) return true
    }
  }
  return false
}

export function clonePayload(payload: DatabasePayload): DatabasePayload {
  return {
    // Options are copied as well, so editing a property's options in a clone can
    // never reach back into the payload the clone came from.
    properties: payload.properties.map((property) => ({
      ...property,
      ...(property.options ? { options: property.options.map((option) => ({ ...option })) } : {}),
    })),
    records: payload.records.map((record) => ({ ...record, values: { ...record.values } })),
    dateRules: payload.dateRules.map((rule) => ({ ...rule })),
    manualDates: payload.manualDates.map((entry) => ({ ...entry })),
    view: payload.view,
    ...(payload.sort ? { sort: { ...payload.sort } } : {}),
    ...(payload.filters ? { filters: payload.filters.map((filter) => ({ ...filter })) } : {}),
    ...(payload.rowHighlights ? { rowHighlights: { ...payload.rowHighlights } } : {}),
  }
}

/**
 * Applies the stored sort and filters to the records. This is presentation
 * only: it never changes record data, and every record keeps its identity, so
 * editing a visible record changes exactly that record.
 */
export function visibleRecords(payload: DatabasePayload): DatabaseRecord[] {
  const filters = payload.filters ?? []
  const rows = payload.records.filter((record) => filters.every((filter) => matchesFilter(payload, record, filter)))
  if (payload.sort) {
    const property = propertyById(payload, payload.sort.propertyId)
    if (property) {
      const direction = payload.sort.direction === 'desc' ? -1 : 1
      rows.sort((left, right) => compareRecords(property, left, right, direction))
    }
  }
  return rows
}

function matchesFilter(
  payload: DatabasePayload,
  record: DatabaseRecord,
  filter: DatabaseFilter,
): boolean {
  const property = propertyById(payload, filter.propertyId)
  if (!property) return false
  const value = record.values[property.id]

  switch (filter.op) {
    case 'isEmpty':
      return isEmptyValue(value)
    case 'isNotEmpty':
      return !isEmptyValue(value)
    case 'isChecked':
      return property.type === 'checkbox' && value === true
    case 'isUnchecked':
      return property.type === 'checkbox' && value !== true
    case 'contains': {
      if (typeof filter.value !== 'string') return false
      if (property.type === 'multiSelect') {
        return Array.isArray(value) && value.includes(filter.value)
      }
      return displayValue(property, value).includes(filter.value)
    }
    case 'is': {
      if (property.type === 'checkbox') return value === filter.value
      return isEmptyValue(filter.value) ? isEmptyValue(value) : value === filter.value
    }
    case 'isNot': {
      if (property.type === 'checkbox') return value !== filter.value
      return isEmptyValue(filter.value) ? !isEmptyValue(value) : value !== filter.value
    }
    case 'before':
      return typeof value === 'string' && typeof filter.value === 'string' && value < filter.value
    case 'after':
      return typeof value === 'string' && typeof filter.value === 'string' && value > filter.value
    default:
      return false
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function compareRecords(
  property: DatabaseProperty,
  left: DatabaseRecord,
  right: DatabaseRecord,
  direction = 1,
): number {
  const leftValue = left.values[property.id]
  const rightValue = right.values[property.id]
  const leftEmpty = isEmptyValue(leftValue)
  const rightEmpty = isEmptyValue(rightValue)
  // Empty values sort last in a stable position in both directions, so a
  // descending sort does not pull them to the top.
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0
    return leftEmpty ? 1 : -1
  }

  const comparison = compareFilledValues(property, leftValue, rightValue)
  return direction * comparison
}

function compareFilledValues(property: DatabaseProperty, leftValue: unknown, rightValue: unknown): number {
  switch (property.type) {
    case 'number':
      return numberValue(leftValue) - numberValue(rightValue)
    case 'checkbox':
      return Number(leftValue === true) - Number(rightValue === true)
    case 'status':
    case 'select':
      return compareOptions(property, leftValue, rightValue)
    case 'multiSelect':
      return displayValue(property, leftValue).localeCompare(displayValue(property, rightValue))
    default:
      return displayValue(property, leftValue).localeCompare(displayValue(property, rightValue))
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function compareOptions(property: DatabaseProperty, left: unknown, right: unknown): number {
  const leftName = optionName(property, typeof left === 'string' ? left : '')
  const rightName = optionName(property, typeof right === 'string' ? right : '')
  return leftName.localeCompare(rightName)
}
