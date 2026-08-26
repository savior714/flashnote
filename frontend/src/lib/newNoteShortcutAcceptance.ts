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
    // A. NEGATIVE TRIGGERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 1. Plain n (no modifier)
    const plainNEvent = dispatchKey(window, 'n')
    await tick()
    await delay(30)
    if (plainNEvent.defaultPrevented) {
      throw new Error('acceptance S3: plain "n" was unexpectedly default-prevented')
    }
    if (getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: plain "n" unexpectedly created/switched note')
    }

    // 2. Cmd/Ctrl + Shift + N
    const shiftEvent = dispatchKey(window, 'N', { ...primaryModifier, shiftKey: true })
    await tick()
    await delay(30)
    if (shiftEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+Shift+N was unexpectedly default-prevented')
    }
    if (getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: Cmd/Ctrl+Shift+N unexpectedly created/switched note')
    }

    // 3. Alt + N
    const altEvent = dispatchKey(window, 'n', { altKey: true })
    await tick()
    await delay(30)
    if (altEvent.defaultPrevented) {
      throw new Error('acceptance S3: Alt+N was unexpectedly default-prevented')
    }
    if (getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: Alt+N unexpectedly created/switched note')
    }

    // 4. Cmd/Ctrl + Alt + N
    const modAltEvent = dispatchKey(window, 'n', { ...primaryModifier, altKey: true })
    await tick()
    await delay(30)
    if (modAltEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+Alt+N was unexpectedly default-prevented')
    }
    if (getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: Cmd/Ctrl+Alt+N unexpectedly created/switched note')
    }

    // 5. Composing IME Cmd/Ctrl + N
    const composingEvent = dispatchKey(window, 'n', { ...primaryModifier, isComposing: true })
    await tick()
    await delay(30)
    if (composingEvent.defaultPrevented) {
      throw new Error('acceptance S3: composing Cmd/Ctrl+N was unexpectedly default-prevented')
    }
    if (getNoteID() !== originalNoteID) {
      throw new Error('acceptance S3: composing Cmd/Ctrl+N unexpectedly created/switched note')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // B. ROOT NOTE CREATION + SETTINGS OVERLAY DISMISSAL + SIDEBAR HIDDEN PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Hide sidebar via shortcut to prove S2 independence
    if (isSidebarVisible()) {
      const hideSidebarEvent = dispatchKey(window, '\\', primaryModifier)
      await tick()
      await delay(30)
      if (!hideSidebarEvent.defaultPrevented || isSidebarVisible()) {
        throw new Error('acceptance S3: failed to hide sidebar for S2 independence setup')
      }
    }

    // Open Settings via shortcut to prove overlay dismissal
    const openSettingsEvent = dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(30)
    if (!openSettingsEvent.defaultPrevented || !isSettingsOpen()) {
      throw new Error('acceptance S3: failed to open Settings for overlay dismissal setup')
    }
    if (document.querySelector('.settings-dialog') === null) {
      throw new Error('acceptance S3: Settings dialog element not found in DOM')
    }

    // Dispatch actual Cmd/Ctrl+N while Settings is open and sidebar is hidden
    const rootCreateEvent = dispatchKey(window, 'n', primaryModifier)
    if (!rootCreateEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+N was not default-prevented')
    }

    const newRootNoteID = await waitForNoteTransition(getNoteID, isNoteTransitionActive, originalNoteID)
    if (!newRootNoteID) {
      throw new Error('acceptance S3: new root note ID is empty')
    }

    // 1. Settings overlay must be closed
    if (isSettingsOpen() || document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance S3: Settings dialog remained open after Cmd/Ctrl+N')
    }

    // 2. Sidebar hidden state must be preserved
    if (isSidebarVisible()) {
      throw new Error('acceptance S3: sidebar was unexpectedly made visible after Cmd/Ctrl+N')
    }
    const shell = document.querySelector<HTMLElement>('main.shell')
    if (!shell || !shell.classList.contains('sidebar-hidden')) {
      throw new Error('acceptance S3: shell lost .sidebar-hidden class after Cmd/Ctrl+N')
    }

    // 3. Title input must be empty and focused (activeElement)
    if (getTitle() !== '') {
      throw new Error(`acceptance S3: expected empty title for new note, got "${getTitle()}"`)
    }
    const titleEl = document.querySelector<HTMLInputElement>('.title')
    if (!titleEl) {
      throw new Error('acceptance S3: .title input element not found in DOM')
    }
    if (document.activeElement !== titleEl) {
      throw new Error(`acceptance S3: .title is not document.activeElement (active: ${document.activeElement?.className})`)
    }

    // 4. Note must appear in root notes and NOT in any folder
    const [rootIDs] = (await ListRootNotes()) as [string[], string[]]
    if (!rootIDs.includes(newRootNoteID)) {
      throw new Error('acceptance S3: new note not found in ListRootNotes()')
    }
    if (getCurrentFolderID() !== '') {
      throw new Error(`acceptance S3: new root note unexpectedly has currentFolderID "${getCurrentFolderID()}"`)
    }
    const [allFolderIDs] = (await ListFolders()) as [string[], string[]]
    for (const fID of allFolderIDs) {
      const [fNoteIDs] = (await ListFolderNotes(fID)) as [string[], string[]]
      if (fNoteIDs.includes(newRootNoteID)) {
        throw new Error(`acceptance S3: new root note was found in folder ${fID}`)
      }
    }

    // 5. Canonical document must be valid initial document
    const newDocEnvelope = JSON.parse(getDocumentJSON()) as { schemaVersion?: unknown; doc?: unknown }
    if (newDocEnvelope.schemaVersion !== 1 || typeof newDocEnvelope.doc !== 'object') {
      throw new Error('acceptance S3: new note canonical document envelope is invalid')
    }

    // 6. Save safety: verify original note was flushed before transition
    const originalSnapshot = (await OpenNote(originalNoteID)) as NoteTuple
    if (originalSnapshot[0] !== originalNoteID) {
      throw new Error('acceptance S3: failed to retrieve original note for save flush verification')
    }
    if (acceptanceText && !originalSnapshot[2].includes(acceptanceText)) {
      throw new Error('acceptance S3: original note pending save was not flushed to database before navigation')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // C. CLEANUP ROOT TEST NOTE & RESTORE ORIGINAL NOTE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await MoveNoteToTrash(newRootNoteID)
    await PermanentlyDeleteNote(newRootNoteID)

    // Restore original acceptance note
    applyNote(originalSnapshot)
    await refreshSidebar()
    await tick()

    // Restore sidebar visibility
    if (!isSidebarVisible()) {
      dispatchKey(window, '\\', primaryModifier)
      await tick()
      await delay(30)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D. FOLDER LOCATION PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const [tempFolderID] = (await CreateFolder('S3 Temp Acceptance Folder')) as [string, string]
    await MoveNote(originalNoteID, tempFolderID)
    await refreshSidebar()
    await tick()

    if (getCurrentFolderID() !== tempFolderID) {
      throw new Error(`acceptance S3: currentFolderID ("${getCurrentFolderID()}") did not resolve to temp folder ("${tempFolderID}")`)
    }

    // Dispatch actual Cmd/Ctrl+N while inside folder
    const folderCreateEvent = dispatchKey(window, 'n', primaryModifier)
    if (!folderCreateEvent.defaultPrevented) {
      throw new Error('acceptance S3: Cmd/Ctrl+N inside folder was not default-prevented')
    }

    const newFolderNoteID = await waitForNoteTransition(getNoteID, isNoteTransitionActive, originalNoteID)
    if (!newFolderNoteID) {
      throw new Error('acceptance S3: new folder note ID is empty')
    }

    // 1. Note must be inside the temp folder
    const [folderNoteIDs] = (await ListFolderNotes(tempFolderID)) as [string[], string[]]
    if (!folderNoteIDs.includes(newFolderNoteID)) {
      throw new Error('acceptance S3: new note not found in temp folder note list')
    }

    // 2. Note must NOT be in root notes
    const [rootAfterFolderCreate] = (await ListRootNotes()) as [string[], string[]]
    if (rootAfterFolderCreate.includes(newFolderNoteID)) {
      throw new Error('acceptance S3: new folder note unexpectedly found in root note list')
    }

    // 3. Title input must be focused
    const folderTitleEl = document.querySelector<HTMLInputElement>('.title')
    if (!folderTitleEl || document.activeElement !== folderTitleEl) {
      throw new Error(`acceptance S3: .title is not document.activeElement after folder note creation (active: ${document.activeElement?.className})`)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E. CLEANUP FOLDER TEST NOTE & TEMPORARY FOLDER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await MoveNoteToTrash(newFolderNoteID)
    await PermanentlyDeleteNote(newFolderNoteID)

    // Move original note back to root
    await MoveNote(originalNoteID, '')

    // Delete temporary folder
    await MoveFolderToTrash(tempFolderID)
    await PermanentlyDeleteFolder(tempFolderID)

    // Reapply original note and verify clean state
    const cleanOriginalSnapshot = (await OpenNote(originalNoteID)) as NoteTuple
    applyNote(cleanOriginalSnapshot)
    await refreshSidebar()
    await tick()

    if (getCurrentFolderID() !== '') {
      throw new Error(`acceptance S3: original note not at root after cleanup (currentFolderID="${getCurrentFolderID()}")`)
    }

    console.log('FLASHNOTE_S3_ACCEPTANCE_SUCCESS')
    console.log('FLASHNOTE_NEW_NOTE_SHORTCUT_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_NEW_NOTE_SHORTCUT_ACCEPTANCE_FAILURE', error)
    throw error
  }
}
