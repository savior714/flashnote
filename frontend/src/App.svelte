<script lang="ts">
  import { Events, Window } from '@wailsio/runtime'
  import { onMount, tick } from 'svelte'
  import {
    CreateFolder,
    CreateNote,
    CreateNoteInFolder,
    GetRuntimeInfo,
    ListFolderNotes,
    ListFolders,
    ListRootNotes,
    ListTrashNotes,
    MoveNote,
    MoveNoteToTrash,
    OpenInitialNote,
    OpenNote,
    OpenTrashNote,
    PermanentlyDeleteNote,
    RestoreNote,
    SaveNote,
    SearchNotes,
  } from '../bindings/github.com/savior714/flashnote/appservice'
  import NoteEditor from './lib/NoteEditor.svelte'

  const autosaveDelayMs = 400
  const retryDelayMs = 1500
  const undoDelayMs = 6000
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

  let rootNotes: NoteSummary[] = []
  let folders: FolderSummary[] = []
  let currentFolderID = ''
  let expandedFolderIDs: string[] = []
  let createMenuOpen = false
  let folderNaming = false
  let newFolderName = ''
  let contextNoteID = ''
  let contextMenuX = 0
  let contextMenuY = 0

  let trashView = false
  let trashNotes: NoteSummary[] = []
  let permanentDeleteTargetID = ''
  let undoTrashNoteID = ''
  let undoTimer: ReturnType<typeof setTimeout> | undefined

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
  type FolderSummary = {
    id: string
    name: string
    notes: NoteSummary[]
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

  function clearOpenedNote() {
    noteID = ''
    title = ''
    documentJSON = ''
    revision = 0
    draftSequence = 0
    durableSequence = 0
    saveError = ''
  }

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function noteSummaries(ids: string[], displayTitles: string[]): NoteSummary[] {
    if (ids.length !== displayTitles.length) {
      throw new Error('Flashnote received an invalid note list')
    }
    return ids.map((id, index) => ({ id, displayTitle: displayTitles[index] ?? 'Untitled' }))
  }

  async function refreshSidebar() {
    const [rootTuple, folderTuple] = await Promise.all([ListRootNotes(), ListFolders()])
    const [rootIDs, rootTitles] = rootTuple as [string[], string[]]
    const [folderIDs, folderNames] = folderTuple as [string[], string[]]
    if (folderIDs.length !== folderNames.length) {
      throw new Error('Flashnote received an invalid folder list')
    }

    const nextFolders = await Promise.all(
      folderIDs.map(async (id, index) => {
        const [ids, titles] = (await ListFolderNotes(id)) as [string[], string[]]
        return {
          id,
          name: folderNames[index] ?? '',
          notes: noteSummaries(ids, titles),
        }
      }),
    )

    rootNotes = noteSummaries(rootIDs, rootTitles)
    folders = nextFolders

    if (trashView) {
      currentFolderID = ''
      return
    }

    let locatedFolderID = ''
    for (const folder of nextFolders) {
      if (folder.notes.some((note) => note.id === noteID)) {
        locatedFolderID = folder.id
        break
      }
    }
    currentFolderID = locatedFolderID
    if (locatedFolderID && !expandedFolderIDs.includes(locatedFolderID)) {
      expandedFolderIDs = [...expandedFolderIDs, locatedFolderID]
    }
  }

  async function refreshTrash() {
    const [ids, displayTitles] = (await ListTrashNotes()) as [string[], string[]]
    trashNotes = noteSummaries(ids, displayTitles)
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
    createMenuOpen = false
    contextNoteID = ''
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

  function clearUndoTimer() {
    if (undoTimer !== undefined) {
      clearTimeout(undoTimer)
      undoTimer = undefined
    }
  }

  function scheduleSave(delay = autosaveDelayMs) {
    clearSaveTimer()
    if (!noteID || trashView || durableSequence >= draftSequence) {
      return
    }
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void persistLatest()
    }, delay)
  }

  function scheduleRetry() {
    clearRetryTimer()
    if (!noteID || trashView || durableSequence >= draftSequence) {
      return
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void persistLatest()
    }, retryDelayMs)
  }

  async function persistLatest(): Promise<boolean> {
    if (!noteID || trashView || durableSequence >= draftSequence) {
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
        if (noteID !== capturedID || trashView) {
          return false
        }
        revision = newRevision
        durableSequence = Math.max(durableSequence, capturedSequence)
        saveError = ''
        clearRetryTimer()
        void refreshSidebar().catch((error: unknown) => {
          operationError = `Could not refresh notes: ${formatError(error)}`
        })
        if (searchOpen) {
          void runSearch(searchQuery)
        }
        if (durableSequence < draftSequence) {
          scheduleSave(0)
        }
        return true
      })
      .catch((error: unknown) => {
        if (noteID === capturedID && !trashView) {
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

    while (!trashView && durableSequence < draftSequence) {
      const saved = await persistLatest()
      if (!saved) {
        return false
      }
    }
    return true
  }

  function markDirty() {
    if (trashView) {
      return
    }
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

  function toggleCreateMenu() {
    if (trashView) {
      return
    }
    createMenuOpen = !createMenuOpen
    contextNoteID = ''
  }

  async function beginFolderNaming() {
    createMenuOpen = false
    folderNaming = true
    newFolderName = ''
    await tick()
    document.querySelector<HTMLInputElement>('.new-folder-input')?.focus()
  }

  async function commitNewFolder() {
    if (!folderNaming) {
      return
    }
    const name = newFolderName.trim()
    folderNaming = false
    newFolderName = ''
    if (!name) {
      return
    }
    try {
      const [folderID] = (await CreateFolder(name)) as [string, string]
      if (!expandedFolderIDs.includes(folderID)) {
        expandedFolderIDs = [...expandedFolderIDs, folderID]
      }
      await refreshSidebar()
    } catch (error) {
      operationError = `Could not create folder: ${formatError(error)}`
    }
  }

  function handleFolderNameKeydown(event: KeyboardEvent) {
    if (event.isComposing) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitNewFolder()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      folderNaming = false
      newFolderName = ''
    }
  }

  async function createNote() {
    if (loading || noteTransitionActive || trashView) {
      return
    }

    createMenuOpen = false
    noteTransitionActive = true
    operationError = ''
    try {
      if (!(await flushPendingSave())) {
        return
      }
      const snapshot = currentFolderID
        ? ((await CreateNoteInFolder(currentFolderID)) as NoteTuple)
        : ((await CreateNote()) as NoteTuple)
      trashView = false
      applyNote(snapshot)
      await refreshSidebar()
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
    if (!trashView && nextNoteID === noteID) {
      return true
    }

    noteTransitionActive = true
    operationError = ''
    try {
      if (!(await flushPendingSave())) {
        return false
      }
      const snapshot = (await OpenNote(nextNoteID)) as NoteTuple
      trashView = false
      applyNote(snapshot)
      await refreshSidebar()
      await tick()
      return true
    } catch (error) {
      operationError = `Could not open note: ${formatError(error)}`
      return false
    } finally {
      noteTransitionActive = false
    }
  }

  async function enterTrashView() {
    if (loading || noteTransitionActive) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    createMenuOpen = false
    contextNoteID = ''
    closeSearch()
    try {
      if (!trashView && !(await flushPendingSave())) {
        return
      }
      trashView = true
      currentFolderID = ''
      await refreshTrash()
      if (trashNotes.length > 0) {
        applyNote((await OpenTrashNote(trashNotes[0].id)) as NoteTuple)
      } else {
        clearOpenedNote()
      }
    } catch (error) {
      operationError = `Could not open Trash: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function selectTrashNote(nextNoteID: string) {
    if (!trashView || loading || noteTransitionActive || !nextNoteID || nextNoteID === noteID) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    try {
      applyNote((await OpenTrashNote(nextNoteID)) as NoteTuple)
    } catch (error) {
      operationError = `Could not open trashed note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  function toggleFolder(folderID: string) {
    expandedFolderIDs = expandedFolderIDs.includes(folderID)
      ? expandedFolderIDs.filter((id) => id !== folderID)
      : [...expandedFolderIDs, folderID]
  }

  function openNoteContext(event: MouseEvent, targetNoteID: string) {
    if (trashView) {
      return
    }
    event.preventDefault()
    createMenuOpen = false
    contextNoteID = targetNoteID
    contextMenuX = Math.min(event.clientX, window.innerWidth - 190)
    contextMenuY = Math.min(event.clientY, window.innerHeight - 260)
  }

  function folderForNote(targetNoteID: string): string {
    for (const folder of folders) {
      if (folder.notes.some((note) => note.id === targetNoteID)) {
        return folder.id
      }
    }
    return ''
  }

  function preferredSurvivor(targetNoteID: string, sourceFolderID: string): string {
    const sameLocation = sourceFolderID
      ? folders.find((folder) => folder.id === sourceFolderID)?.notes ?? []
      : rootNotes
    const sameLocationSurvivor = sameLocation.find((note) => note.id !== targetNoteID)
    if (sameLocationSurvivor) {
      return sameLocationSurvivor.id
    }
    for (const note of rootNotes) {
      if (note.id !== targetNoteID) {
        return note.id
      }
    }
    for (const folder of folders) {
      for (const note of folder.notes) {
        if (note.id !== targetNoteID) {
          return note.id
        }
      }
    }
    return ''
  }

  async function moveContextNote(targetFolderID: string) {
    const targetNoteID = contextNoteID
    if (!targetNoteID || noteTransitionActive || folderForNote(targetNoteID) === targetFolderID) {
      contextNoteID = ''
      return
    }

    contextNoteID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      if (targetNoteID === noteID && !(await flushPendingSave())) {
        return
      }
      await MoveNote(targetNoteID, targetFolderID)
      await refreshSidebar()
    } catch (error) {
      operationError = `Could not move note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  function offerTrashUndo(targetNoteID: string) {
    clearUndoTimer()
    undoTrashNoteID = targetNoteID
    undoTimer = setTimeout(() => {
      undoTrashNoteID = ''
      undoTimer = undefined
    }, undoDelayMs)
  }

  async function moveContextNoteToTrash() {
    const targetNoteID = contextNoteID
    if (!targetNoteID || noteTransitionActive || trashView) {
      contextNoteID = ''
      return
    }

    const sourceFolderID = folderForNote(targetNoteID)
    const survivorID = preferredSurvivor(targetNoteID, sourceFolderID)
    const wasCurrent = targetNoteID === noteID
    contextNoteID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      if (wasCurrent && !(await flushPendingSave())) {
        return
      }
      await MoveNoteToTrash(targetNoteID)
      offerTrashUndo(targetNoteID)
      await Promise.all([refreshSidebar(), refreshTrash()])

      if (wasCurrent) {
        if (survivorID) {
          trashView = false
          applyNote((await OpenNote(survivorID)) as NoteTuple)
        } else {
          const snapshot = sourceFolderID
            ? ((await CreateNoteInFolder(sourceFolderID)) as NoteTuple)
            : ((await CreateNote()) as NoteTuple)
          trashView = false
          applyNote(snapshot)
          await tick()
          document.querySelector<HTMLInputElement>('.title')?.focus()
        }
        await refreshSidebar()
      }
    } catch (error) {
      operationError = `Could not move note to Trash: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function undoTrash() {
    const targetNoteID = undoTrashNoteID
    if (!targetNoteID || noteTransitionActive) {
      return
    }

    clearUndoTimer()
    undoTrashNoteID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      await RestoreNote(targetNoteID)
      if (trashView && noteID === targetNoteID) {
        const snapshot = (await OpenNote(targetNoteID)) as NoteTuple
        trashView = false
        applyNote(snapshot)
      }
      await Promise.all([refreshSidebar(), refreshTrash()])
    } catch (error) {
      operationError = `Could not restore note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function restoreCurrentTrash() {
    if (!trashView || !noteID || noteTransitionActive) {
      return
    }

    const targetNoteID = noteID
    noteTransitionActive = true
    operationError = ''
    try {
      await RestoreNote(targetNoteID)
      const snapshot = (await OpenNote(targetNoteID)) as NoteTuple
      trashView = false
      applyNote(snapshot)
      await Promise.all([refreshSidebar(), refreshTrash()])
    } catch (error) {
      operationError = `Could not restore note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function confirmPermanentDelete() {
    const targetNoteID = permanentDeleteTargetID
    if (!targetNoteID || !trashView || noteTransitionActive) {
      return
    }

    permanentDeleteTargetID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      await PermanentlyDeleteNote(targetNoteID)
      await refreshTrash()
      if (noteID === targetNoteID) {
        if (trashNotes.length > 0) {
          applyNote((await OpenTrashNote(trashNotes[0].id)) as NoteTuple)
        } else {
          clearOpenedNote()
        }
      }
      await refreshSidebar()
    } catch (error) {
      operationError = `Could not permanently delete note: ${formatError(error)}`
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

  function handleWindowClick(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target?.closest('.create-controls')) {
      createMenuOpen = false
    }
    if (!target?.closest('.note-context-menu')) {
      contextNoteID = ''
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

  async function runAcceptanceTrashLifecycle() {
    if (!(await flushPendingSave())) {
      throw new Error('acceptance save flush failed')
    }
    const expectedID = noteID
    const [folderID] = (await CreateFolder('Acceptance Folder')) as [string, string]
    await MoveNote(expectedID, folderID)
    await MoveNoteToTrash(expectedID)

    const [trashIDs] = (await ListTrashNotes()) as [string[], string[]]
    if (!trashIDs.includes(expectedID)) {
      throw new Error('acceptance Trash listing missed note')
    }
    const [hiddenIDs] = (await SearchNotes('Flashnote')) as [string[], string[], string[]]
    if (hiddenIDs.includes(expectedID)) {
      throw new Error('acceptance Search exposed trashed note')
    }
    const trashSnapshot = (await OpenTrashNote(expectedID)) as NoteTuple
    if (trashSnapshot[0] !== expectedID) {
      throw new Error('acceptance trash open mismatch')
    }

    await RestoreNote(expectedID)
    const restoredSnapshot = (await OpenNote(expectedID)) as NoteTuple
    const [restoredIDs] = (await SearchNotes('Flashnote')) as [string[], string[], string[]]
    if (!restoredIDs.includes(expectedID)) {
      throw new Error('acceptance Search missed restored note')
    }
    trashView = false
    applyNote(restoredSnapshot)
    await refreshSidebar()
  }

  async function initialise() {
    await tick()
    const shell = document.querySelector('main.shell')
    if (!shell) {
      throw new Error('Flashnote native UI did not mount')
    }

    const info = await GetRuntimeInfo()
    if (!info.databaseReady || info.schemaVersion < 5) {
      throw new Error('Flashnote runtime bridge returned invalid diagnostics')
    }

    const snapshot = (await OpenInitialNote()) as NoteTuple
    trashView = false
    applyNote(snapshot)
    await refreshSidebar()
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
        void (async () => {
          try {
            await runAcceptanceTrashLifecycle()
          } catch (error) {
            console.error('FLASHNOTE_ACCEPTANCE_TRASH_FAILURE', error)
          } finally {
            await Window.Close()
          }
        })()
      }, 550)
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
    window.addEventListener('click', handleWindowClick)
    void initialise().catch((error: unknown) => {
      loading = false
      operationError = `Flashnote could not open your note: ${formatError(error)}`
    })

    return () => {
      clearSaveTimer()
      clearRetryTimer()
      clearUndoTimer()
      removeCloseListener?.()
      window.removeEventListener('keydown', handleGlobalKeydown)
      window.removeEventListener('click', handleWindowClick)
    }
  })
</script>

<main class="shell">
  <aside class="sidebar" aria-label="Notes">
    <div class="brand-row">
      <strong>Flashnote</strong>
      <div class="create-controls">
        <button
          class="quiet-button"
          type="button"
          aria-label="Create"
          aria-expanded={createMenuOpen}
          disabled={loading || noteTransitionActive || trashView}
          onclick={toggleCreateMenu}
        >+</button>
        {#if createMenuOpen}
          <div class="sidebar-menu create-menu">
            <button type="button" onclick={() => void createNote()}>New note</button>
            <button type="button" onclick={() => void beginFolderNaming()}>New folder</button>
          </div>
        {/if}
      </div>
    </div>

    {#if loading}
      <div class="sidebar-placeholder">Opening…</div>
    {:else if trashView}
      <nav class="note-list trash-list" aria-label="Trash notes">
        <div class="trash-heading">Trash</div>
        {#each trashNotes as note (note.id)}
          <button
            class="note-row"
            class:active={note.id === noteID}
            type="button"
            aria-current={note.id === noteID ? 'page' : undefined}
            disabled={noteTransitionActive}
            onclick={() => void selectTrashNote(note.id)}
          >{sidebarTitle(note)}</button>
        {/each}
        {#if trashNotes.length === 0}
          <div class="sidebar-placeholder">Trash is empty</div>
        {/if}
      </nav>
    {:else}
      <nav class="note-list" aria-label="Note list">
        {#each rootNotes as note (note.id)}
          <button
            class="note-row"
            class:active={note.id === noteID}
            type="button"
            aria-current={note.id === noteID ? 'page' : undefined}
            disabled={noteTransitionActive}
            onclick={() => void selectNote(note.id)}
            oncontextmenu={(event) => openNoteContext(event, note.id)}
          >{sidebarTitle(note)}</button>
        {/each}

        {#if folderNaming}
          <input
            class="new-folder-input"
            aria-label="Folder name"
            placeholder="Folder name"
            bind:value={newFolderName}
            onkeydown={handleFolderNameKeydown}
            onblur={() => void commitNewFolder()}
          />
        {/if}

        {#each folders as folder (folder.id)}
          <div class="folder-block">
            <button
              class="folder-row"
              type="button"
              aria-expanded={expandedFolderIDs.includes(folder.id)}
              onclick={() => toggleFolder(folder.id)}
            >
              <span class="folder-disclosure" aria-hidden="true">
                {expandedFolderIDs.includes(folder.id) ? '▾' : '▸'}
              </span>
              <span class="folder-name">{folder.name}</span>
            </button>
            {#if expandedFolderIDs.includes(folder.id)}
              <div class="folder-notes">
                {#each folder.notes as note (note.id)}
                  <button
                    class="note-row nested"
                    class:active={note.id === noteID}
                    type="button"
                    aria-current={note.id === noteID ? 'page' : undefined}
                    disabled={noteTransitionActive}
                    onclick={() => void selectNote(note.id)}
                    oncontextmenu={(event) => openNoteContext(event, note.id)}
                  >{sidebarTitle(note)}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
    {/if}

    <button
      class="trash-row"
      class:active={trashView}
      type="button"
      aria-current={trashView ? 'page' : undefined}
      disabled={loading || noteTransitionActive}
      onclick={() => void enterTrashView()}
    >Trash</button>
  </aside>

  <section class="document" aria-label={trashView ? 'Trash viewer' : 'Editor'}>
    <div class="document-inner">
      {#if loading}
        <div class="editor-loading">Opening note…</div>
      {:else if trashView}
        {#if noteID}
          <div class="trash-actions">
            <span>Read-only in Trash</span>
            <div>
              <button
                type="button"
                class="secondary-button"
                disabled={noteTransitionActive}
                onclick={() => void restoreCurrentTrash()}
              >Restore</button>
              <button
                type="button"
                class="danger-button"
                disabled={noteTransitionActive}
                onclick={() => (permanentDeleteTargetID = noteID)}
              >Delete permanently…</button>
            </div>
          </div>
          <input
            class="title"
            aria-label="Note title"
            value={title}
            readonly
          />
          {#key noteID}
            <NoteEditor
              {documentJSON}
              onDocumentChange={handleDocumentChange}
              acceptanceText=""
              editable={false}
            />
          {/key}
        {:else}
          <div class="trash-empty">
            <h2>Trash is empty</h2>
            <p>Deleted notes stay here until you restore or permanently delete them.</p>
          </div>
        {/if}
        {#if operationError}
          <div class="save-error" role="status">{operationError}</div>
        {/if}
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

{#if contextNoteID}
  <div class="note-context-menu" style={`left:${contextMenuX}px;top:${contextMenuY}px;`}>
    <div class="context-menu-label">Move to…</div>
    <button
      type="button"
      disabled={folderForNote(contextNoteID) === ''}
      onclick={() => void moveContextNote('')}
    >Root</button>
    {#each folders as folder (folder.id)}
      <button
        type="button"
        disabled={folderForNote(contextNoteID) === folder.id}
        onclick={() => void moveContextNote(folder.id)}
      >{folder.name}</button>
    {/each}
    <div class="context-menu-separator"></div>
    <button
      type="button"
      class="context-danger"
      onclick={() => void moveContextNoteToTrash()}
    >Move to Trash</button>
  </div>
{/if}

{#if undoTrashNoteID}
  <div class="undo-trash" role="status">
    <span>Note moved to Trash</span>
    <button type="button" onclick={() => void undoTrash()}>Undo</button>
  </div>
{/if}

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

{#if permanentDeleteTargetID}
  <div class="modal-backdrop" role="presentation">
    <section class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-note-title">
      <h2 id="delete-note-title">Delete this note permanently?</h2>
      <p>This cannot be undone.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (permanentDeleteTargetID = '')}>Cancel</button>
        <button type="button" class="danger-button" onclick={() => void confirmPermanentDelete()}>Delete permanently</button>
      </div>
    </section>
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
