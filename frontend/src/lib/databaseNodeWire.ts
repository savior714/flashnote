// The one boundary codec between the editor's database model and the Go storage
// contract's database model.
//
// The editor models an in-note task database as a single `payload` node
// attribute, so the whole database stays one value the node view reads and
// commits. The Go storage contract instead keeps the payload's own fields
// directly on the node's `attrs` — that flat shape is what
// `internal/document.ValidateAndNormalizeJSON` validates (with
// DisallowUnknownFields) and what every Go reader (search, Markdown export)
// decodes. A document that crosses the boundary in the editor's shape is
// rejected as `json: unknown field "payload"`.
//
// These two functions are the only place that reconciles the two. They are
// applied exactly where the document crosses into and out of the editor model
// (NoteEditor's persisted document in, and its emitted document out), and
// nowhere else, so the rest of the frontend keeps working with `attrs.payload`
// and the persisted document stays the canonical flat shape Go already defines.

import type { JSONContent } from '@tiptap/core'

function hasPayloadWrapper(node: JSONContent): boolean {
  const attrs = node.attrs
  return !!attrs && typeof attrs === 'object' && 'payload' in attrs
}

/** Editor → stored: `attrs.payload` becomes `attrs`. */
function unwrapDatabase(node: JSONContent): JSONContent {
  if (node.type !== 'database' || !hasPayloadWrapper(node)) return node
  return { ...node, attrs: node.attrs!.payload }
}

/** Stored → editor: the flat payload becomes `attrs.payload`. */
function wrapDatabase(node: JSONContent): JSONContent {
  if (node.type !== 'database' || hasPayloadWrapper(node) || !node.attrs) return node
  return { ...node, attrs: { payload: node.attrs } }
}

// Returns the same node object when nothing beneath it changed, so a document
// with no database node (the common case) is left untouched with no rebuild.
function walk(node: JSONContent, transform: (node: JSONContent) => JSONContent): JSONContent {
  let changed = false
  let nextContent: JSONContent[] | undefined
  if (Array.isArray(node.content)) {
    nextContent = node.content.map((child) => {
      const next = walk(child, transform)
      if (next !== child) changed = true
      return next
    })
  }
  const transformed = transform(node)
  if (transformed !== node) changed = true
  if (!changed) return node
  return nextContent ? { ...transformed, content: nextContent } : transformed
}

/**
 * Prepares an editor document for the SaveNote/canonical boundary by flattening
 * every database node's `attrs.payload` onto its `attrs`.
 */
export function toStoredDocument(doc: JSONContent): JSONContent {
  return walk(doc, unwrapDatabase)
}

/**
 * Prepares a stored document for the editor by wrapping each database node's
 * payload back under `attrs.payload`.
 */
export function toEditorDocument(doc: JSONContent): JSONContent {
  return walk(doc, wrapDatabase)
}
