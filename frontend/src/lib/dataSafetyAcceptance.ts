import { Window } from '@wailsio/runtime'
import { OpenNote, SearchNotes } from '../../bindings/github.com/savior714/flashnote/appservice'

type NoteTuple = [string, string, string, number, boolean]
type SaveFailureAcceptanceHooks = {
  startSaveForRaceProbe: () => boolean
  isTransitionPromptVisible: () => boolean
  currentNoteID: () => string
}

const failureMessage = 'Changes aren’t saved. Flashnote will keep retrying.'
const closeTitle = 'Changes aren’t saved'
const transitionDialogSelector = '[data-save-transition-dialog]'

// SaveNotes handshakes: fixed unique query lengths observed as
// FLASHNOTE_NOTE_SEARCH query_len=<len> on the Go side so the native runner
// can order phases and drop the forced-failure trigger at the right moment.
const stayMarker = 'flashnote-p1b-navigation-stay-handshake-v1' // query_len=42
const retryFailureMarker = 'flashnote-p1b-navigation-retry-failure-handshake-v1' // query_len=51
const discardMarker = 'flashnote-p1b-navigation-discard-handshake-v1' // query_len=45
const triggerDropMarker = 'flashnote-p1b-navigation-trigger-drop-handshake-v1' // query_len=50
const retrySuccessMarker = 'flashnote-p1b-navigation-retry-succeeded-handshake-v1' // query_len=53

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(
  read: () => T | null | undefined | false,
  description: string,
  timeoutMs = 8000,
): Promise<T> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const value = read()
    if (value) {
      return value
    }
    await delay(30)
  }
  throw new Error(`acceptance P1B: timed out waiting for ${description}`)
}

function saveFailureNotice(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('.save-error')).find((element) =>
      element.textContent?.includes(failureMessage),
    ) ?? null
  )
}

function closeDialog(): HTMLElement | null {
  const dialog = document.querySelector<HTMLElement>('.close-dialog')
  if (!dialog) {
    return null
  }
  const heading = dialog.querySelector('h2')?.textContent?.trim()
  return heading === closeTitle ? dialog : null
}

function transitionDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(transitionDialogSelector)
}

function dialogButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) {
    throw new Error(`acceptance P1B: dialog is missing "${label}"`)
  }
  return button
}

function titleInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input.title:not([readonly])')
}

function editableTitleInput(): HTMLInputElement {
  const input = titleInput()
  if (!input || input.disabled) {
    throw new Error('acceptance P1B: editable title input is unavailable')
  }
  return input
}

function editTitle(nextTitle: string): void {
  const input = editableTitleInput()
  input.value = nextTitle
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function activeNormalNoteRow(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    'nav.note-list:not(.trash-list) button.note-row[data-note-id][aria-current="page"]',
  )
}

function normalNoteRow(noteID: string): HTMLButtonElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'nav.note-list:not(.trash-list) button.note-row[data-note-id]',
      ),
    ).find((candidate) => candidate.dataset.noteId === noteID) ?? null
  )
}

function enabledNormalNoteRow(noteID: string): HTMLButtonElement | null {
  const row = normalNoteRow(noteID)
  return row && !row.disabled ? row : null
}

function acceptanceHooks(): SaveFailureAcceptanceHooks {
  const hooks = (window as unknown as Record<string, SaveFailureAcceptanceHooks | undefined>)
    .__flashnoteDataSafetyAcceptance
  if (!hooks) {
    throw new Error('acceptance P1B: data safety acceptance hooks are not installed')
  }
  return hooks
}

async function emitHandshake(token: string): Promise<void> {
  await SearchNotes(token)
}

