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

  function repositionBubble() {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta('formattingBubble', 'updatePosition'))
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
      repositionBubble()
      inputElement?.focus()
      inputElement?.select()
    })
  }

  function handleApplyLink() {
    if (!editor || !editable || !savedRange) {
      isEditingLink = false
      void tick().then(repositionBubble)
      return
    }
    const normalized = normalizeExternalUrl(linkUrl)
    if (!normalized) {
      linkError = 'Please enter a valid web URL (http:// or https://)'
      void tick().then(repositionBubble)
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
    void tick().then(repositionBubble)
  }

  function handleRemoveLink() {
    if (!editor || !editable || !savedRange) {
      isEditingLink = false
      void tick().then(repositionBubble)
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
    void tick().then(repositionBubble)
  }

  function handleCancelLink() {
    isEditingLink = false
    linkError = ''
    if (editor && savedRange) {
      editor.chain().focus().setTextSelection(savedRange).run()
      savedRange = null
    }
    updateActiveMarks()
    void tick().then(repositionBubble)
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
    background: var(--surface-elevated);
    border: 1px solid var(--border-dialog);
    border-radius: 8px;
    box-shadow: var(--shadow-menu);
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
    color: var(--text-primary);
    font-size: 0.85rem;
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  .bubble-btn:hover {
    background: var(--surface-hover);
  }

  .bubble-btn.is-active {
    background: var(--surface-active);
    color: var(--text-primary);
    font-weight: 600;
  }

  .bubble-divider {
    width: 1px;
    height: 16px;
    background: var(--border-subtle);
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
    font-family: var(--font-mono, monospace);
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
    border: 1px solid var(--border-input);
    border-radius: 4px;
    background: var(--surface-app);
    color: var(--text-primary);
    outline: none;
  }

  .link-input:focus {
    border-color: var(--border-input-focus);
    box-shadow: 0 0 0 1px var(--border-input-focus);
  }

  .link-btn {
    padding: 4px 8px;
    font-size: 0.82rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    line-height: 1.2;
    transition: background-color 0.1s ease;
  }

  .link-btn:hover {
    background: var(--surface-hover);
  }

  .link-apply-btn {
    background: var(--surface-active);
    font-weight: 600;
  }

  .link-apply-btn:hover {
    background: var(--surface-hover);
  }

  .link-remove-btn {
    color: var(--danger-text-strong);
  }

  .link-remove-btn:hover {
    background: var(--danger-bg);
  }

  .link-error {
    font-size: 0.75rem;
    color: var(--danger-text-strong);
    padding: 0 4px;
    line-height: 1.3;
  }
</style>
