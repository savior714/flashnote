import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTableContent } from '../src/lib/tableExtension.ts'

// The Go document schema is the authority on which node types and attributes are
// valid canonical data. This test pins the shape the editor is expected to emit,
// so a change in the table extension's attributes fails here instead of turning
// into a save rejection in the app.
const ALLOWED_CELL_ATTRIBUTES = new Set(['colspan', 'rowspan', 'colwidth'])
const ALLOWED_CELL_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
])

function walk(node: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) {
  assert.equal(node.type.trim() !== '', true, 'a node must have a non-empty type')
  if (node.attrs) {
    const keys = Object.keys(node.attrs)
    switch (node.type) {
      case 'tableCell':
      case 'tableHeader':
        for (const key of keys) {
          assert.equal(
            ALLOWED_CELL_ATTRIBUTES.has(key),
            true,
            `${node.type} carries unsupported attribute ${key}`,
          )
        }
        // The stock extension also emits an alignment attribute. If it reappears
        // here, the alignment override in tableExtension.ts stopped working and
        // Go would reject the saved document.
        assert.equal(
          keys.includes('align'),
          false,
          `${node.type} persisted an alignment attribute that Flashnote never reads`,
        )
        break
      case 'table':
      case 'tableRow':
        assert.equal(keys.length, 0, `${node.type} does not allow attributes`)
        break
      default:
        break
    }
  }
  for (const child of node.content ?? []) {
    walk(child as { type: string; attrs?: Record<string, unknown>; content?: unknown[] })
  }
}

test('a freshly inserted table only uses the canonical table vocabulary', () => {
  const table = createTableContent(3, 3, true)

  assert.equal(table.type, 'table')
  assert.equal(table.content.length, 3, 'a fresh table carries the requested row count')

  for (let row = 0; row < table.content.length; row += 1) {
    const cells = table.content[row].content
    assert.equal(cells.length, 3, `row ${row} carries the requested column count`)
    const expectedCellType = row === 0 ? 'tableHeader' : 'tableCell'
    for (const cell of cells) {
      assert.equal(cell.type, expectedCellType)
      // A cell may not be empty: the Go schema requires at least one block child.
      assert.equal(cell.content.length > 0, true, 'a cell must hold at least one block')
      for (const block of cell.content) {
        assert.equal(
          ALLOWED_CELL_BLOCK_TYPES.has(block.type),
          true,
          `a cell holds unsupported block type ${block.type}`,
        )
      }
    }
  }

  walk(table as unknown as { type: string; attrs?: Record<string, unknown>; content?: unknown[] })
})

test('a header-less table still carries rows and columns', () => {
  const table = createTableContent(2, 2, false)
  assert.equal(table.content.length, 2)
  for (const row of table.content) {
    for (const cell of row.content) {
      assert.equal(cell.type, 'tableCell')
    }
  }
})
