import assert from 'node:assert/strict'
import { test } from 'node:test'
import './noExtensionSpecifiers.ts'
import type { RuleProblem } from '../src/lib/databaseRules.ts'

const {
  batchSetDateValue,
  batchShiftDateValue,
  detachManualDate,
  isManualDate,
  reattachManualDate,
  recomputeLinkedDates,
  ruleProblem,
  setDateValue,
  wouldCreateCycle,
} = await import('../src/lib/databaseRules.ts')
// The payload module reads the calendar-date module, so it is loaded the same
// way: after the resolver above is in place.
const {
  compareRecords,
  createEmptyPayload,
  displayValue,
  isRecordComplete,
  newProperty,
  newRecord,
  propertyById,
  visibleRecords,
} = await import('../src/lib/databaseTypes.ts')
import type { DatabasePayload } from '../src/lib/databaseTypes.ts'

// A database with two linked date rules: Start drives Mid, and Mid drives Due,
// so one base change has to travel two steps.
function buildPayload(): DatabasePayload {
  const payload = createEmptyPayload()
  payload.properties = [
    newProperty('p-title', 'Name', 'title'),
    newProperty('p-start', 'Start', 'date'),
    newProperty('p-mid', 'Mid', 'date'),
    newProperty('p-due', 'Due', 'date'),
    newProperty('p-end', 'End', 'date'),
    newProperty('p-status', 'Status', 'status', [
      { id: 'o-todo', name: 'To do' },
      { id: 'o-doing', name: 'Doing' },
      { id: 'o-done', name: 'Done', done: true },
    ]),
  ]
  payload.records = [
    newRecord('r1', {
      'p-title': 'Write the spec',
      'p-start': '2026-10-01',
      'p-mid': '2026-10-06',
      'p-due': '2026-10-16',
      'p-status': 'o-doing',
    }),
    newRecord('r2', {
      'p-title': 'Review the spec',
      'p-start': '2026-10-05',
      'p-status': 'o-done',
    }),
  ]
  payload.dateRules = [
    { id: 'rule-start-to-mid', basePropertyId: 'p-start', targetPropertyId: 'p-mid', offsetDays: 5 },
    { id: 'rule-mid-to-due', basePropertyId: 'p-mid', targetPropertyId: 'p-due', offsetDays: 10 },
  ]
  return payload
}

// Records whose base date cannot produce a derived date: absent, impossible on
// the calendar, and not a string at all.
function buildPayloadWithoutUsableBase(): DatabasePayload {
  const payload = buildPayload()
  payload.records = [
    newRecord('r1', { 'p-title': 'No base at all', 'p-start': null }),
    newRecord('r2', { 'p-title': 'Day that does not exist', 'p-start': '2026-02-30' }),
    newRecord('r3', { 'p-title': 'Base of the wrong type', 'p-start': 20261001 }),
  ]
  return payload
}

// A database shaped for the view layer: option, checkbox, and list properties
// worth filtering and sorting on, plus a record with several empty values.
function buildViewPayload(): DatabasePayload {
  const payload = createEmptyPayload()
  payload.properties = [
    newProperty('p-title', 'Name', 'title'),
    newProperty('p-start', 'Start', 'date'),
    newProperty('p-due', 'Due', 'date'),
    newProperty('p-status', 'Status', 'status', [
      { id: 'o-todo', name: 'To do' },
      { id: 'o-doing', name: 'Doing' },
      { id: 'o-done', name: 'Done', done: true },
    ]),
    newProperty('p-priority', 'Priority', 'select', [
      { id: 's-low', name: 'Low' },
      { id: 's-high', name: 'High' },
    ]),
    newProperty('p-check', 'Check', 'checkbox'),
    newProperty('p-tags', 'Tags', 'multiSelect', [
      { id: 't-alpha', name: 'Alpha' },
      { id: 't-beta', name: 'Beta' },
    ]),
    newProperty('p-score', 'Score', 'number'),
  ]
  payload.records = [
    newRecord('r1', {
      'p-title': 'One',
      'p-start': '2026-10-01',
      'p-due': '2026-10-16',
      'p-status': 'o-doing',
      'p-priority': 's-high',
      'p-check': false,
      'p-tags': ['t-alpha'],
      'p-score': 3,
    }),
    newRecord('r2', {
      'p-title': 'Two',
      'p-start': '2026-10-05',
      'p-status': 'o-done',
      'p-priority': 's-low',
      'p-check': true,
      'p-tags': ['t-alpha', 't-beta'],
      'p-score': 1,
    }),
    newRecord('r3', {
      'p-title': 'Three',
      'p-start': '2026-10-05',
      'p-due': '2026-10-11',
      'p-status': null,
      'p-priority': null,
      'p-check': false,
      'p-tags': [],
      'p-score': null,
    }),
  ]
  return payload
}

