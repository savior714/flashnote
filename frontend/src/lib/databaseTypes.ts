// Types and pure helpers for the in-note task database payload.
//
// The payload is the whole database: it lives in the `database` node's
// attributes inside the owning note's canonical document JSON, so it inherits
// that note's save, revision, backup, trash, and restore behavior with no second
// persistence path. internal/document holds the authoritative shape; these types
// and helpers mirror it for the editor.

import { isValidCalendarDate } from './databaseDates'

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

/**
 * Whether a stored value is already shaped the way `property.type` requires.
 * This is the check a value must pass after a type change, not a licence to drop
 * one that does not: see `convertValue` for what a type change actually does with
 * a stored value.
 */
export function valueFitsType(property: DatabaseProperty, value: unknown): boolean {
  // A value that is not there fits every type, exactly as the Go schema accepts
  // null for every property type.
  if (value === null || value === undefined) return true
  switch (property.type) {
    case 'title':
    case 'text':
    case 'date':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'checkbox':
      return typeof value === 'boolean'
    case 'status':
    case 'select':
      return typeof value === 'string' && optionName(property, value) !== ''
    case 'multiSelect':
      return Array.isArray(value)
    default:
      return false
  }
}

/** A value that fits the type it is being changed to, or the reason it cannot. */
export type ConvertedValue =
  | { ok: true; value: unknown }
  | { ok: false }

/**
 * Rewrites one stored value so the target property can hold it. A value that
 * carries the same information in the new type is converted — a stored `100`
 * becomes the number 100, a stored option id becomes its option name when the
 * column becomes plain text — and a value that has no representation there is
 * refused, so the caller can stop the whole type change instead of quietly
 * discarding data the schema would have rejected.
 *
 * `from` is the property as it stands, `to` the same property with its new type
 * and options already in place.
 */
export function convertValue(
  from: DatabaseProperty,
  to: DatabaseProperty,
  value: unknown,
): ConvertedValue {
  if (value === null || value === undefined) return { ok: true, value: null }
  const converted = convertForType(from, to, value)
  // Whatever the conversion produced, it still has to be a value the new type
  // accepts: the Go schema checks that shape on save.
  if (!converted.ok) return converted
  return valueFitsType(to, converted.value) ? converted : { ok: false }
}

function convertForType(
  from: DatabaseProperty,
  to: DatabaseProperty,
  value: unknown,
): ConvertedValue {
  switch (to.type) {
    case 'title':
    case 'text':
      return convertToText(from, value)
    case 'number':
      return convertToNumber(value)
    case 'date':
      return isValidCalendarDate(value) ? { ok: true, value } : { ok: false }
    case 'checkbox':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false }
    case 'status':
    case 'select':
      return typeof value === 'string' && optionName(to, value) !== ''
        ? { ok: true, value }
        : { ok: false }
    case 'multiSelect':
      // One chosen option stays the same choice in a list of them.
      if (typeof value === 'string') {
        return optionName(to, value) === '' ? { ok: false } : { ok: true, value: [value] }
      }
      return Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string' && optionName(to, entry) !== '')
        ? { ok: true, value }
        : { ok: false }
    default:
      return { ok: false }
  }
}

function convertToText(from: DatabaseProperty, value: unknown): ConvertedValue {
  if (typeof value === 'number') return { ok: true, value: String(value) }
  if (typeof value === 'boolean') return { ok: true, value: String(value) }
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: true, value: '' }
    const names = value.map((entry) =>
      typeof entry === 'string' ? optionName(from, entry) : '',
    )
    if (names.some((name) => name === '')) return { ok: false }
    return { ok: true, value: names.join(', ') }
  }
  if (typeof value !== 'string') return { ok: false }
  // An option id is stored data, but the text a user reads is the option name.
  if (from.type === 'status' || from.type === 'select') {
    const name = optionName(from, value)
    return name === '' ? { ok: false } : { ok: true, value: name }
  }
  return { ok: true, value }
}

function convertToNumber(value: unknown): ConvertedValue {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false }
  }
  if (typeof value !== 'string') return { ok: false }
  // A blank cell holds no number, which is the same as no value at all.
  if (value.trim() === '') return { ok: true, value: null }
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
}

/**
 * Why a property's type cannot change. Every reason describes state the user can
 * clear, because the alternative — saving a payload the Go schema rejects — costs
 * the whole document save, and the alternative the old code chose, deleting
 * values the new type did not accept, cost the data.
 */
