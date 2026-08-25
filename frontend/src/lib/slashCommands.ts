import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'

export interface SlashCommandItem {
  id: string
  label: string
  keywords: string[]
  execute: (editor: Editor, range: Range) => void
}

export const slashCommands: SlashCommandItem[] = [
  {
    id: 'text',
    label: 'Text',
    keywords: ['paragraph', 'plain', 'text', 'p'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    },
  },
  {
    id: 'heading-1',
    label: 'Heading 1',
    keywords: ['h1', 'heading1', 'title', 'header1', 'hea'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run()
    },
  },
  {
    id: 'heading-2',
    label: 'Heading 2',
    keywords: ['h2', 'heading2', 'subtitle', 'header2', 'hea'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run()
    },
  },
  {
    id: 'heading-3',
    label: 'Heading 3',
    keywords: ['h3', 'heading3', 'subheading', 'header3', 'hea'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run()
    },
  },
  {
    id: 'bullet-list',
    label: 'Bullet list',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    keywords: ['number', 'numbered', 'ordered', 'list', 'ol'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    id: 'todo-list',
    label: 'Todo list',
    keywords: ['todo', 'task', 'checklist', 'checkbox', 'check'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleList('taskList', 'taskItem').run()
    },
  },
  {
    id: 'quote',
    label: 'Quote',
    keywords: ['quote', 'blockquote', 'quotation'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    id: 'code-block',
    label: 'Code block',
    keywords: ['code', 'codeblock', 'pre', 'program'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    keywords: ['divider', 'horizontal', 'rule', 'line', 'hr', 'separator'],
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
]

export function filterSlashCommands(query: string): SlashCommandItem[] {
  if (!query) {
    return slashCommands
  }
  const cleanQuery = query.toLowerCase().trim()
  return slashCommands.filter(
    (item) =>
      item.label.toLowerCase().includes(cleanQuery) ||
      item.keywords.some((k) => k.toLowerCase().includes(cleanQuery)),
  )
}

export interface SlashMenuRenderHandlers {
  onStart: (props: SuggestionProps<SlashCommandItem>) => void
  onUpdate: (props: SuggestionProps<SlashCommandItem>) => void
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
  onExit: () => void
}

export function createSlashExtension(handlers: SlashMenuRenderHandlers) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          editor: this.editor,
          char: '/',
          startOfLine: true,
          initialItems: slashCommands,
          allow: ({ editor, state, range }) => {
            if (!editor.isEditable) {
              return false
            }
            const $from = state.doc.resolve(range.from)
            return $from.parent.type.name === 'paragraph'
          },
          items: ({ query }) => filterSlashCommands(query),
          command: ({ editor, range, props }) => {
            props.execute(editor, range)
          },
          render: () => ({
            onStart: (props) => handlers.onStart(props),
            onUpdate: (props) => handlers.onUpdate(props),
            onKeyDown: (props) => handlers.onKeyDown(props),
            onExit: () => handlers.onExit(),
          }),
        }),
      ]
    },
  })
}
