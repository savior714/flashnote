import assert from 'node:assert/strict'
import { test } from 'node:test'
import './noExtensionSpecifiers.ts'
import { Editor, Node, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

// Real-editor coverage for the table→database conversion. The pure helpers in
// tableToDatabase.test.ts exercise the serialized helpers; this file drives the
// real TipTap/ProseMirror path where a live node's content is a Fragment, which
// is the representation that made conversion throw before the fix.
const { tableExtensions } = await import('../src/lib/tableExtension.ts')
const { convertTableToDatabase } = await import('../src/lib/tableToDatabase.ts')
const { toStoredDocument } = await import('../src/lib/databaseNodeWire.ts')
const { createEmptyPayload } = await import('../src/lib/databaseTypes.ts')

// Database is imported as a faithful schema-only twin rather than the real
// extension, because the real one pulls in a Svelte node view that cannot load
// under `node --test`. This mirrors databaseNode.ts's node spec exactly (name,
// atom, isolating, the single `payload` attribute), so getJSON and the
// conversion's schema.nodes.database lookup behave identically in the editor.
const Database = Node.create({
  name: 'database',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes() {
    return { payload: { default: createEmptyPayload(), rendered: false } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="database"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'database' }]
  },
})

function para(text: string): unknown {
  return { type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] }
}

function row(cells: string[], type: string, colwidth?: number[]): unknown {
  return {
    type: 'tableRow',
    content: cells.map((text, index) => ({
      type,
      ...(colwidth ? { attrs: { colspan: 1, rowspan: 1, colwidth: [colwidth[index]] } } : {}),
      content: [para(text)],
    })),
  }
}

const SAMPLE: Array<{ cells: string[]; type: string }> = [
  { cells: ['이름', '수량', '시작'], type: 'tableHeader' },
  { cells: ['A', '100', '2026-10-01'], type: 'tableCell' },
  { cells: ['B', '200', '2026-10-05'], type: 'tableCell' },
]

function tableJSON(rows: Array<{ cells: string[]; type: string }>): unknown {
  return { type: 'table', content: rows.map((r) => row(r.cells, r.type)) }
}

function makeEditor(content: JSONContent): Editor {
  const editor = new Editor({
    extensions: [StarterKit, ...tableExtensions, Database],
    content,
    injectCSS: false,
  })
  // A mounted view attaches the extension plugins (history, keymap, …) to the
  // editor state; a headless editor is created without them. Attach the same set
  // Tiptap's createView uses so undo/redo and other plugin-backed behavior are
  // real rather than stubbed.
  editor.view.updateState(
    editor.state.reconfigure({
      plugins: (editor as unknown as { extensionManager: { plugins: unknown } }).extensionManager.plugins,
    }),
  )
  return editor
}

function posOfText(doc: Editor['state']['doc'], needle: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === needle) found = pos
    return true
  })
  return found
}

function eachNode(json: JSONContent, visit: (node: JSONContent) => void): void {
  const walk = (node: JSONContent) => {
    visit(node)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  if (Array.isArray(json.content)) json.content.forEach(walk)
  else walk(json)
}

function countNodes(json: JSONContent, type: string): number {
  let count = 0
  eachNode(json, (node) => {
    if (node.type === type) count += 1
  })
  return count
}

function databaseNode(json: JSONContent): JSONContent | null {
  let found: JSONContent | null = null
  eachNode(json, (node) => {
    if (!found && node.type === 'database') found = node
  })
  return found
}

function payloadOf(json: JSONContent): { properties: Array<{ id: string; type: string; name: string }>; records: Array<{ id: string; values: Record<string, unknown> }> } {
  const node = databaseNode(json)!
  return node.attrs!.payload as ReturnType<typeof payloadOf>
}

test('converting a table keeps every cell value, replaces the table, and leaves one database', () => {
  const editor = makeEditor({ type: 'doc', content: [tableJSON(SAMPLE)] })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'A'))

  const result = convertTableToDatabase(editor)
  assert.deepEqual(result, { ok: true, rows: 2, columns: 3 })

  const json = editor.getJSON()
  assert.equal(countNodes(json, 'database'), 1, 'exactly one database node was created')
  assert.equal(countNodes(json, 'table'), 0, 'the plain table is gone from its position')

  const payload = payloadOf(json)
  assert.equal(payload.properties.length, 3)
  assert.equal(payload.records.length, 2)
  assert.equal(payload.properties[0].type, 'title')
  // Korean headers, and number-like / date-like strings, are preserved verbatim.
  assert.equal(payload.records[0].values[payload.properties[0].id], 'A')
  assert.equal(payload.records[0].values[payload.properties[1].id], '100')
  assert.equal(payload.records[0].values[payload.properties[2].id], '2026-10-01')
  assert.equal(payload.records[1].values[payload.properties[2].id], '2026-10-05')
  editor.destroy()
})

