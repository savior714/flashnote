<script lang="ts">
  import { Editor, isTextSelection, type JSONContent, type Range } from '@tiptap/core'
  import BubbleMenu from '@tiptap/extension-bubble-menu'
  import { NodeSelection } from '@tiptap/pm/state'
  import StarterKit from '@tiptap/starter-kit'
  import { onDestroy, onMount, untrack } from 'svelte'
  import { IngestImage } from '../../bindings/github.com/savior714/flashnote/appservice'
  import { AttachmentImage, attachmentImageContent } from './attachmentImage'
  import FormattingBubble from './FormattingBubble.svelte'
  import { isValidExternalWebUrl, openExternalUrl } from './linkHelper'
  import { RichPasteNormalization } from './richPaste'
  import SlashMenu from './SlashMenu.svelte'
  import { runSlashAcceptance } from './slashAcceptance'
  import { getMessages } from './i18n'
  import {
    createSlashExtension,
    filterSlashCommands,
    type SlashCommandItem,
  } from './slashCommands'
  import { runChecklistInteractionAcceptance } from './checklistAcceptance'
  import type { ResolvedLanguage } from './settings'
  import { syncTaskCheckboxLabels, TaskItem, TaskList } from './taskList'

  type Props = {
    documentJSON: string
    onDocumentChange: (documentJSON: string) => void
    acceptanceText?: string
    editable?: boolean
    onAcceptanceReady?: () => void
    onAcceptanceFailed?: (error: unknown) => void
    language: ResolvedLanguage
  }

  let {
    documentJSON,
    onDocumentChange,
    acceptanceText = '',
    editable = true,
    onAcceptanceReady,
    onAcceptanceFailed,
    language,
  }: Props = $props()
  let messages = $derived(getMessages(language))
  let element!: HTMLDivElement
  let bubbleElement!: HTMLDivElement
  let editor = $state<Editor | null>(null)
  let imageError = $state(false)

  let slashOpen = $state(false)
  let slashQuery = $state('')
  let slashItems = $state<SlashCommandItem[]>([])
  let slashSelectedIndex = $state(0)
  let slashRange = $state<Range | null>(null)
  let slashX = $state(0)
  let slashY = $state(0)

  function updateSlashPosition(clientRect?: (() => DOMRect | null) | null) {
    const rect = clientRect?.()
    if (!rect) return
    const menuWidth = 200
    const menuHeight = 240
    const padding = 12

    let x = rect.left
    if (x + menuWidth > window.innerWidth - padding) {
      x = Math.max(padding, window.innerWidth - menuWidth - padding)
    }

    let y = rect.bottom + 4
    if (y + menuHeight > window.innerHeight - padding) {
      y = Math.max(padding, rect.top - menuHeight - 4)
    }

    slashX = x
    slashY = y
  }

  function closeSlash() {
    slashOpen = false
    slashQuery = ''
    slashRange = null
    slashSelectedIndex = 0
  }

  function executeSlash(item: SlashCommandItem) {
    const currentEditor = editor
    const currentRange = slashRange
    if (!currentEditor || !currentRange) {
      closeSlash()
      return
    }
    item.execute(currentEditor, currentRange)
    closeSlash()
  }

  const slashExtension = createSlashExtension({
    onStart: (props) => {
      slashOpen = true
      slashQuery = props.query ?? ''
      slashItems = props.items
      slashSelectedIndex = 0
      slashRange = props.range
      updateSlashPosition(props.clientRect)
    },
    onUpdate: (props) => {
      slashQuery = props.query ?? ''
      slashItems = props.items
      if (slashSelectedIndex >= slashItems.length) {
        slashSelectedIndex = Math.max(0, slashItems.length - 1)
      }
      slashRange = props.range
      updateSlashPosition(props.clientRect)
    },
    onKeyDown: ({ event }) => {
      if (!slashOpen) return false
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (slashItems.length > 0) {
          slashSelectedIndex = (slashSelectedIndex + 1) % slashItems.length
        }
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (slashItems.length > 0) {
          slashSelectedIndex = (slashSelectedIndex - 1 + slashItems.length) % slashItems.length
        }
        return true
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (slashItems.length > 0 && slashItems[slashSelectedIndex]) {
          executeSlash(slashItems[slashSelectedIndex])
          return true
        }
        return false
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSlash()
        return true
      }
      return false
    },
    onExit: () => {
      closeSlash()
    },
  }, () => language)

  function persistedDoc(): JSONContent {
    const envelope = JSON.parse(documentJSON) as {
      schemaVersion?: unknown
      doc?: unknown
    }
    if (envelope.schemaVersion !== 1 || typeof envelope.doc !== 'object' || envelope.doc === null) {
      throw new Error('Flashnote received an invalid persisted document')
    }
    return envelope.doc as JSONContent
  }

  function isImageCandidate(file: File): boolean {
    if (file.type.startsWith('image/')) {
      return true
    }
    return /\.(png|jpe?g|gif)$/i.test(file.name)
  }

  function droppedFiles(dataTransfer: DataTransfer | null): File[] {
    if (!dataTransfer) {
      return []
    }
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      const fromFiles = Array.from(dataTransfer.files).filter(isImageCandidate)
      if (fromFiles.length > 0) {
        return fromFiles
      }
    }
    if (dataTransfer.items && dataTransfer.items.length > 0) {
      const fromItems: File[] = []
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile?.()
          if (file && isImageCandidate(file)) {
            fromItems.push(file)
          }
        }
      }
      if (fromItems.length > 0) {
        return fromItems
      }
    }
    return []
  }

  function bytesToBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
    }
    return btoa(binary)
  }

  async function ingestFiles(files: File[], requestedPosition?: number) {
    let position = requestedPosition
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const attachmentID = await IngestImage(bytesToBase64(bytes), file.name || 'clipboard-image')
        const currentEditor = editor
        if (!currentEditor || currentEditor.isDestroyed || !currentEditor.isEditable) {
          return
        }
        const imageNode = attachmentImageContent(attachmentID, file.name)
        if (typeof position === 'number') {
          const safePosition = Math.max(0, Math.min(position, currentEditor.state.doc.content.size))
          currentEditor.chain().focus().insertContentAt(safePosition, imageNode).run()
          position = safePosition + 1
        } else {
          currentEditor.chain().focus().insertContent(imageNode).run()
        }
        imageError = false
      } catch (error) {
        console.error('FLASHNOTE_IMAGE_INSERT_FAILED', error)
        imageError = true
      }
    }
  }


  $effect(() => {
    editor?.setEditable(editable, false)
    if (!editable && slashOpen) {
      closeSlash()
    }
  })

  $effect(() => {
    const currentLanguage = language
    if (editor) {
      editor.view.dom.setAttribute('aria-label', messages.sidebar.editor)
      syncTaskCheckboxLabels(editor.view.dom, currentLanguage)
    }
    const shouldUpdateSlashItems = untrack(() => slashOpen)
    if (shouldUpdateSlashItems) {
      untrack(() => {
        slashItems = filterSlashCommands(slashQuery, currentLanguage)
        if (slashSelectedIndex >= slashItems.length) {
          slashSelectedIndex = Math.max(0, slashItems.length - 1)
        }
      })
    }
  })

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          underline: false,
          link: {
            autolink: true,
            linkOnPaste: true,
            defaultProtocol: 'https',
            openOnClick: false,
            protocols: ['http', 'https'],
            isAllowedUri: (url) => isValidExternalWebUrl(url),
          },
        }),
        TaskList,
        TaskItem.configure({ getLanguage: () => language }),
        AttachmentImage,
        slashExtension,
        RichPasteNormalization,
        BubbleMenu.configure({
          pluginKey: 'formattingBubble',
          element: bubbleElement,
          updateDelay: 0,
          shouldShow: ({ editor: currentEditor, state, from, to }) => {
            if (!currentEditor.isEditable) return false
            const { doc, selection } = state
            if (selection.empty) return false
            if (!isTextSelection(selection)) return false
            if (!doc.textBetween(from, to).length) return false
            if (currentEditor.isActive('codeBlock')) return false
            return true
          },
        }),
      ],
      content: persistedDoc(),
      editable,
      onUpdate: ({ editor: updatedEditor }) => {
        onDocumentChange(
          JSON.stringify({
            schemaVersion: 1,
            doc: updatedEditor.getJSON(),
          }),
        )
      },
      editorProps: {
        handleKeyDown: (view, event) => {
          if (!editable || slashOpen || event.key !== 'Escape') {
            return false
          }
          const { selection } = view.state
          if (!isTextSelection(selection) || selection.$from.parent.type.name !== 'codeBlock') {
            return false
          }
          const position = selection.$from.before(selection.$from.depth)
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)))
          return true
        },
        attributes: {
          class: 'prose-editor',
          'aria-label': messages.sidebar.editor,
        },
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (!editable || event.button !== 0) {
              return false
            }
            const target = event.target
            if (!(target instanceof HTMLElement) || target.tagName !== 'PRE') {
              return false
            }
            const domPosition = view.posAtDOM(target, 0)
            const resolvedPosition = view.state.doc.resolve(domPosition)
            let position: number | null = null
            for (let depth = resolvedPosition.depth; depth > 0; depth--) {
              if (resolvedPosition.node(depth).type.name === 'codeBlock') {
                position = resolvedPosition.before(depth)
                break
              }
            }
            if (position === null && resolvedPosition.nodeAfter?.type.name === 'codeBlock') {
              position = domPosition
            }
            if (position === null) {
              return false
            }
            event.preventDefault()
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)))
            view.focus()
            return true
          },
          click: (_view, event) => {
            const target = event.target as HTMLElement | null
            const anchor = target?.closest('a')
            if (anchor) {
              event.preventDefault()
              const href = anchor.getAttribute('href')
              if (href) {
                void openExternalUrl(href)
              }
              return true
            }
            return false
          },
        },
        handlePaste: (_view, event) => {
          if (!editable) {
            return false
          }
          const files = droppedFiles(event.clipboardData)
          if (files.length === 0) {
            return false
          }
          event.preventDefault()
          void ingestFiles(files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          if (!editable || moved) {
            return false
          }
          const files = droppedFiles(event.dataTransfer)
          if (files.length === 0) {
            return false
          }
          event.preventDefault()
          const droppedAt = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          void ingestFiles(files, droppedAt)
          return true
        },
      },
    })

    if (acceptanceText) {
      queueMicrotask(() => {
        if (!editor) return
        void runSlashAcceptance(editor, acceptanceText, onDocumentChange)
          .then(async () => {
            const currentEditor = editor
            if (!currentEditor) {
              throw new Error('Flashnote checklist acceptance lost the editor instance')
            }
            await runChecklistInteractionAcceptance(currentEditor, acceptanceText)
            onAcceptanceReady?.()
          })
          .catch((error) => {
            console.error('FLASHNOTE_EDITOR_ACCEPTANCE_FAILURE', error)
            // Terminal acceptance failure: success-only onAcceptanceReady
            // would otherwise leave the native app alive until an external
            // timeout. Emit the existing pipeline failure marker so the
            // native runner can distinguish this from success, then hand
            // control to the App-owned fail-fast close. Ordinary
            // non-acceptance behavior is untouched (this branch only runs
            // when acceptanceText is set).
            console.error('FLASHNOTE_ACCEPTANCE_FAILURE', error)
            onAcceptanceFailed?.(error)
          })
      })
    }
  })

  onDestroy(() => {
    editor?.destroy()
    editor = null
  })
</script>

<div class="editor-host" bind:this={element}></div>
<div class="bubble-menu-wrapper" bind:this={bubbleElement}>
  <FormattingBubble {editor} {editable} {language} />
</div>
{#if slashOpen && editable}
  <SlashMenu
    items={slashItems}
    selectedIndex={slashSelectedIndex}
    x={slashX}
    y={slashY}
    {language}
    onSelect={executeSlash}
    onHover={(index) => (slashSelectedIndex = index)}
  />
{/if}
{#if imageError}
  <div class="image-error" role="status">{messages.status.imageInsertFailed}</div>
{/if}

<style>
  .bubble-menu-wrapper {
    visibility: hidden;
    opacity: 0;
    position: absolute;
  }

  .image-error {
    margin-top: 10px;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--text-muted, #7a3c32);
  }
</style>
