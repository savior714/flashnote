<script lang="ts">
  import { Events, Window } from '@wailsio/runtime'
  import { onMount, tick } from 'svelte'
  import {
    CreateNote,
    GetRuntimeInfo,
    OpenInitialNote,
    SaveNote,
  } from '../bindings/github.com/savior714/flashnote/appservice'
  import NoteEditor from './lib/NoteEditor.svelte'

  const autosaveDelayMs = 400
  const retryDelayMs = 1500
  const acceptanceText = import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_TEXT ?? ''

  let noteID = ''
  let title = ''
  let documentJSON = ''
  let revision = 0
  let loading = true
  let saveError = ''
  let closePromptVisible = false
  let closeRequestActive = false

  let draftSequence = 0
  let durableSequence = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let saveInFlight: Promise<boolean> | null = null
  let removeCloseListener: (() => void) | null = null

  type NoteTuple = [string, string, string, number, boolean]

  function applyNote(snapshot: NoteTuple) {
    ;[noteID, title, documentJSON, revision] = snapshot
    draftSequence = 0
    durableSequence = 0
    saveError = ''
  }

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function clearSaveTimer() {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
  }

  function clearRetryTimer() {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  function scheduleSave(delay = autosaveDelayMs) {
    clearSaveTimer()
    if (!noteID || durableSequence >= draftSequence) {
      return
    }
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void persistLatest()
    }, delay)
  }

  function scheduleRetry() {
    clearRetryTimer()
    if (!noteID || durableSequence >= draftSequence) {
      return
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void persistLatest()
    }, retryDelayMs)
  }

  async function persistLatest(): Promise<boolean> {
    if (!noteID || durableSequence >= draftSequence) {
      return true
    }

    if (saveInFlight) {
      const priorSucceeded = await saveInFlight
      if (!priorSucceeded) {
        return false
      }
      return durableSequence >= draftSequence ? true : persistLatest()
    }

    const capturedID = noteID
    const capturedTitle = title
    const capturedDocument = documentJSON
    const capturedRevision = revision
    const capturedSequence = draftSequence

    const operation = SaveNote(
      capturedID,
      capturedTitle,
      capturedDocument,
      capturedRevision,
    )
      .then((newRevision) => {
        if (noteID !== capturedID) {
          return false
        }
        revision = newRevision
        durableSequence = Math.max(durableSequence, capturedSequence)
        saveError = ''
        clearRetryTimer()
        if (durableSequence < draftSequence) {
          scheduleSave(0)
        }
        return true
      })
      .catch((error: unknown) => {
        if (noteID === capturedID) {
          saveError = formatError(error)
          scheduleRetry()
        }
        return false
      })
      .finally(() => {
        saveInFlight = null
      })

    saveInFlight = operation
    return operation
  }

  async function flushPendingSave(): Promise<boolean> {
    clearSaveTimer()
    clearRetryTimer()

    while (durableSequence < draftSequence) {
      const saved = await persistLatest()
      if (!saved) {
        return false
      }
    }
    return true
  }

  function markDirty() {
    draftSequence += 1
    scheduleSave()
  }

  function handleDocumentChange(nextDocumentJSON: string) {
    documentJSON = nextDocumentJSON
    markDirty()
  }

  function handleTitleInput(event: Event) {
    title = (event.currentTarget as HTMLInputElement).value
    markDirty()
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    document.querySelector<HTMLElement>('.prose-editor')?.focus()
  }

  async function createNote() {
    if (loading) {
      return
    }
    if (!(await flushPendingSave())) {
      return
    }

    loading = true
    try {
      applyNote((await CreateNote()) as NoteTuple)
      loading = false
      await tick()
      document.querySelector<HTMLInputElement>('.title')?.focus()
    } catch (error) {
      loading = false
      saveError = `Could not create note: ${formatError(error)}`
    }
  }

  async function handleCloseRequested() {
    if (closeRequestActive) {
      return
    }
    closeRequestActive = true
    try {
      if (await flushPendingSave()) {
        await Events.Emit('flashnote:close-approved', null)
        return
      }
      closePromptVisible = true
    } finally {
      closeRequestActive = false
    }
  }

  async function retryClose() {
    closePromptVisible = false
    if (await flushPendingSave()) {
      await Events.Emit('flashnote:close-approved', null)
      return
    }
    closePromptVisible = true
  }

  async function discardAndExit() {
    closePromptVisible = false
    await Events.Emit('flashnote:close-discard', null)
  }

  function derivedBodyTitle(): string {
    if (!documentJSON) {
      return ''
    }
    try {
      const parsed = JSON.parse(documentJSON) as { doc?: unknown }
      const visit = (value: unknown): string => {
        if (!value || typeof value !== 'object') {
          return ''
        }
        const node = value as { text?: unknown; content?: unknown }
        if (typeof node.text === 'string' && node.text.trim()) {
          return node.text.trim()
        }
        if (Array.isArray(node.content)) {
          for (const child of node.content) {
            const text = visit(child)
            if (text) {
              return text
            }
          }
        }
        return ''
      }
      return visit(parsed.doc)
    } catch {
      return ''
    }
  }

  function displayTitle(): string {
    const explicit = title.trim()
    if (explicit) {
      return explicit
    }
    const derived = derivedBodyTitle()
    return derived || 'Untitled'
  }

  async function initialise() {
    await tick()
    const shell = document.querySelector('main.shell')
    if (!shell) {
      throw new Error('Flashnote native UI did not mount')
    }

    const info = await GetRuntimeInfo()
    if (!info.databaseReady || info.schemaVersion < 2) {
      throw new Error('Flashnote runtime bridge returned invalid diagnostics')
    }

    const snapshot = (await OpenInitialNote()) as NoteTuple
    applyNote(snapshot)
    loading = false
    await tick()

    if (snapshot[4]) {
      document.querySelector<HTMLInputElement>('.title')?.focus()
    }

    removeCloseListener = Events.On('flashnote:close-requested', () => {
      void handleCloseRequested()
    })
    await Events.Emit('flashnote:frontend-ready', null)

    if (acceptanceText) {
      setTimeout(() => {
        void Window.Close()
      }, 550)
    }
  }

  onMount(() => {
    void initialise().catch((error: unknown) => {
      loading = false
      saveError = `Flashnote could not open your note: ${formatError(error)}`
    })

    return () => {
      clearSaveTimer()
      clearRetryTimer()
      removeCloseListener?.()
    }
  })
