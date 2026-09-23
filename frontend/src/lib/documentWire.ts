// Document wire codec for the SaveNote binding.
//
// The Wails HTTP transport refuses assembled request bodies above 64MB
// ("assembled body too large") before AppService.SaveNote runs, which turns
// large pastes into a permanent save-retry loop. Documents whose UTF-8 size
// could grow the JSON envelope near that ceiling are gzip-compressed and
// base64-tagged on the frontend; AppService.SaveNote decodes the tag before
// validation. Smaller documents keep the plain format.
//
// Compression only helps while base64(gzip(doc)) stays inside the cap: for
// poorly compressible documents near the ceiling, base64's 4/3 expansion can
// make the compressed envelope LARGER than the plain one. Admission therefore
// measures the exact envelope size of each candidate wire format against the
// 64MB transport cap: prefer the compressed form when it fits, fall back to
// plain when compression would blow past the cap, and fail fast client-side
// when neither format fits rather than feeding a doomed body to the retry loop.

const WIRE_PREFIX = 'fn1:'
const PLAIN_LENGTH_GUARD = 8 * 1024 * 1024
const PLAIN_BYTE_LIMIT = 32 * 1024 * 1024
const SAVE_TRANSPORT_CAP_BYTES = 64 * 1024 * 1024
// The runtime envelope frame (object/method ids, nested args object, note
// UUID, revision) is ~300 bytes; 4KiB keeps the bound conservative against
// binding-shape drift without hiding multi-megabyte violations.
const ENVELOPE_FRAME_SLACK = 4096

export function documentWirePrefix(): string {
  return WIRE_PREFIX
}

export function shouldCompressDocument(documentJSON: string): boolean {
  if (documentJSON.length <= PLAIN_LENGTH_GUARD) {
    return false
  }
  return new TextEncoder().encode(documentJSON).length > PLAIN_BYTE_LIMIT
}

function jsonEncodedBytes(value: string): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

// Upper bound on the UTF-8 bytes of the SaveNote runtime envelope that would
// carry `wire` with `title`: each argument's exact JSON encoding (including
// string escaping) plus a fixed frame slack. Conservative — never undercounts.
export function saveEnvelopeBytes(wire: string, title = ''): number {
  return jsonEncodedBytes(wire) + jsonEncodedBytes(title) + ENVELOPE_FRAME_SLACK
}

export async function encodeDocumentForSave(documentJSON: string, title = ''): Promise<string> {
  if (!shouldCompressDocument(documentJSON)) {
    return documentJSON
  }
  const compressed = await gzipBytes(new TextEncoder().encode(documentJSON))
  const compressedWire = WIRE_PREFIX + bytesToBase64(compressed)
  const compressedEnvelope = saveEnvelopeBytes(compressedWire, title)
  if (compressedEnvelope <= SAVE_TRANSPORT_CAP_BYTES) {
    return compressedWire
  }
  const plainEnvelope = saveEnvelopeBytes(documentJSON, title)
  if (plainEnvelope <= SAVE_TRANSPORT_CAP_BYTES) {
    // base64 expansion pushed the compressed envelope over the cap while the
    // plain document still fits — compression hurt, so send plain.
    return documentJSON
  }
  throw new Error(
    `note document too large to save: plain envelope ${plainEnvelope} bytes and compressed envelope ${compressedEnvelope} bytes both exceed the ${SAVE_TRANSPORT_CAP_BYTES} byte transport cap`,
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