async function prepareNavigationSibling(): Promise<{ originalNoteID: string; siblingNoteID: string }> {
  const originalRow = await waitFor(
    () => {
      const row = activeNormalNoteRow()
      return row && !row.disabled ? row : null
    },
    'active normal note before navigation setup',
  )
  const originalNoteID = originalRow.dataset.noteId ?? ''
  if (!originalNoteID) {
    throw new Error('acceptance P1B: active normal note is missing its stable id')
  }

  const createButton = await waitFor(
    () => {
      const button = document.querySelector<HTMLButtonElement>(
        '.create-controls > button[aria-label="Create"]',
      )
      return button && !button.disabled ? button : null
    },
    'Create button for navigation setup',
  )
  createButton.click()

  const newNoteButton = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.create-menu button')).find(
        (button) => button.textContent?.trim() === 'New note' && !button.disabled,
      ) ?? null,
    'New note action for navigation setup',
  )
  newNoteButton.click()

  const siblingRow = await waitFor(
    () => {
      const row = activeNormalNoteRow()
      const id = row?.dataset.noteId ?? ''
      return row && id && id !== originalNoteID && !row.disabled ? row : null
    },
    'temporary sibling note',
  )
  const siblingNoteID = siblingRow.dataset.noteId ?? ''
  if (!siblingNoteID) {
    throw new Error('acceptance P1B: temporary sibling note is missing its stable id')
  }

  const refreshedOriginalRow = await waitFor(
    () => enabledNormalNoteRow(originalNoteID),
    'original note after temporary sibling creation',
  )
  refreshedOriginalRow.click()
  await waitFor(
    () => {
      const row = activeNormalNoteRow()
      return row?.dataset.noteId === originalNoteID && !row.disabled ? row : null
    },
    'return to original note before forced save failure',
  )

  return { originalNoteID, siblingNoteID }
}

async function verifyFailurePersistsAcrossNewerDraft(nextTitle: string): Promise<void> {
  editTitle(nextTitle)
  await delay(120)
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: failure state disappeared while a newer unsaved draft remained')
  }
  if (editableTitleInput().value !== nextTitle) {
    throw new Error('acceptance P1B: newer in-memory title draft was not retained')
  }
}

async function requestTransitionDialog(siblingNoteID: string): Promise<HTMLElement> {
  const siblingRow = await waitFor(
    () => enabledNormalNoteRow(siblingNoteID),
    'sibling note navigation target while save is failing',
  )
  siblingRow.click()
  return waitFor(transitionDialog, 'save-failure transition choice dialog')
}

async function settleTransitionControls(originalNoteID: string): Promise<void> {
  await waitFor(
    () => {
      const originalRow = normalNoteRow(originalNoteID)
      const input = titleInput()
      return originalRow && input && !originalRow.disabled && !input.disabled ? true : null
    },
    'failed transition to release transition controls',
  )
}

// A. Save failure + Stay here: the current note and the latest draft are
// preserved, no navigation happens, and the failure state remains visible.
async function verifyStayKeepsCurrentNote(
  originalNoteID: string,
  siblingNoteID: string,
  expectedTitle: string,
): Promise<void> {
  const dialog = await requestTransitionDialog(siblingNoteID)
  if (activeNormalNoteRow()?.dataset.noteId !== originalNoteID) {
    throw new Error('acceptance P1B: transition dialog appeared with a different current note')
  }
  if (titleInput()?.value !== expectedTitle) {
    throw new Error('acceptance P1B: transition dialog lost the latest draft')
  }

  dialogButton(dialog, 'Stay here').click()
  await waitFor(() => (transitionDialog() ? null : true), 'Stay here to dismiss the dialog')
  await settleTransitionControls(originalNoteID)

  if (activeNormalNoteRow()?.dataset.noteId !== originalNoteID) {
    throw new Error('acceptance P1B: Stay here navigated away from the dirty note')
  }
  if (titleInput()?.value !== expectedTitle) {
    throw new Error('acceptance P1B: Stay here lost the latest draft')
  }
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: Stay here cleared the unresolved save-failure state')
  }
  await emitHandshake(stayMarker)
}

