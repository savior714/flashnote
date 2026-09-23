import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeDocumentWire,
  documentWirePrefix,
  encodeDocumentForSave,
  saveEnvelopeBytes,
  shouldCompressDocument,
} from '../src/lib/documentWire.ts'

const MiB = 1024 * 1024
const CAP = 64 * MiB

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

// High-entropy printable fixture (no `"` or `\`, so JSON.stringify adds no
// content escaping): measured gzip ratio ≈ 0.83, i.e. base64(gzip(doc)) grows
// past the 64MB cap while the plain document still fits.
function poorRatioDocument(sizeChars: number): string {
  const alpha = Array.from({ length: 95 }, (_, index) => String.fromCharCode(0x20 + index))
    .filter((char) => char !== '"' && char !== '\\')
    .join('')
  let state = 0x9e3779b9
  const parts: string[] = []
  const chunkSize = 1 << 20
  let remaining = sizeChars
  while (remaining > 0) {
    const count = Math.min(chunkSize, remaining)
    let chunk = ''
    for (let index = 0; index < count; index += 1) {
      state ^= state << 13
      state >>>= 0
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      chunk += alpha[state % alpha.length]
    }
    parts.push(chunk)
    remaining -= count
  }
  const text = parts.join('')
  return JSON.stringify({
    schemaVersion: 1,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  })
}

test('small documents stay plain on the wire', async () => {
  const doc = sampleDocument(1024)
  const wire = await encodeDocumentForSave(doc)
  assert.equal(wire, doc)
  assert.equal(await decodeDocumentWire(wire), doc)
})

test('oversized documents compress and round-trip', async () => {
  const doc = sampleDocument(40 * MiB)
  assert.equal(shouldCompressDocument(doc), true)
  const wire = await encodeDocumentForSave(doc)
  assert.ok(wire.startsWith(documentWirePrefix()))
  assert.notEqual(wire, doc)
  const decoded = await decodeDocumentWire(wire)
  assert.equal(decoded.length, doc.length)
  assert.equal(decoded, doc)
  assert.ok(
    saveEnvelopeBytes(wire) <= CAP,
    `compressed envelope ${saveEnvelopeBytes(wire)} must stay under the 64MB transport cap`,
  )
})

test('poor-ratio documents fall back to plain when compression exceeds the cap', async () => {
  const doc = poorRatioDocument(62 * MiB)
  assert.equal(shouldCompressDocument(doc), true)
  const wire = await encodeDocumentForSave(doc, 'fallback-title')
  // Compression was triggered but the base64(gzip) envelope would exceed the
  // cap, so admission must fall back to the plain document that still fits.
  assert.equal(wire, doc)
  assert.ok(saveEnvelopeBytes(wire, 'fallback-title') <= CAP)
  assert.equal(await decodeDocumentWire(wire), doc)
})

test('documents over the cap in both wire formats reject client-side', async () => {
  const doc = poorRatioDocument(65 * MiB)
  assert.equal(shouldCompressDocument(doc), true)
  assert.ok(saveEnvelopeBytes(doc) > CAP)
  await assert.rejects(
    () => encodeDocumentForSave(doc, 'oversize-title'),
    /both exceed the \d+ byte transport cap/,
  )
})
