import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { getMessages } from './i18n'
import type { ResolvedLanguage } from './settings'

export interface SlashCommandItem {
  id: string
  label: string
  keywords: string[]
  execute: (editor: Editor, range: Range) => void
}

type SlashCommandDefinition = Omit<SlashCommandItem, 'label' | 'keywords'> & {
  label: (messages: ReturnType<typeof getMessages>) => string
  keywords: Record<ResolvedLanguage, readonly string[]>
}

const definitions: SlashCommandDefinition[] = [
  {
    id: 'text',
    label: (messages) => messages.slash.text,
    keywords: {
      en: ['paragraph', 'plain', 'text', 'p'],
      ko: ['문단', '일반 텍스트', '텍스트'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    },
  },
  {
    id: 'heading-1',
    label: (messages) => messages.slash.heading1,
    keywords: {
      en: ['h1', 'heading1', 'title', 'header1', 'hea'],
      ko: ['제목1', '헤딩1', 'h1'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run()
    },
  },
  {
    id: 'heading-2',
    label: (messages) => messages.slash.heading2,
    keywords: {
      en: ['h2', 'heading2', 'subtitle', 'header2', 'hea'],
      ko: ['제목2', '헤딩2', 'h2'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run()
    },
  },
  {
    id: 'heading-3',
    label: (messages) => messages.slash.heading3,
    keywords: {
      en: ['h3', 'heading3', 'subheading', 'header3', 'hea'],
      ko: ['제목3', '헤딩3', 'h3'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run()
    },
  },
  {
    id: 'bullet-list',
    label: (messages) => messages.slash.bulletList,
    keywords: {
      en: ['bullet', 'list', 'unordered', 'ul'],
      ko: ['글머리 기호', '비순서 목록', '목록', '불릿'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    id: 'numbered-list',
    label: (messages) => messages.slash.numberedList,
    keywords: {
      en: ['number', 'numbered', 'ordered', 'list', 'ol'],
      ko: ['번호', '번호 매기기', '순서 목록', '목록'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    id: 'todo-list',
    label: (messages) => messages.slash.todoList,
    keywords: {
      en: ['todo', 'task', 'checklist', 'checkbox', 'check'],
      ko: ['할 일', '체크박스', '목록', '할일'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleList('taskList', 'taskItem').run()
    },
  },
  {
    id: 'quote',
    label: (messages) => messages.slash.quote,
    keywords: {
      en: ['quote', 'blockquote', 'quotation'],
      ko: ['인용', '인용문', 'blockquote'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    id: 'code-block',
    label: (messages) => messages.slash.codeBlock,
    keywords: {
      en: ['code', 'codeblock', 'pre', 'program'],
      ko: ['코드', '코드블록', '프로그램'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    id: 'divider',
    label: (messages) => messages.slash.divider,
    keywords: {
      en: ['divider', 'horizontal', 'rule', 'line', 'hr', 'separator'],
      ko: ['구분선', '가로줄', '구분', '선'],
    },
    execute: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
]

export function getSlashCommands(language: ResolvedLanguage): SlashCommandItem[] {
  const messages = getMessages(language)
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label(messages),
    keywords: [...definition.keywords[language]],
    execute: definition.execute,
  }))
}

export function filterSlashCommands(
  query: string,
  language: ResolvedLanguage,
): SlashCommandItem[] {
  const commands = getSlashCommands(language)
  if (!query) {
    return commands
  }
  const cleanQuery = query.toLowerCase().trim()
  return commands.filter(
    (item) =>
      item.label.toLowerCase().includes(cleanQuery) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(cleanQuery)),
  )
}

export interface SlashMenuRenderHandlers {
  onStart: (props: SuggestionProps<SlashCommandItem>) => void
  onUpdate: (props: SuggestionProps<SlashCommandItem>) => void
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
  onExit: () => void
}

export function createSlashExtension(
  handlers: SlashMenuRenderHandlers,
  getLanguage: () => ResolvedLanguage,
) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem>({
          editor: this.editor,
          char: '/',
          startOfLine: true,
          initialItems: getSlashCommands(getLanguage()),
          allow: ({ editor, state, range }) => {
            if (!editor.isEditable) {
              return false
            }
            const $from = state.doc.resolve(range.from)
            return $from.parent.type.name === 'paragraph'
          },
          items: ({ query }) => filterSlashCommands(query, getLanguage()),
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
