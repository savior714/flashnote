import { mergeAttributes, Node, wrappingInputRule } from '@tiptap/core'
import { getMessages } from './i18n'
import type { ResolvedLanguage } from './settings'

const taskInputRegex = /^\s*(\[([( |x])?\])\s$/

export const TaskList = Node.create({
  name: 'taskList',
  group: 'block list',
  content: 'taskItem+',

  parseHTML() {
    return [{ tag: 'ul[data-type="taskList"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': this.name }), 0]
  },
})

export function taskCheckboxLabel(text: string, language: ResolvedLanguage): string {
  const messages = getMessages(language)
  return messages.editor.taskCheckbox(text || messages.editor.emptyTask)
}

export function syncTaskCheckboxLabels(root: ParentNode, language: ResolvedLanguage): void {
  root.querySelectorAll<HTMLElement>('li[data-type="taskItem"][data-task-text]').forEach((item) => {
    const label = taskCheckboxLabel(item.dataset.taskText ?? '', language)
    item.querySelector<HTMLInputElement>('input[type="checkbox"]')?.setAttribute('aria-label', label)
    const hiddenLabel = item.querySelector<HTMLSpanElement>('label > span')
    if (hiddenLabel) {
      hiddenLabel.textContent = label
    }
  })
}

export const TaskItem = Node.create({
  name: 'taskItem',
  content: 'paragraph+',

  addOptions() {
    return {
      getLanguage: () => 'en' as ResolvedLanguage,
    }
  },
  defining: true,

  addAttributes() {
    return {
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: element => {
          const dataChecked = element.getAttribute('data-checked')
          return dataChecked === '' || dataChecked === 'true'
        },
        renderHTML: attributes => ({ 'data-checked': attributes.checked }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: `li[data-type="${this.name}"]`,
        priority: 51,
        contentElement: element => element.querySelector('div') ?? element,
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'li',
      mergeAttributes(HTMLAttributes, { 'data-type': this.name }),
      [
        'label',
        [
          'input',
          {
            type: 'checkbox',
            checked: node.attrs.checked ? 'checked' : null,
          },
        ],
        ['span'],
      ],
      ['div', 0],
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    }
  },

  addNodeView() {
    const getLanguage = this.options.getLanguage
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement('li')
      const checkboxWrapper = document.createElement('label')
      const checkboxLabel = document.createElement('span')
      const checkbox = document.createElement('input')
      const content = document.createElement('div')

      const syncCheckbox = (currentNode: typeof node) => {
        const taskText = currentNode.textContent
        listItem.dataset.taskText = taskText
        listItem.dataset.checked = String(currentNode.attrs.checked)
        checkbox.checked = currentNode.attrs.checked
        const label = taskCheckboxLabel(taskText, getLanguage())
        checkbox.setAttribute('aria-label', label)
        checkboxLabel.textContent = label
      }

      checkboxLabel.style.cssText =
        'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
      checkboxWrapper.contentEditable = 'false'
      checkbox.type = 'checkbox'
      checkbox.addEventListener('mousedown', event => event.preventDefault())
      checkbox.addEventListener('change', event => {
        if (!editor.isEditable) {
          checkbox.checked = !checkbox.checked
          return
        }

        if (typeof getPos !== 'function') {
          checkbox.checked = !checkbox.checked
          return
        }

        const { checked } = event.target as HTMLInputElement
        editor
          .chain()
          .focus(undefined, { scrollIntoView: false })
          .command(({ tr }) => {
            const position = getPos()
            if (typeof position !== 'number') {
              return false
            }
            const currentNode = tr.doc.nodeAt(position)
            tr.setNodeMarkup(position, undefined, {
              ...currentNode?.attrs,
              checked,
            })
            return true
          })
          .run()
      })

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, String(value))
      })
      listItem.dataset.type = this.name
      syncCheckbox(node)
      checkboxWrapper.append(checkbox, checkboxLabel)
      listItem.append(checkboxWrapper, content)

      return {
        dom: listItem,
        contentDOM: content,
        update: updatedNode => {
          if (updatedNode.type !== this.type) {
            return false
          }
          syncCheckbox(updatedNode)
          return true
        },
      }
    }
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: taskInputRegex,
        type: this.type,
        getAttributes: match => ({ checked: match[match.length - 1] === 'x' }),
      }),
    ]
  },
})
