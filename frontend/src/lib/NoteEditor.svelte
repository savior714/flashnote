<script lang="ts">
  import { Editor, type JSONContent } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { onDestroy, onMount } from 'svelte'
  import { IngestImage } from '../../bindings/github.com/savior714/flashnote/appservice'
  import { AttachmentImage, attachmentImageContent } from './attachmentImage'
  import { TaskItem, TaskList } from './taskList'

  type Props = {
    documentJSON: string
    onDocumentChange: (documentJSON: string) => void
    acceptanceText?: string
    editable?: boolean
  }

  let { documentJSON, onDocumentChange, acceptanceText = '', editable = true }: Props = $props()
  let element!: HTMLDivElement
  let editor = $state<Editor | null>(null)
  let imageError = $state('')

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

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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
    return Array.from(dataTransfer.files).filter(isImageCandidate)
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
        imageError = ''
      } catch (error) {
        imageError = `Could not insert image: ${formatError(error)}`
      }
    }
  }

  $effect(() => {
    editor?.setEditable(editable, false)
  })

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          underline: false,
        }),
        TaskList,
        TaskItem,
        AttachmentImage,
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
        attributes: {
          class: 'prose-editor',
          spellcheck: 'true',
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
        editor?.commands.insertContent({
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: acceptanceText }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Completed checklist item' }],
                },
              ],
            },
          ],
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
{#if imageError}
  <div class="image-error" role="status">{imageError}</div>
{/if}

<style>
  .image-error {
    margin-top: 10px;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--text-muted, #7a3c32);
  }
</style>
