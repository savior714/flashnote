// Converting a plain table into the in-note task database.
//
// The whole conversion is one ProseMirror transaction, so it is one Undo unit,
// and a failure leaves the original table untouched because nothing is
// dispatched until the payload is fully built.

import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import {
  createEmptyPayload,
  newProperty,
  newRecord,
  type DatabasePayload,
  type PropertyType,
} from './databaseTypes'

export type ConversionResult =
  | { ok: true; rows: number; columns: number }
  | { ok: false; reason: ConversionBlockedReason }

export type ConversionBlockedReason = 'no-table' | 'merged-cells'

export const CONVERSION_BLOCKED_MESSAGES = {
  'merged-cells':
    'This table has merged cells, so it cannot become a database yet. Unmerge the cells, then convert again.',
  'no-table': 'Put the cursor inside a table to convert it into a database.',
} as const

/** The parts of a parsed table the conversion actually reads. */
export interface ConvertibleTable {
  content: Array<{
    content: Array<{ attrs?: { colspan?: number; rowspan?: number } }>
  }>
}

function tableAtSelection(editor: Editor): { pos: number; node: unknown } | null {
  const { selection } = editor.state
  const $from = selection.$from
  if (typeof $from.before === 'function') {
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === 'table') {
        return { pos: $from.before(depth), node: $from.node(depth) }
      }
    }
  }
  if (selection instanceof NodeSelection && typeof $from.nodeAfter !== 'undefined') {
    const node = $from.nodeAfter
    if (node?.type.name === 'table') {
      return { pos: $from.pos, node }
    }
  }
  return null
}

/** Concatenates a node's text, walking its children. */
export function tableCellText(value: unknown): string {
  const node = value as { text?: unknown; content?: unknown[] }
  if (typeof node?.text === 'string') return node.text
  if (!Array.isArray(node?.content)) return ''
  return node.content.map((child) => tableCellText(child)).join('')
}

/**
 * Whether any cell spans more than one row or column. Such a table cannot become
 * a database, and Flashnote never silently unmerges it.
 */
export function hasMergedCells(table: ConvertibleTable): boolean {
  for (const row of table.content) {
    for (const cell of row.content) {
      const spans = cell.attrs ?? {}
      if ((spans.colspan ?? 1) > 1 || (spans.rowspan ?? 1) > 1) return true
    }
  }
  return false
}

/**
 * Builds the database payload for a converted table. The first row names the
 * properties, the first column becomes the title property, and every other
 * cell's text is preserved verbatim as a record value.
 */
export function buildDatabasePayload(
  rows: string[][],
  makeId: () => string = () => crypto.randomUUID(),
): DatabasePayload {
  // A table with no rows has nothing to convert; it becomes an empty database
  // rather than throwing, so the conversion control never dead-ends the user.
  if (rows.length === 0 || rows[0].length === 0) return createEmptyPayload()

  const header = rows[0].map((name, index) => (name.trim() === '' ? `Column ${index + 1}` : name.trim()))
  const columnCount = rows.reduce((max, cells) => Math.max(max, cells.length), 0)
  if (columnCount === 0) return createEmptyPayload()

  const properties = header.map((name, index) =>
    newProperty(makeId(), name, index === 0 ? 'title' : 'text'),
  )
  const titleIndex = properties.findIndex((property) => property.type === 'title')
  if (titleIndex === -1) {
    properties.unshift(newProperty(makeId(), 'Name', 'title'))
  }

  const records = rows.slice(1).map((cells) => {
    const values: Record<string, unknown> = {}
    properties.forEach((property, index) => {
      values[property.id] = cells[index] ?? ''
    })
    return newRecord(makeId(), values)
  })

  return { ...createEmptyPayload(), properties, records }
}

export function convertTableToDatabase(editor: Editor): ConversionResult {
  const found = tableAtSelection(editor)
  if (!found) return { ok: false, reason: 'no-table' }
  const table = found.node as ConvertibleTable
  if (!table?.content) return { ok: false, reason: 'no-table' }

  if (hasMergedCells(table)) return { ok: false, reason: 'merged-cells' }

  const rows: string[][] = []
  for (const row of table.content) {
    rows.push(row.content.map((cell) => tableCellText(cell).trim()))
  }
  if (rows.length === 0 || rows[0].length === 0) return { ok: false, reason: 'no-table' }

  const payload = buildDatabasePayload(rows)
  const databaseType = editor.state.schema.nodes.database
  if (!databaseType) return { ok: false, reason: 'no-table' }

  const databaseNode = (
    databaseType as unknown as { create: (attrs: unknown) => unknown }
  ).create({ payload })

  const tableSize = (found.node as { nodeSize?: number }).nodeSize ?? 2
  const transaction = editor.state.tr
  transaction.replaceRangeWith(found.pos, found.pos + tableSize, databaseNode as never)
  transaction.setSelection(
    NodeSelection.create(transaction.doc, transaction.mapping.map(found.pos) + 1) as never,
  )
  editor.view.dispatch(transaction)

  return {
    ok: true,
    rows: payload.records.length,
    columns: payload.properties.length,
  }
}

export function conversionBlockedMessage(reason: ConversionBlockedReason): string {
  return CONVERSION_BLOCKED_MESSAGES[reason]
}

/** The property types a converted column starts as, before the user changes it. */
export const CONVERSION_DEFAULT_PROPERTY_TYPES: readonly PropertyType[] = ['title', 'text']
