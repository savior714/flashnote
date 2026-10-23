import assert from 'node:assert/strict'
import { test } from 'node:test'
import './noExtensionSpecifiers.ts'

// Static imports in this file are linked before the resolver above is evaluated,
// so the module under test is loaded dynamically once the resolver is in place.
const {
  buildDatabasePayload,
  conversionBlockedMessage,
  hasMergedCells,
  tableCellText,
} = await import('../src/lib/tableToDatabase.ts')
const { newProperty } = await import('../src/lib/databaseTypes.ts')

type ConvertibleTable = {
  content: Array<{ content: Array<{ attrs?: { colspan?: number; rowspan?: number } }> }>
}

// Distinct sequential ids, because a constant id would make every property
// share one key and hide real bugs in the payload.
function sequentialIds(): () => string {
  let counter = 0
  return () => `id-${(counter += 1)}`
}

function cells(texts: Array<Array<{ colspan?: number; rowspan?: number }>>): ConvertibleTable {
  return {
    content: texts.map((spans) => ({
      content: spans.map((attrs) => ({ attrs: { colspan: 1, rowspan: 1, ...attrs } })),
    })),
  }
}

test('concatenates a cell paragraph into one string', () => {
  const paragraph = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ],
  }
  assert.equal(tableCellText(paragraph), 'hello world')
})

test('a table with no spanning cell converts', () => {
  const table = cells([[{}, {}], [{}, {}]])
  assert.equal(hasMergedCells(table), false)
})

test('a colspan greater than one blocks conversion', () => {
  const table = cells([[{ colspan: 2 }, {}], [{}, {}]])
  assert.equal(hasMergedCells(table), true)
})

test('a rowspan greater than one blocks conversion', () => {
  const table = cells([[{}], [{ rowspan: 2 }]])
  assert.equal(hasMergedCells(table), true)
})

test('converting a table keeps every cell text and names properties from the first row', () => {
  const payload = buildDatabasePayload(
    [
      ['Task', 'Owner', 'Notes'],
      ['ship the kernel', 'me', 'remember the checklist'],
      ['', '', 'second row'],
    ],
    sequentialIds(),
  )

  const names = payload.properties.map((property) => property.name)
  assert.deepEqual(names, ['Task', 'Owner', 'Notes'])
  assert.equal(payload.properties[0].type, 'title')
  assert.equal(payload.properties[1].type, 'text')

  assert.equal(payload.records.length, 2)
  const title = payload.properties.find((property) => property.type === 'title')
  const owner = payload.properties.find((property) => property.name === 'Owner')
  assert.equal(payload.records[0].values[title!.id], 'ship the kernel')
  assert.equal(payload.records[0].values[owner!.id], 'me')
  assert.equal(payload.records[1].values[owner!.id], '')
})

test('converting a table with only a header row makes properties and no records', () => {
  const payload = buildDatabasePayload([['Solo column']], sequentialIds())
  assert.equal(payload.properties.length, 1)
  assert.equal(payload.records.length, 0)
})

test('a blank header cell still gets a usable property name', () => {
  const payload = buildDatabasePayload([['', 'Named']], sequentialIds())
  assert.equal(payload.properties[0].name, 'Column 1')
  assert.equal(payload.properties[0].type, 'title')
  assert.equal(payload.properties[1].name, 'Named')
})

test('an empty table becomes an empty database rather than throwing', () => {
  const payload = buildDatabasePayload([], sequentialIds())
  assert.deepEqual(payload.properties.map((property) => property.name), ['Name'])
  assert.equal(payload.records.length, 0)
})

test('a headerless table still gets a title property', () => {
  // A first column of blank names would otherwise leave the payload without the
  // single title property the schema requires.
  const payload = buildDatabasePayload(
    [
      ['', ''],
      ['a', 'b'],
    ],
    sequentialIds(),
  )
  const titles = payload.properties.filter((property) => property.type === 'title')
  assert.equal(titles.length, 1)
})

test('the blocked reason names how to unblock it', () => {
  assert.match(conversionBlockedMessage('merged-cells'), /Unmerge the cells/)
  assert.match(conversionBlockedMessage('no-table'), /inside a table/)
})

test('a property helper stays consistent with the payload type', () => {
  const property = newProperty('p-1', 'Task', 'title')
  assert.equal(property.type, 'title')
  assert.equal(property.options, undefined)
})
