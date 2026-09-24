// Document wire codec for the SaveNote binding.
//
// The Wails HTTP transport refuses assembled request bodies above 64MB
// ("assembled body too large") before AppService.SaveNote runs, which turns
// large pastes into a permanent save-retry loop. Documents whose UTF-8 size
// could grow the JSON envelope near that ceiling are gzip-compressed and
// base64-tagged on the frontend; AppService.SaveNote decodes the tag before
// validation. Smaller documents keep the plain format when their actual
// transport envelope is admitted.
//
// Compression only helps while base64(gzip(doc)) stays inside the cap: for
// poorly compressible documents near the ceiling, base64's 4/3 expansion can
// make the compressed envelope LARGER than the plain one. Admission therefore
// measures a conservative byte bound for each candidate wire format against
// the 64MB transport cap: prefer the compressed form when it fits, fall back
// to plain when compression would blow past the cap, and fail fast when
// neither format fits rather than feeding a doomed body to the retry loop.

const WIRE_PREFIX = 'fn1:'
const PLAIN_LENGTH_GUARD = 8 * 1024 * 1024
const PLAIN_BYTE_LIMIT = 32 * 1024 * 1024
const SAVE_TRANSPORT_CAP_BYTES = 64 * 1024 * 1024
const ENVELOPE_FRAME_SLACK = 4096

export function documentWirePrefix(): string {
  return WIRE_PREFIX
}

export class DocumentTransportOversizeError extends Error {
  readonly plainEnvelopeBytes: number
  readonly compressedEnvelopeBytes: number
  readonly capBytes: number

  constructor(plainEnvelopeBytes: number, compressedEnvelopeBytes: number, capBytes: number) {
    super(
      `note document too large to save: plain envelope ${plainEnvelopeBytes} bytes and compressed envelope ${compressedEnvelopeBytes} bytes both exceed the ${capBytes} byte transport cap`,
    )
    this.name = 'DocumentTransportOversizeError'
    this.plainEnvelopeBytes = plainEnvelopeBytes
    this.compressedEnvelopeBytes = compressedEnvelopeBytes
    this.capBytes = capBytes
  }
}

export function isDeterministicDocumentSaveError(error: unknown): error is Error {
  if (error instanceof DocumentTransportOversizeError) {
    return true
  }
  return error instanceof Error && error.message.includes('assembled body too large')
}

export function shouldCompressDocument(documentJSON: string): boolean {
  if (documentJSON.length <= PLAIN_LENGTH_GUARD) {
    return false
  }
  return utf8ByteLength(documentJSON) > PLAIN_BYTE_LIMIT
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

function jsonEncodedBytes(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x22 || code === 0x5c) {
      bytes += 2
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code === 0x2028 || code === 0x2029) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

export function saveEnvelopeBytes(wire: string, title = ''): number {
  return jsonEncodedBytes(wire) + jsonEncodedBytes(title) + ENVELOPE_FRAME_SLACK
}

export async function encodeDocumentForSave(documentJSON: string, title = ''): Promise<string> {
  const plainEnvelope = saveEnvelopeBytes(documentJSON, title)
  if (!shouldCompressDocument(documentJSON) && plainEnvelope <= SAVE_TRANSPORT_CAP_BYTES) {
    return documentJSON
  }
  const compressed = await gzipBytes(new TextEncoder().encode(documentJSON))
  const compressedWire = WIRE_PREFIX + bytesToBase64(compressed)
  const compressedEnvelope = saveEnvelopeBytes(compressedWire, title)
  if (compressedEnvelope <= SAVE_TRANSPORT_CAP_BYTES) {
    return compressedWire
  }
  if (plainEnvelope <= SAVE_TRANSPORT_CAP_BYTES) {
    return documentJSON
  }
  throw new DocumentTransportOversizeError(
    plainEnvelope,
    compressedEnvelope,
    SAVE_TRANSPORT_CAP_BYTES,
  )
}

export async function decodeDocumentWire(wire: string): Promise<string> {
  if (!wire.startsWith(WIRE_PREFIX)) {
    return wire
  }
  const bytes = base64ToBytes(wire.slice(WIRE_PREFIX.length))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new TextDecoder().decode(buffer)
}

async function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
