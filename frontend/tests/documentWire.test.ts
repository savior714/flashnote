import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeDocumentWire,
  DocumentTransportOversizeError,
  documentWirePrefix,
  encodeDocumentForSave,
  isDeterministicDocumentSaveError,
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

function documentWithText(text: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  })
}

function escapeHeavyDocument(): string {
  return documentWithText('\\'.repeat(16 * MiB - 56))
}

function runtimeEnvelopeBytes(wire: string, title: string): number {
  const body = JSON.stringify({
    object: 0,
    method: 0,
    args: {
      'call-id': 'c'.repeat(21),
      methodID: 1592610343,
      args: ['12345678-1234-1234-1234-123456789012', title, wire, 1],
    },
  })
  return new TextEncoder().encode(body).length
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

test('escape-heavy plain fast path is admitted by the transport envelope', async () => {
  const title = 'escape-heavy'
  const doc = escapeHeavyDocument()
  const docBytes = new TextEncoder().encode(doc).length
  assert.ok(docBytes <= 32 * MiB)
  assert.equal(shouldCompressDocument(doc), false)
  assert.ok(saveEnvelopeBytes(doc, title) > CAP)
  assert.ok(runtimeEnvelopeBytes(doc, title) > CAP)

  const wire = await encodeDocumentForSave(doc, title)
  assert.ok(wire.startsWith(documentWirePrefix()))
  assert.notEqual(wire, doc)
  assert.ok(saveEnvelopeBytes(wire, title) <= CAP)
  assert.ok(runtimeEnvelopeBytes(wire, title) <= CAP)
  assert.equal(await decodeDocumentWire(wire), doc)
})

test('similar inner size does not imply similar transport size', () => {
  const title = 'same-inner-size'
  const escapeDoc = escapeHeavyDocument()
  const asciiDoc = documentWithText('a'.repeat(2 * (16 * MiB - 56)))
  const escapeBytes = new TextEncoder().encode(escapeDoc).length
  const asciiBytes = new TextEncoder().encode(asciiDoc).length
  assert.equal(escapeBytes, asciiBytes)
  assert.equal(shouldCompressDocument(escapeDoc), false)
  assert.equal(shouldCompressDocument(asciiDoc), false)
  assert.ok(saveEnvelopeBytes(escapeDoc, title) > CAP)
  assert.ok(saveEnvelopeBytes(asciiDoc, title) <= CAP)
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

test('transport cap rejection is classified as deterministic', () => {
  assert.equal(isDeterministicDocumentSaveError(new Error('assembled body too large')), true)
  assert.equal(isDeterministicDocumentSaveError(new Error('temporary database busy')), false)
})

test('documents over the cap in both wire formats reject client-side', async () => {
  const doc = poorRatioDocument(65 * MiB)
  assert.equal(shouldCompressDocument(doc), true)
  assert.ok(saveEnvelopeBytes(doc) > CAP)
  await assert.rejects(
    () => encodeDocumentForSave(doc, 'oversize-title'),
    (error: unknown) => {
      assert.ok(error instanceof DocumentTransportOversizeError)
      assert.equal(isDeterministicDocumentSaveError(error), true)
      assert.match(String(error), /both exceed the \d+ byte transport cap/)
      return true
    },
  )
})