// C. Save failure + Retry saving that fails again: the draft is retained, the
// choice UI is withdrawn during the attempt and re-offered afterwards, and no
// navigation happens.
async function verifyRetryFailureReoffersChoice(
  originalNoteID: string,
  siblingNoteID: string,
  expectedTitle: string,
): Promise<void> {
  let dialog = await requestTransitionDialog(siblingNoteID)
  const dialogBefore = dialog
  dialogButton(dialog, 'Retry saving').click()
  // A fast server-side failure can re-present the dialog within one poll
  // interval; the {#if} block remounts the dialog element, so an element
  // identity change is an equally valid observation that the choice UI was
  // withdrawn for the attempt.
  const withdrawStartedAt = Date.now()
  let withdrawn = false
  while (Date.now() - withdrawStartedAt < 8000) {
    const current = transitionDialog()
    if (!current || current !== dialogBefore) {
      withdrawn = true
      break
    }
    await delay(5)
  }
  if (!withdrawn) {
    throw new Error('acceptance P1B: timed out waiting for choice UI to withdraw during retry')
  }
  dialog = await waitFor(transitionDialog, 'Retry saving to re-offer the choice after failure')
  // The choice UI stays modal-pending after a failed retry: the transition
  // intentionally remains unresolved (controls disabled) until the user answers.

  if (activeNormalNoteRow()?.dataset.noteId !== originalNoteID) {
    throw new Error('acceptance P1B: failed Retry navigated away from the dirty note')
  }
  if (titleInput()?.value !== expectedTitle) {
    throw new Error('acceptance P1B: failed Retry lost the latest draft')
  }
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: failed Retry cleared the unresolved save-failure state')
  }
  await emitHandshake(retryFailureMarker)
}

// D + E. Save failure + Discard changes & continue with a guaranteed
// in-flight stale SaveNote completion: the requested transition completes
// exactly once, the previous durable version is untouched, and neither the
// stale completion nor a resurrected retry touches destination state.
async function verifyDiscardCompletesNavigation(
  originalNoteID: string,
  siblingNoteID: string,
  baselineTitle: string,
  baselineRevision: number,
): Promise<void> {
  const hooks = acceptanceHooks()
  // C leaves the choice dialog pending; reuse it rather than clicking a
  // disabled row. Re-requesting is the fallback for standalone runs.
  let dialog = transitionDialog()
  if (!dialog) {
    dialog = await requestTransitionDialog(siblingNoteID)
  }
  if (!hooks.startSaveForRaceProbe()) {
    throw new Error('acceptance P1B: race probe could not start an in-flight save')
  }
  dialogButton(dialog, 'Discard changes & continue').click()
  await waitFor(
    () => (activeNormalNoteRow()?.dataset.noteId === siblingNoteID ? true : null),
    'Discard changes & continue to complete the requested navigation',
  )
  await settleTransitionControls(siblingNoteID)
  if (transitionDialog() || hooks.isTransitionPromptVisible()) {
    throw new Error('acceptance P1B: transition dialog remained after discard-and-continue')
  }
  if (saveFailureNotice()) {
    throw new Error('acceptance P1B: destination note inherited the discarded save-failure state')
  }
  if (editableTitleInput().value !== '') {
    throw new Error('acceptance P1B: destination note lost its clean empty state')
  }

  // Silence window: the discarded draft must not resurrect a background
  // retry, and the in-flight stale completion must not leak into the new
  // note's identity, draft, error state, or retry scheduling.
  await delay(4000)
  if (activeNormalNoteRow()?.dataset.noteId !== siblingNoteID) {
    throw new Error('acceptance P1B: stale save completion changed the current note')
  }
  if (editableTitleInput().value !== '') {
    throw new Error('acceptance P1B: stale save completion contaminated the destination draft')
  }
  if (saveFailureNotice() || transitionDialog()) {
    throw new Error('acceptance P1B: stale save completion resurrected failure state')
  }
  const durableOriginal = (await OpenNote(originalNoteID)) as NoteTuple
  if (durableOriginal[1] !== baselineTitle || durableOriginal[3] !== baselineRevision) {
    throw new Error('acceptance P1B: discard damaged the previous durable version')
  }

  // The destination note's own autosave path must stay healthy after the
  // discarded stale request settles.
  editTitle('P1B navok durable draft')
  await waitForDurableTitle(siblingNoteID, 'P1B navok durable draft')
  if (saveFailureNotice() || transitionDialog()) {
    throw new Error('acceptance P1B: destination autosave surfaced failure UI after discard')
  }
  await emitHandshake(discardMarker)
}