test('the selection lands on the database node the conversion produced', () => {
  const editor = makeEditor({ type: 'doc', content: [tableJSON(SAMPLE)] })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'A'))
  convertTableToDatabase(editor)
  const selection = editor.state.selection as unknown as { constructor: { name: string }; $from: { nodeAfter?: { type: { name: string } } } }
  assert.equal(selection.constructor.name, 'NodeSelection', 'the conversion selects the new node')
  // A NodeSelection anchor is the position directly before the node; the anchor
  // must resolve to the database node, not to a neighbour or past the end.
  assert.equal(selection.$from.nodeAfter?.type.name, 'database', 'the anchor is directly before the database node')
  editor.destroy()
})

test('undo restores the table and redo recreates the identical database', () => {
  const editor = makeEditor({ type: 'doc', content: [tableJSON(SAMPLE)] })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'A'))
  convertTableToDatabase(editor)
  const afterConvert = JSON.stringify(editor.getJSON())

  editor.commands.undo()
  const afterUndo = editor.getJSON()
  assert.equal(countNodes(afterUndo, 'table'), 1, 'one undo restores the plain table')
  assert.equal(countNodes(afterUndo, 'database'), 0, 'the database is removed by undo')

  editor.commands.redo()
  assert.equal(JSON.stringify(editor.getJSON()), afterConvert, 'redo recreates the identical database')
  editor.destroy()
})

test('a table in the middle, at the end, or alone all convert and select the database', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const scenarios: Record<string, JSONContent> = {
    middle: { type: 'doc', content: [p('before'), tableJSON(SAMPLE), p('after')] },
    last: { type: 'doc', content: [p('intro'), tableJSON(SAMPLE)] },
    alone: { type: 'doc', content: [tableJSON(SAMPLE)] },
  }
  for (const [name, content] of Object.entries(scenarios)) {
    const editor = makeEditor(content)
    editor.commands.setTextSelection(posOfText(editor.state.doc, 'A'))
    const result = convertTableToDatabase(editor)
    assert.equal(result.ok, true, `${name}: the conversion succeeds`)
    const json = editor.getJSON()
    assert.equal(countNodes(json, 'database'), 1, `${name}: one database node`)
    assert.equal(countNodes(json, 'table'), 0, `${name}: the table is replaced`)
    const selection = editor.state.selection as unknown as { $from: { nodeAfter?: { type: { name: string } } } }
    assert.equal(selection.$from.nodeAfter?.type.name, 'database', `${name}: selection anchors on the database`)
    editor.destroy()
  }
})

test('a table with merged cells is blocked and left untouched', () => {
  const merged = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          row(['이름', '수량'], 'tableHeader'),
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { colspan: 2, rowspan: 1 }, content: [para('A')] },
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [para('x')] },
            ],
          },
        ],
      },
    ],
  }
  const editor = makeEditor(merged as JSONContent)
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'A'))
  const before = JSON.stringify(editor.getJSON())
  const result = convertTableToDatabase(editor)
  assert.deepEqual(result, { ok: false, reason: 'merged-cells' })
  assert.equal(countNodes(editor.getJSON(), 'database'), 0, 'no database is created')
  assert.equal(JSON.stringify(editor.getJSON()), before, 'the original table is preserved')
  editor.destroy()
})