function property(payload: DatabasePayload, propertyId: string) {
  const found = propertyById(payload, propertyId)
  assert.ok(found, `the fixture must hold a property ${propertyId}`)
  return found
}

function dateValue(payload: DatabasePayload, recordId: string, propertyId: string): unknown {
  const record = payload.records.find((candidate) => candidate.id === recordId)
  assert.ok(record, `the fixture must hold a record ${recordId}`)
  return record.values[propertyId]
}

function ids(payload: DatabasePayload): string[] {
  return visibleRecords(payload).map((record) => record.id)
}

test('recomputes every linked date from its base along a chain', () => {
  const original = buildPayload()
  const before = JSON.stringify(original)

  const payload = recomputeLinkedDates(original)

  // r2 carries only the base date, so both links are computed from it.
  assert.equal(dateValue(payload, 'r1', 'p-mid'), '2026-10-06')
  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-16')
  assert.equal(dateValue(payload, 'r2', 'p-mid'), '2026-10-10')
  assert.equal(dateValue(payload, 'r2', 'p-due'), '2026-10-20')

  // The stored values are left alone: recomputing hands back a copy.
  assert.equal(JSON.stringify(original), before)
  assert.notEqual(payload.records[0], original.records[0])
  assert.notEqual(payload.manualDates, original.manualDates)
})

test('gives a record with no usable base date no derived date', () => {
  const payload = recomputeLinkedDates(buildPayloadWithoutUsableBase())

  for (const recordId of ['r1', 'r2', 'r3']) {
    assert.equal(dateValue(payload, recordId, 'p-mid'), null, `${recordId} Mid`)
    assert.equal(dateValue(payload, recordId, 'p-due'), null, `${recordId} Due`)
  }

  // Only the target changes; the unusable base value is still stored as it was.
  assert.equal(dateValue(payload, 'r2', 'p-start'), '2026-02-30')
  assert.equal(dateValue(payload, 'r3', 'p-start'), 20261001)
})

test('skips a record listed in manualDates', () => {
  const payload = buildPayload()
  payload.records[0].values['p-due'] = '2026-01-01'
  payload.manualDates = [{ recordId: 'r1', propertyId: 'p-due' }]

  const next = recomputeLinkedDates(payload)

  // The manual value survives, the other rule still moves this record, and the
  // second record's link is untouched.
  assert.equal(dateValue(next, 'r1', 'p-due'), '2026-01-01')
  assert.equal(dateValue(next, 'r1', 'p-mid'), '2026-10-06')
  assert.equal(dateValue(next, 'r2', 'p-due'), '2026-10-20')
})

test('moves the linked target when the base date changes', () => {
  const payload = setDateValue(buildPayload(), 'r1', 'p-start', '2026-10-02')

  assert.equal(dateValue(payload, 'r1', 'p-start'), '2026-10-02')
  assert.equal(dateValue(payload, 'r1', 'p-mid'), '2026-10-07')
  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-17')
  assert.deepEqual(payload.manualDates, [])

  // The other record keeps its own recomputed dates.
  assert.equal(dateValue(payload, 'r2', 'p-mid'), '2026-10-10')
  assert.equal(dateValue(payload, 'r2', 'p-due'), '2026-10-20')
})