</script>

<main class="shell">
  <aside class="sidebar" aria-label="Notes">
    <div class="brand-row">
      <strong>Flashnote</strong>
      <button class="quiet-button" type="button" aria-label="Create note" onclick={createNote}>+</button>
    </div>

    {#if loading}
      <div class="sidebar-placeholder">Opening…</div>
    {:else}
      <div class="note-row active" aria-current="page">{displayTitle()}</div>
    {/if}

    <div class="trash-row">Trash</div>
  </aside>

  <section class="document" aria-label="Editor">
    <div class="document-inner">
      {#if loading}
        <div class="editor-loading">Opening note…</div>
      {:else if noteID}
        <input
          class="title"
          aria-label="Note title"
          placeholder="Untitled"
          value={title}
          oninput={handleTitleInput}
          onkeydown={handleTitleKeydown}
        />
        {#key noteID}
          <NoteEditor
            {documentJSON}
            onDocumentChange={handleDocumentChange}
            {acceptanceText}
          />
        {/key}
        {#if saveError}
          <div class="save-error" role="status">
            Changes aren’t saved. Flashnote will keep retrying.
          </div>
        {/if}
      {/if}
    </div>
  </section>
</main>

{#if closePromptVisible}
  <div class="modal-backdrop" role="presentation">
    <section class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title">
      <h2 id="close-title">Changes aren’t saved</h2>
      <p>Flashnote couldn’t save your latest changes. Retry saving, keep the window open, or discard those unsaved changes and exit.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (closePromptVisible = false)}>Cancel</button>
        <button type="button" class="secondary-button" onclick={retryClose}>Retry saving</button>
        <button type="button" class="danger-button" onclick={discardAndExit}>Discard &amp; exit</button>
      </div>
    </section>
  </div>
{/if}
