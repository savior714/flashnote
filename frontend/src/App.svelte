<script lang="ts">
  import { Events, Window } from '@wailsio/runtime'
  import { onMount, tick } from 'svelte'
  import {
    CreateNote,
    GetRuntimeInfo,
    ListNotes,
    OpenInitialNote,
    OpenNote,
    SaveNote,
    SearchNotes,
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
  let noteTransitionActive = false
  let saveError = ''
  let operationError = ''
  let closePromptVisible = false
  let closeRequestActive = false

  let notes: NoteSummary[] = []
  let searchOpen = false
  let searchQuery = ''
  let searchResults: SearchResult[] = []
  let searchSelectedIndex = 0
  let searchError = ''
  let searchRequestSequence = 0

  let draftSequence = 0
  let durableSequence = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let saveInFlight: Promise<boolean> | null = null
  let removeCloseListener: (() => void) | null = null

  type NoteTuple = [string, string, string, number, boolean]
  type NoteSummary = {
    id: string
    displayTitle: string
  }
  type SearchResult = {
    id: string
    displayTitle: string
    excerpt: string
  }

  function applyNote(snapshot: NoteTuple) {
    ;[noteID, title, documentJSON, revision] = snapshot
    draftSequence = 0
    durableSequence = 0
    saveError = ''
    operationError = ''
  }

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function refreshNotes() {
    const [ids, displayTitles] = (await ListNotes()) as [string[], string[]]
    if (ids.length !== displayTitles.length) {
      throw new Error('Flashnote received an invalid note list')
    }
    notes = ids.map((id, index) => ({ id, displayTitle: displayTitles[index] ?? 'Untitled' }))
  }

  async function runSearch(query = searchQuery) {
    const requestSequence = ++searchRequestSequence
    try {
      const [ids, displayTitles, excerpts] = (await SearchNotes(query)) as [string[], string[], string[]]
      if (requestSequence !== searchRequestSequence || !searchOpen) {
        return
      }
      if (ids.length !== displayTitles.length || ids.length !== excerpts.length) {
        throw new Error('Flashnote received invalid search results')
      }
      searchResults = ids.map((id, index) => ({
        id,
        displayTitle: displayTitles[index] ?? 'Untitled',
        excerpt: excerpts[index] ?? '',
      }))
      searchSelectedIndex = Math.min(searchSelectedIndex, Math.max(0, searchResults.length - 1))
      searchError = ''
    } catch (error) {
      if (requestSequence !== searchRequestSequence || !searchOpen) {
        return
      }
      searchResults = []
      searchSelectedIndex = 0
      searchError = formatError(error)
    }
  }

  async function openSearch() {
    searchOpen = true
    searchQuery = ''
    searchResults = []
    searchSelectedIndex = 0
    searchError = ''
    await tick()
    document.querySelector<HTMLInputElement>('.search-input')?.focus()
    void runSearch('')
  }

  function closeSearch() {
    searchRequestSequence += 1
    searchOpen = false
    searchQuery = ''
    searchResults = []
    searchSelectedIndex = 0
    searchError = ''
  }

  function handleSearchInput(event: Event) {
    searchQuery = (event.currentTarget as HTMLInputElement).value
    searchSelectedIndex = 0
    void runSearch(searchQuery)
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

  function promoteCurrentNoteInSidebar() {
    if (!noteID) {
      return
    }
    const current = { id: noteID, displayTitle: displayTitle() }
    notes = [current, ...notes.filter((note) => note.id !== noteID)]
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
        promoteCurrentNoteInSidebar()
        if (searchOpen) {
          void runSearch(searchQuery)
        }
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
    if (loading || noteTransitionActive) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    try {
      if (!(await flushPendingSave())) {
        return
      }
      applyNote((await CreateNote()) as NoteTuple)
      await refreshNotes()
      await tick()
      document.querySelector<HTMLInputElement>('.title')?.focus()
    } catch (error) {
      operationError = `Could not create note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function selectNote(nextNoteID: string): Promise<boolean> {
    if (loading || noteTransitionActive || !nextNoteID) {
      return false
    }
    if (nextNoteID === noteID) {
      return true
    }

    noteTransitionActive = true
    operationError = ''
    try {
      if (!(await flushPendingSave())) {
        return false
      }
      applyNote((await OpenNote(nextNoteID)) as NoteTuple)
      await tick()
      return true
    } catch (error) {
      operationError = `Could not open note: ${formatError(error)}`
      return false
    } finally {
      noteTransitionActive = false
    }
  }

  async function activateSearchResult(result: SearchResult) {
    if (await selectNote(result.id)) {
      closeSearch()
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      void openSearch()
      return
    }
    if (!searchOpen || event.isComposing) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (searchResults.length > 0) {
        searchSelectedIndex = Math.min(searchSelectedIndex + 1, searchResults.length - 1)
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (searchResults.length > 0) {
        searchSelectedIndex = Math.max(searchSelectedIndex - 1, 0)
      }
      return
    }
    if (event.key === 'Enter') {
      const selected = searchResults[searchSelectedIndex]
      if (selected) {
        event.preventDefault()
        void activateSearchResult(selected)
      }
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
        if (typeof node.text === 'string') {
          return node.text
        }
        if (Array.isArray(node.content)) {
          return node.content.map(visit).join('')
        }
        return ''
      }
      const doc = parsed.doc as { content?: unknown } | undefined
      if (!doc || !Array.isArray(doc.content)) {
        return ''
      }
      for (const block of doc.content) {
        const text = visit(block).replace(/\s+/g, ' ').trim()
        if (text) {
          return text
        }
      }
      return ''
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

  function sidebarTitle(note: NoteSummary): string {
    return note.id === noteID ? displayTitle() : note.displayTitle
  }

  async function initialise() {
    await tick()
    const shell = document.querySelector('main.shell')
    if (!shell) {
      throw new Error('Flashnote native UI did not mount')
    }

    const info = await GetRuntimeInfo()
    if (!info.databaseReady || info.schemaVersion < 3) {
      throw new Error('Flashnote runtime bridge returned invalid diagnostics')
    }

    const snapshot = (await OpenInitialNote()) as NoteTuple
    applyNote(snapshot)
    await refreshNotes()
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
    window.addEventListener('keydown', handleGlobalKeydown)
    void initialise().catch((error: unknown) => {
      loading = false
      operationError = `Flashnote could not open your note: ${formatError(error)}`
    })

    return () => {
      clearSaveTimer()
      clearRetryTimer()
      removeCloseListener?.()
      window.removeEventListener('keydown', handleGlobalKeydown)
    }
  })
</script>

<main class="shell">
  <aside class="sidebar" aria-label="Notes">
    <div class="brand-row">
      <strong>Flashnote</strong>
      <button
        class="quiet-button"
        type="button"
        aria-label="Create note"
        disabled={loading || noteTransitionActive}
        onclick={createNote}
      >+</button>
    </div>

    {#if loading}
      <div class="sidebar-placeholder">Opening…</div>
    {:else}
      <nav class="note-list" aria-label="Note list">
        {#each notes as note (note.id)}
          <button
            class="note-row"
            class:active={note.id === noteID}
            type="button"
            aria-current={note.id === noteID ? 'page' : undefined}
            disabled={noteTransitionActive}
            onclick={() => void selectNote(note.id)}
          >{sidebarTitle(note)}</button>
        {/each}
      </nav>
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
          disabled={noteTransitionActive}
          oninput={handleTitleInput}
          onkeydown={handleTitleKeydown}
        />
        {#key noteID}
          <NoteEditor
            {documentJSON}
            onDocumentChange={handleDocumentChange}
            {acceptanceText}
            editable={!noteTransitionActive}
          />
        {/key}
        {#if saveError}
          <div class="save-error" role="status" title={saveError}>
            Changes aren’t saved. Flashnote will keep retrying.
          </div>
        {/if}
        {#if operationError}
          <div class="save-error" role="status">{operationError}</div>
        {/if}
      {/if}
    </div>
  </section>
</main>

{#if searchOpen}
  <div class="search-backdrop">
    <div class="search-dialog" role="dialog" aria-modal="true" aria-label="Search notes">
      <input
        class="search-input"
        aria-label="Search notes"
        placeholder="Search notes"
        value={searchQuery}
        oninput={handleSearchInput}
      />
      <div class="search-section-label">{searchQuery.trim() ? 'Results' : 'Recently modified'}</div>
      <div class="search-results">
        {#each searchResults as result, index (result.id)}
          <button
            class="search-result"
            class:selected={index === searchSelectedIndex}
            type="button"
            onmouseenter={() => (searchSelectedIndex = index)}
            onclick={() => void activateSearchResult(result)}
          >
            <span class="search-result-title">{result.displayTitle}</span>
            {#if result.excerpt && result.excerpt !== result.displayTitle}
              <span class="search-result-excerpt">{result.excerpt}</span>
            {/if}
          </button>
        {/each}
        {#if searchError}
          <div class="search-empty" role="status">Search is unavailable right now.</div>
        {:else if searchResults.length === 0}
          <div class="search-empty">No matching notes</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

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