test('detaches only the edited record when the target is set off the rule', () => {
  const payload = setDateValue(buildPayload(), 'r1', 'p-due', '2026-11-01')

  assert.deepEqual(payload.manualDates, [{ recordId: 'r1', propertyId: 'p-due' }])
  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-11-01')
  assert.equal(dateValue(payload, 'r1', 'p-mid'), '2026-10-06')

  // Other records stay linked and keep being recomputed.
  assert.equal(dateValue(payload, 'r2', 'p-due'), '2026-10-20')

  const again = recomputeLinkedDates(payload)
  assert.equal(dateValue(again, 'r1', 'p-due'), '2026-11-01')
  assert.equal(dateValue(again, 'r1', 'p-mid'), '2026-10-06')
  assert.equal(dateValue(again, 'r2', 'p-mid'), '2026-10-10')
  assert.equal(dateValue(again, 'r2', 'p-due'), '2026-10-20')
  assert.equal(again.manualDates.length, 1)
})

test('keeps a target linked when the value matches the rule', () => {
  const payload = setDateValue(buildPayload(), 'r1', 'p-due', '2026-10-16')

  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-16')
  assert.deepEqual(payload.manualDates, [])

  // Because the record stayed linked, a later base change still moves it.
  const moved = setDateValue(payload, 'r1', 'p-start', '2026-11-01')
  assert.deepEqual(moved.manualDates, [])
  assert.equal(dateValue(moved, 'r1', 'p-mid'), '2026-11-06')
  assert.equal(dateValue(moved, 'r1', 'p-due'), '2026-11-16')
})

test('treats a target value the rule cannot produce from a missing base as manual', () => {
  const withoutBase = buildPayload()
  withoutBase.records[1].values['p-start'] = null

  const blank = setDateValue(withoutBase, 'r2', 'p-due', null)
  assert.deepEqual(blank.manualDates, [])
  assert.equal(dateValue(blank, 'r2', 'p-due'), null)

  const dated = setDateValue(withoutBase, 'r2', 'p-due', '2026-12-25')
  assert.deepEqual(dated.manualDates, [{ recordId: 'r2', propertyId: 'p-due' }])
  assert.equal(dateValue(dated, 'r2', 'p-due'), '2026-12-25')
  assert.equal(dateValue(dated, 'r2', 'p-mid'), null)
})

test('keeps the chain moving from a manually set middle date', () => {
  const payload = setDateValue(buildPayload(), 'r1', 'p-mid', '2026-10-07')

  assert.deepEqual(payload.manualDates, [{ recordId: 'r1', propertyId: 'p-mid' }])
  assert.equal(dateValue(payload, 'r1', 'p-mid'), '2026-10-07')
  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-17')
  assert.equal(dateValue(payload, 'r2', 'p-due'), '2026-10-20')
})

test('detaches and re-attaches one record from the rule that targets it', () => {
  const payload = buildPayload()
  assert.equal(isManualDate(payload, 'r1', 'p-due'), false)
  assert.equal(isManualDate(payload, 'r2', 'p-due'), false)

  const detached = detachManualDate(payload, 'r1', 'p-due')
  assert.deepEqual(detached.manualDates, [{ recordId: 'r1', propertyId: 'p-due' }])
  assert.equal(isManualDate(detached, 'r1', 'p-due'), true)
  assert.equal(isManualDate(detached, 'r1', 'p-mid'), false)

  // Detaching stores the fact only: the stored date is not recomputed.
  assert.equal(dateValue(detached, 'r1', 'p-due'), '2026-10-16')

  // Detaching an already detached record changes nothing and adds no duplicate.
  assert.equal(detachManualDate(detached, 'r1', 'p-due'), detached)

  // A property no rule targets cannot be detached.
  const notATarget = detachManualDate(payload, 'r1', 'p-title')
  assert.equal(notATarget, payload)
  assert.deepEqual(notATarget.manualDates, [])

  // Re-attaching recomputes the date from the rule.
  detached.records[0].values['p-due'] = '2026-01-01'
  const reattached = reattachManualDate(detached, 'r1', 'p-due')
  assert.deepEqual(reattached.manualDates, [])
  assert.equal(isManualDate(reattached, 'r1', 'p-due'), false)
  assert.equal(dateValue(reattached, 'r1', 'p-due'), '2026-10-16')
  assert.equal(dateValue(reattached, 'r2', 'p-due'), '2026-10-20')
})

