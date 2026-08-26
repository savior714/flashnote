import { tick } from 'svelte'
import {
  CreateFolder,
  CreateNoteInFolder,
  ListFolderNotes,
  ListFolders,
  ListNotes,
  ListRootNotes,
  MoveFolderToTrash,
  MoveNoteToTrash,
  OpenNote,
  PermanentlyDeleteFolder,
  PermanentlyDeleteNote,
  TrashCounts,
} from '../../bindings/github.com/savior714/flashnote/appservice'

type AcceptanceOptions = {
  refreshSidebar: () => Promise<void>
}

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

function sameIDs(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
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
