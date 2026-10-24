import assert from 'node:assert/strict'
import { test } from 'node:test'
import './noExtensionSpecifiers.ts'

// The payload module reads the calendar-date module, so it is loaded after the
// resolver above is in place.
const {
  appendRecordWithDeadline,
  convertValue,
  createEmptyPayload,
  newProperty,
  newRecord,
  propertyTypeChangeProblem,
  valueFitsType,
} = await import('../src/lib/databaseTypes.ts')
import type { DatabasePayload, DatabaseProperty, PropertyType } from '../src/lib/databaseTypes.ts'

// A converted table: the first column is the title, the rest hold whatever text
// the table cell carried.
function convertedTable(cells: Record<string, unknown>[] = [{}]): DatabasePayload {
  const payload = createEmptyPayload()
  payload.properties = [
    newProperty('p-title', 'Task', 'title'),
    newProperty('p-text', 'Notes', 'text'),
    newProperty('p-number', 'Count', 'number'),
    newProperty('p-date', 'Day', 'date'),
    newProperty('p-status', 'Status', 'status', [
      { id: 'o-todo', name: 'To do' },
      { id: 'o-done', name: 'Done', done: true },
    ]),
    newProperty('p-check', 'Done?', 'checkbox'),
    newProperty('p-tags', 'Tags', 'multiSelect', [
      { id: 't-alpha', name: 'Alpha' },
      { id: 't-beta', name: 'Beta' },
    ]),
  ]
  payload.records = cells.map((values, index) => newRecord(`r${index + 1}`, values))
  return payload
}

function propertyOf(payload: DatabasePayload, propertyId: string): DatabaseProperty {
  const found = payload.properties.find((candidate) => candidate.id === propertyId)
  assert.ok(found, `the fixture must hold a property ${propertyId}`)
  return found
}

function valueOf(payload: DatabasePayload, recordId: string, propertyId: string): unknown {
  const record = payload.records.find((candidate) => candidate.id === recordId)
  assert.ok(record, `the fixture must hold a record ${recordId}`)
  return record.values[propertyId]
}

function problemReason(
  payload: DatabasePayload,
  propertyId: string,
  type: PropertyType,
): string | null {
  return propertyTypeChangeProblem(payload, propertyId, type)?.reason ?? null
}

// ── changing a property type keeps every value it can represent ─────────────

test('converts stored numbers when a text column becomes a number', () => {
  const payload = convertedTable([
    { 'p-title': 'One', 'p-text': '100' },
    { 'p-title': 'Two', 'p-text': '200' },
    { 'p-title': 'Three', 'p-text': '300' },
  ])

  assert.equal(problemReason(payload, 'p-text', 'number'), null)
  const from = propertyOf(payload, 'p-text')
  const to: DatabaseProperty = { ...from, type: 'number' }
  for (const recordId of ['r1', 'r2', 'r3']) {
    const converted = convertValue(from, to, valueOf(payload, recordId, 'p-text'))
    assert.deepEqual(converted, { ok: true, value: Number(valueOf(payload, recordId, 'p-text')) })
    assert.equal(valueFitsType(to, converted.ok ? converted.value : undefined), true)
  }
})

test('refuses a value the new type cannot hold instead of deleting it', () => {
  const payload = convertedTable([
    { 'p-title': 'One', 'p-text': '100' },
    { 'p-title': 'Two', 'p-text': 'abc' },
  ])
  const before = JSON.stringify(payload)

  const problem = propertyTypeChangeProblem(payload, 'p-text', 'number')
  assert.equal(problem?.reason, 'value-not-representable')
  assert.equal(problem?.recordId, 'r2')

  // Asking is free of side effects: nothing in the payload moved.
  assert.equal(JSON.stringify(payload), before)
  assert.equal(valueOf(payload, 'r2', 'p-text'), 'abc')
})

test('converts numbers, booleans and option ids into text', () => {
  const payload = convertedTable([
    { 'p-title': 'One', 'p-number': 42, 'p-check': true, 'p-status': 'o-done', 'p-tags': ['t-alpha', 't-beta'] },
    { 'p-title': 'Two', 'p-number': null, 'p-check': false, 'p-status': null, 'p-tags': [] },
  ])

  const fromNumber = propertyOf(payload, 'p-number')
  const toText: DatabaseProperty = { ...fromNumber, type: 'text' }
  assert.deepEqual(convertValue(fromNumber, toText, valueOf(payload, 'r1', 'p-number')), {
    ok: true,
    value: '42',
  })
  // A value that is already absent stays absent rather than becoming the text "null".
  assert.deepEqual(convertValue(fromNumber, toText, valueOf(payload, 'r2', 'p-number')), {
    ok: true,
    value: null,
  })

  const fromStatus = propertyOf(payload, 'p-status')
  const toTextFromStatus: DatabaseProperty = { ...fromStatus, type: 'text' }
  assert.deepEqual(convertValue(fromStatus, toTextFromStatus, 'o-done'), {
    ok: true,
    value: 'Done',
  })
  // An option id that names no option has no text form, so it is refused.
  assert.equal(convertValue(fromStatus, toTextFromStatus, 'o-missing').ok, false)

  const fromTags = propertyOf(payload, 'p-tags')
  assert.deepEqual(convertValue(fromTags, toText, ['t-beta', 't-alpha']), {
    ok: true,
    value: 'Beta, Alpha',
  })
  assert.deepEqual(convertValue(fromTags, toText, []), { ok: true, value: '' })
  assert.equal(convertValue(fromTags, toText, ['t-nope']).ok, false)

  const fromCheck = propertyOf(payload, 'p-check')
  assert.deepEqual(convertValue(fromCheck, toText, true), { ok: true, value: 'true' })
})