test('explains why a rule cannot be saved', () => {
  const payload = buildPayload()
  const cases: Array<{ name: string; base: string; target: string; offset: number; expected: RegExp }> = [
    {
      name: 'the same property as base and target',
      base: 'p-start',
      target: 'p-start',
      offset: 1,
      expected: /same property/i,
    },
    {
      name: 'a base property that does not exist',
      base: 'p-missing',
      target: 'p-due',
      offset: 1,
      expected: /base property does not exist/i,
    },
    {
      name: 'a base property that is not a date',
      base: 'p-title',
      target: 'p-due',
      offset: 1,
      expected: /base property must be a date/i,
    },
    {
      name: 'a target property that does not exist',
      base: 'p-start',
      target: 'p-missing',
      offset: 1,
      expected: /target property does not exist/i,
    },
    {
      name: 'a target property that is not a date',
      base: 'p-start',
      target: 'p-title',
      offset: 1,
      expected: /target property must be a date/i,
    },
    {
      name: 'a target another rule already owns',
      base: 'p-start',
      target: 'p-due',
      offset: 1,
      expected: /already the target of another rule/i,
    },
    {
      name: 'a rule that closes the existing chain',
      base: 'p-due',
      target: 'p-start',
      offset: 1,
      expected: /cycle/i,
    },
    {
      name: 'an offset that is not a whole number',
      base: 'p-due',
      target: 'p-end',
      offset: 1.5,
      expected: /offset is outside the supported range/i,
    },
    {
      name: 'an offset that is too far out',
      base: 'p-due',
      target: 'p-end',
      offset: 36501,
      expected: /offset is outside the supported range/i,
    },
    {
      name: 'a negative offset that is too far out',
      base: 'p-due',
      target: 'p-end',
      offset: -36501,
      expected: /offset is outside the supported range/i,
    },
  ]

  for (const testCase of cases) {
    const problem: RuleProblem | null = ruleProblem(
      payload,
      testCase.base,
      testCase.target,
      testCase.offset,
    )
    assert.ok(problem, `${testCase.name} must be refused`)
    assert.match(problem.message, testCase.expected, testCase.name)
  }
})

test('accepts a rule that settles', () => {
  const payload = buildPayload()
  assert.equal(ruleProblem(payload, 'p-due', 'p-end', 3), null)
  assert.equal(ruleProblem(payload, 'p-due', 'p-end', -3), null)
  assert.equal(ruleProblem(payload, 'p-due', 'p-end', 36500), null)
})

test('reports whether a new rule would close a cycle', () => {
  const payload = buildPayload()

  // Closing the start of the chain from either end forms a cycle.
  assert.equal(wouldCreateCycle(payload, 'p-due', 'p-start'), true)
  assert.equal(wouldCreateCycle(payload, 'p-mid', 'p-start'), true)
  assert.equal(wouldCreateCycle(payload, 'p-start', 'p-start'), true)

  // Extending the chain does not, and neither does re-stating the linked edge.
  assert.equal(wouldCreateCycle(payload, 'p-due', 'p-end'), false)
  assert.equal(wouldCreateCycle(payload, 'p-end', 'p-due'), false)
  assert.equal(wouldCreateCycle(payload, 'p-start', 'p-mid'), false)
})

