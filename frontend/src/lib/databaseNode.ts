import { Node, type NodeViewRendererProps } from '@tiptap/core'
import { mount, unmount } from 'svelte'
import DatabaseView from './DatabaseView.svelte'
import { createEmptyPayload, type DatabasePayload } from './databaseTypes'
import { databaseLanguage } from './databaseLanguage'

type DatabaseAttributes = { payload: DatabasePayload }

function readPayload(value: unknown): DatabasePayload {
  if (value && typeof value === 'object' && Array.isArray((value as DatabasePayload).properties)) {
    return value as DatabasePayload
  }
  return createEmptyPayload()
}

/**
 * The in-note task database node.
 *
 * The whole database lives in one attribute, so a database edit is a single
 * `setNodeMarkup` step: one ProseMirror transaction, one Undo unit, and the
 * surrounding prose history stays untouched. The payload inherits the owning
 * note's save, revision, backup, trash, and restore behavior through that note's
 * canonical document JSON, with no second persistence path.
 */
export const Database = Node.create({
  name: 'database',
  group: 'block',
  atom: true,
  isolating: true,

  addAttributes() {
    return {
      payload: {
        default: createEmptyPayload(),
        // The payload is data, not markup: rendering never depends on it, so it
        // must not leak into the DOM as a serialized attribute the editor would
        // have to parse back.
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="database"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false
          return { payload: readPayload(element.dataset.database) }
        },
        priority: 100,
      },
    ]
  },

  renderHTML({ node }) {
    return ['div', { 'data-type': 'database' }]
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const { editor, node, getPos } = props
      const host = document.createElement('div')
      host.className = 'database-host'
      host.setAttribute('data-type', 'database')

      const commit = (payload: DatabasePayload) => {
        const position = typeof getPos === 'function' ? getPos() : null
        if (position === null || position === undefined) return
        const attributes = { ...(node.attrs as DatabaseAttributes), payload }
        editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, attributes))
      }

      const component = mount(DatabaseView, {
        target: host,
        props: {
          payload: readPayload((node.attrs as DatabaseAttributes).payload),
          language: databaseLanguage,
          editable: editor.isEditable,
          onCreateTask: (date: string) =>
            commit(appendRecordWithDate((node.attrs as DatabaseAttributes).payload, date)),
          onChange: (next: DatabasePayload) => commit(next),
        },
      }) as { setPayload?: (next: DatabasePayload) => void }

      return {
        dom: host,
        // The database draws its own DOM, so ProseMirror must never reconcile it
        // against the document and must never forward DOM events into the
        // document's keymap.
        ignoreMutation: () => true,
        stopEvent: () => true,
        update: (updatedNode) => {
          const next = readPayload((updatedNode.attrs as DatabaseAttributes).payload)
          component.setPayload?.(next)
          return true
        },
        destroy: () => {
          void unmount(component)
        },
      }
    }
  },
})

// Adding a record with a deadline is the one database action that originates
// outside the table (the calendar views), so the payload change is built here
// and committed by the node view as an ordinary transaction.
function appendRecordWithDate(payload: DatabasePayload, date: string): DatabasePayload {
  const title = payload.properties.find((property) => property.type === 'title')
  const values: Record<string, unknown> = {}
  const dateProperty = payload.properties.find(
    (property) => property.type === 'date' && property.name.toLowerCase().includes('due'),
  ) ?? payload.properties.find((property) => property.type === 'date')
  if (title) values[title.id] = ''
  if (dateProperty && date) values[dateProperty.id] = date
  return {
    ...payload,
    records: [...payload.records, { id: crypto.randomUUID(), values }],
  }
}