test('keeps an empty cell empty when a column becomes a number', () => {
  const payload = convertedTable([{ 'p-title': 'One', 'p-text': '' }, { 'p-title': 'Two', 'p-text': null }])
  const from = propertyOf(payload, 'p-text')
  const to: DatabaseProperty = { ...from, type: 'number' }

  assert.deepEqual(convertValue(from, to, ''), { ok: true, value: null })
  assert.deepEqual(convertValue(from, to, null), { ok: true, value: null })
  assert.equal(convertValue(from, to, '  ').ok, true)
  // Text that is not a number has no number form.
  assert.equal(convertValue(from, to, '12 kg').ok, false)
  assert.equal(convertValue(from, to, 'Infinity').ok, false)
})

test('refuses text that is not a calendar date when a column becomes a date', () => {
  // Every value must be a real calendar date before the column may become a date.
  const usable = convertedTable([
    { 'p-title': 'One', 'p-text': '2026-10-01' },
    { 'p-title': 'Two', 'p-text': null },
  ])
  assert.equal(problemReason(usable, 'p-text', 'date'), null)

  const notADate = convertedTable([
    { 'p-title': 'One', 'p-text': '2026-10-01' },
    { 'p-title': 'Two', 'p-text': 'abc' },
  ])
  assert.equal(problemReason(notADate, 'p-text', 'date'), 'value-not-representable')

  // A day that does not exist on the calendar is not a date either.
  const impossible = convertedTable([{ 'p-title': 'One', 'p-text': '2026-02-30' }])
  assert.equal(problemReason(impossible, 'p-text', 'date'), 'value-not-representable')
})

test('keeps option values when the column stays an option type', () => {
  const payload = convertedTable([{ 'p-title': 'One', 'p-status': 'o-done' }])
  assert.equal(problemReason(payload, 'p-status', 'select'), null)
  const from = propertyOf(payload, 'p-status')
  const toSelect: DatabaseProperty = { ...from, type: 'select' }
  assert.deepEqual(convertValue(from, toSelect, 'o-done'), { ok: true, value: 'o-done' })

  // A fresh option list cannot hold a stored id, so the change is refused rather
  // than emptied.
  const textColumn = convertedTable([{ 'p-title': 'One', 'p-text': 'blue' }])
  assert.equal(problemReason(textColumn, 'p-text', 'status'), 'value-not-representable')
})

test('keeps one chosen option when a select column becomes a multi-select', () => {
  const payload = convertedTable([{ 'p-title': 'One', 'p-status': 'o-done' }])
  const from = propertyOf(payload, 'p-status')
  const to: DatabaseProperty = { ...from, type: 'multiSelect', options: from.options }

  assert.deepEqual(convertValue(from, to, 'o-done'), { ok: true, value: ['o-done'] })
  assert.equal(problemReason(payload, 'p-status', 'multiSelect'), null)

  // A list of choices has no single-choice form, so it is refused instead of
  // being cut down to whichever one happened to come first.
  const lists = convertedTable([{ 'p-title': 'One', 'p-tags': ['t-alpha'] }])
  const tags = propertyOf(lists, 'p-tags')
  const single: DatabaseProperty = { ...tags, type: 'select', options: tags.options }
  assert.equal(convertValue(tags, single, ['t-alpha']).ok, false)
})

test('keeps a value of the wrong shape out of a type that cannot hold it', () => {
  const payload = convertedTable([{ 'p-title': 'One', 'p-text': '2026-10-01' }])
  const text = propertyOf(payload, 'p-text')
  for (const type of ['checkbox'] as const) {
    const to: DatabaseProperty = { ...text, type }
    assert.equal(convertValue(text, to, '2026-10-01').ok, false, `${type} must refuse text`)
    assert.equal(convertValue(text, to, true).ok, true, `${type} keeps a boolean`)
  }
})

// ── the title property invariant ───────────────────────────────────────────

test('refuses to demote the only title property', () => {
  const payload = convertedTable([{ 'p-title': 'One' }])
  assert.equal(problemReason(payload, 'p-title', 'text'), 'last-title-property')
  assert.equal(problemReason(payload, 'p-title', 'number'), 'last-title-property')
  // Staying the title is not a change at all.
  assert.equal(problemReason(payload, 'p-title', 'title'), null)
})