test('applies is and isNot filters to the stored values', () => {
  const payload = buildViewPayload()

  payload.filters = [{ propertyId: 'p-status', op: 'is', value: 'o-doing' }]
  assert.deepEqual(ids(payload), ['r1'])

  payload.filters = [{ propertyId: 'p-status', op: 'isNot', value: 'o-doing' }]
  assert.deepEqual(ids(payload), ['r2', 'r3'])

  // An empty filter value asks for records that hold no value at all.
  payload.filters = [{ propertyId: 'p-status', op: 'is', value: null }]
  assert.deepEqual(ids(payload), ['r3'])

  payload.filters = [{ propertyId: 'p-title', op: 'is', value: 'Two' }]
  assert.deepEqual(ids(payload), ['r2'])
})

test('applies contains, isEmpty and isNotEmpty filters', () => {
  const payload = buildViewPayload()

  payload.filters = [{ propertyId: 'p-tags', op: 'contains', value: 't-alpha' }]
  assert.deepEqual(ids(payload), ['r1', 'r2'])

  payload.filters = [{ propertyId: 'p-title', op: 'contains', value: 'Three' }]
  assert.deepEqual(ids(payload), ['r3'])

  payload.filters = [{ propertyId: 'p-due', op: 'isEmpty', value: null }]
  assert.deepEqual(ids(payload), ['r2'])

  payload.filters = [{ propertyId: 'p-due', op: 'isNotEmpty', value: null }]
  assert.deepEqual(ids(payload), ['r1', 'r3'])

  payload.filters = [{ propertyId: 'p-score', op: 'isEmpty', value: null }]
  assert.deepEqual(ids(payload), ['r3'])
})

test('applies isChecked, isUnchecked, before and after filters', () => {
  const payload = buildViewPayload()

  payload.filters = [{ propertyId: 'p-check', op: 'isChecked', value: null }]
  assert.deepEqual(ids(payload), ['r2'])

  payload.filters = [{ propertyId: 'p-check', op: 'isUnchecked', value: null }]
  assert.deepEqual(ids(payload), ['r1', 'r3'])

  payload.filters = [{ propertyId: 'p-start', op: 'before', value: '2026-10-03' }]
  assert.deepEqual(ids(payload), ['r1'])

  payload.filters = [{ propertyId: 'p-start', op: 'after', value: '2026-10-03' }]
  assert.deepEqual(ids(payload), ['r2', 'r3'])

  payload.filters = [{ propertyId: 'p-due', op: 'before', value: '2026-10-12' }]
  assert.deepEqual(ids(payload), ['r3'])
})

test('sorts the visible records by the stored sort', () => {
  const payload = buildViewPayload()

  payload.sort = { propertyId: 'p-score', direction: 'asc' }
  assert.deepEqual(ids(payload), ['r2', 'r1', 'r3'])

  // Empty values stay at the end instead of jumping to the top.
  payload.sort = { propertyId: 'p-status', direction: 'asc' }
  assert.deepEqual(ids(payload), ['r1', 'r2', 'r3'])

  payload.sort = { propertyId: 'p-title', direction: 'desc' }
  assert.deepEqual(ids(payload), ['r2', 'r3', 'r1'])

  payload.sort = { propertyId: 'p-tags', direction: 'asc' }
  assert.deepEqual(ids(payload), ['r1', 'r2', 'r3'])
})

test('leaves the payload untouched when filtering and sorting', () => {
  const payload = buildViewPayload()
  payload.filters = [{ propertyId: 'p-tags', op: 'contains', value: 't-alpha' }]
  payload.sort = { propertyId: 'p-title', direction: 'desc' }
  const before = JSON.stringify(payload)

  const rows = visibleRecords(payload)

  assert.deepEqual(rows.map((record) => record.id), ['r2', 'r1'])
  assert.equal(JSON.stringify(payload), before)
  // Record identity is kept, so editing a visible row edits that record.
  assert.equal(rows[0], payload.records[1])
  assert.equal(rows[1], payload.records[0])
})

