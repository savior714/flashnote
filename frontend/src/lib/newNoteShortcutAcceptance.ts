import { tick } from 'svelte'
import {
  CreateFolder,
  ListFolderNotes,
  ListFolders,
  ListRootNotes,
  MoveFolderToTrash,
  MoveNote,
  MoveNoteToTrash,
  OpenNote,
  PermanentlyDeleteFolder,
  PermanentlyDeleteNote,
} from '../../bindings/github.com/savior714/flashnote/appservice'
import { runDataSafetyAcceptance } from './dataSafetyAcceptance'

type NoteTuple = [string, string, string, number, boolean]

export type NewNoteShortcutAcceptanceCallbacks = {
  getNoteID: () => string
  getTitle: () => string
  getDocumentJSON: () => string
  isSidebarVisible: () => boolean
  getCurrentFolderID: () => string
  isSettingsOpen: () => boolean
  isNoteTransitionActive: () => boolean
  applyNote: (snapshot: NoteTuple) => void
  refreshSidebar: () => Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nodeText(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }
  const node = value as { text?: unknown; content?: unknown }
  if (typeof node.text === 'string') {
    return node.text
  }
  if (!Array.isArray(node.content)) {
    return ''
  }
  return node.content.map(nodeText).join('')
}

function checklistStates(documentJSON: string, acceptanceText: string): boolean[] {
  const envelope = JSON.parse(documentJSON) as { schemaVersion?: unknown; doc?: unknown }
  if (envelope.schemaVersion !== 1 || !envelope.doc || typeof envelope.doc !== 'object') {
    throw new Error('acceptance checklist durability: invalid canonical document envelope')
  }

  const findTaskList = (value: unknown): unknown[] | null => {
    if (!value || typeof value !== 'object') {
      return null
    }
    const node = value as { type?: unknown; content?: unknown }
    if (
      node.type === 'taskList' &&
      nodeText(node).includes(acceptanceText) &&
      Array.isArray(node.content)
    ) {
      return node.content
    }
    if (!Array.isArray(node.content)) {
      return null
    }
    for (const child of node.content) {
      const found = findTaskList(child)
      if (found) {
        return found
      }
    }
    return null
  }

  const items = findTaskList(envelope.doc)
  if (!items || items.length !== 2) {
    throw new Error('acceptance checklist durability: expected two acceptance task items')
  }

  return items.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new Error('acceptance checklist durability: task item is not an object')
    }
    const item = value as { type?: unknown; attrs?: unknown }
    if (item.type !== 'taskItem' || !item.attrs || typeof item.attrs !== 'object') {
      throw new Error('acceptance checklist durability: malformed task item')
    }
    const checked = (item.attrs as { checked?: unknown }).checked
    if (typeof checked !== 'boolean') {
      throw new Error('acceptance checklist durability: task item checked state is not boolean')
    }
    return checked
  })
}

function sameBooleanStates(left: boolean[], right: boolean[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function waitForDurableChecklist(
  noteID: string,
  acceptanceText: string,
  expectedStates: boolean[],
  timeoutMs = 4000,
): Promise<NoteTuple> {
  const startedAt = Date.now()
  let lastStates: boolean[] | null = null
  let lastError: unknown = null

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = (await OpenNote(noteID)) as NoteTuple
    try {
      lastStates = checklistStates(snapshot[2], acceptanceText)
      lastError = null
      if (sameBooleanStates(lastStates, expectedStates)) {
        return snapshot
      }
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }

  const detail = lastError instanceof Error
    ? lastError.message
    : `last durable states=${JSON.stringify(lastStates)}`
  throw new Error(`acceptance checklist durability: autosave did not persist clicked states (${detail})`)
}

function dispatchKey(
  target: EventTarget,
  key: string,
  options: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    isComposing?: boolean
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    isComposing: options.isComposing ?? false,
  })
  target.dispatchEvent(event)
  return event
}

async function waitForNoteTransition(
  getNoteID: () => string,
  isTransitionActive: () => boolean,
  previousNoteID: string,
  timeoutMs = 4000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await tick()
    await delay(30)
    const current = getNoteID()
    if (current && current !== previousNoteID && !isTransitionActive()) {
      await tick()
      await delay(50)
      return current
    }
  }
  throw new Error(`acceptance S3: timed out waiting for note transition from "${previousNoteID}"`)
}

