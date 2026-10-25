import assert from 'node:assert/strict'
import { test } from 'node:test'
import './noExtensionSpecifiers.ts'

const { toEditorDocument, toStoredDocument } = await import('../src/lib/databaseNodeWire.ts')

// The payload the Go storage contract keeps flat on the node's attrs (matches
// internal/document fixtures: properties/records/dateRules/manualDates/view,
// exactly one title property, string values).
const PAYLOAD = {
  properties: [
    { id: 'p-title', name: '이름', type: 'title' },
    { id: 'p-qty', name: '수량', type: 'text' },
    { id: 'p-start', name: '시작', type: 'text' },
  ],
  records: [
    { id: 'r-1', values: { 'p-title': 'A', 'p-qty': '100', 'p-start': '2026-10-01' } },
    { id: 'r-2', values: { 'p-title': 'B', 'p-qty': '200', 'p-start': '2026-10-05' } },
  ],
  dateRules: [],
  manualDates: [],
  view: 'table',
}

test('toStoredDocument flattens attrs.payload onto the node attrs', () => {
  const doc = { type: 'doc', content: [{ type: 'database', attrs: { payload: PAYLOAD } }] }
  const stored = toStoredDocument(doc)
  const node = stored.content![0]
  assert.equal('payload' in node.attrs!, false, 'the payload wrapper is removed')
  assert.deepEqual(node.attrs, PAYLOAD, 'the payload fields sit directly on attrs')
})

test('toEditorDocument widens flat attrs back under attrs.payload', () => {
  const doc = { type: 'doc', content: [{ type: 'database', attrs: { ...PAYLOAD } }] }
  const editorDoc = toEditorDocument(doc)
  const node = editorDoc.content![0]
  assert.deepEqual(node.attrs, { payload: PAYLOAD }, 'the flat payload is wrapped')
})

test('the two directions round-trip without drift', () => {
  const wrapped = { type: 'doc', content: [{ type: 'database', attrs: { payload: PAYLOAD } }] }
  const backToEditor = toEditorDocument(toStoredDocument(wrapped))
  assert.deepEqual(backToEditor, wrapped, 'editor → stored → editor is identity for a database doc')
  const flat = { type: 'doc', content: [{ type: 'database', attrs: { ...PAYLOAD } }] }
  assert.deepEqual(toStoredDocument(toEditorDocument(flat)), flat, 'stored → editor → stored is identity')
})

test('a nested database node is transformed too', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'blockquote', content: [{ type: 'database', attrs: { payload: PAYLOAD } }] }],
  }
  const stored = toStoredDocument(doc)
  assert.deepEqual(stored.content![0].content![0].attrs, PAYLOAD, 'the nested database is flattened')
})

test('a document with no database node is returned unchanged', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
  assert.equal(toStoredDocument(doc), doc, 'the same object is reused when there is nothing to flatten')
  assert.equal(toEditorDocument(doc), doc, 'the same object is reused when there is nothing to widen')
})

test('a database node already in the target shape is left alone', () => {
  const flat = { type: 'doc', content: [{ type: 'database', attrs: { ...PAYLOAD } }] }
  assert.deepEqual(toStoredDocument(flat), flat, 'an already-flat database is not double-processed')
})