test('a header-only table converts to properties with no records', () => {
  const editor = makeEditor({ type: 'doc', content: [tableJSON([{ cells: ['Solo'], type: 'tableHeader' }])] })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'Solo'))
  const result = convertTableToDatabase(editor)
  assert.equal(result.ok, true)
  const payload = payloadOf(editor.getJSON())
  assert.equal(payload.properties.length, 1)
  assert.equal(payload.records.length, 0)
  editor.destroy()
})

test('empty and whitespace-only cells are preserved as empty strings, not dropped', () => {
  const editor = makeEditor({
    type: 'doc',
    content: [
      tableJSON([
        { cells: ['Task', 'Owner'], type: 'tableHeader' },
        { cells: ['   ', 'me'], type: 'tableCell' },
      ]),
    ],
  })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'me'))
  const result = convertTableToDatabase(editor)
  assert.equal(result.ok, true)
  const payload = payloadOf(editor.getJSON())
  assert.equal(payload.records[0].values[payload.properties[0].id], '', 'whitespace-only becomes empty')
  assert.equal(payload.records[0].values[payload.properties[1].id], 'me')
  editor.destroy()
})

test('column widths on cells do not affect the conversion or its values', () => {
  const withWidths = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [row(['H1', 'H2'], 'tableHeader', [120, 200]), row(['v1', 'v2'], 'tableCell', [120, 200])],
      },
    ],
  }
  const editor = makeEditor(withWidths as JSONContent)
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'v1'))
  const result = convertTableToDatabase(editor)
  assert.equal(result.ok, true)
  const payload = payloadOf(editor.getJSON())
  assert.equal(payload.properties.length, 2)
  assert.equal(payload.records.length, 1)
  assert.equal(payload.records[0].values[payload.properties[0].id], 'v1')
  editor.destroy()
})

test('the cursor outside any table is refused and the document is untouched', () => {
  const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }] })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'note'))
  const before = JSON.stringify(editor.getJSON())
  const result = convertTableToDatabase(editor)
  assert.deepEqual(result, { ok: false, reason: 'no-table' })
  assert.equal(JSON.stringify(editor.getJSON()), before, 'the document is unchanged on refusal')
  editor.destroy()
})

test('the stored database shape is the flat payload Go validates, not attrs.payload', () => {
  const editor = makeEditor({ type: 'doc', content: [tableJSON(SAMPLE)] })
  editor.commands.setTextSelection(posOfText(editor.state.doc, 'A'))
  convertTableToDatabase(editor)
  const stored = toStoredDocument(editor.getJSON())
  const node = databaseNode(stored)!
  // The SaveNote boundary carries the payload flattened onto attrs: the exact
  // databasePayload struct internal/document decodes with DisallowUnknownFields.
  const attrs = node.attrs as Record<string, unknown>
  assert.equal('payload' in attrs, false, 'no payload wrapper reaches the storage boundary')
  assert.ok(Array.isArray(attrs.properties), 'attrs.properties is the property array')
  assert.ok(Array.isArray(attrs.records), 'attrs.records is the record array')
  assert.equal(attrs.view, 'table')
  const titles = (attrs.properties as Array<{ type: string }>).filter((property) => property.type === 'title')
  assert.equal(titles.length, 1, 'exactly one title property, as the Go schema requires')
  // Every record value is a string (title + text), which Go accepts for those types.
  for (const record of attrs.records as Array<{ values: Record<string, unknown> }>) {
    for (const value of Object.values(record.values)) {
      assert.equal(typeof value, 'string', 'a converted cell value is stored as a string')
    }
  }
  editor.destroy()
})