test('returns the stored records in stored order without sort or filters', () => {
  const payload = buildViewPayload()
  assert.equal(payload.sort, undefined)
  assert.equal(payload.filters, undefined)

  const rows = visibleRecords(payload)

  assert.deepEqual(rows.map((record) => record.id), ['r1', 'r2', 'r3'])
  assert.equal(rows[0], payload.records[0])
  assert.equal(rows[2], payload.records[2])
})

test('sorts empty values after real ones', () => {
  const payload = buildViewPayload()
  const due = property(payload, 'p-due')
  const score = property(payload, 'p-score')
  const missing = newRecord('r4', { 'p-title': 'Four' })

  assert.equal(compareRecords(due, payload.records[1], payload.records[0]), 1)
  assert.equal(compareRecords(due, payload.records[0], payload.records[1]), -1)
  assert.equal(compareRecords(due, payload.records[1], missing), 0)

  assert.ok(compareRecords(score, payload.records[1], payload.records[0]) < 0, '1 before 3')
  assert.ok(compareRecords(score, payload.records[0], payload.records[1]) > 0, '3 after 1')
  assert.equal(compareRecords(score, payload.records[2], payload.records[0]), 1)

  const check = property(payload, 'p-check')
  assert.equal(compareRecords(check, payload.records[1], payload.records[0]), 1)
})

test('reports a checked box and a done status option as complete', () => {
  const payload = buildViewPayload()

  assert.equal(isRecordComplete(payload, payload.records[0]), false)
  assert.equal(isRecordComplete(payload, payload.records[2]), false)

  // Either a done option or a checked box completes a record.
  assert.equal(isRecordComplete(payload, payload.records[1]), true)

  const uncheckedButDone = buildViewPayload()
  uncheckedButDone.records[1].values['p-check'] = false
  assert.equal(isRecordComplete(uncheckedButDone, uncheckedButDone.records[1]), true)

  const checkedOnly = buildViewPayload()
  checkedOnly.records[2].values['p-check'] = true
  assert.equal(isRecordComplete(checkedOnly, checkedOnly.records[2]), true)
})

test('renders option names and blank for values it cannot show', () => {
  const payload = buildViewPayload()

  assert.equal(displayValue(property(payload, 'p-status'), 'o-done'), 'Done')
  assert.equal(displayValue(property(payload, 'p-status'), 'o-todo'), 'To do')
  assert.equal(displayValue(property(payload, 'p-priority'), 's-high'), 'High')
  assert.equal(displayValue(property(payload, 'p-status'), 'o-missing'), '')
  assert.equal(displayValue(property(payload, 'p-status'), 7), '')
  assert.equal(displayValue(property(payload, 'p-status'), null), '')

  assert.equal(displayValue(property(payload, 'p-tags'), ['t-beta', 't-alpha']), 'Beta, Alpha')
  assert.equal(displayValue(property(payload, 'p-tags'), ['t-alpha', 't-missing']), 'Alpha')
  assert.equal(displayValue(property(payload, 'p-tags'), []), '')
  assert.equal(displayValue(property(payload, 'p-tags'), 't-alpha'), '')

  assert.equal(displayValue(property(payload, 'p-title'), 'Hello'), 'Hello')
  assert.equal(displayValue(property(payload, 'p-title'), 5), '')
  assert.equal(displayValue(property(payload, 'p-score'), 12), '12')
  assert.equal(displayValue(property(payload, 'p-score'), '12'), '')
  assert.equal(displayValue(property(payload, 'p-start'), 9), '')
})

// These two cases are regressions for defects found while the database modules
// were built. A rule chain must settle regardless of the order its rules are
// stored in, and an empty value must stay last in a descending sort too.

