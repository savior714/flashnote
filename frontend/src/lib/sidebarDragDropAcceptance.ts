import { tick } from 'svelte'
import {
  CreateFolder,
  CreateNoteInFolder,
  ListFolderNotes,
  ListFolders,
  ListNotes,
  ListRootNotes,
  ListTrashNotes,
  MoveFolderToTrash,
  MoveNote,
  MoveNoteToTrash,
  OpenNote,
  PermanentlyDeleteFolder,
  PermanentlyDeleteNote,
  RestoreFolder,
  RestoreNote,
  SearchNotes,
  TrashCounts,
} from '../../bindings/github.com/savior714/flashnote/appservice'

type AcceptanceOptions = {
  refreshSidebar: () => Promise<void>
}

type NoteTuple = [string, string, string, number, boolean]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return
    }
    await delay(30)
  }
  throw new Error(`acceptance sidebar DnD: timed out waiting for ${description}`)
}

function folderBlock(folderID: string): HTMLElement {
  const block = Array.from(document.querySelectorAll<HTMLElement>('.folder-block')).find(
    (candidate) => candidate.dataset.folderId === folderID,
  )
  if (!block) {
    throw new Error(`acceptance sidebar DnD: folder ${folderID} is not rendered`)
  }
  return block
}

function noteRow(noteID: string): HTMLElement {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.note-row')).find(
    (candidate) => candidate.dataset.noteId === noteID,
  )
  if (!row) {
    throw new Error(`acceptance sidebar DnD: note ${noteID} is not rendered`)
  }
  return row
}

async function expandFolder(folderID: string): Promise<void> {
  const block = folderBlock(folderID)
  const row = block.querySelector<HTMLButtonElement>('.folder-row')
  if (!row) {
    throw new Error(`acceptance sidebar DnD: folder ${folderID} is missing its row`)
  }
  if (row.getAttribute('aria-expanded') !== 'true') {
    row.click()
    await tick()
    await delay(30)
  }
}

function dispatchDrag(target: HTMLElement, type: 'dragstart' | 'dragover' | 'drop' | 'dragend'): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

async function folderContains(folderID: string, noteID: string): Promise<boolean> {
  const [ids] = (await ListFolderNotes(folderID)) as [string[], string[]]
  return ids.includes(noteID)
}

async function rootContains(noteID: string): Promise<boolean> {
  const [ids] = (await ListRootNotes()) as [string[], string[]]
  return ids.includes(noteID)
}

async function trashContains(noteID: string): Promise<boolean> {
  const [ids] = (await ListTrashNotes()) as [string[], string[]]
  return ids.includes(noteID)
}

