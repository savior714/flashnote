import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

// Flashnote's canonical table stores exactly three cell attributes: colspan,
// rowspan, and colwidth (see docs/TECHNICAL.md §4). The stock cell and header
// nodes also carry an alignment attribute, so persisting them verbatim would put
// a value into the document that Flashnote never reads. Dropping it at the node
// spec is what keeps it out of the saved JSON rather than merely hiding it.
function withoutAlignment(node: typeof TableCell | typeof TableHeader) {
  return node.extend({
    addAttributes() {
      const parent: Record<string, unknown> = (this.parent?.() as Record<string, unknown>) ?? {}
      delete parent.align
      return parent
    },
  })
}

export const FlashnoteTableCell = withoutAlignment(TableCell)
export const FlashnoteTableHeader = withoutAlignment(TableHeader)
export { Table as FlashnoteTable, TableRow as FlashnoteTableRow }

/**
 * Registers the in-note table. Column resizing is enabled because the product
 * contract requires column-width adjustment, and its written result is the
 * colwidth attribute the document schema already stores.
 */
export const tableExtensions = [
  Table.configure({ resizable: true }),
  TableRow,
  FlashnoteTableCell,
  FlashnoteTableHeader,
]

export const DEFAULT_TABLE_ROWS = 3
export const DEFAULT_TABLE_COLUMNS = 3
export const DEFAULT_TABLE_WITH_HEADER_ROW = true

/** A fresh empty table as document JSON, used by the insert commands. */
export function createTableContent(
  rows = DEFAULT_TABLE_ROWS,
  columns = DEFAULT_TABLE_COLUMNS,
  withHeaderRow = DEFAULT_TABLE_WITH_HEADER_ROW,
) {
  const content = []
  for (let row = 0; row < rows; row += 1) {
    const cellType = withHeaderRow && row === 0 ? 'tableHeader' : 'tableCell'
    const cells = []
    for (let column = 0; column < columns; column += 1) {
      cells.push({ type: cellType, content: [{ type: 'paragraph' }] })
    }
    content.push({ type: 'tableRow', content: cells })
  }
  return { type: 'table', content }
}