export type PropertyTypeChangeBlock =
  | 'last-title-property'
  | 'title-property-exists'
  | 'date-rule-references-property'
  | 'filter-references-property'
  | 'value-not-representable'

export interface PropertyTypeChangeProblem {
  reason: PropertyTypeChangeBlock
  /** The record holding the value that cannot change shape, when there is one. */
  recordId?: string
}

/**
 * The reason `propertyId` cannot become `type`, or null when the change is safe.
 * The Go schema checks these invariants on save; checking them here means the
 * user is told at the point of the change instead of losing the save.
 */
export function propertyTypeChangeProblem(
  payload: DatabasePayload,
  propertyId: string,
  type: PropertyType,
): PropertyTypeChangeProblem | null {
  const property = propertyById(payload, propertyId)
  if (!property || property.type === type) return null

  // A database always carries exactly one title property.
  const titlesAfter = payload.properties.filter(
    (candidate) => candidate.type === 'title' && candidate.id !== propertyId,
  )
  if (type === 'title') titlesAfter.push(property)
  if (titlesAfter.length !== 1) {
    return { reason: type === 'title' ? 'title-property-exists' : 'last-title-property' }
  }

  // A date rule only works between date properties, so a rule that references
  // this property has to go before its type can.
  if (type !== 'date') {
    const references = payload.dateRules.some(
      (rule) => rule.basePropertyId === propertyId || rule.targetPropertyId === propertyId,
    )
    if (references) return { reason: 'date-rule-references-property' }
  }

  const target: DatabaseProperty = { ...property, type }
  if (type === 'status' || type === 'select' || type === 'multiSelect') {
    target.options = property.options
  } else {
    delete target.options
  }

  // A filter is stored in the shape of the type it was written for, and the Go
  // schema checks that shape on save.
  const filterBlocked = (payload.filters ?? []).some(
    (filter) =>
      filter.propertyId === propertyId &&
      filterFitsPropertyType(property, filter) &&
      !filterFitsPropertyType(target, filter),
  )
  if (filterBlocked) return { reason: 'filter-references-property' }

  for (const record of payload.records) {
    const value = record.values[propertyId]
    if (value === null || value === undefined) continue
    if (!convertValue(property, target, value).ok) {
      return { reason: 'value-not-representable', recordId: record.id }
    }
  }
  return null
}

/**
 * Whether one stored filter is legal on `property`. This mirrors what the Go
 * schema checks on save, so a type change is refused while its filters still hold
 * rather than after the document can no longer be saved.
 */
function filterFitsPropertyType(property: DatabaseProperty, filter: DatabaseFilter): boolean {
  const hasValue = filter.value !== null && filter.value !== undefined
  switch (filter.op) {
    case 'isEmpty':
    case 'isNotEmpty':
      return !hasValue
    case 'isChecked':
    case 'isUnchecked':
      return property.type === 'checkbox' && !hasValue
    case 'before':
    case 'after':
      return property.type === 'date' && isValidCalendarDate(filter.value)
    case 'contains':
      return typeof filter.value === 'string'
    case 'is':
    case 'isNot':
      return !hasValue || equalityValueFits(property, filter.value)
    default:
      return false
  }
}

function equalityValueFits(property: DatabaseProperty, value: unknown): boolean {
  switch (property.type) {
    case 'title':
    case 'text':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'date':
      return isValidCalendarDate(value)
    case 'checkbox':
      return typeof value === 'boolean'
    case 'status':
    case 'select':
    case 'multiSelect':
      return typeof value === 'string' && optionName(property, value) !== ''
    default:
      return false
  }
}

/**
 * Appends a record that carries `date` as its deadline. The calendar views create
 * a task on the day the user picked, and the product contract makes that day the
 * task's deadline, so a database with no date property gets one instead of
 * quietly storing a task with no deadline at all.
 */
export function appendRecordWithDeadline(
  payload: DatabasePayload,
  date: string,
  newDatePropertyName: string,
): DatabasePayload {
  const next = clonePayload(payload)
  const title = titleProperty(next)
  const named = next.properties.find(
    (property) => property.type === 'date' && /due|deadline|마감|기한/i.test(property.name),
  )
  const deadline = named ?? next.properties.find((property) => property.type === 'date')
  const target = deadline ?? newProperty(newId(), newDatePropertyName, 'date')
  if (!deadline) next.properties.push(target)

  const values: Record<string, unknown> = {}
  if (title) values[title.id] = ''
  values[target.id] = date
  next.records = [...next.records, newRecord(newId(), values)]
  return next
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
