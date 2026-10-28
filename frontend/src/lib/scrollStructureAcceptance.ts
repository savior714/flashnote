import { tick } from 'svelte'
import { CURRENT_DOCUMENT_SCHEMA_VERSION } from './documentWire'
import {
  CreateNote,
  ListNotes,
  OpenNote,
  SaveNote,
  SearchNotes,
} from '../../bindings/github.com/savior714/flashnote/appservice'
import { reportAcceptanceStage, scrollStageEntered, scrollStageFailed } from './acceptanceStageLog'

type NoteTuple = [string, string, string, number, boolean]

export type ScrollStructureAcceptanceOptions = {
  refreshSidebar: () => Promise<void>
  applyNote: (snapshot: NoteTuple) => void
  getNoteID: () => string
}

/** Minimum overflow a region must produce before it counts as genuinely scrollable. */
const REQUIRED_OVERFLOW_PX = 120

/** Note count that makes the sidebar overflow the window height in a real window. */
const SIDEBAR_OVERFLOW_NOTE_COUNT = 50

/** Paragraph count that makes a document overflow the pane height in a real window. */
const DOCUMENT_OVERFLOW_PARAGRAPH_COUNT = 60

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isScrollable(element: HTMLElement | null): boolean {
  if (!element) return false
  return element.scrollHeight - element.clientHeight > 1
}

/**
 * Proves a region can be scrolled to its real maximum.
 *
 * The offset assigned is the element's own scrollHeight, which is always at
 * least as large as its maximum scroll offset, so the platform must clamp down
 * to the reachable maximum. A numeric literal far beyond the range is not
 * portable: WebKit's Wails WebView treats an oversized double through its
 * integer scroll-offset path, which silently reads back as zero instead of the
 * maximum.
 */
function maxScrollTop(element: HTMLElement | null): number {
  if (!element) return -1
  const before = element.scrollTop
  element.scrollTop = element.scrollHeight
  const reached = element.scrollTop
  element.scrollTop = before
  return reached
}

/**
 * The viewport must never scroll. `overflow: hidden` alone is not proof: a
 * programmatic scroll that still moves, or a document taller than the viewport,
 * both mean the page can still own scrolling and show a second scrollbar.
 */
function assertViewportDoesNotScroll(where: string): void {
  window.scrollTo(0, 400)
  const reached = window.scrollY
  window.scrollTo(0, 0)
  if (reached !== 0) {
    throw new Error(`acceptance scroll: ${where} still lets the viewport scroll (${reached}px)`)
  }
  const root = document.documentElement
  if (root.scrollHeight > root.clientHeight) {
    throw new Error(
      `acceptance scroll: ${where} leaves the document ${root.scrollHeight}px tall inside a ${root.clientHeight}px viewport`,
    )
  }
  if (document.body.scrollHeight > document.body.clientHeight) {
    throw new Error(
      `acceptance scroll: ${where} leaves the body ${document.body.scrollHeight}px tall inside a ${document.body.clientHeight}px box`,
    )
  }
}

function longDocumentEnvelope(): string {
  return JSON.stringify({
    schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
    doc: {
      type: 'doc',
      content: Array.from({ length: DOCUMENT_OVERFLOW_PARAGRAPH_COUNT }, (_, index) => ({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Scroll paragraph ${index} ${'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(5)}`,
          },
        ],
      })),
    },
  })
}

/**
 * Records the verdict of this acceptance in durable note data.
 *
 * The frontend's console is not carried into the application log, so a silent
 * failure would otherwise be indistinguishable from success. The marker note is
 * read back from the isolated database by the runner, and searching for it also
 * exercises the real search path.
 *
 * This function is deliberately not fail-silent for the success case: the note
 * is read back through the backend search path before returning, so a note that
 * was created and saved in memory but never became queryable cannot be reported
 * as recorded. A failed write is then propagated to the caller, which decides
 * what the run's terminal state is.
 */
