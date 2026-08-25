<script lang="ts">
  import { Events, Window } from '@wailsio/runtime'
  import { onMount, tick } from 'svelte'
  import {
    CreateFolder,
    CreateNote,
    CreateNoteInFolder,
    EmptyTrash,
    GetRuntimeInfo,
    ListFolderNotes,
    ListFolders,
    ListRootNotes,
    ListTrashFolderNotes,
    ListTrashFolders,
    ListTrashNotes,
    MoveFolderToTrash,
    MoveNote,
    MoveNoteToTrash,
    OpenInitialNote,
    OpenNote,
    OpenTrashNote,
    PermanentlyDeleteFolder,
    PermanentlyDeleteNote,
    RestoreFolder,
    RestoreNote,
    SaveNote,
    SearchNotes,
    TrashCounts,
  } from '../bindings/github.com/savior714/flashnote/appservice'
  import NoteEditor from './lib/NoteEditor.svelte'
  import SettingsDialog from './lib/SettingsDialog.svelte'
  import {
    applyEditorFontSize,
    applyTheme,
    initSettingsListener,
    loadSettings,
    saveSettings,
    type Settings,
  } from './lib/settings'

  const autosaveDelayMs = 400
  const retryDelayMs = 1500
  const undoDelayMs = 6000
  const acceptanceText = import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_TEXT ?? ''

  let settings = loadSettings()
  let settingsOpen = false
  let cleanupSettingsListener: (() => void) | null = null

  applyTheme(settings.appearance)
  applyEditorFontSize(settings.editorFontSize)

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
  let contextFolderID = ''
  let contextMenuX = 0
  let contextMenuY = 0
  let folderDeleteTargetID = ''

  let trashView = false
  let trashNotes: NoteSummary[] = []
  let trashFolders: FolderSummary[] = []
  let selectedTrashFolderID = ''
  let trashNoteCount = 0
  let trashFolderCount = 0
  let permanentDeleteTargetID = ''
  let permanentDeleteFolderTargetID = ''
  let emptyTrashConfirmVisible = false
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
    const [noteTuple, folderTuple, countTuple] = await Promise.all([
      ListTrashNotes(),
      ListTrashFolders(),
      TrashCounts(),
    ])
    const [noteIDs, noteTitles] = noteTuple as [string[], string[]]
    const [folderIDs, folderNames] = folderTuple as [string[], string[]]
    const [nextNoteCount, nextFolderCount] = countTuple as [number, number]
    if (folderIDs.length !== folderNames.length) {
      throw new Error('Flashnote received an invalid Trash folder list')
    }

    const nextFolders = await Promise.all(
      folderIDs.map(async (id, index) => {
        const [ids, titles] = (await ListTrashFolderNotes(id)) as [string[], string[]]
        return {
          id,
          name: folderNames[index] ?? '',
          notes: noteSummaries(ids, titles),
        }
      }),
    )

    trashNotes = noteSummaries(noteIDs, noteTitles)
    trashFolders = nextFolders
    trashNoteCount = nextNoteCount
    trashFolderCount = nextFolderCount
    if (selectedTrashFolderID && !nextFolders.some((folder) => folder.id === selectedTrashFolderID)) {
      selectedTrashFolderID = ''
    }
  }

  function currentTrashFolder(): FolderSummary | undefined {
    return trashFolders.find((folder) => folder.id === selectedTrashFolderID)
  }

  async function openFirstTrashItem() {
    if (trashNotes.length > 0) {
      selectedTrashFolderID = ''
      applyNote((await OpenTrashNote(trashNotes[0].id)) as NoteTuple)
      return
    }
    const folder = trashFolders[0]
    if (folder) {
      selectedTrashFolderID = folder.id
      if (folder.notes.length > 0) {
        applyNote((await OpenTrashNote(folder.notes[0].id)) as NoteTuple)
      } else {
        clearOpenedNote()
      }
      return
    }
    selectedTrashFolderID = ''
    clearOpenedNote()
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

  function openSettings() {
    createMenuOpen = false
    contextNoteID = ''
    contextFolderID = ''
    closeSearch()
    settingsOpen = true
  }

  function closeSettings() {
    settingsOpen = false
  }

  function updateSettings(updater: (prev: Settings) => Settings) {
    settings = updater(settings)
    saveSettings(settings)
    applyTheme(settings.appearance)
    applyEditorFontSize(settings.editorFontSize)
  }

  async function openSearch() {
    createMenuOpen = false
    contextNoteID = ''
    contextFolderID = ''
    closeSettings()
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
    contextFolderID = ''
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
      selectedTrashFolderID = ''
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
    contextFolderID = ''
    closeSearch()
    closeSettings()
    try {
      if (!trashView && !(await flushPendingSave())) {
        return
      }
      trashView = true
      currentFolderID = ''
      await refreshTrash()
      await openFirstTrashItem()
    } catch (error) {
      operationError = `Could not open Trash: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function selectTrashNote(nextNoteID: string, folderID = '') {
    if (!trashView || loading || noteTransitionActive || !nextNoteID) {
      return
    }
    if (nextNoteID === noteID && selectedTrashFolderID === folderID) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    try {
      selectedTrashFolderID = folderID
      applyNote((await OpenTrashNote(nextNoteID)) as NoteTuple)
    } catch (error) {
      operationError = `Could not open trashed note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function selectTrashFolder(folderID: string) {
    if (!trashView || loading || noteTransitionActive || !folderID) {
      return
    }
    const folder = trashFolders.find((candidate) => candidate.id === folderID)
    if (!folder) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    try {
      selectedTrashFolderID = folderID
      if (folder.notes.length > 0) {
        applyNote((await OpenTrashNote(folder.notes[0].id)) as NoteTuple)
      } else {
        clearOpenedNote()
      }
    } catch (error) {
      operationError = `Could not open trashed folder: ${formatError(error)}`
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
    contextFolderID = ''
    contextNoteID = targetNoteID
    contextMenuX = Math.min(event.clientX, window.innerWidth - 190)
    contextMenuY = Math.min(event.clientY, window.innerHeight - 260)
  }

  function openFolderContext(event: MouseEvent, targetFolderID: string) {
    if (trashView) {
      return
    }
    event.preventDefault()
    createMenuOpen = false
    contextNoteID = ''
    contextFolderID = targetFolderID
    contextMenuX = Math.min(event.clientX, window.innerWidth - 190)
    contextMenuY = Math.min(event.clientY, window.innerHeight - 180)
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

  function preferredSurvivorOutsideFolder(folderID: string): string {
    if (rootNotes.length > 0) {
      return rootNotes[0].id
    }
    for (const folder of folders) {
      if (folder.id === folderID) {
        continue
      }
      if (folder.notes.length > 0) {
        return folder.notes[0].id
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

  function requestFolderTrash(folderID: string) {
    const folder = folders.find((candidate) => candidate.id === folderID)
    contextFolderID = ''
    if (!folder || noteTransitionActive || trashView) {
      return
    }
    if (folder.notes.length > 0) {
      folderDeleteTargetID = folderID
      return
    }
    void moveFolderToTrash(folderID)
  }

  async function moveFolderToTrash(folderID: string) {
    const folder = folders.find((candidate) => candidate.id === folderID)
    if (!folder || noteTransitionActive || trashView) {
      return
    }

    const containsCurrent = folder.notes.some((note) => note.id === noteID)
    const survivorID = preferredSurvivorOutsideFolder(folderID)
    noteTransitionActive = true
    operationError = ''
    try {
      if (containsCurrent && !(await flushPendingSave())) {
        return
      }
      await MoveFolderToTrash(folderID)
      await Promise.all([refreshSidebar(), refreshTrash()])
      if (containsCurrent) {
        if (survivorID) {
          trashView = false
          applyNote((await OpenNote(survivorID)) as NoteTuple)
        } else {
          trashView = false
          applyNote((await CreateNote()) as NoteTuple)
          await tick()
          document.querySelector<HTMLInputElement>('.title')?.focus()
        }
        await refreshSidebar()
      }
    } catch (error) {
      operationError = `Could not move folder to Trash: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function confirmFolderTrash() {
    const folderID = folderDeleteTargetID
    folderDeleteTargetID = ''
    if (folderID) {
      await moveFolderToTrash(folderID)
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
      if (trashView && noteID === targetNoteID && !selectedTrashFolderID) {
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
    if (!trashView || noteTransitionActive) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    try {
      if (selectedTrashFolderID) {
        const folder = currentTrashFolder()
        const folderID = selectedTrashFolderID
        await RestoreFolder(folderID)
        const snapshot = folder?.notes[0]
          ? ((await OpenNote(folder.notes[0].id)) as NoteTuple)
          : ((await OpenInitialNote()) as NoteTuple)
        trashView = false
        selectedTrashFolderID = ''
        applyNote(snapshot)
      } else if (noteID) {
        const targetNoteID = noteID
        await RestoreNote(targetNoteID)
        const snapshot = (await OpenNote(targetNoteID)) as NoteTuple
        trashView = false
        applyNote(snapshot)
      } else {
        return
      }
      await Promise.all([refreshSidebar(), refreshTrash()])
    } catch (error) {
      operationError = `Could not restore Trash item: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function confirmPermanentDelete() {
    const targetNoteID = permanentDeleteTargetID
    if (!targetNoteID || !trashView || noteTransitionActive || selectedTrashFolderID) {
      return
    }

    permanentDeleteTargetID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      await PermanentlyDeleteNote(targetNoteID)
      await refreshTrash()
      await openFirstTrashItem()
      await refreshSidebar()
    } catch (error) {
      operationError = `Could not permanently delete note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function confirmPermanentFolderDelete() {
    const folderID = permanentDeleteFolderTargetID
    if (!folderID || !trashView || noteTransitionActive) {
      return
    }

    permanentDeleteFolderTargetID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      await PermanentlyDeleteFolder(folderID)
      selectedTrashFolderID = ''
      await refreshTrash()
      await openFirstTrashItem()
      await refreshSidebar()
    } catch (error) {
      operationError = `Could not permanently delete folder: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  async function confirmEmptyTrash() {
    if (!trashView || noteTransitionActive) {
      return
    }

    emptyTrashConfirmVisible = false
    noteTransitionActive = true
    operationError = ''
    try {
      await EmptyTrash()
      selectedTrashFolderID = ''
      await refreshTrash()
      clearOpenedNote()
      await refreshSidebar()
    } catch (error) {
      operationError = `Could not empty Trash: ${formatError(error)}`
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
    const modifier = event.metaKey || event.ctrlKey

    if (modifier && !event.shiftKey && !event.altKey && event.key === ',') {
      event.preventDefault()
      if (settingsOpen) {
        closeSettings()
      } else {
        openSettings()
      }
      return
    }

    if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      void openSearch()
      return
    }

    if (settingsOpen && !event.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSettings()
        return
      }
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
      contextFolderID = ''
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

  function folderDeleteTarget(): FolderSummary | undefined {
    return folders.find((folder) => folder.id === folderDeleteTargetID)
  }

  function permanentFolderTarget(): FolderSummary | undefined {
    return trashFolders.find((folder) => folder.id === permanentDeleteFolderTargetID)
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

    const sibling = (await CreateNoteInFolder(folderID)) as NoteTuple
    await MoveFolderToTrash(folderID)
    const [trashFolderIDs] = (await ListTrashFolders()) as [string[], string[]]
    if (!trashFolderIDs.includes(folderID)) {
      throw new Error('acceptance Trash folder listing missed folder')
    }
    const [groupedIDs] = (await ListTrashFolderNotes(folderID)) as [string[], string[]]
    if (!groupedIDs.includes(expectedID) || !groupedIDs.includes(sibling[0])) {
      throw new Error('acceptance folder recovery unit missed child notes')
    }
    const [standaloneIDs] = (await ListTrashNotes()) as [string[], string[]]
    if (standaloneIDs.includes(expectedID) || standaloneIDs.includes(sibling[0])) {
      throw new Error('acceptance folder recovery unit was flattened')
    }
    const [folderHiddenIDs] = (await SearchNotes('Flashnote')) as [string[], string[], string[]]
    if (folderHiddenIDs.includes(expectedID)) {
      throw new Error('acceptance Search exposed folder-trashed note')
    }
    const [countedNotes, countedFolders] = (await TrashCounts()) as [number, number]
    if (countedNotes !== 2 || countedFolders !== 1) {
      throw new Error('acceptance Trash counts mismatch')
    }

    await RestoreFolder(folderID)
    const restoredSnapshot = (await OpenNote(expectedID)) as NoteTuple
    const [restoredIDs] = (await SearchNotes('Flashnote')) as [string[], string[], string[]]
    if (!restoredIDs.includes(expectedID)) {
      throw new Error('acceptance Search missed restored note')
    }
    trashView = false
    selectedTrashFolderID = ''
    applyNote(restoredSnapshot)
    await refreshSidebar()
  }

  function handleAcceptanceReady() {
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
    }, 200)
  }

  async function initialise() {
    await tick()
    const shell = document.querySelector('main.shell')
    if (!shell) {
      throw new Error('Flashnote native UI did not mount')
    }

    const info = await GetRuntimeInfo()
    if (!info.databaseReady || info.schemaVersion < 6) {
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
  }

  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
    window.addEventListener('click', handleWindowClick)
    cleanupSettingsListener = initSettingsListener(() => settings.appearance)
    void initialise().catch((error: unknown) => {
      loading = false
      operationError = `Flashnote could not open your note: ${formatError(error)}`
    })

    return () => {
      clearSaveTimer()
      clearRetryTimer()
      clearUndoTimer()
      removeCloseListener?.()
      cleanupSettingsListener?.()
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
        <div class="trash-heading-row">
          <div class="trash-heading">Trash</div>
          <button
            class="trash-empty-button"
            type="button"
            disabled={noteTransitionActive || (trashNoteCount === 0 && trashFolderCount === 0)}
            onclick={() => (emptyTrashConfirmVisible = true)}
          >Empty Trash…</button>
        </div>
        {#each trashNotes as note (note.id)}
          <button
            class="note-row"
            class:active={note.id === noteID && !selectedTrashFolderID}
            type="button"
            aria-current={note.id === noteID && !selectedTrashFolderID ? 'page' : undefined}
            disabled={noteTransitionActive}
            onclick={() => void selectTrashNote(note.id)}
          >{sidebarTitle(note)}</button>
        {/each}
        {#each trashFolders as folder (folder.id)}
          <div class="folder-block trash-folder-block">
            <button
              class="folder-row"
              class:active={folder.id === selectedTrashFolderID}
              type="button"
              disabled={noteTransitionActive}
              onclick={() => void selectTrashFolder(folder.id)}
            >
              <span class="folder-disclosure" aria-hidden="true">▾</span>
              <span class="folder-name">{folder.name}</span>
            </button>
            <div class="folder-notes">
              {#each folder.notes as note (note.id)}
                <button
                  class="note-row nested"
                  class:active={note.id === noteID && folder.id === selectedTrashFolderID}
                  type="button"
                  aria-current={note.id === noteID && folder.id === selectedTrashFolderID ? 'page' : undefined}
                  disabled={noteTransitionActive}
                  onclick={() => void selectTrashNote(note.id, folder.id)}
                >{sidebarTitle(note)}</button>
              {/each}
              {#if folder.notes.length === 0}
                <div class="trash-folder-empty">Empty folder</div>
              {/if}
            </div>
          </div>
        {/each}
        {#if trashNoteCount === 0 && trashFolderCount === 0}
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
              oncontextmenu={(event) => openFolderContext(event, folder.id)}
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

    <div class="sidebar-footer">
      <button
        class="trash-row"
        class:active={trashView}
        type="button"
        aria-current={trashView ? 'page' : undefined}
        disabled={loading || noteTransitionActive}
        onclick={() => void enterTrashView()}
      >Trash</button>
      <button
        class="settings-row"
        type="button"
        aria-label="Settings"
        disabled={loading}
        onclick={openSettings}
      >Settings</button>
    </div>
  </aside>

  <section class="document" aria-label={trashView ? 'Trash viewer' : 'Editor'}>
    <div class="document-inner">
      {#if loading}
        <div class="editor-loading">Opening note…</div>
      {:else if trashView}
        {#if selectedTrashFolderID}
          <div class="trash-actions">
            <span>Folder recovery unit · read-only</span>
            <div>
              <button
                type="button"
                class="secondary-button"
                disabled={noteTransitionActive}
                onclick={() => void restoreCurrentTrash()}
              >Restore folder</button>
              <button
                type="button"
                class="danger-button"
                disabled={noteTransitionActive}
                onclick={() => (permanentDeleteFolderTargetID = selectedTrashFolderID)}
              >Delete folder permanently…</button>
            </div>
          </div>
          {#if noteID}
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
                spellcheck={settings.spellcheck}
              />
            {/key}
          {:else}
            <div class="trash-empty">
              <h2>{currentTrashFolder()?.name ?? 'Folder'}</h2>
              <p>This deleted folder is empty.</p>
            </div>
          {/if}
        {:else if noteID}
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
              spellcheck={settings.spellcheck}
            />
          {/key}
        {:else}
          <div class="trash-empty">
            <h2>Trash is empty</h2>
            <p>Deleted notes and folders stay here until you restore or permanently delete them.</p>
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
            spellcheck={settings.spellcheck}
            onAcceptanceReady={handleAcceptanceReady}
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

{#if contextFolderID}
  <div class="note-context-menu" style={`left:${contextMenuX}px;top:${contextMenuY}px;`}>
    <button
      type="button"
      class="context-danger"
      onclick={() => requestFolderTrash(contextFolderID)}
    >Move to Trash{folders.find((folder) => folder.id === contextFolderID)?.notes.length ? '…' : ''}</button>
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

{#if folderDeleteTargetID}
  <div class="modal-backdrop" role="presentation">
    <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
      <h2 id="delete-folder-title">Move folder to Trash?</h2>
      <p>This folder and {folderDeleteTarget()?.notes.length ?? 0} notes will be moved to Trash.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (folderDeleteTargetID = '')}>Cancel</button>
        <button type="button" class="danger-button" onclick={() => void confirmFolderTrash()}>Move to Trash</button>
      </div>
    </div>
  </div>
{/if}

{#if permanentDeleteTargetID}
  <div class="modal-backdrop" role="presentation">
    <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-note-title">
      <h2 id="delete-note-title">Delete this note permanently?</h2>
      <p>This cannot be undone.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (permanentDeleteTargetID = '')}>Cancel</button>
        <button type="button" class="danger-button" onclick={() => void confirmPermanentDelete()}>Delete permanently</button>
      </div>
    </div>
  </div>
{/if}

{#if permanentDeleteFolderTargetID}
  <div class="modal-backdrop" role="presentation">
    <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-trash-folder-title">
      <h2 id="delete-trash-folder-title">Delete this folder permanently?</h2>
      <p>This folder and {permanentFolderTarget()?.notes.length ?? 0} notes will be permanently deleted. This cannot be undone.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (permanentDeleteFolderTargetID = '')}>Cancel</button>
        <button type="button" class="danger-button" onclick={() => void confirmPermanentFolderDelete()}>Delete permanently</button>
      </div>
    </div>
  </div>
{/if}

{#if emptyTrashConfirmVisible}
  <div class="modal-backdrop" role="presentation">
    <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="empty-trash-title">
      <h2 id="empty-trash-title">Empty Trash?</h2>
      <p>Permanently delete {trashNoteCount} notes and {trashFolderCount} folders. This cannot be undone.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (emptyTrashConfirmVisible = false)}>Cancel</button>
        <button type="button" class="danger-button" onclick={() => void confirmEmptyTrash()}>Empty Trash</button>
      </div>
    </div>
  </div>
{/if}

{#if closePromptVisible}
  <div class="modal-backdrop" role="presentation">
    <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-title">
      <h2 id="close-title">Changes aren’t saved</h2>
      <p>Flashnote couldn’t save your latest changes. Retry saving, keep the window open, or discard those unsaved changes and exit.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (closePromptVisible = false)}>Cancel</button>
        <button type="button" class="secondary-button" onclick={retryClose}>Retry saving</button>
        <button type="button" class="danger-button" onclick={discardAndExit}>Discard &amp; exit</button>
      </div>
    </div>
  </div>
{/if}

{#if settingsOpen}
  <SettingsDialog
    {settings}
    onUpdate={updateSettings}
    onClose={closeSettings}
  />
{/if}
