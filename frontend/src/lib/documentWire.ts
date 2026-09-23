// Document wire codec for the SaveNote binding.
//
// The Wails HTTP transport refuses assembled request bodies above 64MB
// ("assembled body too large") before AppService.SaveNote runs, which turns
// large pastes into a permanent save-retry loop. Documents whose UTF-8 size
// could grow the JSON envelope near that ceiling are gzip-compressed and
// base64-tagged on the frontend; AppService.SaveNote decodes the tag before
// validation. Smaller documents keep the plain format.

const WIRE_PREFIX = 'fn1:'
const PLAIN_LENGTH_GUARD = 8 * 1024 * 1024
const PLAIN_BYTE_LIMIT = 32 * 1024 * 1024

export function documentWirePrefix(): string {
  return WIRE_PREFIX
}

export function shouldCompressDocument(documentJSON: string): boolean {
  if (documentJSON.length <= PLAIN_LENGTH_GUARD) {
    return false
  }
  return new TextEncoder().encode(documentJSON).length > PLAIN_BYTE_LIMIT
}

export async function encodeDocumentForSave(documentJSON: string): Promise<string> {
  if (!shouldCompressDocument(documentJSON)) {
    return documentJSON
  }
  const compressed = await gzipBytes(new TextEncoder().encode(documentJSON))
  return WIRE_PREFIX + bytesToBase64(compressed)
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
