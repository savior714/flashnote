import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeDocumentWire,
  documentWirePrefix,
  encodeDocumentForSave,
  shouldCompressDocument,
} from '../src/lib/documentWire.ts'

function sampleDocument(size: number): string {
  const block = {
    schemaVersion: 1,
    doc: {
      type: 'doc',
      content: Array.from({ length: 64 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: 'lorem ipsum dolor sit amet '.repeat(8) }],
      })),
    },
  }
  const one = JSON.stringify(block)
  let doc = ''
  while (doc.length < size) {
    doc += one
  }
  return doc
}

test('small documents stay plain on the wire', async () => {
  const doc = sampleDocument(1024)
  const wire = await encodeDocumentForSave(doc)
  assert.equal(wire, doc)
  assert.equal(await decodeDocumentWire(wire), doc)
})

test('oversized documents compress and round-trip', async () => {
  const doc = sampleDocument(40 * 1024 * 1024)
  assert.equal(shouldCompressDocument(doc), true)
  const wire = await encodeDocumentForSave(doc)
  assert.ok(wire.startsWith(documentWirePrefix()))
  assert.notEqual(wire, doc)
  const decoded = await decodeDocumentWire(wire)
  assert.equal(decoded.length, doc.length)
  assert.equal(decoded, doc)
  const envelopeBytes = new TextEncoder().encode(
    JSON.stringify({ object: 0, method: 0, args: ['id', 'title', wire, 1] }),
  ).length
  assert.ok(
    envelopeBytes < 64 * 1024 * 1024,
    `wire envelope ${envelopeBytes} must stay under the 64MB transport cap`,
  )
})
