import type { Editor } from '@tiptap/core'
import { tick } from 'svelte'
import { SETTINGS_STORAGE_KEY } from './settings'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dispatchKey(
  target: EventTarget,
  key: string,
  options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
  })
  target.dispatchEvent(event)
  return event
}

export async function runNavigationShellAcceptance(editor: Editor): Promise<void> {
  try {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
    const primaryModifier = isMac ? { metaKey: true } : { ctrlKey: true }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // A. DEFAULT VISIBLE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await tick()
    await delay(30)

    const initialSidebar = document.querySelector<HTMLElement>('aside.sidebar')
    if (!initialSidebar) {
      throw new Error('acceptance S2: sidebar is not rendered by default')
    }

    const shell = document.querySelector<HTMLElement>('main.shell')
    if (!shell || shell.classList.contains('sidebar-hidden')) {
      throw new Error('acceptance S2: shell is unexpectedly marked sidebar-hidden by default')
    }

    const hideButton = document.querySelector<HTMLButtonElement>('.hide-sidebar-button')
    if (!hideButton || hideButton.getAttribute('aria-label') !== 'Hide sidebar') {
      throw new Error('acceptance S2: hide sidebar button missing or missing aria-label')
    }

    if (document.querySelector('.show-sidebar-button') !== null) {
      throw new Error('acceptance S2: show sidebar button unexpectedly exists in default visible state')
    }

    // Capture editor DOM identity and document content
    const editorDomNode = document.querySelector<HTMLElement>('.prose-editor')
    if (!editorDomNode) {
      throw new Error('acceptance S2: .prose-editor element not found')
    }
    const initialDocJSON = JSON.stringify(editor.getJSON())

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // B. PLAIN BACKSLASH NEGATIVE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const plainBackslashEvent = dispatchKey(window, '\\')
    await tick()
    await delay(30)

    if (plainBackslashEvent.defaultPrevented) {
      throw new Error('acceptance S2: plain backslash was unexpectedly default-prevented')
    }
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: plain backslash unexpectedly hid sidebar')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // C. MODIFIER SHORTCUT — HIDE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const hideShortcutEvent = dispatchKey(window, '\\', primaryModifier)
    await tick()
    await delay(50)

    if (!hideShortcutEvent.defaultPrevented) {
      throw new Error('acceptance S2: Cmd/Ctrl+\\ was not default-prevented')
    }
    if (document.querySelector('aside.sidebar') !== null) {
      throw new Error('acceptance S2: Cmd/Ctrl+\\ failed to hide sidebar')
    }
    if (!shell.classList.contains('sidebar-hidden')) {
      throw new Error('acceptance S2: shell missing .sidebar-hidden class after toggle')
    }

    const showButton = document.querySelector<HTMLButtonElement>('.show-sidebar-button')
    if (!showButton || showButton.getAttribute('aria-label') !== 'Show sidebar') {
      throw new Error('acceptance S2: show sidebar button missing or missing aria-label in hidden state')
    }
    if (document.querySelector('.hide-sidebar-button') !== null) {
      throw new Error('acceptance S2: hide sidebar button unexpectedly present when sidebar is hidden')
    }

    // Editor continuity checks
    const currentEditorDomAfterHide = document.querySelector<HTMLElement>('.prose-editor')
    if (currentEditorDomAfterHide !== editorDomNode) {
      throw new Error('acceptance S2: .prose-editor DOM node was recreated when sidebar was hidden')
    }
    if (JSON.stringify(editor.getJSON()) !== initialDocJSON) {
      throw new Error('acceptance S2: editor document was mutated when sidebar was hidden')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D. READABLE WIDTH PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const docInner = document.querySelector<HTMLElement>('.document-inner')
    if (!docInner) {
      throw new Error('acceptance S2: .document-inner not found')
    }
    const innerRect = docInner.getBoundingClientRect()
    if (window.innerWidth >= 800) {
      if (innerRect.width > 722) {
        throw new Error(`acceptance S2: .document-inner width (${innerRect.width}px) exceeds 720px max-width`)
      }
      if (innerRect.width >= window.innerWidth - 32) {
        throw new Error('acceptance S2: .document-inner stretched to full window width instead of respecting max-width')
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E. SHORTCUT — SHOW PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const showShortcutEvent = dispatchKey(window, '\\', primaryModifier)
    await tick()
    await delay(50)

    if (!showShortcutEvent.defaultPrevented) {
      throw new Error('acceptance S2: second Cmd/Ctrl+\\ was not default-prevented')
    }
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: second Cmd/Ctrl+\\ failed to reveal sidebar')
    }
    if (shell.classList.contains('sidebar-hidden')) {
      throw new Error('acceptance S2: shell retained .sidebar-hidden class after reveal')
    }
    if (document.querySelector('.hide-sidebar-button') === null) {
      throw new Error('acceptance S2: hide sidebar button did not return after reveal')
    }
    if (document.querySelector('.show-sidebar-button') !== null) {
      throw new Error('acceptance S2: show sidebar button remained in DOM after reveal')
    }

    const currentEditorDomAfterShow = document.querySelector<HTMLElement>('.prose-editor')
    if (currentEditorDomAfterShow !== editorDomNode) {
      throw new Error('acceptance S2: .prose-editor DOM node was recreated when sidebar was revealed')
    }
    if (JSON.stringify(editor.getJSON()) !== initialDocJSON) {
      throw new Error('acceptance S2: editor document was mutated when sidebar was revealed')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // F. VISIBLE BUTTON — HIDE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const activeHideBtn = document.querySelector<HTMLButtonElement>('.hide-sidebar-button')
    if (!activeHideBtn) {
      throw new Error('acceptance S2: hide sidebar button not found for button click test')
    }
    activeHideBtn.click()
    await tick()
    await delay(50)

    if (document.querySelector('aside.sidebar') !== null) {
      throw new Error('acceptance S2: clicking hide sidebar button failed to hide sidebar')
    }
    if (document.querySelector('.show-sidebar-button') === null) {
      throw new Error('acceptance S2: show sidebar button did not appear after button hide')
    }
    if (document.querySelector<HTMLElement>('.prose-editor') !== editorDomNode) {
      throw new Error('acceptance S2: .prose-editor DOM node changed on button hide')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // G. HIDDEN BUTTON — SHOW PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const activeShowBtn = document.querySelector<HTMLButtonElement>('.show-sidebar-button')
    if (!activeShowBtn) {
      throw new Error('acceptance S2: show sidebar button not found for button click test')
    }
    activeShowBtn.click()
    await tick()
    await delay(50)

    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: clicking show sidebar button failed to reveal sidebar')
    }
    if (document.querySelector('.hide-sidebar-button') === null) {
      throw new Error('acceptance S2: hide sidebar button did not reappear after button show')
    }
    if (document.querySelector<HTMLElement>('.prose-editor') !== editorDomNode) {
      throw new Error('acceptance S2: .prose-editor DOM node changed on button show')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // H. MODIFIER NEGATIVES PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Cmd/Ctrl + Shift + \
    dispatchKey(window, '\\', { ...primaryModifier, shiftKey: true })
    await tick()
    await delay(30)
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: Cmd/Ctrl+Shift+\\ unexpectedly toggled sidebar')
    }

    // 2. Alt + \
    dispatchKey(window, '\\', { altKey: true })
    await tick()
    await delay(30)
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: Alt+\\ unexpectedly toggled sidebar')
    }

    // 3. Cmd/Ctrl + Alt + \
    dispatchKey(window, '\\', { ...primaryModifier, altKey: true })
    await tick()
    await delay(30)
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: Cmd/Ctrl+Alt+\\ unexpectedly toggled sidebar')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // I. EXISTING SHORTCUT REGRESSIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Cmd/Ctrl+K -> Search opens, sidebar not toggled
    dispatchKey(window, 'k', primaryModifier)
    await tick()
    await delay(40)
    if (document.querySelector('.search-dialog') === null) {
      throw new Error('acceptance S2: Cmd/Ctrl+K failed to open Search overlay')
    }
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: Cmd/Ctrl+K unexpectedly hid sidebar')
    }
    dispatchKey(window, 'Escape')
    await tick()
    await delay(40)

    // Cmd/Ctrl+, -> Settings opens, sidebar not toggled
    dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(40)
    if (document.querySelector('.settings-dialog') === null) {
      throw new Error('acceptance S2: Cmd/Ctrl+, failed to open Settings dialog')
    }
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: Cmd/Ctrl+, unexpectedly hid sidebar')
    }
    dispatchKey(window, 'Escape')
    await tick()
    await delay(40)

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // J. NO PERSISTENCE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (localStorage.getItem('sidebarVisible') !== null) {
      throw new Error('acceptance S2: sidebarVisible was unexpectedly written to localStorage')
    }
    if (localStorage.getItem('flashnote:sidebar') !== null) {
      throw new Error('acceptance S2: flashnote:sidebar was unexpectedly written to localStorage')
    }
    const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (storedSettings && storedSettings.includes('sidebar')) {
      throw new Error('acceptance S2: settings storage contains unexpected sidebar property')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // K. FINAL STATE RESTORATION & NON-MUTATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (document.querySelector('aside.sidebar') === null) {
      throw new Error('acceptance S2: sidebar left in hidden state at completion of S2 tests')
    }
    if (JSON.stringify(editor.getJSON()) !== initialDocJSON) {
      throw new Error('acceptance S2: editor JSON was mutated across entire S2 suite')
    }

    console.log('FLASHNOTE_S2_ACCEPTANCE_SUCCESS')
    console.log('FLASHNOTE_NAVIGATION_SHELL_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_NAVIGATION_SHELL_ACCEPTANCE_FAILURE', error)
    throw error
  }
}
