<script lang="ts">
  import type { Editor } from '@tiptap/core'
  import { onDestroy, onMount, tick } from 'svelte'
  import { normalizeExternalUrl } from './linkHelper'

  type Props = {
    editor: Editor | null
    editable?: boolean
  }

  let { editor, editable = true }: Props = $props()

  let isBold = $state(false)
  let isItalic = $state(false)
  let isStrike = $state(false)
  let isCode = $state(false)
  let isLink = $state(false)

  let isEditingLink = $state(false)
  let linkUrl = $state('')
  let linkError = $state('')
  let savedRange = $state<{ from: number; to: number } | null>(null)
  let inputElement = $state<HTMLInputElement | null>(null)

  function updateActiveMarks() {
    if (!editor || editor.isDestroyed) return
    isBold = editor.isActive('bold')
    isItalic = editor.isActive('italic')
    isStrike = editor.isActive('strike')
    isCode = editor.isActive('code')
    isLink = editor.isActive('link')

    if (!isEditingLink) {
      linkError = ''
    }
  }

  function handleBold() {
    if (!editor || !editable) return
    editor.chain().focus().toggleBold().run()
    updateActiveMarks()
  }

  function handleItalic() {
    if (!editor || !editable) return
    editor.chain().focus().toggleItalic().run()
    updateActiveMarks()
  }

  function handleStrike() {
    if (!editor || !editable) return
    editor.chain().focus().toggleStrike().run()
    updateActiveMarks()
  }

  function handleCode() {
    if (!editor || !editable) return
    editor.chain().focus().toggleCode().run()
    updateActiveMarks()
  }

  function handleStartLink() {
    if (!editor || !editable) return
    const { from, to } = editor.state.selection
    savedRange = { from, to }
    const existingHref = (editor.getAttributes('link').href as string) || ''
    linkUrl = existingHref
    linkError = ''
    isEditingLink = true

    void tick().then(() => {
      inputElement?.focus()
      inputElement?.select()
    })
  }

  function handleApplyLink() {
    if (!editor || !editable || !savedRange) {
      isEditingLink = false
      return
    }
    const normalized = normalizeExternalUrl(linkUrl)
    if (!normalized) {
      linkError = 'Please enter a valid web URL (http:// or https://)'
      return
    }

    editor
      .chain()
      .focus()
      .setTextSelection(savedRange)
      .setLink({ href: normalized })
      .run()

    isEditingLink = false
    linkError = ''
    savedRange = null
    updateActiveMarks()
  }

  function handleRemoveLink() {
    if (!editor || !editable || !savedRange) {
      isEditingLink = false
      return
    }
    editor
      .chain()
      .focus()
      .setTextSelection(savedRange)
      .unsetLink()
      .run()

    isEditingLink = false
    linkError = ''
    savedRange = null
    updateActiveMarks()
  }

  function handleCancelLink() {
    isEditingLink = false
    linkError = ''
    if (editor && savedRange) {
      editor.chain().focus().setTextSelection(savedRange).run()
      savedRange = null
    }
    updateActiveMarks()
  }

  function handleInputKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleApplyLink()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelLink()
    }
  }

  $effect(() => {
    if (editor) {
      updateActiveMarks()
      editor.on('transaction', updateActiveMarks)
      editor.on('selectionUpdate', updateActiveMarks)
      return () => {
        editor.off('transaction', updateActiveMarks)
        editor.off('selectionUpdate', updateActiveMarks)
      }
    }
  })
</script>

