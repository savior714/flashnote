<script lang="ts">
  import { Editor, type JSONContent } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { onDestroy, onMount } from 'svelte'

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
        editor?.commands.insertContent(acceptanceText)
      })
    }
  })

  onDestroy(() => {
    editor?.destroy()
    editor = null
  })
</script>

<div class="editor-host" bind:this={element}></div>
