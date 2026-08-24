<script lang="ts">
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { onDestroy, onMount } from 'svelte'

  let element!: HTMLDivElement
  let editor = $state<Editor | null>(null)

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          underline: false,
        }),
      ],
      content: '<p></p>',
      editorProps: {
        attributes: {
          class: 'prose-editor',
          spellcheck: 'true',
        },
      },
    })
  })

  onDestroy(() => {
    editor?.destroy()
    editor = null
  })
</script>

<div class="editor-host" bind:this={element}></div>