export async function runNewNoteShortcutAcceptance(
  callbacks: NewNoteShortcutAcceptanceCallbacks,
): Promise<void> {
  const {
    getNoteID,
    getTitle,
    getDocumentJSON,
    isSidebarVisible,
    getCurrentFolderID,
    isSettingsOpen,
    isNoteTransitionActive,
    applyNote,
    refreshSidebar,
  } = callbacks

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
  const primaryModifier = isMac ? { metaKey: true } : { ctrlKey: true }

  try {
    const dataSafetyAcceptanceMode = import.meta.env.VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE ?? ''
    if (dataSafetyAcceptanceMode) {
      await runDataSafetyAcceptance(dataSafetyAcceptanceMode)
    }

    const originalNoteID = getNoteID()
    if (!originalNoteID) {
      throw new Error('acceptance S3: no note is currently open')
    }

    const originalDocJSON = getDocumentJSON()
    const acceptanceText = import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_TEXT ?? ''
    if (acceptanceText && !originalDocJSON.includes(acceptanceText)) {
      throw new Error('acceptance S3: original note does not contain expected acceptanceText before S3 suite')
    }

    if (acceptanceText) {
      const clickedChecklistStates = checklistStates(originalDocJSON, acceptanceText)
      if (!sameBooleanStates(clickedChecklistStates, [true, false])) {
        throw new Error(
          `acceptance checklist durability: unexpected post-click in-memory states ${JSON.stringify(clickedChecklistStates)}`,
        )
      }
      await waitForDurableChecklist(originalNoteID, acceptanceText, clickedChecklistStates)
      console.log('FLASHNOTE_CHECKLIST_DURABLE_ACCEPTANCE_SUCCESS')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // S3A. CREATE MENU → NEW NOTE CLICK PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const [menuBaselineRootIDs] = (await ListRootNotes()) as [string[], string[]]
    if (!menuBaselineRootIDs.includes(originalNoteID) || getCurrentFolderID() !== '') {
      throw new Error('acceptance sidebar create: expected the acceptance note at root before New note click proof')
    }

    const menuCreateButton = document.querySelector<HTMLButtonElement>(
      '.create-controls > button[aria-label="Create"]',
    )
    if (!menuCreateButton || menuCreateButton.disabled) {
      throw new Error('acceptance sidebar create: Create button is missing or disabled before New note click proof')
    }
    menuCreateButton.click()
    await tick()
    await delay(30)

    const menu = document.querySelector<HTMLElement>('.create-menu')
    const menuNewNoteButton = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === 'New note')
    if (!menu || !menuNewNoteButton) {
      throw new Error('acceptance sidebar create: New note action is missing from the open Create menu')
    }

    menuNewNoteButton.click()
    const menuCreatedNoteID = await waitForNoteTransition(
      getNoteID,
      isNoteTransitionActive,
      originalNoteID,
    )
    if (document.querySelector('.create-menu') !== null) {
      throw new Error('acceptance sidebar create: Create menu remained open after New note click')
    }
    if (getCurrentFolderID() !== '') {
      throw new Error('acceptance sidebar create: root New note click created a note outside root')
    }
    if (getTitle() !== '') {
      throw new Error(`acceptance sidebar create: New note click created non-empty title "${getTitle()}"`)
    }
    const menuTitleEl = document.querySelector<HTMLInputElement>('.title')
    if (!menuTitleEl || document.activeElement !== menuTitleEl) {
      throw new Error('acceptance sidebar create: New note click did not focus the title immediately')
    }

    const [menuRootIDs, menuRootTitles] = (await ListRootNotes()) as [string[], string[]]
    const addedRootIDs = menuRootIDs.filter((id) => !menuBaselineRootIDs.includes(id))
    const menuCreatedIndex = menuRootIDs.indexOf(menuCreatedNoteID)
    if (
      menuRootIDs.length !== menuBaselineRootIDs.length + 1 ||
      addedRootIDs.length !== 1 ||
      addedRootIDs[0] !== menuCreatedNoteID ||
      menuCreatedIndex < 0 ||
      menuRootTitles[menuCreatedIndex] !== 'Untitled'
    ) {
      throw new Error('acceptance sidebar create: New note click did not add exactly one Untitled root note')
    }

    const [menuFolderIDs] = (await ListFolders()) as [string[], string[]]
    for (const folderID of menuFolderIDs) {
      const [folderNoteIDs] = (await ListFolderNotes(folderID)) as [string[], string[]]
      if (folderNoteIDs.includes(menuCreatedNoteID)) {
        throw new Error(`acceptance sidebar create: New note click leaked into folder ${folderID}`)
      }
    }

    const menuCreatedSnapshot = (await OpenNote(menuCreatedNoteID)) as NoteTuple
    if (
      menuCreatedSnapshot[0] !== menuCreatedNoteID ||
      menuCreatedSnapshot[1] !== '' ||
      menuCreatedSnapshot[3] !== 1
    ) {
      throw new Error('acceptance sidebar create: New note click did not produce the canonical empty revision-1 note')
    }
    const menuDocumentEnvelope = JSON.parse(menuCreatedSnapshot[2]) as { schemaVersion?: unknown; doc?: unknown }
    if (menuDocumentEnvelope.schemaVersion !== 1 || !menuDocumentEnvelope.doc || typeof menuDocumentEnvelope.doc !== 'object') {
      throw new Error('acceptance sidebar create: New note click produced an invalid canonical document envelope')
    }

    const originalAfterMenuSnapshot = (await OpenNote(originalNoteID)) as NoteTuple
    if (
      originalAfterMenuSnapshot[0] !== originalNoteID ||
      (acceptanceText && !originalAfterMenuSnapshot[2].includes(acceptanceText))
    ) {
      throw new Error('acceptance sidebar create: original note was not durable before restoring the fixture')
    }
    applyNote(originalAfterMenuSnapshot)
    await refreshSidebar()
    await tick()
    await delay(30)
    if (getNoteID() !== originalNoteID || getCurrentFolderID() !== '') {
      throw new Error('acceptance sidebar create: failed to restore original root note after New note click proof')
    }

    await MoveNoteToTrash(menuCreatedNoteID)
    await PermanentlyDeleteNote(menuCreatedNoteID)
    await refreshSidebar()
    const [menuCleanupRootIDs] = (await ListRootNotes()) as [string[], string[]]
    if (JSON.stringify(menuCleanupRootIDs) !== JSON.stringify(menuBaselineRootIDs)) {
      throw new Error('acceptance sidebar create: New note click fixture cleanup did not restore the root baseline')
    }
    for (const folderID of menuFolderIDs) {
      const [folderNoteIDs] = (await ListFolderNotes(folderID)) as [string[], string[]]
      if (folderNoteIDs.includes(menuCreatedNoteID)) {
        throw new Error(`acceptance sidebar create: cleaned New note fixture remained in folder ${folderID}`)
      }
    }
    console.log('FLASHNOTE_CREATE_MENU_NEW_NOTE_ACCEPTANCE_SUCCESS')

    const plainNEvent = dispatchKey(window, 'n')
    await tick()
    await delay(30)
    if (plainNEvent.defaultPrevented || getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: plain "n" unexpectedly triggered new-note handling')
    }

    const shiftEvent = dispatchKey(window, 'N', { ...primaryModifier, shiftKey: true })
    await tick()
    await delay(30)
    if (shiftEvent.defaultPrevented || getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: Cmd/Ctrl+Shift+N unexpectedly triggered new-note handling')
    }

    const altEvent = dispatchKey(window, 'n', { altKey: true })
    await tick()
    await delay(30)
    if (altEvent.defaultPrevented || getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: Alt+N unexpectedly triggered new-note handling')
    }

    const modAltEvent = dispatchKey(window, 'n', { ...primaryModifier, altKey: true })
    await tick()
    await delay(30)
    if (modAltEvent.defaultPrevented || getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: Cmd/Ctrl+Alt+N unexpectedly triggered new-note handling')
    }

    const composingEvent = dispatchKey(window, 'n', { ...primaryModifier, isComposing: true })
    await tick()
    await delay(30)
    if (composingEvent.defaultPrevented || getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: composing Cmd/Ctrl+N unexpectedly triggered new-note handling')
    }

    if (isSidebarVisible()) {
      const hideSidebarEvent = dispatchKey(window, '\\', primaryModifier)
      await tick()
      await delay(30)
      if (!hideSidebarEvent.defaultPrevented || isSidebarVisible()) {
        throw new Error('acceptance S3: failed to hide sidebar for S2 independence setup')
      }
    }

    const openSettingsEvent = dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(30)
    if (!openSettingsEvent.defaultPrevented || !isSettingsOpen() || document.querySelector('.settings-dialog') === null) {
      throw new Error('acceptance S3: failed to open Settings for overlay dismissal setup')
    }

    const rootCreateEvent = dispatchKey(window, 'n', primaryModifier)
    if (!rootCreateEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+N was not default-prevented')
    }
    const newRootNoteID = await waitForNoteTransition(getNoteID, isNoteTransitionActive, originalNoteID)

    if (isSettingsOpen() || document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance S3: Settings dialog remained open after Cmd/Ctrl+N')
    }
    if (isSidebarVisible()) {
      throw new Error('acceptance S3: sidebar was unexpectedly made visible after Cmd/Ctrl+N')
    }
    const shell = document.querySelector<HTMLElement>('main.shell')
    if (!shell || !shell.classList.contains('sidebar-hidden')) {
      throw new Error('acceptance S3: shell lost .sidebar-hidden class after Cmd/Ctrl+N')
    }

    if (getTitle() !== '') {
      throw new Error(`acceptance S3: expected empty title for new note, got "${getTitle()}"`)
    }
    const titleEl = document.querySelector<HTMLInputElement>('.title')
    if (!titleEl || document.activeElement !== titleEl) {
      throw new Error('acceptance S3: title did not receive immediate focus')
    }

    const titleDocumentBeforeEnter = getDocumentJSON()
    const blankTitleSnapshot = (await OpenNote(newRootNoteID)) as NoteTuple
    if (blankTitleSnapshot[1] !== '' || blankTitleSnapshot[2] !== titleDocumentBeforeEnter) {
      throw new Error('acceptance title: canonical new-note title/document is not the expected empty initial state')
    }

    const titleEnterEvent = dispatchKey(titleEl, 'Enter')
    await tick()
    await delay(30)
    const editorElement = document.querySelector<HTMLElement>('.prose-editor')
    if (!titleEnterEvent.defaultPrevented || !editorElement || document.activeElement !== editorElement) {
      throw new Error('acceptance title: Enter did not move focus from title to body')
    }
    if (getNoteID() !== newRootNoteID || getTitle() !== '' || getDocumentJSON() !== titleDocumentBeforeEnter || isNoteTransitionActive()) {
      throw new Error('acceptance title: Enter mutated or transitioned the new note')
    }
    const afterTitleEnterSnapshot = (await OpenNote(newRootNoteID)) as NoteTuple
    if (afterTitleEnterSnapshot[1] !== '' || afterTitleEnterSnapshot[2] !== blankTitleSnapshot[2] || afterTitleEnterSnapshot[3] !== blankTitleSnapshot[3]) {
      throw new Error('acceptance title: Enter changed durable title, document, or revision')
    }
    console.log('FLASHNOTE_TITLE_ENTER_ACCEPTANCE_SUCCESS')

    const [rootIDs, rootTitles] = (await ListRootNotes()) as [string[], string[]]
    const rootIndex = rootIDs.indexOf(newRootNoteID)
    if (rootIndex < 0 || rootTitles[rootIndex] !== 'Untitled') {
      throw new Error('acceptance title: empty root note did not retain Untitled as presentation-only display title')
    }
    if (getCurrentFolderID() !== '') {
      throw new Error('acceptance S3: new root note unexpectedly has folder membership')
    }
    const [allFolderIDs] = (await ListFolders()) as [string[], string[]]
    for (const fID of allFolderIDs) {
      const [fNoteIDs] = (await ListFolderNotes(fID)) as [string[], string[]]
      if (fNoteIDs.includes(newRootNoteID)) {
        throw new Error(`acceptance S3: new root note was found in folder ${fID}`)
      }
    }

    const newDocEnvelope = JSON.parse(getDocumentJSON()) as { schemaVersion?: unknown; doc?: unknown }
    if (newDocEnvelope.schemaVersion !== 1 || typeof newDocEnvelope.doc !== 'object') {
      throw new Error('acceptance S3: new note canonical document envelope is invalid')
    }

    const originalSnapshot = (await OpenNote(originalNoteID)) as NoteTuple
    if (originalSnapshot[0] !== originalNoteID || (acceptanceText && !originalSnapshot[2].includes(acceptanceText))) {
      throw new Error('acceptance S3: original note pending save was not durable before navigation')
    }

    const openSearchEvent = dispatchKey(window, 'k', primaryModifier)
    if (!openSearchEvent.defaultPrevented) {
      throw new Error('acceptance search UI: Cmd/Ctrl+K was not handled')
    }
    const searchStart = Date.now()
    while (Date.now() - searchStart < 4000) {
      await tick()
      await delay(30)
      const input = document.querySelector<HTMLInputElement>('.search-input')
      if (input && document.activeElement === input && document.querySelectorAll('.search-result').length >= 2) {
        break
      }
    }
    let searchInput = document.querySelector<HTMLInputElement>('.search-input')
    let searchResults = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-result'))
    if (!searchInput || document.activeElement !== searchInput || searchResults.length < 2) {
      throw new Error('acceptance search UI: recent search did not open focused with at least two results')
    }
    if (document.querySelector<HTMLElement>('.search-section-label')?.textContent?.trim() !== 'Recently modified') {
      throw new Error('acceptance search UI: empty query did not show Recently modified')
    }
    if (!searchResults[0]?.classList.contains('selected')) {
      throw new Error('acceptance search UI: first recent result was not selected initially')
    }

    const searchDownEvent = dispatchKey(searchInput, 'ArrowDown')
    await tick()
    searchResults = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-result'))
    if (!searchDownEvent.defaultPrevented || !searchResults[1]?.classList.contains('selected')) {
      throw new Error('acceptance search UI: ArrowDown did not select the second result')
    }
    const searchUpEvent = dispatchKey(searchInput, 'ArrowUp')
    await tick()
    searchResults = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-result'))
    if (!searchUpEvent.defaultPrevented || !searchResults[0]?.classList.contains('selected')) {
      throw new Error('acceptance search UI: ArrowUp did not restore the first result')
    }
    const searchEscapeEvent = dispatchKey(searchInput, 'Escape')
    await tick()
    await delay(30)
    if (!searchEscapeEvent.defaultPrevented || document.querySelector('.search-dialog') !== null || getNoteID() !== newRootNoteID) {
      throw new Error('acceptance search UI: Escape did not dismiss search without changing notes')
    }

    const reopenSearchEvent = dispatchKey(window, 'k', primaryModifier)
    if (!reopenSearchEvent.defaultPrevented) {
      throw new Error('acceptance search UI: Cmd/Ctrl+K did not reopen search')
    }
    const reopenStart = Date.now()
    while (Date.now() - reopenStart < 4000) {
      await tick()
      await delay(30)
      searchInput = document.querySelector<HTMLInputElement>('.search-input')
      if (searchInput && document.activeElement === searchInput && document.querySelectorAll('.search-result').length >= 2) {
        break
      }
    }
    searchInput = document.querySelector<HTMLInputElement>('.search-input')
    if (!searchInput || document.activeElement !== searchInput) {
      throw new Error('acceptance search UI: reopened search input did not receive focus')
    }
    const originalRootIndex = rootIDs.indexOf(originalNoteID)
    if (originalRootIndex < 0) {
      throw new Error('acceptance search UI: original note is missing from root presentation data')
    }
    const targetDisplayTitle = rootTitles[originalRootIndex] ?? 'Untitled'
    const queryToken = acceptanceText.trim().split(/\s+/).find((token) => token.length >= 4) ?? ''
    if (!queryToken) {
      throw new Error('acceptance search UI: acceptance text has no usable query token')
    }
    searchInput.value = queryToken
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    const queryStart = Date.now()
    while (Date.now() - queryStart < 4000) {
      await tick()
      await delay(30)
      searchResults = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-result'))
      if (searchResults.length === 1 && searchResults[0]?.querySelector('.search-result-title')?.textContent?.trim() === targetDisplayTitle) {
        break
      }
    }
    searchResults = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-result'))
    if (searchResults.length !== 1 || searchResults[0]?.querySelector('.search-result-title')?.textContent?.trim() !== targetDisplayTitle) {
      throw new Error(`acceptance search UI: query "${queryToken}" did not isolate the original note`)
    }
    if (document.querySelector<HTMLElement>('.search-section-label')?.textContent?.trim() !== 'Results') {
      throw new Error('acceptance search UI: non-empty query did not show Results label')
    }
    const searchEnterEvent = dispatchKey(searchInput, 'Enter')
    if (!searchEnterEvent.defaultPrevented) {
      throw new Error('acceptance search UI: Enter was not handled for the selected result')
    }
    const activationStart = Date.now()
    while (Date.now() - activationStart < 4000) {
      await tick()
      await delay(30)
      if (getNoteID() === originalNoteID && !isNoteTransitionActive() && document.querySelector('.search-dialog') === null) {
        break
      }
    }
    if (getNoteID() !== originalNoteID || isNoteTransitionActive() || document.querySelector('.search-dialog') !== null) {
      throw new Error('acceptance search UI: Enter did not open the selected note and dismiss search')
    }
    console.log('FLASHNOTE_SEARCH_UI_ACCEPTANCE_SUCCESS')

    await MoveNoteToTrash(newRootNoteID)
    await PermanentlyDeleteNote(newRootNoteID)
    applyNote(originalSnapshot)
    await refreshSidebar()
    await tick()

    if (!isSidebarVisible()) {
      dispatchKey(window, '\\', primaryModifier)
      await tick()
      await delay(30)
    }

    const [tempFolderID] = (await CreateFolder('S3 Temp Acceptance Folder')) as [string, string]
    await MoveNote(originalNoteID, tempFolderID)
    await refreshSidebar()
    await tick()
    if (getCurrentFolderID() !== tempFolderID) {
      throw new Error('acceptance S3: original note did not resolve to temporary folder')
    }

    const folderCreateEvent = dispatchKey(window, 'n', primaryModifier)
    if (!folderCreateEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+N inside folder was not handled')
    }
    const newFolderNoteID = await waitForNoteTransition(getNoteID, isNoteTransitionActive, originalNoteID)
    const [folderNoteIDs] = (await ListFolderNotes(tempFolderID)) as [string[], string[]]
    if (!folderNoteIDs.includes(newFolderNoteID)) {
      throw new Error('acceptance S3: new note not found in temp folder note list')
    }
    const [rootAfterFolderCreate] = (await ListRootNotes()) as [string[], string[]]
    if (rootAfterFolderCreate.includes(newFolderNoteID)) {
      throw new Error('acceptance S3: new folder note unexpectedly found in root note list')
    }
    const folderTitleEl = document.querySelector<HTMLInputElement>('.title')
    if (!folderTitleEl || document.activeElement !== folderTitleEl) {
      throw new Error('acceptance S3: title did not receive focus after folder note creation')
    }

    await MoveNoteToTrash(newFolderNoteID)
    await PermanentlyDeleteNote(newFolderNoteID)
    await MoveNote(originalNoteID, '')
    await MoveFolderToTrash(tempFolderID)
    await PermanentlyDeleteFolder(tempFolderID)

    const cleanOriginalSnapshot = (await OpenNote(originalNoteID)) as NoteTuple
    applyNote(cleanOriginalSnapshot)
    await refreshSidebar()
    await tick()
    if (getCurrentFolderID() !== '') {
      throw new Error('acceptance S3: original note not at root after cleanup')
    }

    console.log('FLASHNOTE_S3_ACCEPTANCE_SUCCESS')
    console.log('FLASHNOTE_NEW_NOTE_SHORTCUT_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_NEW_NOTE_SHORTCUT_ACCEPTANCE_FAILURE', error)
    throw error
  }
}
