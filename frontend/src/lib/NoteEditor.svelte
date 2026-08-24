<script lang="ts">
  import { Editor, type JSONContent } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { onDestroy, onMount } from 'svelte'
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
