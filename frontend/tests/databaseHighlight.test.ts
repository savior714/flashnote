import assert from 'node:assert/strict'
import { test } from 'node:test'
import './noExtensionSpecifiers.ts'

const {
  createEmptyPayload,
  newProperty,
  newRecord,
} = await import('../src/lib/databaseTypes.ts')
const { dueProperty, dueState, isDueSoon, isOverdue, recordDueDate } = await import(
  '../src/lib/databaseHighlight.ts'
)

function buildPayload(records: Array<Record<string, unknown>>) {
  const payload = createEmptyPayload()
  payload.properties = [
    newProperty('p-title', 'Task', 'title'),
    newProperty('p-check', 'Done?', 'checkbox'),
    newProperty('p-start', 'Start', 'date'),
    newProperty('p-due', 'Due', 'date'),
    newProperty('p-plain', 'Other date', 'date'),
  ]
  payload.records = records.map((values, index) => newRecord(`rec-${index + 1}`, values))
  return payload
}

test('the due property prefers the one named for a deadline', () => {
  const payload = buildPayload([{}])
  assert.equal(dueProperty(payload)?.id, 'p-due')
  assert.equal(recordDueDate(payload, payload.records[0]), null)
})

test('a past date is overdue and today is due soon', () => {
  // The reference "today" is passed in, so the result depends only on the data.
  const payload = buildPayload([{ 'p-title': 'overdue one', 'p-due': '2020-01-01' }])
  assert.equal(dueState(payload, payload.records[0], '2026-10-22'), 'overdue')
  assert.equal(isOverdue(payload, payload.records[0], '2026-10-22'), true)

  const soon = buildPayload([{ 'p-title': 'today', 'p-due': '2026-10-22' }])
  assert.equal(dueState(soon, soon.records[0], '2026-10-22'), 'due-soon')
  assert.equal(isDueSoon(soon, soon.records[0], '2026-10-22'), true)
})

test('a completed record is never overdue or due soon', () => {
  const checkboxDone = buildPayload([{ 'p-title': 'done', 'p-check': true, 'p-due': '2020-01-01' }])
  assert.equal(dueState(checkboxDone, checkboxDone.records[0], '2026-10-22'), 'complete')
  assert.equal(isOverdue(checkboxDone, checkboxDone.records[0], '2026-10-22'), false)

  const payload = createEmptyPayload()
  payload.properties = [
    newProperty('p-title', 'Task', 'title'),
    newProperty('p-status', 'Status', 'status', [
      { id: 'o-todo', name: 'To do' },
      { id: 'o-done', name: 'Done', done: true },
    ]),
    newProperty('p-due', 'Due', 'date'),
  ]
  payload.records = [newRecord('rec-1', { 'p-title': 'done', 'p-status': 'o-done', 'p-due': '2020-01-01' })]
  assert.equal(dueState(payload, payload.records[0], '2026-10-22'), 'complete')
})

test('a record with no due date has no conditional highlight', () => {
  const payload = buildPayload([{ 'p-title': 'no date' }])
  assert.equal(dueState(payload, payload.records[0], '2026-10-22'), 'plain')
})

test('a due date beyond the warning window is plain', () => {
  const payload = buildPayload([{ 'p-title': 'far', 'p-due': '2026-10-29' }])
  assert.equal(dueState(payload, payload.records[0], '2026-10-22'), 'plain')
})