function sameIDs(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

async function proveDirtyCurrentNoteFlush(noteID: string, targetFolderID: string): Promise<void> {
  if (!(await rootContains(noteID))) {
    throw new Error('acceptance sidebar DnD dirty flush: current note must begin at root')
  }

  const titleInput = document.querySelector<HTMLInputElement>('.title')
  if (!titleInput) {
    throw new Error('acceptance sidebar DnD dirty flush: title input is missing')
  }

  const original = (await OpenNote(noteID)) as NoteTuple
  if (titleInput.value !== original[1]) {
    throw new Error('acceptance sidebar DnD dirty flush: editor title differs from durable title before edit')
  }

  const dirtyTitle = `${original[1]}${original[1] ? ' ' : ''}[DnD pending draft]`
  titleInput.value = dirtyTitle
  titleInput.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()

  const currentRootRow = noteRow(noteID)
  const targetBlock = folderBlock(targetFolderID)
  dispatchDrag(currentRootRow, 'dragstart')
  const targetDragOver = dispatchDrag(targetBlock, 'dragover')
  if (!targetDragOver.defaultPrevented) {
    throw new Error('acceptance sidebar DnD dirty flush: target folder rejected current note drag')
  }
  dispatchDrag(targetBlock, 'drop')
  dispatchDrag(currentRootRow, 'dragend')

  await waitFor(
    async () => (await folderContains(targetFolderID, noteID)) && !(await rootContains(noteID)),
    'dirty current note root-to-folder move',
  )

  const persistedDirty = (await OpenNote(noteID)) as NoteTuple
  if (persistedDirty[1] !== dirtyTitle) {
    throw new Error('acceptance sidebar DnD dirty flush: pending title was not durable before membership moved')
  }
  if (persistedDirty[2] !== original[2]) {
    throw new Error('acceptance sidebar DnD dirty flush: moving dirty title changed document content')
  }
  if (persistedDirty[3] <= original[3]) {
    throw new Error('acceptance sidebar DnD dirty flush: durable revision did not advance before move')
  }

  titleInput.value = original[1]
  titleInput.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  await expandFolder(targetFolderID)

  const currentFolderRow = noteRow(noteID)
  const rootDropZone = document.querySelector<HTMLElement>('.root-note-drop-zone')
  if (!rootDropZone) {
    throw new Error('acceptance sidebar DnD dirty flush: root drop zone is missing')
  }
  dispatchDrag(currentFolderRow, 'dragstart')
  const rootDragOver = dispatchDrag(rootDropZone, 'dragover')
  if (!rootDragOver.defaultPrevented) {
    throw new Error('acceptance sidebar DnD dirty flush: root rejected current note drag')
  }
  dispatchDrag(rootDropZone, 'drop')
  dispatchDrag(currentFolderRow, 'dragend')

  await waitFor(
    async () => (await rootContains(noteID)) && !(await folderContains(targetFolderID, noteID)),
    'restored current note folder-to-root move',
  )

  const restored = (await OpenNote(noteID)) as NoteTuple
  if (restored[1] !== original[1] || restored[2] !== original[2]) {
    throw new Error('acceptance sidebar DnD dirty flush: original note content was not restored durably')
  }
  if (restored[3] <= persistedDirty[3]) {
    throw new Error('acceptance sidebar DnD dirty flush: restoration was not durably acknowledged')
  }

  console.log('FLASHNOTE_SIDEBAR_DND_DIRTY_FLUSH_SUCCESS')
}

async function proveContextTrashUndo(
  currentNoteID: string,
  siblingNoteID: string,
  folderID: string,
  emptyFolderID: string,
  refreshSidebar: () => Promise<void>,
): Promise<void> {
  await MoveNote(siblingNoteID, folderID)
  await MoveNote(currentNoteID, folderID)
  await refreshSidebar()
  await tick()
  await expandFolder(folderID)

  const openCurrentNoteContextMenu = async (): Promise<{ menu: HTMLElement; event: MouseEvent }> => {
    const row = noteRow(currentNoteID)
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 120,
    })
    row.dispatchEvent(event)
    await tick()
    await delay(30)
    if (!event.defaultPrevented) {
      throw new Error('acceptance note context move: note contextmenu was not handled')
    }
    const menu = document.querySelector<HTMLElement>('.note-context-menu')
    if (!menu) {
      throw new Error('acceptance note context move: note context menu is missing')
    }
    return { menu, event }
  }

  const [allFolderIDs, allFolderNames] = (await ListFolders()) as [string[], string[]]
  const sourceFolderIndex = allFolderIDs.indexOf(folderID)
  const targetFolderIndex = allFolderIDs.indexOf(emptyFolderID)
  if (sourceFolderIndex < 0 || targetFolderIndex < 0) {
    throw new Error('acceptance note context move: source or target folder fixture is missing')
  }

  let { menu: contextMenu } = await openCurrentNoteContextMenu()
  if (contextMenu.querySelector<HTMLElement>('.context-menu-label')?.textContent?.trim() !== 'Move to…') {
    throw new Error('acceptance note context move: Move to… label is missing')
  }
  let destinationButtons = Array.from(
    contextMenu.querySelectorAll<HTMLButtonElement>('button:not(.context-danger)'),
  )
  const expectedDestinationLabels = ['Root', ...allFolderNames]
  const destinationLabels = destinationButtons.map((button) => button.textContent?.trim() ?? '')
  if (JSON.stringify(destinationLabels) !== JSON.stringify(expectedDestinationLabels)) {
    throw new Error(
      `acceptance note context move: expected destinations ${JSON.stringify(expectedDestinationLabels)}, got ${JSON.stringify(destinationLabels)}`,
    )
  }

  const rootDestination = destinationButtons[0]
  const currentFolderDestination = destinationButtons[sourceFolderIndex + 1]
  const targetFolderDestination = destinationButtons[targetFolderIndex + 1]
  if (!rootDestination || !currentFolderDestination || !targetFolderDestination) {
    throw new Error('acceptance note context move: Root/current/target destination controls are incomplete')
  }
  if (rootDestination.disabled || !currentFolderDestination.disabled || targetFolderDestination.disabled) {
    throw new Error('acceptance note context move: destination enabled states do not match current folder')
  }

  targetFolderDestination.click()
  await waitFor(
    async () =>
      (await folderContains(emptyFolderID, currentNoteID)) &&
      !(await folderContains(folderID, currentNoteID)),
    'context-menu folder-to-folder move',
  )
  await refreshSidebar()
  await tick()
  await expandFolder(emptyFolderID)

  ;({ menu: contextMenu } = await openCurrentNoteContextMenu())
  destinationButtons = Array.from(
    contextMenu.querySelectorAll<HTMLButtonElement>('button:not(.context-danger)'),
  )
  const rootDestinationAfterFolderMove = destinationButtons[0]
  const targetDestinationAfterFolderMove = destinationButtons[targetFolderIndex + 1]
  if (!rootDestinationAfterFolderMove || rootDestinationAfterFolderMove.disabled || !targetDestinationAfterFolderMove?.disabled) {
    throw new Error('acceptance note context move: Root/target enabled states are wrong after folder move')
  }

  rootDestinationAfterFolderMove.click()
  await waitFor(
    async () =>
      (await rootContains(currentNoteID)) &&
      !(await folderContains(emptyFolderID, currentNoteID)),
    'context-menu folder-to-root move',
  )
  await refreshSidebar()
  await tick()

  await MoveNote(currentNoteID, folderID)
  await refreshSidebar()
  await tick()
  await expandFolder(folderID)
  await SearchNotes('flashnote-note-context-move-root-folder-destinations-acceptance-handshake-v1')
  console.log('FLASHNOTE_NOTE_CONTEXT_MOVE_ACCEPTANCE_SUCCESS')

  ;({ menu: contextMenu } = await openCurrentNoteContextMenu())
  const moveToTrashButton = Array.from(
    contextMenu.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === 'Move to Trash')
  if (!moveToTrashButton) {
    throw new Error('acceptance Trash UX: Move to Trash context action is missing')
  }

  moveToTrashButton.click()
  await waitFor(
    async () => {
      const selected = document.querySelector<HTMLElement>('.note-row[aria-current="page"]')
      return (
        selected?.dataset.noteId === siblingNoteID &&
        (await trashContains(currentNoteID)) &&
        document.querySelector('.undo-trash') !== null
      )
    },
    'context deletion, same-folder survivor selection, and Undo affordance',
  )

  if (!(await folderContains(folderID, siblingNoteID))) {
    throw new Error('acceptance Trash UX: same-folder survivor did not remain in its folder')
  }
  if (await folderContains(folderID, currentNoteID)) {
    throw new Error('acceptance Trash UX: deleted current note remained visible in normal folder membership')
  }

  const undoButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.undo-trash button'),
  ).find((button) => button.textContent?.trim() === 'Undo')
  if (!undoButton) {
    throw new Error('acceptance Trash UX: Undo button is missing after context deletion')
  }
  undoButton.click()

  await waitFor(
    async () =>
      (await folderContains(folderID, currentNoteID)) &&
      !(await trashContains(currentNoteID)) &&
      document.querySelector('.undo-trash') === null,
    'Undo restoring the deleted note to its original folder',
  )

  await refreshSidebar()
  await tick()
  await expandFolder(folderID)

  const [folderNoteIDs] = (await ListFolderNotes(folderID)) as [string[], string[]]
  if (folderNoteIDs.length < 1) {
    throw new Error('acceptance folder Trash warning: fixture folder unexpectedly became empty')
  }

  const folderRow = folderBlock(folderID).querySelector<HTMLButtonElement>('.folder-row')
  if (!folderRow) {
    throw new Error('acceptance folder Trash warning: folder row is missing')
  }
  const folderContextEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 140,
    clientY: 140,
  })
  folderRow.dispatchEvent(folderContextEvent)
  await tick()
  await delay(30)

  if (!folderContextEvent.defaultPrevented) {
    throw new Error('acceptance folder Trash warning: folder contextmenu was not handled')
  }
  const folderContextMenu = document.querySelector<HTMLElement>('.note-context-menu')
  const folderTrashButton = Array.from(
    folderContextMenu?.querySelectorAll<HTMLButtonElement>('button') ?? [],
  ).find((button) => button.textContent?.trim() === 'Move to Trash…')
  if (!folderContextMenu || !folderTrashButton) {
    throw new Error('acceptance folder Trash warning: non-empty folder did not expose Move to Trash…')
  }

  folderTrashButton.click()
  await tick()
  await delay(30)

  const deleteDialog = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-labelledby="delete-folder-title"]',
  )
  if (!deleteDialog) {
    throw new Error('acceptance folder Trash warning: destructive consequence dialog did not open')
  }
  const warningText = deleteDialog.querySelector('p')?.textContent?.trim() ?? ''
  const expectedWarning = `This folder and ${folderNoteIDs.length} notes will be moved to Trash.`
  if (warningText !== expectedWarning) {
    throw new Error(
      `acceptance folder Trash warning: expected "${expectedWarning}", got "${warningText}"`,
    )
  }

  const cancelButton = Array.from(deleteDialog.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === 'Cancel',
  )
  if (!cancelButton) {
    throw new Error('acceptance folder Trash warning: confirmation dialog is missing Cancel')
  }
  cancelButton.click()
  await tick()
  await delay(30)

  if (document.querySelector('[role="dialog"][aria-labelledby="delete-folder-title"]')) {
    throw new Error('acceptance folder Trash warning: Cancel did not close confirmation dialog')
  }
  const [folderNoteIDsAfterCancel] = (await ListFolderNotes(folderID)) as [string[], string[]]
  if (!sameIDs(folderNoteIDsAfterCancel, folderNoteIDs)) {
    throw new Error('acceptance folder Trash warning: Cancel changed folder membership')
  }

  console.log('FLASHNOTE_NONEMPTY_FOLDER_TRASH_CONFIRMATION_SUCCESS')

  const permanentDeleteFixtureTitle = `Permanent delete fixture ${siblingNoteID.slice(0, 8)}`
  const siblingTitleInput = document.querySelector<HTMLInputElement>('.title')
  if (!siblingTitleInput) {
    throw new Error('acceptance permanent delete: title input is missing before fixture rename')
  }
  siblingTitleInput.value = permanentDeleteFixtureTitle
  siblingTitleInput.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()

  noteRow(currentNoteID).click()
  await waitFor(
    async () => {
      const selected = document.querySelector<HTMLElement>('.note-row[aria-current="page"]')
      const siblingSnapshot = (await OpenNote(siblingNoteID)) as NoteTuple
      return selected?.dataset.noteId === currentNoteID && siblingSnapshot[1] === permanentDeleteFixtureTitle
    },
    'permanent-delete fixture title flush before Trash transition',
  )

  await MoveNoteToTrash(siblingNoteID)
  await refreshSidebar()
  await tick()

  const trashButton = document.querySelector<HTMLButtonElement>('.trash-row')
  if (!trashButton) {
    throw new Error('acceptance permanent delete: Trash navigation button is missing')
  }
  trashButton.click()
  await waitFor(
    () => document.querySelector('.trash-list') !== null,
    'Trash view before permanent-delete confirmation',
  )

  const trashFixtureRow = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.trash-list .note-row'),
  ).find((button) => button.textContent?.trim() === permanentDeleteFixtureTitle)
  if (!trashFixtureRow) {
    throw new Error('acceptance permanent delete: uniquely titled fixture note is missing from Trash')
  }
  trashFixtureRow.click()
  await waitFor(
    () => {
      const title = document.querySelector<HTMLInputElement>('.title')
      const body = document.querySelector<HTMLElement>('.prose-editor')
      return (
        title?.value === permanentDeleteFixtureTitle &&
        title.readOnly &&
        body !== null &&
        body.getAttribute('contenteditable') === 'false' &&
        body.isContentEditable === false
      )
    },
    'read-only trashed fixture note selection',
  )
  await SearchNotes('flashnote-trash-readonly-acceptance-handshake')

  const deletePermanentlyButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.trash-actions button'),
  ).find((button) => button.textContent?.trim() === 'Delete permanently…')
  if (!deletePermanentlyButton) {
    throw new Error('acceptance permanent delete: Delete permanently… action is missing in Trash')
  }
  deletePermanentlyButton.click()
  await tick()
  await delay(30)

  const permanentDeleteDialog = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-labelledby="delete-note-title"]',
  )
  if (!permanentDeleteDialog) {
    throw new Error('acceptance permanent delete: destructive confirmation dialog did not open')
  }
  if (permanentDeleteDialog.querySelector('p')?.textContent?.trim() !== 'This cannot be undone.') {
    throw new Error('acceptance permanent delete: dialog did not state that deletion cannot be undone')
  }
  const permanentDeleteConfirmButton = Array.from(
    permanentDeleteDialog.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === 'Delete permanently')
  const permanentDeleteCancelButton = Array.from(
    permanentDeleteDialog.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === 'Cancel')
  if (!permanentDeleteConfirmButton || !permanentDeleteCancelButton) {
    throw new Error('acceptance permanent delete: confirmation dialog actions are incomplete')
  }

  permanentDeleteCancelButton.click()
  await tick()
  await delay(30)
  if (document.querySelector('[role="dialog"][aria-labelledby="delete-note-title"]')) {
    throw new Error('acceptance permanent delete: Cancel did not close destructive confirmation')
  }
  if (!(await trashContains(siblingNoteID))) {
    throw new Error('acceptance permanent delete: Cancel unexpectedly removed the trashed note')
  }

  const restoreButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.trash-actions button'),
  ).find((button) => button.textContent?.trim() === 'Restore')
  if (!restoreButton) {
    throw new Error('acceptance permanent delete: Restore action is missing after Cancel')
  }
  restoreButton.click()
  await waitFor(
    async () =>
      (await folderContains(folderID, siblingNoteID)) &&
      !(await trashContains(siblingNoteID)) &&
      document.querySelector('.trash-row.active') === null,
    'restoring permanent-delete fixture after confirmation Cancel',
  )

  await refreshSidebar()
  await tick()
  await expandFolder(folderID)
  console.log('FLASHNOTE_PERMANENT_NOTE_DELETE_CONFIRMATION_SUCCESS')

  const trashCountsBeforeEmptyFixture = (await TrashCounts()) as [number, number]
  await MoveNote(siblingNoteID, '')
  if (!(await MoveNoteToTrash(siblingNoteID))) {
    throw new Error('acceptance Empty Trash: standalone note fixture did not move to Trash')
  }
  const movedFolderNoteCount = await MoveFolderToTrash(emptyFolderID)
  if (movedFolderNoteCount !== 0) {
    throw new Error(
      `acceptance Empty Trash: empty folder fixture unexpectedly moved ${movedFolderNoteCount} note(s)`,
    )
  }

  const expectedEmptyTrashCounts = (await TrashCounts()) as [number, number]
  if (
    expectedEmptyTrashCounts[0] !== trashCountsBeforeEmptyFixture[0] + 1 ||
    expectedEmptyTrashCounts[1] !== trashCountsBeforeEmptyFixture[1] + 1
  ) {
    throw new Error('acceptance Empty Trash: fixture setup did not add exactly one note and one folder')
  }

  await refreshSidebar()
  await tick()
  const emptyTrashNav = document.querySelector<HTMLButtonElement>('.trash-row')
  if (!emptyTrashNav) {
    throw new Error('acceptance Empty Trash: Trash navigation button is missing')
  }
  emptyTrashNav.click()
  await waitFor(
    () => document.querySelector('.trash-list') !== null,
    'Trash view before Empty Trash confirmation',
  )

  const emptyTrashButton = document.querySelector<HTMLButtonElement>('.trash-empty-button')
  if (!emptyTrashButton || emptyTrashButton.disabled) {
    throw new Error('acceptance Empty Trash: Empty Trash… action is missing or disabled with Trash contents')
  }
  if (emptyTrashButton.textContent?.trim() !== 'Empty Trash…') {
    throw new Error('acceptance Empty Trash: bulk destructive action label is unexpected')
  }
  emptyTrashButton.click()
  await tick()
  await delay(30)

  const emptyTrashDialog = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-labelledby="empty-trash-title"]',
  )
  if (!emptyTrashDialog) {
    throw new Error('acceptance Empty Trash: destructive confirmation dialog did not open')
  }
  const expectedEmptyTrashWarning = `Permanently delete ${expectedEmptyTrashCounts[0]} notes and ${expectedEmptyTrashCounts[1]} folders. This cannot be undone.`
  if (emptyTrashDialog.querySelector('p')?.textContent?.trim() !== expectedEmptyTrashWarning) {
    throw new Error('acceptance Empty Trash: dialog did not state exact counts and irreversible consequence')
  }
  const emptyTrashConfirmButton = Array.from(
    emptyTrashDialog.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === 'Empty Trash')
  const emptyTrashCancelButton = Array.from(
    emptyTrashDialog.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === 'Cancel')
  if (!emptyTrashConfirmButton || !emptyTrashCancelButton) {
    throw new Error('acceptance Empty Trash: confirmation dialog actions are incomplete')
  }

  emptyTrashCancelButton.click()
  await tick()
  await delay(30)
  if (document.querySelector('[role="dialog"][aria-labelledby="empty-trash-title"]')) {
    throw new Error('acceptance Empty Trash: Cancel did not close destructive confirmation')
  }
  const countsAfterEmptyCancel = (await TrashCounts()) as [number, number]
  if (
    countsAfterEmptyCancel[0] !== expectedEmptyTrashCounts[0] ||
    countsAfterEmptyCancel[1] !== expectedEmptyTrashCounts[1]
  ) {
    throw new Error('acceptance Empty Trash: Cancel changed Trash contents')
  }

  const emptyTrashNoteRow = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.trash-list .note-row'),
  ).find((button) => button.textContent?.trim() === permanentDeleteFixtureTitle)
  if (!emptyTrashNoteRow) {
    throw new Error('acceptance Empty Trash: standalone fixture note is missing after Cancel')
  }
  emptyTrashNoteRow.click()
  await waitFor(
    () => document.querySelector<HTMLInputElement>('.title')?.value === permanentDeleteFixtureTitle,
    'standalone fixture note selection after Empty Trash Cancel',
  )
  const emptyTrashRestoreButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.trash-actions button'),
  ).find((button) => button.textContent?.trim() === 'Restore')
  if (!emptyTrashRestoreButton) {
    throw new Error('acceptance Empty Trash: Restore action is missing for standalone fixture note')
  }
  emptyTrashRestoreButton.click()
  await waitFor(
    async () => {
      const trashNavigation = document.querySelector<HTMLButtonElement>('.trash-row')
      return (
        (await rootContains(siblingNoteID)) &&
        !(await trashContains(siblingNoteID)) &&
        trashNavigation?.disabled === false &&
        trashNavigation.getAttribute('aria-current') !== 'page'
      )
    },
    'restoring standalone fixture note and completing Trash UI transition',
  )

  await RestoreFolder(emptyFolderID)
  await refreshSidebar()
  await tick()
  const trashCountsAfterEmptyFixture = (await TrashCounts()) as [number, number]
  if (
    trashCountsAfterEmptyFixture[0] !== trashCountsBeforeEmptyFixture[0] ||
    trashCountsAfterEmptyFixture[1] !== trashCountsBeforeEmptyFixture[1]
  ) {
    throw new Error('acceptance Empty Trash: fixture restoration did not return Trash to baseline')
  }
  console.log('FLASHNOTE_EMPTY_TRASH_CONFIRMATION_SUCCESS')

  await expandFolder(folderID)
  noteRow(currentNoteID).click()
  await waitFor(
    () =>
      document.querySelector<HTMLElement>('.note-row[aria-current="page"]')?.dataset.noteId === currentNoteID,
    'restored original note selection before fixture cleanup',
  )

  console.log('FLASHNOTE_CONTEXT_TRASH_UNDO_ACCEPTANCE_SUCCESS')
}