test('refuses a second title property', () => {
  const payload = convertedTable([{ 'p-title': 'One' }])
  assert.equal(problemReason(payload, 'p-text', 'title'), 'title-property-exists')
  assert.equal(problemReason(payload, 'p-status', 'title'), 'title-property-exists')
})

test('refuses a type change that would orphan a date rule', () => {
  const payload = convertedTable([{ 'p-title': 'One', 'p-date': '2026-10-01' }])
  payload.properties = [
    ...payload.properties,
    newProperty('p-due', 'Due', 'date'),
  ]
  payload.dateRules = [
    { id: 'rule-1', basePropertyId: 'p-date', targetPropertyId: 'p-due', offsetDays: 7 },
  ]

  // The rule works between date properties, so both ends must stay dates.
  assert.equal(problemReason(payload, 'p-date', 'text'), 'date-rule-references-property')
  assert.equal(problemReason(payload, 'p-due', 'number'), 'date-rule-references-property')
  // Becoming a date property is exactly what a rule needs.
  assert.equal(problemReason(payload, 'p-text', 'date'), null)
})

test('refuses a type change that would leave a filter value the schema rejects', () => {
  const withBefore = convertedTable([{ 'p-title': 'One', 'p-date': '2026-10-01' }])
  withBefore.filters = [{ propertyId: 'p-date', op: 'before', value: '2026-10-03' }]
  assert.equal(problemReason(withBefore, 'p-date', 'text'), 'filter-references-property')

  const withChecked = convertedTable([{ 'p-title': 'One', 'p-check': true }])
  withChecked.filters = [{ propertyId: 'p-check', op: 'isChecked' }]
  assert.equal(problemReason(withChecked, 'p-check', 'text'), 'filter-references-property')

  const withNumber = convertedTable([{ 'p-title': 'One', 'p-number': 7 }])
  withNumber.filters = [{ propertyId: 'p-number', op: 'is', value: 7 }]
  assert.equal(problemReason(withNumber, 'p-number', 'text'), 'filter-references-property')

  // A filter that only asks for an empty cell needs no value, so it survives.
  const withEmpty = convertedTable([{ 'p-title': 'One', 'p-number': 7 }])
  withEmpty.filters = [{ propertyId: 'p-number', op: 'isEmpty' }]
  assert.equal(problemReason(withEmpty, 'p-number', 'text'), null)

  // A filter on another property never blocks this change.
  const elsewhere = convertedTable([{ 'p-title': 'One' }])
  elsewhere.filters = [{ propertyId: 'p-date', op: 'before', value: '2026-10-03' }]
  assert.equal(problemReason(elsewhere, 'p-text', 'date'), null)
})

// ── creating a task from a calendar date ───────────────────────────────────

test('gives a task created on a calendar date that date as its deadline', () => {
  const payload = convertedTable([{ 'p-title': 'One', 'p-date': '2026-10-01' }])
  payload.properties = [
    newProperty('p-title', 'Task', 'title'),
    newProperty('p-start', 'Start', 'date'),
    newProperty('p-due', 'Due', 'date'),
  ]

  const next = appendRecordWithDeadline(payload, '2026-10-24', 'Due date')

  assert.equal(next.records.length, 2)
  assert.deepEqual(next.records[0], payload.records[0])
  assert.equal(next.records[1].values['p-title'], '')
  // The deadline-named column is the one the calendar writes to.
  assert.equal(next.records[1].values['p-due'], '2026-10-24')
  assert.equal(next.records[1].values['p-start'], undefined)
})

test('falls back to the only date column when none is named as a deadline', () => {
  const payload = convertedTable([{ 'p-title': 'One' }])
  payload.properties = [
    newProperty('p-title', 'Task', 'title'),
    newProperty('p-start', 'Start', 'date'),
  ]

  const next = appendRecordWithDeadline(payload, '2026-10-24', 'Due date')

  assert.equal(next.records[1].values['p-start'], '2026-10-24')
  assert.equal(next.properties.length, 2)
})

test('creates a date column when the database has none', () => {
  const payload = convertedTable([{ 'p-title': 'One' }])
  payload.properties = [newProperty('p-title', 'Task', 'title')]
  const before = JSON.stringify(payload)

  const next = appendRecordWithDeadline(payload, '2026-10-24', 'Due date')

  // The contract is that the picked day is the new task's deadline, so a database
  // without any date column gains one instead of storing a task with no date.
  const created = next.properties.find((property) => property.type === 'date')
  assert.ok(created, 'the database must hold a date property')
  assert.equal(created.name, 'Due date')
  assert.equal(next.records[1].values[created.id], '2026-10-24')
  assert.equal(next.records[1].values['p-title'], '')

  // The stored payload is untouched.
  assert.equal(JSON.stringify(payload), before)
  assert.deepEqual(next.properties[0], payload.properties[0])
})
