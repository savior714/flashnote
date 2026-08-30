import { Window } from '@wailsio/runtime'

const failureMessage = 'Changes aren’t saved. Flashnote will keep retrying.'
const closeTitle = 'Changes aren’t saved'

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

function dialogButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) {
    throw new Error(`acceptance P1B: close dialog is missing "${label}"`)
  }
  return button
}

function editableTitleInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input.title:not([readonly])')
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
    () => {
      const row = normalNoteRow(originalNoteID)
      return row && !row.disabled ? row : null
    },
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

async function verifyFailedNavigationKeepsDraft(
  originalNoteID: string,
  siblingNoteID: string,
  expectedTitle: string,
): Promise<void> {
  const siblingRow = await waitFor(
    () => {
      const row = normalNoteRow(siblingNoteID)
      return row && !row.disabled ? row : null
    },
    'sibling note navigation target while save is failing',
  )
  siblingRow.click()

  await waitFor(
    () => {
      const row = activeNormalNoteRow()
      if (row?.dataset.noteId !== originalNoteID || row.disabled) {
        return null
      }
      const input = document.querySelector<HTMLInputElement>('input.title:not([readonly])')
      return input?.value === expectedTitle ? row : null
    },
    'failed navigation to return control without changing the active note',
  )

  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: failed navigation cleared the unresolved save-failure state')
  }
  if (editableTitleInput().value !== expectedTitle) {
    throw new Error('acceptance P1B: failed navigation lost the latest in-memory draft')
  }
  if (activeNormalNoteRow()?.dataset.noteId !== originalNoteID) {
    throw new Error('acceptance P1B: failed save allowed navigation away from the dirty note')
  }

  console.log('FLASHNOTE_SAVE_FAILURE_NAVIGATION_GUARD_SUCCESS')
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

  void Window.Close()
  return haltUntilProcessExit()
}

async function runDiscardAcceptance(): Promise<never> {
  const { originalNoteID, siblingNoteID } = await prepareNavigationSibling()

  editTitle('P1B discard first draft')
  await waitFor(saveFailureNotice, 'persistent autosave failure state')
  await verifyFailurePersistsAcrossNewerDraft('P1B discard latest draft')
  await verifyFailedNavigationKeepsDraft(
    originalNoteID,
    siblingNoteID,
    'P1B discard latest draft',
  )

  await Window.Close()
  let dialog = await waitForCloseDialog()
  const explanatoryText = dialog.textContent ?? ''
  if (!explanatoryText.includes('Retry saving, keep the window open, or discard those unsaved changes and exit.')) {
    throw new Error('acceptance P1B: close dialog does not explain the unsaved-change choices')
  }
  const cancel = dialogButton(dialog, 'Cancel')
  dialogButton(dialog, 'Retry saving')
  dialogButton(dialog, 'Discard & exit')

  cancel.click()
  await waitFor(() => (closeDialog() ? null : true), 'Cancel to keep the window open')
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: Cancel cleared the unresolved save-failure state')
  }
  if (editableTitleInput().value !== 'P1B discard latest draft') {
    throw new Error('acceptance P1B: Cancel lost the in-memory draft')
  }

  await Window.Close()
  dialog = await waitForCloseDialog()
  dialogButton(dialog, 'Retry saving').click()
  await delay(120)
  dialog = await waitForCloseDialog()
  if (!saveFailureNotice()) {
    throw new Error('acceptance P1B: failed Retry cleared unresolved save-failure state')
  }

  dialogButton(dialog, 'Discard & exit').click()
  return haltUntilProcessExit()
}

export async function runDataSafetyAcceptance(mode: string): Promise<never> {
  switch (mode) {
    case 'recovery':
      return runRecoveryAcceptance()
    case 'discard':
      return runDiscardAcceptance()
    default:
      throw new Error(`acceptance P1B: unsupported mode "${mode}"`)
  }
}