async function proveLastNormalNoteTrashFallback(
  currentNoteID: string,
  folderID: string,
  refreshSidebar: () => Promise<void>,
): Promise<void> {
  const [normalBefore] = (await ListNotes()) as [string[], string[]]
  const trashCountsBefore = (await TrashCounts()) as [number, number]
  if (!normalBefore.includes(currentNoteID)) {
    throw new Error('acceptance last-note fallback: current note is not in the normal-note baseline')
  }

  const sidelinedNoteIDs = normalBefore.filter((noteID) => noteID !== currentNoteID)
  let fallbackNoteID = ''
  let proofFailure: unknown = null

  try {
    for (const noteID of sidelinedNoteIDs) {
      if (!(await MoveNoteToTrash(noteID))) {
        throw new Error(`acceptance last-note fallback: failed to sideline normal note ${noteID}`)
      }
    }

    await refreshSidebar()
    await tick()
    await expandFolder(folderID)

    const [isolatedNormalIDs] = (await ListNotes()) as [string[], string[]]
    if (!sameIDs(isolatedNormalIDs, [currentNoteID])) {
      throw new Error('acceptance last-note fallback: failed to isolate exactly one normal note')
    }

    noteRow(currentNoteID).click()
    await waitFor(
      () =>
        document.querySelector<HTMLElement>('.note-row[aria-current="page"]')?.dataset.noteId === currentNoteID,
      'last normal note selection before deletion',
    )

    const currentRow = noteRow(currentNoteID)
    const contextEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 160,
      clientY: 160,
    })
    currentRow.dispatchEvent(contextEvent)
    await tick()
    await delay(30)

    if (!contextEvent.defaultPrevented) {
      throw new Error('acceptance last-note fallback: note contextmenu was not handled')
    }
    const contextMenu = document.querySelector<HTMLElement>('.note-context-menu')
    const moveToTrashButton = Array.from(
      contextMenu?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    ).find((button) => button.textContent?.trim() === 'Move to Trash')
    if (!contextMenu || !moveToTrashButton) {
      throw new Error('acceptance last-note fallback: Move to Trash action is missing')
    }

    moveToTrashButton.click()
    await waitFor(
      async () => {
        const [normalIDs] = (await ListNotes()) as [string[], string[]]
        if (normalIDs.length !== 1 || normalIDs[0] === currentNoteID) {
          return false
        }
        fallbackNoteID = normalIDs[0]
        const selected = document.querySelector<HTMLElement>('.note-row[aria-current="page"]')
        return selected?.dataset.noteId === fallbackNoteID && (await trashContains(currentNoteID))
      },
      'last-note deletion creating and selecting exactly one fallback note',
    )

    const fallbackSnapshot = (await OpenNote(fallbackNoteID)) as NoteTuple
    if (fallbackSnapshot[1] !== '') {
      throw new Error('acceptance last-note fallback: replacement note has a non-empty durable title')
    }
    await waitFor(
      () => {
        const titleInput = document.querySelector<HTMLInputElement>('.title')
        const editorBody = document.querySelector<HTMLElement>('.prose-editor')
        return titleInput?.value === '' && editorBody !== null && editorBody.textContent?.trim() === ''
      },
      'new empty fallback note rendered in the editor',
    )

    const undoButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.undo-trash button'),
    ).find((button) => button.textContent?.trim() === 'Undo')
    if (!undoButton) {
      throw new Error('acceptance last-note fallback: Undo is missing after deleting the last normal note')
    }
    undoButton.click()
    await waitFor(
      async () => !(await trashContains(currentNoteID)) && ((await ListNotes()) as [string[], string[]])[0].includes(currentNoteID),
      'Undo restoring the former last note',
    )

    console.log('FLASHNOTE_LAST_NOTE_TRASH_FALLBACK_SUCCESS')
  } catch (error) {
    proofFailure = error
  }

  let cleanupFailure: unknown = null
  try {
    if (fallbackNoteID) {
      const [normalIDs] = (await ListNotes()) as [string[], string[]]
      if (normalIDs.includes(fallbackNoteID) && !(await MoveNoteToTrash(fallbackNoteID))) {
        throw new Error('acceptance last-note fallback cleanup: failed to trash fallback note')
      }
      if ((await trashContains(fallbackNoteID)) && !(await PermanentlyDeleteNote(fallbackNoteID))) {
        throw new Error('acceptance last-note fallback cleanup: failed to permanently delete fallback note')
      }
    }

    if ((await trashContains(currentNoteID)) && !(await RestoreNote(currentNoteID))) {
      throw new Error('acceptance last-note fallback cleanup: failed to restore current note')
    }
    for (const noteID of sidelinedNoteIDs) {
      if ((await trashContains(noteID)) && !(await RestoreNote(noteID))) {
        throw new Error(`acceptance last-note fallback cleanup: failed to restore sidelined note ${noteID}`)
      }
    }

    await refreshSidebar()
    await tick()

    const [normalAfter] = (await ListNotes()) as [string[], string[]]
    const trashCountsAfter = (await TrashCounts()) as [number, number]
    if (!sameIDs(normalAfter, normalBefore)) {
      throw new Error('acceptance last-note fallback cleanup: normal-note baseline was not restored')
    }
    if (
      trashCountsAfter[0] !== trashCountsBefore[0] ||
      trashCountsAfter[1] !== trashCountsBefore[1]
    ) {
      throw new Error('acceptance last-note fallback cleanup: Trash baseline was not restored')
    }

    if (await folderContains(folderID, currentNoteID)) {
      await expandFolder(folderID)
    }
    noteRow(currentNoteID).click()
    await waitFor(
      () =>
        document.querySelector<HTMLElement>('.note-row[aria-current="page"]')?.dataset.noteId === currentNoteID,
      'restored current note selection after last-note fallback cleanup',
    )
  } catch (error) {
    cleanupFailure = error
  }

  if (cleanupFailure) {
    if (proofFailure) {
      console.error('FLASHNOTE_LAST_NOTE_TRASH_FALLBACK_CLEANUP_FAILURE', cleanupFailure)
    } else {
      throw cleanupFailure
    }
  }
  if (proofFailure) {
    throw proofFailure
  }
}