async function recordVerdict(status: 'ok' | 'failed', detail: string): Promise<void> {
  // Verdict CreateNote/SaveNote start and completion are the two boundaries a
  // durable verdict can be lost at, so each is reported through the same
  // stage channel the rest of the pipeline uses.
  await reportAcceptanceStage(status === 'ok' ? 1000 : 1100)
  const [noteID, , , revision] = await CreateNote()
  await SaveNote(
    noteID,
    `FLASHNOTE_SCROLL_ACCEPTANCE_${status.toUpperCase()}`,
    JSON.stringify({
      schemaVersion: 1,
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: detail }] }],
      },
    }),
    revision,
  )
  // Persistence proof: the marker must be visible through the real search path
  // that owns the note's durable projection, not merely accepted by the write
  // call. A note that does not come back is not a recorded verdict.
  const [searchIDs] = (await SearchNotes(`FLASHNOTE_SCROLL_ACCEPTANCE_${status.toUpperCase()}`)) as [
    string[],
    string[],
    boolean[],
    string[],
  ]
  if (!searchIDs.includes(noteID)) {
    throw new Error(
      `acceptance scroll: the ${status} verdict note ${noteID} was not readable back through the search path`,
    )
  }
  await reportAcceptanceStage(status === 'ok' ? 1001 : 1101)
}

/**
 * Records a failure verdict without letting its own write error replace the
 * verification failure that is being reported.
 *
 * The verification exception is the authoritative result, so the terminal throw
 * below is always that exception. A failure marker that could not be written is
 * an observed diagnostic gap, not a new verdict.
 */
async function recordFailureVerdict(detail: string): Promise<void> {
  try {
    await recordVerdict('failed', detail)
  } catch (verdictError) {
    console.error(
      'FLASHNOTE_SCROLL_ACCEPTANCE_FAILED_VERDICT_WRITE',
      verdictError instanceof Error ? verdictError.message : String(verdictError),
    )
  }
}

/**
 * Scroll-ownership contract for the application shell.
 *
 * The duplicate vertical scrollbar came from the page becoming a second scroll
 * container beside the document pane whenever content was taller than the
 * viewport. This case builds the real overflow condition (a long note list plus
 * a long document, opened through the real note path) and proves by actually
 * scrolling — real programmatic scrolling of each region, a caret resolved to
 * its scroll owner, a real note transition, a real sidebar toggle, and a real
 * sidebar menu — that the document pane owns document scrolling, the note list
 * owns sidebar scrolling, and the page never scrolls.
 */