test('a rule chain settles regardless of stored rule order', () => {
  const payload = buildPayload()
  payload.records = [newRecord('rec-1', { 'p-title': 'chained', 'p-date': '2026-10-01' })]
  payload.dateRules = [
    { id: 'r2', basePropertyId: 'p-mid', targetPropertyId: 'p-due', offsetDays: 1 },
    { id: 'r1', basePropertyId: 'p-date', targetPropertyId: 'p-mid', offsetDays: 1 },
  ]

  const recomputed = recomputeLinkedDates(payload)
  const record = recomputed.records[0]
  assert.equal(record.values['p-mid'], '2026-10-02')
  assert.equal(record.values['p-due'], '2026-10-03')

  // Setting the base one step at a time still converges after one call.
  const edited = setDateValue(recomputed, 'rec-1', 'p-date', '2026-12-30')
  assert.equal(edited.records[0].values['p-mid'], '2026-12-31')
  assert.equal(edited.records[0].values['p-due'], '2027-01-01')
})

test('empty values stay last in a descending sort too', () => {
  const payload = buildPayload()
  payload.properties = [
    newProperty('p-title', 'Task', 'title'),
    newProperty('p-date', 'Start', 'date'),
  ]
  payload.records = [
    newRecord('r1', { 'p-title': 'has date', 'p-date': '2026-10-01' }),
    newRecord('r2', { 'p-title': 'no date', 'p-date': null }),
  ]
  payload.sort = { propertyId: 'p-date', direction: 'desc' }

  assert.deepEqual(
    visibleRecords(payload).map((record) => record.id),
    ['r1', 'r2'],
  )
})

// A batch date edit is the same edit repeated over the selected rows, so these
// cases replay the single-cell cases from above across a selection.

test('a batch edit on the base date moves every linked date', () => {
  const original = buildPayload()
  const before = JSON.stringify(original)

  const payload = batchSetDateValue(original, ['r1'], 'p-start', '2026-10-10')

  // The base changed and the whole chain followed it in the same change.
  assert.equal(dateValue(payload, 'r1', 'p-start'), '2026-10-10')
  assert.equal(dateValue(payload, 'r1', 'p-mid'), '2026-10-15')
  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-25')
  assert.deepEqual(payload.manualDates, [])

  // The other record keeps its own base and its own derived dates.
  assert.equal(dateValue(payload, 'r2', 'p-start'), '2026-10-05')
  assert.equal(dateValue(payload, 'r2', 'p-mid'), '2026-10-10')
  assert.equal(dateValue(payload, 'r2', 'p-due'), '2026-10-20')

  assert.equal(JSON.stringify(original), before)
})

test('a batch edit on a linked deadline detaches those rows only', () => {
  const original = buildPayload()

  const payload = batchSetDateValue(original, ['r1'], 'p-due', '2026-10-31')

  // Only the selected record is detached; the rule itself survives.
  assert.deepEqual(payload.manualDates, [{ recordId: 'r1', propertyId: 'p-due' }])
  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-31')
  assert.equal(dateValue(payload, 'r1', 'p-mid'), '2026-10-06')
  assert.equal(dateValue(payload, 'r2', 'p-due'), '2026-10-20')

  // A later base change still moves the linked record, and never overwrites the
  // deadline this record now holds by hand.
  const moved = batchSetDateValue(payload, ['r1'], 'p-start', '2026-11-01')
  assert.equal(dateValue(moved, 'r1', 'p-mid'), '2026-11-06')
  assert.equal(dateValue(moved, 'r1', 'p-due'), '2026-10-31')
  assert.equal(dateValue(moved, 'r2', 'p-due'), '2026-10-20')
})

test('a batch edit clears a date and keeps the link it clears', () => {
  const payload = batchSetDateValue(buildPayload(), ['r1'], 'p-start', null)

  // A base date with no value produces no derived date, and the detached target
  // is left empty rather than filled with an invented day.
  assert.equal(dateValue(payload, 'r1', 'p-start'), null)
  assert.equal(dateValue(payload, 'r1', 'p-mid'), null)
  assert.equal(dateValue(payload, 'r1', 'p-due'), null)
  assert.deepEqual(payload.manualDates, [])
})