// B. Save failure + Retry saving that finally succeeds (the native runner
// removes the forced-failure trigger at the handshake): the latest draft is
// durably saved and the originally requested destination is reached exactly
// once. Clean navigations in between must never surface the dialog (F).
async function verifyRetrySuccessContinues(
  originalNoteID: string,
  siblingNoteID: string,
  baselineRevision: number,
): Promise<void> {
  await waitFor(
    () => (titleInput() && !titleInput()?.disabled ? true : null),
    'destination note to become editable after its autosave',
  )
  await waitFor(
    () => (activeNormalNoteRow()?.dataset.noteId === siblingNoteID ? true : null),
    'destination note to remain current',
  )

  const originalRow = await waitFor(
    () => enabledNormalNoteRow(originalNoteID),
    'original note row for the retry-success phase',
  )
  originalRow.click()
  await waitFor(
    () => (activeNormalNoteRow()?.dataset.noteId === originalNoteID ? true : null),
    'ordinary clean navigation back to the original note',
  )
  if (transitionDialog()) {
    throw new Error('acceptance P1B: ordinary successful navigation opened the save-failure dialog')
  }

  editTitle('P1B navfail retry draft')
  await waitFor(saveFailureNotice, 'autosave failure for the retry-success draft')

  const dialog = await requestTransitionDialog(siblingNoteID)
  await emitHandshake(triggerDropMarker)
  const startedAt = Date.now()
  while (activeNormalNoteRow()?.dataset.noteId !== siblingNoteID) {
    if (Date.now() - startedAt > 20000) {
      throw new Error('acceptance P1B: Retry saving never reached the requested destination')
    }
    const openDialog = transitionDialog()
    if (openDialog) {
      dialogButton(openDialog, 'Retry saving').click()
    }
    await delay(250)
  }
  await settleTransitionControls(siblingNoteID)
  if (transitionDialog() || saveFailureNotice()) {
    throw new Error('acceptance P1B: successful retry left failure UI behind')
  }
  if (activeNormalNoteRow()?.dataset.noteId !== siblingNoteID) {
    throw new Error('acceptance P1B: retry-success navigation landed on the wrong note')
  }
  const durableOriginal = (await OpenNote(originalNoteID)) as NoteTuple
  if (durableOriginal[1] !== 'P1B navfail retry draft') {
    throw new Error('acceptance P1B: retry did not durably save the latest draft before continuing')
  }
  if (durableOriginal[3] !== baselineRevision + 1) {
    throw new Error(
      `acceptance P1B: unexpected durable writes after baseline (revision=${durableOriginal[3]}, want ${baselineRevision + 1})`,
    )
  }
  await emitHandshake(retrySuccessMarker)
}

async function waitForDurableTitle(noteID: string, expectedTitle: string): Promise<NoteTuple> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8000) {
    const snapshot = (await OpenNote(noteID)) as NoteTuple
    if (snapshot[1] === expectedTitle) {
      return snapshot
    }
    await delay(50)
  }
  throw new Error(`acceptance P1B: note ${noteID} never durably reached title "${expectedTitle}"`)
}

async function runNavigationAcceptance(): Promise<never> {
  const { originalNoteID, siblingNoteID } = await prepareNavigationSibling()
  const baseline = (await OpenNote(originalNoteID)) as NoteTuple
  const baselineTitle = baseline[1]
  const baselineRevision = baseline[3]

  editTitle('P1B navfail first draft')
  await waitFor(saveFailureNotice, 'persistent autosave failure state')
  await verifyFailurePersistsAcrossNewerDraft('P1B navfail latest draft')

  await verifyStayKeepsCurrentNote(originalNoteID, siblingNoteID, 'P1B navfail latest draft')
  await verifyRetryFailureReoffersChoice(
    originalNoteID,
    siblingNoteID,
    'P1B navfail latest draft',
  )
  await verifyDiscardCompletesNavigation(
    originalNoteID,
    siblingNoteID,
    baselineTitle,
    baselineRevision,
  )
  await verifyRetrySuccessContinues(originalNoteID, siblingNoteID, baselineRevision)

  void Window.Close()
  return haltUntilProcessExit()
}