<div
  class="formatting-bubble"
  role="toolbar"
  aria-label="Formatting"
  tabindex="-1"
  onmousedown={(e) => {
    // Prevent focus loss from the editor selection unless interacting with the link input
    if ((e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault()
    }
  }}
>
  {#if !isEditingLink}
    <div class="bubble-actions">
      <button
        type="button"
        class="bubble-btn bubble-btn-bold"
        class:is-active={isBold}
        aria-label="Bold"
        aria-pressed={isBold}
        onclick={handleBold}
      >
        <span class="btn-text bold-text">B</span>
      </button>
      <button
        type="button"
        class="bubble-btn bubble-btn-italic"
        class:is-active={isItalic}
        aria-label="Italic"
        aria-pressed={isItalic}
        onclick={handleItalic}
      >
        <span class="btn-text italic-text">I</span>
      </button>
      <button
        type="button"
        class="bubble-btn bubble-btn-strike"
        class:is-active={isStrike}
        aria-label="Strike"
        aria-pressed={isStrike}
        onclick={handleStrike}
      >
        <span class="btn-text strike-text">S</span>
      </button>
      <button
        type="button"
        class="bubble-btn bubble-btn-code"
        class:is-active={isCode}
        aria-label="Inline code"
        aria-pressed={isCode}
        onclick={handleCode}
      >
        <span class="btn-text code-text">&lt;/&gt;</span>
      </button>
      <div class="bubble-divider"></div>
      <button
        type="button"
        class="bubble-btn bubble-btn-link"
        class:is-active={isLink}
        aria-label="Link"
        aria-pressed={isLink}
        onclick={handleStartLink}
      >
        <span class="btn-text">Link</span>
      </button>
    </div>
  {:else}
    <div class="link-edit-panel">
      <div class="link-input-row">
        <input
          bind:this={inputElement}
          type="text"
          class="link-input"
          placeholder="https://example.com"
          aria-label="Link URL"
          bind:value={linkUrl}
          onkeydown={handleInputKeyDown}
        />
        <button
          type="button"
          class="link-btn link-apply-btn"
          aria-label="Apply link"
          onclick={handleApplyLink}
        >
          Apply
        </button>
        {#if isLink}
          <button
            type="button"
            class="link-btn link-remove-btn"
            aria-label="Remove link"
            onclick={handleRemoveLink}
          >
            Remove
          </button>
        {/if}
        <button
          type="button"
          class="link-btn link-cancel-btn"
          aria-label="Cancel link"
          onclick={handleCancelLink}
        >
          Cancel
        </button>
      </div>
      {#if linkError}
        <div class="link-error" role="alert">{linkError}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .formatting-bubble {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border: 1px solid rgba(41, 40, 36, 0.12);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 3px;
    user-select: none;
    z-index: 1000;
  }

  .bubble-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .bubble-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #292824;
    font-size: 0.85rem;
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  .bubble-btn:hover {
    background: rgba(41, 40, 36, 0.08);
  }

  .bubble-btn.is-active {
    background: rgba(41, 40, 36, 0.12);
    color: #1a1917;
    font-weight: 600;
  }

  .bubble-divider {
    width: 1px;
    height: 16px;
    background: rgba(41, 40, 36, 0.12);
    margin: 0 2px;
  }

  .btn-text {
    font-size: 0.85rem;
  }

  .bold-text {
    font-weight: 700;
    font-family: serif;
  }

  .italic-text {
    font-style: italic;
    font-family: serif;
  }

  .strike-text {
    text-decoration: line-through;
  }

  .code-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
  }

  .link-edit-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px;
  }

  .link-input-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .link-input {
    width: 200px;
    padding: 4px 8px;
    font-size: 0.85rem;
    border: 1px solid rgba(41, 40, 36, 0.2);
    border-radius: 4px;
    background: #ffffff;
    color: #292824;
    outline: none;
  }

  .link-input:focus {
    border-color: rgba(41, 40, 36, 0.5);
    box-shadow: 0 0 0 1px rgba(41, 40, 36, 0.3);
  }

  .link-btn {
    padding: 4px 8px;
    font-size: 0.82rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: #292824;
    cursor: pointer;
    line-height: 1.2;
    transition: background-color 0.1s ease;
  }

  .link-btn:hover {
    background: rgba(41, 40, 36, 0.08);
  }

  .link-apply-btn {
    background: rgba(41, 40, 36, 0.1);
    font-weight: 600;
  }

  .link-apply-btn:hover {
    background: rgba(41, 40, 36, 0.16);
  }

  .link-remove-btn {
    color: #b3261e;
  }

  .link-remove-btn:hover {
    background: rgba(179, 38, 30, 0.08);
  }

  .link-error {
    font-size: 0.75rem;
    color: #b3261e;
    padding: 0 4px;
    line-height: 1.3;
  }

  @media (prefers-color-scheme: dark) {
    .formatting-bubble {
      background: #25231f;
      border-color: rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }

    .bubble-btn {
      color: #e9e6df;
    }

    .bubble-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .bubble-btn.is-active {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
    }

    .bubble-divider {
      background: rgba(255, 255, 255, 0.12);
    }

    .link-input {
      background: #1a1917;
      border-color: rgba(255, 255, 255, 0.2);
      color: #e9e6df;
    }

    .link-input:focus {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
    }

    .link-btn {
      color: #e9e6df;
    }

    .link-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .link-apply-btn {
      background: rgba(255, 255, 255, 0.14);
      color: #ffffff;
    }

    .link-apply-btn:hover {
      background: rgba(255, 255, 255, 0.22);
    }

    .link-remove-btn {
      color: #ff8a80;
    }

    .link-remove-btn:hover {
      background: rgba(255, 138, 128, 0.12);
    }

    .link-error {
      color: #ff8a80;
    }
  }
</style>
