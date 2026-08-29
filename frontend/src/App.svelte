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
import { runNewNoteShortcutAcceptance } from './lib/newNoteShortcutAcceptance'
import { runSidebarDragDropAcceptance } from './lib/sidebarDragDropAcceptance'
import { exportCurrentNoteMarkdown } from './lib/export-shortcut'
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
  const flushTimeoutMs = 5000
  const acceptanceText = import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_TEXT ?? ''
  let editorAcceptanceConsumed = false

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
  let sidebarVisible = true
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
  let moreMenuOpen = false
  let folderNaming = false
  let newFolderName = ''
  let moveMenuNoteID = ''
  let noteDeleteTargetID = ''
  let folderDeleteTargetID = ''
  let draggedNoteID = ''
  let dragTargetFolderID: string | null = null

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
  let trashReturnNoteID = ''
  let trashReturnFolderID = ''

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
    if (!noteID && currentFolderID && nextFolders.some((folder) => folder.id === currentFolderID)) {
      locatedFolderID = currentFolderID
    } else {
      for (const folder of nextFolders) {
        if (folder.notes.some((note) => note.id === noteID)) {
          locatedFolderID = folder.id
          break
        }
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
    moveMenuNoteID = ''
    moreMenuOpen = false
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
    moveMenuNoteID = ''
    moreMenuOpen = false
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

  function clearNoteDrag() {
    draggedNoteID = ''
    dragTargetFolderID = null
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

    const flushPromise = (async () => {
      while (!trashView && durableSequence < draftSequence) {
        const saved = await persistLatest()
        if (!saved) {
          return false
        }
      }
      return true
    })()

    try {
      return await Promise.race([
        flushPromise,
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            saveError = 'Save timed out'
            resolve(false)
          }, flushTimeoutMs)
        }),
      ])
    } catch {
      return false
    }
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

  function toggleSidebar() {
    sidebarVisible = !sidebarVisible
    createMenuOpen = false
    moveMenuNoteID = ''
    moreMenuOpen = false
    clearNoteDrag()
    if (folderNaming) {
      folderNaming = false
      newFolderName = ''
    }
  }

  function toggleCreateMenu() {
    if (trashView) {
      return
    }
    createMenuOpen = !createMenuOpen
    moveMenuNoteID = ''
    moreMenuOpen = false
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
    moveMenuNoteID = ''
    moreMenuOpen = false
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
    } catch (error) {
      operationError = `Could not create note: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
    await tick()
    document.querySelector<HTMLInputElement>('.title')?.focus()
  }

  async function selectNote(nextNoteID: string): Promise<boolean> {
    if (loading || noteTransitionActive || !nextNoteID) {
      return false
    }
    if (!trashView && nextNoteID === noteID) {
      return true
    }

    moveMenuNoteID = ''
    moreMenuOpen = false
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
    moveMenuNoteID = ''
    moreMenuOpen = false
    clearNoteDrag()
    closeSearch()
    closeSettings()
    try {
      if (!trashView && !(await flushPendingSave())) {
        return
      }
      if (!trashView) {
        trashReturnNoteID = noteID
        trashReturnFolderID = currentFolderID
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

  function normalNoteExists(targetNoteID: string): boolean {
    if (!targetNoteID) {
      return false
    }
    return (
      rootNotes.some((note) => note.id === targetNoteID) ||
      folders.some((folder) => folder.notes.some((note) => note.id === targetNoteID))
    )
  }

  async function returnToNormalLibrary() {
    const preferredNoteID = trashReturnNoteID
    const preferredFolderID = trashReturnFolderID
    trashView = false
    selectedTrashFolderID = ''
    clearOpenedNote()
    await refreshSidebar()

    let createdBlank = false
    if (preferredNoteID && normalNoteExists(preferredNoteID)) {
      applyNote((await OpenNote(preferredNoteID)) as NoteTuple)
    } else {
      const preferredFolder = folders.find((folder) => folder.id === preferredFolderID)
      if (preferredFolder) {
        currentFolderID = preferredFolder.id
        if (preferredFolder.notes.length > 0) {
          applyNote((await OpenNote(preferredFolder.notes[0].id)) as NoteTuple)
        }
      } else {
        const survivorID = preferredSurvivor('', '')
        if (survivorID) {
          applyNote((await OpenNote(survivorID)) as NoteTuple)
        } else {
          applyNote((await CreateNote()) as NoteTuple)
          createdBlank = true
        }
      }
    }
    await refreshSidebar()

    if (createdBlank) {
      await tick()
      document.querySelector<HTMLInputElement>('.title')?.focus()
    }
  }

  async function leaveTrashView() {
    if (!trashView || loading || noteTransitionActive) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    moreMenuOpen = false
    try {
      await returnToNormalLibrary()
    } catch (error) {
      operationError = `Could not leave Trash: ${formatError(error)}`
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

    moreMenuOpen = false
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
    moreMenuOpen = false
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

  async function selectFolder(folderID: string) {
    if (loading || noteTransitionActive || trashView || !folderID) {
      return
    }
    const folder = folders.find((candidate) => candidate.id === folderID)
    if (!folder) {
      return
    }

    noteTransitionActive = true
    operationError = ''
    createMenuOpen = false
    moveMenuNoteID = ''
    moreMenuOpen = false
    clearNoteDrag()
    closeSearch()
    closeSettings()
    try {
      if (!(await flushPendingSave())) {
        return
      }
      currentFolderID = folderID
      if (!expandedFolderIDs.includes(folderID)) {
        expandedFolderIDs = [...expandedFolderIDs, folderID]
      }
      const currentNoteInFolder = folder.notes.some((note) => note.id === noteID)
      if (folder.notes.length === 0) {
        clearOpenedNote()
      } else if (!currentNoteInFolder) {
        applyNote((await OpenNote(folder.notes[0].id)) as NoteTuple)
      }
    } catch (error) {
      operationError = `Could not open folder: ${formatError(error)}`
    } finally {
      noteTransitionActive = false
    }
  }

  function toggleFolder(folderID: string) {
    expandedFolderIDs = expandedFolderIDs.includes(folderID)
      ? expandedFolderIDs.filter((id) => id !== folderID)
      : [...expandedFolderIDs, folderID]
  }

  function handleFolderClick(event: MouseEvent, folderID: string) {
    const target = event.target as Element | null
    if (target?.closest('.folder-disclosure')) {
      toggleFolder(folderID)
      return
    }
    void selectFolder(folderID)
  }

  function folderForNote(targetNoteID: string): string {
    for (const folder of folders) {
      if (folder.notes.some((note) => note.id === targetNoteID)) {
        return folder.id
      }
    }
    return ''
  }

  function noteHasMoveDestination(targetNoteID: string): boolean {
    return folderForNote(targetNoteID) !== '' || folders.length > 0
  }

  function toggleMoveMenu(targetNoteID: string) {
    if (trashView || noteTransitionActive || !noteHasMoveDestination(targetNoteID)) {
      moveMenuNoteID = ''
      return
    }
    createMenuOpen = false
    moveMenuNoteID = moveMenuNoteID === targetNoteID ? '' : targetNoteID
  }

  async function moveNoteToFolder(targetNoteID: string, targetFolderID: string): Promise<boolean> {
    if (
      !targetNoteID ||
      noteTransitionActive ||
      trashView ||
      folderForNote(targetNoteID) === targetFolderID
    ) {
      return false
    }

    moveMenuNoteID = ''
    noteTransitionActive = true
    operationError = ''
    try {
      if (targetNoteID === noteID && !(await flushPendingSave())) {
        return false
      }
      await MoveNote(targetNoteID, targetFolderID)
      await refreshSidebar()
      return true
    } catch (error) {
      operationError = `Could not move note: ${formatError(error)}`
      return false
    } finally {
      noteTransitionActive = false
    }
  }

  async function moveMenuNote(targetFolderID: string) {
    const targetNoteID = moveMenuNoteID
    moveMenuNoteID = ''
    if (targetNoteID) {
      await moveNoteToFolder(targetNoteID, targetFolderID)
    }
  }

  function handleNoteDragStart(event: DragEvent, targetNoteID: string) {
    if (loading || noteTransitionActive || trashView || !targetNoteID) {
      event.preventDefault()
      return
    }
    draggedNoteID = targetNoteID
    dragTargetFolderID = null
    createMenuOpen = false
    moveMenuNoteID = ''
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', targetNoteID)
    }
  }

  function handleNoteDragOver(event: DragEvent, targetFolderID: string) {
    if (!draggedNoteID || trashView) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragTargetFolderID = targetFolderID
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
  }

  function handleNoteDrop(event: DragEvent, targetFolderID: string) {
    if (!draggedNoteID || trashView) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const targetNoteID = draggedNoteID
    clearNoteDrag()
    void moveNoteToFolder(targetNoteID, targetFolderID)
  }

  function handleNoteDragEnd() {
    clearNoteDrag()
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

  function offerTrashUndo(targetNoteID: string) {
    clearUndoTimer()
    undoTrashNoteID = targetNoteID
    undoTimer = setTimeout(() => {
      undoTrashNoteID = ''
      undoTimer = undefined
    }, undoDelayMs)
  }

  function requestNoteTrash(targetNoteID: string) {
    if (!targetNoteID || noteTransitionActive || trashView) {
      return
    }
    moveMenuNoteID = ''
    noteDeleteTargetID = targetNoteID
  }

  async function confirmNoteTrash() {
    const targetNoteID = noteDeleteTargetID
    noteDeleteTargetID = ''
    if (targetNoteID) {
      await moveNoteToTrash(targetNoteID)
    }
  }

  async function moveNoteToTrash(targetNoteID: string) {
    if (!targetNoteID || noteTransitionActive || trashView) {
      return
    }

    const sourceFolderID = folderForNote(targetNoteID)
    const survivorID = preferredSurvivor(targetNoteID, sourceFolderID)
    const wasCurrent = targetNoteID === noteID
    moveMenuNoteID = ''
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
    if (!folder || noteTransitionActive || trashView) {
      return
    }
    moveMenuNoteID = ''
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
      permanentDeleteTargetID = ''
      permanentDeleteFolderTargetID = ''
      clearUndoTimer()
      undoTrashNoteID = ''
      await refreshTrash()
      await returnToNormalLibrary()
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

    if (modifier && !event.shiftKey && !event.altKey && !event.isComposing && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      if (trashView) {
        return
      }
      if (settingsOpen) {
        closeSettings()
      }
      if (searchOpen) {
        closeSearch()
      }
      void createNote()
      return
    }

    if (modifier && !event.shiftKey && !event.altKey && event.key === '\\') {
      event.preventDefault()
      toggleSidebar()
      return
    }

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

    if (moreMenuOpen && !event.isComposing && event.key === 'Escape') {
      event.preventDefault()
      moreMenuOpen = false
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
    if (!target?.closest('.sidebar-move-button') && !target?.closest('.note-move-menu')) {
      moveMenuNoteID = ''
    }
    if (!target?.closest('.more-button') && !target?.closest('.more-menu')) {
      moreMenuOpen = false
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

  async function runAcceptanceEmptyTrashReturn() {
    if (!(await flushPendingSave())) {
      throw new Error('acceptance Empty Trash save flush failed')
    }
    const survivorID = noteID
    if (!survivorID || trashView) {
      throw new Error('acceptance Empty Trash requires an open normal survivor')
    }

    const [navNoteCountBefore, navFolderCountBefore] = (await TrashCounts()) as [number, number]
    await enterTrashView()
    await tick()
    const backButton = document.querySelector<HTMLButtonElement>('[data-trash-back-button]')
    if (!trashView || !backButton) {
      throw new Error('acceptance Trash navigation back control did not render')
    }
    backButton.click()
    for (let attempt = 0; attempt < 100 && noteTransitionActive; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await tick()
    if (noteTransitionActive || trashView || noteID !== survivorID) {
      throw new Error(`acceptance Trash navigation return mismatch note=${noteID} survivor=${survivorID}`)
    }
    const [navNoteCountAfter, navFolderCountAfter] = (await TrashCounts()) as [number, number]
    if (navNoteCountAfter !== navNoteCountBefore || navFolderCountAfter !== navFolderCountBefore) {
      throw new Error('acceptance Trash navigation mutated Trash contents')
    }
    if (document.querySelector('nav.note-list[aria-label="Note list"]') === null) {
      throw new Error('acceptance Trash navigation did not restore normal sidebar')
    }

    const disposableNote = (await CreateNote()) as NoteTuple
    await MoveNoteToTrash(disposableNote[0])
    const [disposableFolderID] = (await CreateFolder('Acceptance Empty Trash Folder')) as [string, string]
    const moved = await MoveFolderToTrash(disposableFolderID)
    if (moved !== 0) {
      throw new Error(`acceptance Empty Trash disposable folder moved ${moved} notes, want 0`)
    }
    await refreshSidebar()

    const [noteCountBefore, folderCountBefore] = (await TrashCounts()) as [number, number]
    if (noteCountBefore !== 1 || folderCountBefore !== 1) {
      throw new Error(`acceptance Empty Trash pre-counts=${noteCountBefore}/${folderCountBefore}, want 1/1`)
    }

    await enterTrashView()
    await selectTrashFolder(disposableFolderID)
    if (!trashView || selectedTrashFolderID !== disposableFolderID) {
      throw new Error('acceptance Empty Trash did not select disposable Trash folder')
    }

    emptyTrashConfirmVisible = true
    await tick()
    if (!document.getElementById('empty-trash-title')) {
      throw new Error('acceptance Empty Trash confirmation did not render')
    }

    permanentDeleteTargetID = disposableNote[0]
    permanentDeleteFolderTargetID = disposableFolderID
    undoTrashNoteID = disposableNote[0]
    await confirmEmptyTrash()
    await tick()

    if (trashView) {
      throw new Error('acceptance Empty Trash remained in trashView')
    }
    if (selectedTrashFolderID || permanentDeleteTargetID || permanentDeleteFolderTargetID || undoTrashNoteID) {
      throw new Error('acceptance Empty Trash retained stale Trash selection/action state')
    }
    if (emptyTrashConfirmVisible) {
      throw new Error('acceptance Empty Trash confirmation remained visible')
    }
    if (trashNoteCount !== 0 || trashFolderCount !== 0) {
      throw new Error(`acceptance Empty Trash UI counts=${trashNoteCount}/${trashFolderCount}, want 0/0`)
    }
    const [noteCountAfter, folderCountAfter] = (await TrashCounts()) as [number, number]
    if (noteCountAfter !== 0 || folderCountAfter !== 0) {
      throw new Error(`acceptance Empty Trash durable counts=${noteCountAfter}/${folderCountAfter}, want 0/0`)
    }
    if (noteID !== survivorID || currentFolderID !== '') {
      throw new Error(`acceptance Empty Trash survivor mismatch note=${noteID} folder=${currentFolderID}`)
    }
    const survivor = (await OpenNote(survivorID)) as NoteTuple
    if (survivor[0] !== survivorID) {
      throw new Error('acceptance Empty Trash normal survivor could not be reopened')
    }
    const [rootIDs] = (await ListRootNotes()) as [string[], string[]]
    if (!rootIDs.includes(survivorID)) {
      throw new Error('acceptance Empty Trash survivor disappeared from normal root list')
    }
    if (
      document.querySelector('nav.note-list[aria-label="Note list"]') === null ||
      document.querySelector(`[data-note-id="${survivorID}"]`) === null ||
      document.querySelector<HTMLElement>('section.document')?.getAttribute('aria-label') !== 'Editor'
    ) {
      throw new Error('acceptance Empty Trash did not restore normal library/editor rendering')
    }

    console.log('FLASHNOTE_ACCEPTANCE_EMPTY_TRASH_RETURN_SUCCESS')
  }

  async function runAcceptanceTrashLifecycle() {
    if (!(await flushPendingSave())) {
      throw new Error('acceptance save flush failed')
    }
    const expectedID = noteID
    const [folderID] = (await CreateFolder('Acceptance Folder')) as [string, string]
    await MoveNote(expectedID, folderID)
    await refreshSidebar()

    const expectedRow = document.querySelector<HTMLElement>(`[data-note-id="${expectedID}"]`)
    const trashButton = expectedRow?.parentElement?.querySelector<HTMLButtonElement>('.sidebar-trash-button')
    if (!trashButton) {
      throw new Error('acceptance note Trash button missing')
    }
    trashButton.click()
    await tick()
    if (noteDeleteTargetID !== expectedID || !document.getElementById('trash-note-title')) {
      throw new Error('acceptance note Trash confirmation did not open')
    }
    const [stillInFolderIDs] = (await ListFolderNotes(folderID)) as [string[], string[]]
    if (!stillInFolderIDs.includes(expectedID)) {
      throw new Error('acceptance note was trashed before confirmation')
    }
    noteDeleteTargetID = ''
    await tick()

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

    await enterTrashView()
    const [rootNotesBeforeTrashCmdN] = (await ListRootNotes()) as [string[], string[]]
    const [trashNotesBeforeTrashCmdN] = (await ListTrashNotes()) as [string[], string[]]
    const noteIDInTrashBefore = noteID
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
    const trashCmdNEvent = new KeyboardEvent('keydown', {
      key: 'n',
      bubbles: true,
      cancelable: true,
      metaKey: isMac,
      ctrlKey: !isMac,
    })
    window.dispatchEvent(trashCmdNEvent)
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 30))

    if (!trashCmdNEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+N while in Trash was not default-prevented')
    }
    if (!trashView) {
      throw new Error('acceptance S3: Cmd/Ctrl+N while in Trash unexpectedly exited trashView')
    }
    if (noteID !== noteIDInTrashBefore) {
      throw new Error('acceptance S3: Cmd/Ctrl+N while in Trash unexpectedly changed noteID')
    }
    const [rootNotesAfterTrashCmdN] = (await ListRootNotes()) as [string[], string[]]
    const [trashNotesAfterTrashCmdN] = (await ListTrashNotes()) as [string[], string[]]
    if (
      rootNotesAfterTrashCmdN.length !== rootNotesBeforeTrashCmdN.length ||
      trashNotesAfterTrashCmdN.length !== trashNotesBeforeTrashCmdN.length
    ) {
      throw new Error('acceptance S3: Cmd/Ctrl+N while in Trash altered note counts')
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
    editorAcceptanceConsumed = true
    setTimeout(() => {
      void (async () => {
        try {
          await runNewNoteShortcutAcceptance({
            getNoteID: () => noteID,
            getTitle: () => title,
            getDocumentJSON: () => documentJSON,
            isSidebarVisible: () => sidebarVisible,
            getCurrentFolderID: () => currentFolderID,
            isSettingsOpen: () => settingsOpen,
            isNoteTransitionActive: () => noteTransitionActive,
            applyNote,
            refreshSidebar,
          })
          await runAcceptanceEmptyTrashReturn()
          await runSidebarDragDropAcceptance({ refreshSidebar })
          await runAcceptanceTrashLifecycle()
          console.log('FLASHNOTE_ACCEPTANCE_FULL_PIPELINE_SUCCESS')
          await Window.Close()
        } catch (error) {
          console.error('FLASHNOTE_ACCEPTANCE_FAILURE', error)
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
      clearNoteDrag()
      removeCloseListener?.()
      cleanupSettingsListener?.()
      window.removeEventListener('keydown', handleGlobalKeydown)
      window.removeEventListener('click', handleWindowClick)
    }
  })
</script>

<main class="shell" class:sidebar-hidden={!sidebarVisible}>
  {#if sidebarVisible}
    <aside id="sidebar" class="sidebar" aria-label="Notes">
      <div class="brand-row">
        <div class="brand-left">
          <button
            class="quiet-button hide-sidebar-button"
            type="button"
            aria-label="Hide sidebar"
            aria-controls="sidebar"
            onclick={toggleSidebar}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <strong>Flashnote</strong>
        </div>
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
          <button
            class="quiet-button"
            type="button"
            aria-label="Back to notes"
            data-trash-back-button
            disabled={noteTransitionActive}
            onclick={() => void leaveTrashView()}
          >← Notes</button>
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
        <div
          class="root-note-drop-zone"
          class:drop-target={dragTargetFolderID === ''}
          role="group"
          aria-label="Root notes"
          ondragover={(event) => handleNoteDragOver(event, '')}
          ondrop={(event) => handleNoteDrop(event, '')}
        >
          {#each rootNotes as note (note.id)}
            <div class="sidebar-item">
              <button
                class="note-row"
                class:active={note.id === noteID}
                class:dragging={note.id === draggedNoteID}
                type="button"
                data-note-id={note.id}
                aria-current={note.id === noteID ? 'page' : undefined}
                disabled={noteTransitionActive}
                draggable={!noteTransitionActive}
                onclick={() => void selectNote(note.id)}
                ondragstart={(event) => handleNoteDragStart(event, note.id)}
                ondragend={handleNoteDragEnd}
              >{sidebarTitle(note)}</button>
              <button
                class="sidebar-action-button sidebar-move-button"
                type="button"
                aria-label="Move note"
                title="Move note"
                aria-haspopup="menu"
                aria-expanded={moveMenuNoteID === note.id}
                disabled={noteTransitionActive || !noteHasMoveDestination(note.id)}
                onclick={() => toggleMoveMenu(note.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 7h7l2 2h9v9H3z" />
                  <path d="M8 13h8" />
                  <path d="m13 10 3 3-3 3" />
                </svg>
              </button>
              <button
                class="sidebar-action-button sidebar-trash-button"
                type="button"
                aria-label="Move note to Trash"
                title="Move to Trash"
                disabled={noteTransitionActive}
                onclick={() => requestNoteTrash(note.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v5" />
                  <path d="M14 11v5" />
                </svg>
              </button>
              {#if moveMenuNoteID === note.id}
                <div class="sidebar-menu note-move-menu" role="menu" aria-label="Move note">
                  {#if folderForNote(note.id)}
                    <button type="button" role="menuitem" onclick={() => void moveMenuNote('')}>Root</button>
                  {/if}
                  {#each folders.filter((folder) => folder.id !== folderForNote(note.id)) as folder (folder.id)}
                    <button type="button" role="menuitem" onclick={() => void moveMenuNote(folder.id)}>{folder.name}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>

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
          <div
            class="folder-block"
            class:drop-target={dragTargetFolderID === folder.id}
            data-folder-id={folder.id}
            role="group"
            aria-label={`${folder.name} folder`}
            ondragover={(event) => handleNoteDragOver(event, folder.id)}
            ondrop={(event) => handleNoteDrop(event, folder.id)}
          >
            <div class="sidebar-item">
              <button
                class="folder-row"
                class:active={folder.id === currentFolderID}
                type="button"
                aria-current={folder.id === currentFolderID ? 'location' : undefined}
                aria-expanded={expandedFolderIDs.includes(folder.id)}
                disabled={noteTransitionActive}
                onclick={(event) => handleFolderClick(event, folder.id)}
              >
                <span class="folder-disclosure" aria-hidden="true">
                  {expandedFolderIDs.includes(folder.id) ? '▾' : '▸'}
                </span>
                <span class="folder-name">{folder.name}</span>
              </button>
              <button
                class="sidebar-action-button sidebar-trash-button"
                type="button"
                aria-label="Move folder to Trash"
                title="Move to Trash"
                disabled={noteTransitionActive}
                onclick={() => requestFolderTrash(folder.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v5" />
                  <path d="M14 11v5" />
                </svg>
              </button>
            </div>
            {#if expandedFolderIDs.includes(folder.id)}
              <div class="folder-notes">
                {#each folder.notes as note (note.id)}
                  <div class="sidebar-item">
                    <button
                      class="note-row nested"
                      class:active={note.id === noteID}
                      class:dragging={note.id === draggedNoteID}
                      type="button"
                      data-note-id={note.id}
                      aria-current={note.id === noteID ? 'page' : undefined}
                      disabled={noteTransitionActive}
                      draggable={!noteTransitionActive}
                      onclick={() => void selectNote(note.id)}
                      ondragstart={(event) => handleNoteDragStart(event, note.id)}
                      ondragend={handleNoteDragEnd}
                    >{sidebarTitle(note)}</button>
                    <button
                      class="sidebar-action-button sidebar-move-button"
                      type="button"
                      aria-label="Move note"
                      title="Move note"
                      aria-haspopup="menu"
                      aria-expanded={moveMenuNoteID === note.id}
                      disabled={noteTransitionActive || !noteHasMoveDestination(note.id)}
                      onclick={() => toggleMoveMenu(note.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 7h7l2 2h9v9H3z" />
                        <path d="M8 13h8" />
                        <path d="m13 10 3 3-3 3" />
                      </svg>
                    </button>
                    <button
                      class="sidebar-action-button sidebar-trash-button"
                      type="button"
                      aria-label="Move note to Trash"
                      title="Move to Trash"
                      disabled={noteTransitionActive}
                      onclick={() => requestNoteTrash(note.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v5" />
                        <path d="M14 11v5" />
                      </svg>
                    </button>
                    {#if moveMenuNoteID === note.id}
                      <div class="sidebar-menu note-move-menu" role="menu" aria-label="Move note">
                        <button type="button" role="menuitem" onclick={() => void moveMenuNote('')}>Root</button>
                        {#each folders.filter((candidate) => candidate.id !== folder.id) as destination (destination.id)}
                          <button type="button" role="menuitem" onclick={() => void moveMenuNote(destination.id)}>{destination.name}</button>
                        {/each}
                      </div>
                    {/if}
                  </div>
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
{/if}

<section class="document" aria-label={trashView ? 'Trash viewer' : 'Editor'}>
  {#if !sidebarVisible}
    <button
      class="quiet-button show-sidebar-button"
      type="button"
      aria-label="Show sidebar"
      aria-controls="sidebar"
      onclick={toggleSidebar}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18" />
      </svg>
    </button>
  {/if}
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
        <div class="document-header">
          <input
            class="title"
            aria-label="Note title"
            placeholder="Untitled"
            value={title}
            disabled={noteTransitionActive}
            oninput={handleTitleInput}
            onkeydown={handleTitleKeydown}
          />
          <div class="document-header-actions">
            <div class="more-controls">
              <button
                class="quiet-button more-button"
                type="button"
                aria-label="More"
                aria-expanded={moreMenuOpen}
                aria-haspopup="menu"
                disabled={noteTransitionActive}
                onclick={() => (moreMenuOpen = !moreMenuOpen)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
              </button>
              {#if moreMenuOpen}
                <div class="sidebar-menu more-menu" role="menu" aria-label="More actions">
                  <button type="button" role="menuitem" onclick={() => { moreMenuOpen = false; void exportCurrentNoteMarkdown(); }}>Export as Markdown…</button>
                </div>
              {/if}
            </div>
          </div>
        </div>
        {#key noteID}
          <NoteEditor
            {documentJSON}
            onDocumentChange={handleDocumentChange}
            acceptanceText={editorAcceptanceConsumed ? '' : acceptanceText}
            editable={!noteTransitionActive}
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

{#if noteDeleteTargetID}
  <div class="modal-backdrop" role="presentation">
    <div class="close-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-note-title">
      <h2 id="trash-note-title">Move note to Trash?</h2>
      <p>You can restore it from Trash.</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onclick={() => (noteDeleteTargetID = '')}>Cancel</button>
        <button type="button" class="danger-button" onclick={() => void confirmNoteTrash()}>Move to Trash</button>
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