async function waitForCloseDialog(): Promise<HTMLElement> {
  return waitFor(closeDialog, 'blocking unsaved-close dialog')
}

function haltUntilProcessExit(): Promise<never> {
  return new Promise<never>(() => {})
}

async function runRecoveryAcceptance(): Promise<never> {
  editTitle('P1B recovery first draft')
  await waitFor(saveFailureNotice, 'persistent autosave failure state')
  await verifyFailurePersistsAcrossNewerDraft('P1B recovery latest draft')

  await waitFor(
    () => (saveFailureNotice() ? null : editableTitleInput().value === 'P1B recovery latest draft'),
    'background retry recovery and failure-state clearance',
    15000,
  )

  if (closeDialog()) {
    throw new Error('acceptance P1B: recovery unexpectedly left a blocking close dialog open')
  }
  if (transitionDialog()) {
    throw new Error('acceptance P1B: ordinary autosave recovery surfaced a transition save-failure dialog')
  }

  void Window.Close()
  return haltUntilProcessExit()
}

async function runDiscardAcceptance(): Promise<never> {
  const { originalNoteID, siblingNoteID } = await prepareNavigationSibling()

  editTitle('P1B discard first draft')
  await waitFor(saveFailureNotice, 'persistent autosave failure state')
  await verifyFailurePersistsAcrossNewerDraft('P1B discard latest draft')

  // The close-flow contract owns Retry/Discard & exit. Here a requested
  // navigation under failure must offer the choice and Stay must hold the
  // note and draft without navigating.
  const dialog = await requestTransitionDialog(siblingNoteID)
  dialogButton(dialog, 'Stay here').click()
  await waitFor(() => (transitionDialog() ? null : true), 'Stay here to dismiss the dialog')
  await settleTransitionControls(originalNoteID)
  if (activeNormalNoteRow()?.dataset.noteId !== originalNoteID) {
    throw new Error('acceptance P1B: Stay here navigated away from the dirty note')
  }
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: Stay here cleared the unresolved save-failure state')
  }
  if (editableTitleInput().value !== 'P1B discard latest draft') {
    throw new Error('acceptance P1B: Stay here lost the in-memory draft')
  }

  await Window.Close()
  let dialog2 = await waitForCloseDialog()
  const explanatoryText = dialog2.textContent ?? ''
  if (!explanatoryText.includes('Retry saving, keep the window open, or discard those unsaved changes and exit.')) {
    throw new Error('acceptance P1B: close dialog does not explain the unsaved-change choices')
  }
  const cancel = dialogButton(dialog2, 'Cancel')
  dialogButton(dialog2, 'Retry saving')
  dialogButton(dialog2, 'Discard & exit')

  cancel.click()
  await waitFor(() => (closeDialog() ? null : true), 'Cancel to keep the window open')
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: Cancel cleared the unresolved save-failure state')
  }
  if (editableTitleInput().value !== 'P1B discard latest draft') {
    throw new Error('acceptance P1B: Cancel lost the in-memory draft')
  }

  await Window.Close()
  dialog2 = await waitForCloseDialog()
  dialogButton(dialog2, 'Retry saving').click()
  await delay(120)
  dialog2 = await waitForCloseDialog()
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: failed Retry cleared unresolved save-failure state')
  }

  dialogButton(dialog2, 'Discard & exit').click()
  return haltUntilProcessExit()
}

export async function runDataSafetyAcceptance(mode: string): Promise<never> {
  switch (mode) {
    case 'recovery':
      return runRecoveryAcceptance()
    case 'discard':
      return runDiscardAcceptance()
    case 'navigation':
      return runNavigationAcceptance()
    default:
      throw new Error(`acceptance P1B: unsupported mode "${mode}"`)
  }
}