test('a batch shift moves dates and shifts a blank one from today', () => {
  const original = buildPayload()
  original.records[0].values['p-end'] = null

  const payload = batchShiftDateValue(original, ['r1'], 'p-end', 7, '2026-10-24')

  assert.equal(dateValue(payload, 'r1', 'p-end'), '2026-10-31')

  const shifted = batchShiftDateValue(original, ['r1'], 'p-start', -2, '2026-10-24')
  assert.equal(dateValue(shifted, 'r1', 'p-start'), '2026-09-29')
  assert.equal(dateValue(shifted, 'r1', 'p-mid'), '2026-10-04')
  assert.equal(dateValue(shifted, 'r1', 'p-due'), '2026-10-14')
  // Shifting the base is not a hand edit, so nothing is detached.
  assert.deepEqual(shifted.manualDates, [])
})

test('a batch shift on a linked deadline keeps that deadline the user set', () => {
  const payload = batchShiftDateValue(buildPayload(), ['r1'], 'p-due', 7, '2026-10-24')

  assert.equal(dateValue(payload, 'r1', 'p-due'), '2026-10-23')
  assert.deepEqual(payload.manualDates, [{ recordId: 'r1', propertyId: 'p-due' }])
})

test('a batch edit touches only the records it is given', () => {
  const original = buildPayload()

  // One of two selected rows.
  const one = batchSetDateValue(original, ['r1'], 'p-start', '2026-10-10')
  assert.equal(dateValue(one, 'r2', 'p-start'), '2026-10-05')
  assert.equal(dateValue(one, 'r2', 'p-due'), '2026-10-20')

  // A filter-hidden row is not part of the selection, so it is not in the list of
  // ids the batch receives in the first place.
  const hidden = visibleRecords({ ...original, filters: [{ propertyId: 'p-status', op: 'is', value: 'o-doing' }] })
  assert.deepEqual(hidden.map((record) => record.id), ['r1'])

  // A record the database does not hold changes nothing.
  const unknown = batchSetDateValue(original, ['r-nope'], 'p-start', '2026-10-10')
  assert.equal(dateValue(unknown, 'r1', 'p-start'), '2026-10-01')

  // An empty selection leaves the payload as it was.
  const none = batchSetDateValue(original, [], 'p-start', '2026-10-10')
  assert.deepEqual(none.records, original.records)
  assert.deepEqual(none.manualDates, [])
})

test('a batch edit on several rows lands as one settled payload', () => {
  const original = buildPayload()
  original.records.push(newRecord('r3', { 'p-title': 'Third', 'p-start': '2026-10-07' }))

  const payload = batchSetDateValue(original, ['r1', 'r2', 'r3'], 'p-start', '2026-10-10')

  for (const recordId of ['r1', 'r2', 'r3']) {
    assert.equal(dateValue(payload, recordId, 'p-mid'), '2026-10-15', `${recordId} Mid`)
    assert.equal(dateValue(payload, recordId, 'p-due'), '2026-10-25', `${recordId} Due`)
  }
  assert.deepEqual(payload.manualDates, [])
})

// The batch settles the rule chain once for the whole selection instead of once
// per row, which is only safe if the two produce the same payload.

test('a batch edit equals the same edit made one row at a time', () => {
  const original = buildPayload()
  original.records.push(newRecord('r3', { 'p-title': 'Third', 'p-start': '2026-10-07' }))

  // p-mid sits in the middle of the chain, so it is both a rule's target and the
  // next rule's base: the one case where a per-row settle could differ.
  for (const [propertyId, value] of [
    ['p-start', '2026-11-02'],
    ['p-mid', '2026-11-02'],
    ['p-due', '2026-12-25'],
  ] as const) {
    const batched = batchSetDateValue(original, ['r1', 'r2', 'r3'], propertyId, value)
    let oneByOne = original
    for (const recordId of ['r1', 'r2', 'r3']) {
      oneByOne = setDateValue(oneByOne, recordId, propertyId, value)
    }
    assert.deepEqual(batched, oneByOne, `batch and single edits disagree on ${propertyId}`)
  }
})