async function cleanupFixtures(options: {
  sourceNoteID: string
  sourceFolderID: string
  targetFolderID: string
  resumeNoteID: string
  baselineNoteIDs: string[]
  baselineFolderIDs: string[]
  baselineTrashCounts: [number, number]
  refreshSidebar: () => Promise<void>
}): Promise<void> {
  const {
    sourceNoteID,
    sourceFolderID,
    targetFolderID,
    resumeNoteID,
    baselineNoteIDs,
    baselineFolderIDs,
    baselineTrashCounts,
    refreshSidebar,
  } = options

  if (resumeNoteID && !(await rootContains(resumeNoteID))) {
    await MoveNote(resumeNoteID, '')
  }

  if (sourceNoteID) {
    if (!(await MoveNoteToTrash(sourceNoteID))) {
      throw new Error('acceptance sidebar DnD cleanup: fixture note was not moved to Trash')
    }
    if (!(await PermanentlyDeleteNote(sourceNoteID))) {
      throw new Error('acceptance sidebar DnD cleanup: fixture note was not permanently deleted')
    }
  }

  for (const folderID of [sourceFolderID, targetFolderID]) {
    if (!folderID) {
      continue
    }
    const trashedNotes = await MoveFolderToTrash(folderID)
    if (trashedNotes !== 0) {
      throw new Error(
        `acceptance sidebar DnD cleanup: fixture folder ${folderID} still contained ${trashedNotes} note(s)`,
      )
    }
    const deletedNotes = await PermanentlyDeleteFolder(folderID)
    if (deletedNotes !== 0) {
      throw new Error(
        `acceptance sidebar DnD cleanup: permanent folder deletion removed ${deletedNotes} unexpected note(s)`,
      )
    }
  }

  await OpenNote(resumeNoteID)
  await refreshSidebar()
  await tick()

  const [noteIDsAfter] = (await ListNotes()) as [string[], string[]]
  const [folderIDsAfter] = (await ListFolders()) as [string[], string[]]
  const trashCountsAfter = (await TrashCounts()) as [number, number]

  if (!sameIDs(noteIDsAfter, baselineNoteIDs)) {
    throw new Error('acceptance sidebar DnD cleanup: normal note fixture state leaked into later acceptance')
  }
  if (!sameIDs(folderIDsAfter, baselineFolderIDs)) {
    throw new Error('acceptance sidebar DnD cleanup: folder fixture state leaked into later acceptance')
  }
  if (
    trashCountsAfter[0] !== baselineTrashCounts[0] ||
    trashCountsAfter[1] !== baselineTrashCounts[1]
  ) {
    throw new Error('acceptance sidebar DnD cleanup: Trash fixture state leaked into later acceptance')
  }

  console.log('FLASHNOTE_SIDEBAR_DND_CLEANUP_SUCCESS')
}