export async function runScrollStructureAcceptance({
  refreshSidebar,
  applyNote,
  getNoteID,
}: ScrollStructureAcceptanceOptions): Promise<void> {
  const measurements: Record<string, unknown> = {}
  const measure = (key: string, value: unknown): void => {
    measurements[key] = value
  }
  const failureDetail = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error)
    return `${message} || measurements=${JSON.stringify(measurements)}`
  }
  let stage = 0
  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // A. REAL OVERFLOW SETUP: a sidebar that overflows the window
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(1))
    stage = 1
    const [existingNoteIDs] = (await ListNotes()) as [string[], string[], boolean[]]
    const notesToCreate = Math.max(0, SIDEBAR_OVERFLOW_NOTE_COUNT - existingNoteIDs.length)
    for (let index = 0; index < notesToCreate; index += 1) {
      await CreateNote()
    }
    await refreshSidebar()
    await tick()
    await delay(250)

    const shell = document.querySelector<HTMLElement>('main.shell')
    const sidebar = document.querySelector<HTMLElement>('aside.sidebar')
    const noteList = document.querySelector<HTMLElement>('nav.note-list')
    const pane = document.querySelector<HTMLElement>('section.document')
    if (!shell || !sidebar || !noteList || !pane) {
      throw new Error('acceptance scroll: shell, sidebar, note list, or document pane is missing')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // B. THE REPORTED CONDITION EXISTS: the sidebar really overflows
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(2))
    stage = 2
    const sidebarOverflow = noteList.scrollHeight - noteList.clientHeight
    measure('sidebarOverflow', sidebarOverflow)
    measure('window', { innerWidth: window.innerWidth, innerHeight: window.innerHeight })
    measure('shell', { scrollHeight: shell.scrollHeight, clientHeight: shell.clientHeight, computedRows: getComputedStyle(shell).gridTemplateRows, computedOverflow: getComputedStyle(shell).overflow })
    measure('sidebar', { scrollHeight: sidebar.scrollHeight, clientHeight: sidebar.clientHeight, computedOverflow: getComputedStyle(sidebar).overflow, computedDisplay: getComputedStyle(sidebar).display, computedFlex: getComputedStyle(sidebar).flex })
    measure('noteList', { scrollHeight: noteList.scrollHeight, clientHeight: noteList.clientHeight, computedOverflowY: getComputedStyle(noteList).overflowY, computedFlex: getComputedStyle(noteList).flex, computedMinHeight: getComputedStyle(noteList).minHeight })
    measure('pane', { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, computedOverflow: getComputedStyle(pane).overflow, computedHeight: getComputedStyle(pane).height, computedPosition: getComputedStyle(pane).position })
    measure('document', { scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, bodyScrollHeight: document.body.scrollHeight })
    if (sidebarOverflow < REQUIRED_OVERFLOW_PX) {
      throw new Error(
        `acceptance scroll: the sidebar only overflows ${sidebarOverflow}px, so the duplicate-scrollbar case is not represented`,
      )
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // C. THE PAGE NEVER SCROLLS — proven by scrolling it
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(3))
    stage = 3
    assertViewportDoesNotScroll('with a long sidebar')
    if (maxScrollTop(shell) !== 0 || maxScrollTop(sidebar) !== 0) {
      throw new Error('acceptance scroll: the shell or the sidebar is independently scrollable')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D. A LONG DOCUMENT THROUGH THE REAL NOTE PATH
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(4))
    stage = 4
    const originalNoteID = getNoteID()
    if (!originalNoteID) {
      throw new Error('acceptance scroll: no note is open before the scroll checks')
    }
    const [longNoteID, longTitle, , longRevision] = await CreateNote()
    await SaveNote(longNoteID, longTitle, longDocumentEnvelope(), longRevision)
    applyNote((await OpenNote(longNoteID)) as NoteTuple)
    await tick()
    await delay(350)

    const editor = document.querySelector<HTMLElement>('.prose-editor')
    if (!editor) {
      throw new Error('acceptance scroll: the editor did not mount for the long document')
    }
    measure('paneLongDoc', {
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
      scrollable: isScrollable(pane),
      computedOverflow: getComputedStyle(pane).overflow,
      computedHeight: getComputedStyle(pane).height,
      editorScrollHeight: editor.scrollHeight,
    })
    if (!isScrollable(pane)) {
      throw new Error(
        `acceptance scroll: the document pane does not overflow for a long document (${pane.scrollHeight}/${pane.clientHeight})`,
      )
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E. THE DOCUMENT PANE IS THE ONE DOCUMENT SCROLL OWNER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(5))
    stage = 5
    pane.scrollTop = 0
    await tick()
    await delay(60)
    measure('paneScrollTopAfterZero', pane.scrollTop)
    if (pane.scrollTop !== 0) {
      throw new Error(`acceptance scroll: the pane could not be returned to the top (${pane.scrollTop})`)
    }
    const paneReach = maxScrollTop(pane)
    await tick()
    measure('paneReach', paneReach)
    measure('paneReachDetails', { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, scrollTop: pane.scrollTop })
    if (paneReach < REQUIRED_OVERFLOW_PX) {
      throw new Error(`acceptance scroll: the document pane only scrolled ${paneReach}px`)
    }
    let scrollOwnerOfEditor: HTMLElement | null = null
    for (let node = editor.parentElement; node; node = node.parentElement) {
      if (isScrollable(node)) {
        scrollOwnerOfEditor = node
        break
      }
    }
    if (scrollOwnerOfEditor !== pane) {
      throw new Error('acceptance scroll: the editor does not resolve the document pane as its scroll owner')
    }
    assertViewportDoesNotScroll('with a long document open')

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // F. THE NOTE LIST OWNS SIDEBAR SCROLL INDEPENDENTLY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(6))
    stage = 6
    noteList.scrollTop = 0
    await tick()
    const listReach = maxScrollTop(noteList)
    await tick()
    if (listReach < REQUIRED_OVERFLOW_PX) {
      throw new Error(`acceptance scroll: the note list only scrolled ${listReach}px`)
    }
    const noteRows = Array.from(noteList.querySelectorAll<HTMLElement>('.note-row'))
    if (noteRows.length === 0) {
      throw new Error('acceptance scroll: the note list rendered no note rows')
    }
    noteList.scrollTop = listReach
    await delay(150)
    const sidebarBottom = sidebar.getBoundingClientRect().bottom
    const lastRowBottom = noteRows[noteRows.length - 1].getBoundingClientRect().bottom
    if (lastRowBottom > sidebarBottom + 1) {
      throw new Error(
        `acceptance scroll: the last note row (${lastRowBottom}) stays below the sidebar (${sidebarBottom}) at full scroll`,
      )
    }
    if (maxScrollTop(pane) < REQUIRED_OVERFLOW_PX) {
      throw new Error('acceptance scroll: scrolling the note list removed the document pane scroll range')
    }
    assertViewportDoesNotScroll('after scrolling the note list')

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // G. THE CARET RESOLVES THE PANE, AND THE PAGE STAYS STILL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Caret following while typing depends on trusted input events, which a
    // scripted run cannot produce. What can be proven here is the property that
    // caret following rests on: the caret's own DOM position resolves the
    // document pane — and only the pane — as its scroll container, and nothing
    // the caret does can move the page.
    await reportAcceptanceStage(scrollStageEntered(7))
    stage = 7
    noteList.scrollTop = 0
    pane.scrollTop = 0
    await tick()
    await delay(120)
    const ownerWindow = pane.ownerDocument.defaultView
    if (!ownerWindow) {
      throw new Error('acceptance scroll: the pane has no window to inspect a caret in')
    }
    const selection = ownerWindow.getSelection()
    if (!selection) {
      throw new Error('acceptance scroll: the document has no selection to resolve a caret from')
    }
    const firstParagraph = editor.querySelector('p')
    const firstTextNode = firstParagraph?.firstChild
    if (!firstParagraph || !firstTextNode || firstTextNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('acceptance scroll: the long document has no text node to place a caret in')
    }
    const caretRange = document.createRange()
    caretRange.setStart(firstTextNode, 0)
    caretRange.collapse(true)
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(caretRange)
    await tick()
    await delay(80)
    const caretNode = selection.focusNode ?? selection.anchorNode
    let caretScrollOwner: HTMLElement | null = null
    for (let node = caretNode?.parentElement ?? null; node; node = node.parentElement) {
      if (isScrollable(node)) {
        caretScrollOwner = node
        break
      }
    }
    measure('caretScrollOwner', caretScrollOwner?.className ?? String(caretScrollOwner))
    if (caretScrollOwner !== pane) {
      throw new Error(
        `acceptance scroll: the caret resolves ${caretScrollOwner?.className ?? 'nothing'} instead of the document pane`,
      )
    }
    const caretRect = (selection.focusNode?.parentElement ?? editor).getBoundingClientRect()
    measure('caretRect', { top: caretRect.top, bottom: caretRect.bottom, height: caretRect.height })
    measure('paneReachAfterCarets', maxScrollTop(pane))
    assertViewportDoesNotScroll('with the caret resolved to the document pane')
    if (maxScrollTop(noteList) < REQUIRED_OVERFLOW_PX) {
      throw new Error('acceptance scroll: resolving the caret removed the note list scroll range')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // H. NOTE TRANSITION AND SIDEBAR TOGGLE KEEP ONE OWNER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(8))
    stage = 8
    const [shortNoteID] = await CreateNote()
    applyNote((await OpenNote(shortNoteID)) as NoteTuple)
    await tick()
    await delay(300)
    if (getNoteID() !== shortNoteID) {
      throw new Error('acceptance scroll: note transition did not open the short note')
    }
    assertViewportDoesNotScroll('after switching to a short note')
    if (!isScrollable(noteList) || maxScrollTop(noteList) < REQUIRED_OVERFLOW_PX) {
      throw new Error('acceptance scroll: a short note removed the note list scroll range')
    }

    const hideSidebarButton = document.querySelector<HTMLButtonElement>('.hide-sidebar-button')
    if (!hideSidebarButton) {
      throw new Error('acceptance scroll: the hide sidebar button is missing')
    }
    hideSidebarButton.click()
    await tick()
    await delay(300)
    if (document.querySelector('aside.sidebar') !== null) {
      throw new Error('acceptance scroll: hiding the sidebar left it in the document')
    }
    assertViewportDoesNotScroll('with the sidebar hidden')
    const showSidebarButton = document.querySelector<HTMLButtonElement>('.show-sidebar-button')
    if (!showSidebarButton) {
      throw new Error('acceptance scroll: the show sidebar button did not appear')
    }
    showSidebarButton.click()
    await tick()
    await delay(300)
    // Hiding the sidebar removes the whole aside from the document, so the note
    // list is a fresh element once it comes back.
    const restoredNoteList = document.querySelector<HTMLElement>('nav.note-list')
    if (!restoredNoteList) {
      throw new Error('acceptance scroll: showing the sidebar again left no note list')
    }
    assertViewportDoesNotScroll('after restoring the sidebar')
    if (maxScrollTop(restoredNoteList) < REQUIRED_OVERFLOW_PX) {
      throw new Error('acceptance scroll: restoring the sidebar removed the note list scroll range')
    }
    // The open note is deliberately short from section H, so the pane has nothing
    // to scroll here; its scroll range is proven in section E.
    measure('paneRangeWithShortNote', maxScrollTop(pane))

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // I. A SIDEBAR MENU STILL OPENS INSIDE THE WINDOW
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // The sidebar and the shell are now overflow-clipped, so a menu the sidebar
    // renders over its rows must still reach the user. Open a real one from a
    // row in the visible part of the list and measure it.
    await reportAcceptanceStage(scrollStageEntered(9))
    stage = 9
    const restoredSidebar = document.querySelector<HTMLElement>('aside.sidebar')
    if (!restoredSidebar) {
      throw new Error('acceptance scroll: the sidebar disappeared after the toggle check')
    }
    const sidebarRect = restoredSidebar.getBoundingClientRect()
    const moveButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-move-button'))
    if (moveButtons.length === 0) {
      throw new Error('acceptance scroll: the sidebar rendered no move buttons')
    }
    // Choose a row well inside the visible part of the list so the measurement is
    // about clipping, not about a menu opening below the window edge.
    const visibleMoveButton = moveButtons.find((button) => {
      const rect = button.getBoundingClientRect()
      return rect.top > sidebarRect.top + 40 && rect.bottom < sidebarRect.bottom - 160
    })
    if (!visibleMoveButton) {
      throw new Error('acceptance scroll: no move button sits inside the visible part of the sidebar')
    }
    visibleMoveButton.click()
    await tick()
    await delay(300)
    const noteMoveMenu = document.querySelector<HTMLElement>('.sidebar-menu.note-move-menu')
    if (!noteMoveMenu) {
      throw new Error('acceptance scroll: the note move menu did not open for a visible row')
    }
    const menuRect = noteMoveMenu.getBoundingClientRect()
    measure('noteMoveMenu', {
      top: menuRect.top,
      bottom: menuRect.bottom,
      right: menuRect.right,
      sidebarRight: sidebarRect.right,
      sidebarBottom: sidebarRect.bottom,
      width: menuRect.width,
      height: menuRect.height,
    })
    if (menuRect.width <= 0 || menuRect.height <= 0) {
      throw new Error('acceptance scroll: the note move menu rendered with no size, so the sidebar clipped it away')
    }
    if (menuRect.right > sidebarRect.right + 1) {
      throw new Error(
        `acceptance scroll: the note move menu (${menuRect.right}) is clipped by the sidebar boundary (${sidebarRect.right})`,
      )
    }
    if (menuRect.bottom > sidebarRect.bottom + 1 || menuRect.bottom > window.innerHeight + 1) {
      throw new Error(
        `acceptance scroll: the note move menu (${menuRect.bottom}) is clipped by the sidebar (${sidebarRect.bottom}) or the window (${window.innerHeight})`,
      )
    }
    assertViewportDoesNotScroll('with a sidebar menu open')
    // The menu is closed by toggling its own button, not by Escape.
    visibleMoveButton.click()
    await tick()
    await delay(250)
    if (document.querySelector('.sidebar-menu.note-move-menu') !== null) {
      throw new Error('acceptance scroll: the note move menu did not close')
    }
    assertViewportDoesNotScroll('after the sidebar menu closed')

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // J. LEAVE THE ORIGINAL NOTE OPEN AND BOTH REGIONS RESET
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await reportAcceptanceStage(scrollStageEntered(10))
    stage = 10
    if (originalNoteID) {
      applyNote((await OpenNote(originalNoteID)) as NoteTuple)
      await tick()
      await delay(250)
      const restoredPane = document.querySelector<HTMLElement>('section.document')
      const restoredList = document.querySelector<HTMLElement>('nav.note-list')
      if (restoredPane) restoredPane.scrollTop = 0
      if (restoredList) restoredList.scrollTop = 0
      await tick()
      await delay(100)
    }
    assertViewportDoesNotScroll('at completion')

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // K. THE SEARCH OVERLAY OPENS AND CLOSES ABOVE THE SHELL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // The search overlay is a fixed layer above the shell. It must open and close
    // without the page becoming a scroll container, which is the regression the
    // shell-level overflow guards could otherwise introduce.
    //
    // Reported as its own stage: the overlay checks used to run inside stage 10's
    // span, so a failure here was indistinguishable from a stage-10 failure in
    // the last stage recorded before the run stopped.
    await reportAcceptanceStage(scrollStageEntered(11))
    stage = 11
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
    const searchShortcut = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(searchShortcut)
    await tick()
    await delay(350)
    const searchInput = document.querySelector<HTMLElement>('.search-input')
    if (!searchInput) {
      throw new Error('acceptance scroll: the search overlay did not open over the shell')
    }
    assertViewportDoesNotScroll('with the search overlay open')
    const searchDialogRect = searchInput.getBoundingClientRect()
    measure('searchInputRect', { top: searchDialogRect.top, height: searchDialogRect.height })
    if (searchDialogRect.top < 0 || searchDialogRect.bottom > window.innerHeight + 1) {
      throw new Error(
        `acceptance scroll: the search overlay (${searchDialogRect.top}..${searchDialogRect.bottom}) is clipped by the shell`,
      )
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick()
    await delay(250)
    if (document.querySelector('.search-input') !== null) {
      throw new Error('acceptance scroll: the search overlay did not close')
    }
    assertViewportDoesNotScroll('after the search overlay closed')

    // Every scroll-structure verification above has now succeeded, so this is
    // the only point where an OK verdict may be written. Recording it earlier
    // would leave a durable OK behind for a run that then failed a later check.
    await recordVerdict('ok', 'single document scroll owner; page never scrolls; note list scrolls independently')
    console.log('FLASHNOTE_SCROLL_ACCEPTANCE_SUCCESS')
  } catch (error) {
    await reportAcceptanceStage(scrollStageFailed(stage))
    console.error('FLASHNOTE_SCROLL_ACCEPTANCE_FAILURE', error)
    // A failed-verdict write must never overwrite the original verification
    // failure: the original exception is what the run is judged by.
    await recordFailureVerdict(failureDetail(error))
    throw error
  }
}