export async function runSidebarDragDropAcceptance({ refreshSidebar }: AcceptanceOptions): Promise<void> {
  const [baselineNoteIDs] = (await ListNotes()) as [string[], string[]]
  const [baselineFolderIDs] = (await ListFolders()) as [string[], string[]]
  const baselineTrashCounts = (await TrashCounts()) as [number, number]
  const currentRow = document.querySelector<HTMLElement>('.note-row[aria-current="page"]')
  const resumeNoteID = currentRow?.dataset.noteId ?? ''
  if (!resumeNoteID || !baselineNoteIDs.includes(resumeNoteID)) {
    throw new Error('acceptance sidebar DnD: current normal note is not identifiable before fixture setup')
  }

  let sourceFolderID = ''
  let targetFolderID = ''
  let sourceNoteID = ''
  let failure: unknown = null

  try {
    ;[sourceFolderID] = (await CreateFolder('DnD Source')) as [string, string]
    ;[targetFolderID] = (await CreateFolder('DnD Target')) as [string, string]
    const sourceNote = (await CreateNoteInFolder(sourceFolderID)) as [string, string, string, number, boolean]
    sourceNoteID = sourceNote[0]

    await refreshSidebar()
    await tick()
    await expandFolder(sourceFolderID)

    const sourceRow = noteRow(sourceNoteID)
    if (sourceRow.getAttribute('draggable') !== 'true') {
      throw new Error('acceptance sidebar DnD: normal sidebar note row is not draggable')
    }

    const sourceOrderBefore = ((await ListFolderNotes(sourceFolderID)) as [string[], string[]])[0]
    const targetBlock = folderBlock(targetFolderID)
    dispatchDrag(sourceRow, 'dragstart')
    const folderDragOver = dispatchDrag(targetBlock, 'dragover')
    if (!folderDragOver.defaultPrevented) {
      throw new Error('acceptance sidebar DnD: folder dragover did not accept note move')
    }
    dispatchDrag(targetBlock, 'drop')
    dispatchDrag(sourceRow, 'dragend')

    await waitFor(
      async () =>
        (await folderContains(targetFolderID, sourceNoteID)) &&
        !(await folderContains(sourceFolderID, sourceNoteID)),
      'folder-to-folder membership move',
    )

    const sourceOrderAfter = ((await ListFolderNotes(sourceFolderID)) as [string[], string[]])[0]
    if (sourceOrderAfter.includes(sourceNoteID) || sourceOrderAfter.length !== sourceOrderBefore.length - 1) {
      throw new Error('acceptance sidebar DnD: source folder membership did not contract by exactly one note')
    }

    await refreshSidebar()
    await tick()
    await expandFolder(targetFolderID)
    const movedRow = noteRow(sourceNoteID)
    const rootDropZone = document.querySelector<HTMLElement>('.root-note-drop-zone')
    if (!rootDropZone) {
      throw new Error('acceptance sidebar DnD: root drop zone is missing')
    }

    dispatchDrag(movedRow, 'dragstart')
    const rootDragOver = dispatchDrag(rootDropZone, 'dragover')
    if (!rootDragOver.defaultPrevented) {
      throw new Error('acceptance sidebar DnD: root dragover did not accept note move')
    }
    dispatchDrag(rootDropZone, 'drop')
    dispatchDrag(movedRow, 'dragend')

    await waitFor(
      async () =>
        (await rootContains(sourceNoteID)) &&
        !(await folderContains(targetFolderID, sourceNoteID)),
      'folder-to-root membership move',
    )

    await proveDirtyCurrentNoteFlush(resumeNoteID, sourceFolderID)
    await refreshSidebar()
    await tick()

    const rootOrderBefore = ((await ListRootNotes()) as [string[], string[]])[0]
    const rootRow = noteRow(sourceNoteID)
    dispatchDrag(rootRow, 'dragstart')
    dispatchDrag(rootDropZone, 'dragover')
    dispatchDrag(rootDropZone, 'drop')
    dispatchDrag(rootRow, 'dragend')
    await delay(100)
    const rootOrderAfter = ((await ListRootNotes()) as [string[], string[]])[0]
    if (JSON.stringify(rootOrderAfter) !== JSON.stringify(rootOrderBefore)) {
      throw new Error('acceptance sidebar DnD: same-location drop changed note ordering')
    }

    await proveContextTrashUndo(
      resumeNoteID,
      sourceNoteID,
      sourceFolderID,
      targetFolderID,
      refreshSidebar,
    )
    await proveLastNormalNoteTrashFallback(resumeNoteID, sourceFolderID, refreshSidebar)

    const trashDraggable = document.querySelector('.trash-list .note-row[draggable="true"]')
    if (trashDraggable) {
      throw new Error('acceptance sidebar DnD: Trash note unexpectedly became draggable')
    }
  } catch (error) {
    failure = error
  }

  try {
    await cleanupFixtures({
      sourceNoteID,
      sourceFolderID,
      targetFolderID,
      resumeNoteID,
      baselineNoteIDs,
      baselineFolderIDs,
      baselineTrashCounts,
      refreshSidebar,
    })
  } catch (cleanupError) {
    if (failure) {
      console.error('FLASHNOTE_SIDEBAR_DND_CLEANUP_FAILURE', cleanupError)
    } else {
      failure = cleanupError
    }
  }

  if (failure) {
    console.error('FLASHNOTE_SIDEBAR_DND_ACCEPTANCE_FAILURE', failure)
    throw failure
  }

  console.log('FLASHNOTE_SIDEBAR_DND_ACCEPTANCE_SUCCESS')
}
