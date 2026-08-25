import type { Editor } from '@tiptap/core'
import { tick } from 'svelte'
import {
  applyEditorFontSize,
  applyTheme,
  DEFAULT_SETTINGS,
  loadSettings,
  resolveTheme,
  sanitizeAppearance,
  sanitizeFontSize,
  sanitizeSpellcheck,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from './settings'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dispatchKey(
  target: EventTarget,
  key: string,
  options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
) {
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

export async function runSettingsAcceptance(editor: Editor): Promise<void> {
  try {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
    const primaryModifier = isMac ? { metaKey: true } : { ctrlKey: true }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // A. DEFAULTS & SANITIZATION PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
    const defaults = loadSettings()
    if (
      defaults.appearance !== 'system' ||
      defaults.editorFontSize !== 16 ||
      defaults.spellcheck !== true
    ) {
      throw new Error(`acceptance: default settings mismatch: ${JSON.stringify(defaults)}`)
    }

    // Test malformed storage parsing
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{ invalid json')
    const fallbackFromMalformed = loadSettings()
    if (
      fallbackFromMalformed.appearance !== 'system' ||
      fallbackFromMalformed.editorFontSize !== 16 ||
      fallbackFromMalformed.spellcheck !== true
    ) {
      throw new Error('acceptance: malformed stored json did not fallback to defaults')
    }

    // Test out-of-range / invalid field sanitization
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ appearance: 'neon-cyberpunk', editorFontSize: 999, spellcheck: 'not-bool' }),
    )
    const sanitized = loadSettings()
    if (
      sanitized.appearance !== 'system' ||
      sanitized.editorFontSize !== 16 ||
      sanitized.spellcheck !== true
    ) {
      throw new Error(`acceptance: invalid field values failed to sanitize: ${JSON.stringify(sanitized)}`)
    }

    localStorage.removeItem(SETTINGS_STORAGE_KEY)

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // B. SETTINGS SHORTCUT PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Unmodified comma must NOT open settings
    dispatchKey(window, ',')
    await tick()
    await delay(30)
    if (document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance: unmodified comma unexpectedly opened Settings')
    }

    // 2. Cmd/Ctrl+, opens Settings dialog
    dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(50)
    let dialog = document.querySelector<HTMLElement>('.settings-dialog')
    if (!dialog) {
      throw new Error('acceptance: Cmd/Ctrl+, failed to open Settings dialog')
    }

    // 3. Cmd/Ctrl+, again closes Settings (toggle behavior)
    dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(50)
    if (document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance: Cmd/Ctrl+, toggle failed to close Settings dialog')
    }

    // 4. Open via Settings button in sidebar
    const settingsButton = document.querySelector<HTMLButtonElement>('.settings-row')
    if (!settingsButton) {
      throw new Error('acceptance: sidebar .settings-row button not found')
    }
    settingsButton.click()
    await tick()
    await delay(50)
    dialog = document.querySelector<HTMLElement>('.settings-dialog')
    if (!dialog) {
      throw new Error('acceptance: clicking sidebar Settings button failed to open dialog')
    }

    // 5. Escape closes Settings dialog
    dispatchKey(window, 'Escape')
    await tick()
    await delay(50)
    if (document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance: Escape key failed to close Settings dialog')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // C. SEARCH REGRESSION PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Cmd/Ctrl+K must open search, not settings
    dispatchKey(window, 'k', primaryModifier)
    await tick()
    await delay(50)
    const searchDialog = document.querySelector<HTMLElement>('.search-dialog')
    if (!searchDialog) {
      throw new Error('acceptance: Cmd/Ctrl+K failed to open Search')
    }
    if (document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance: Cmd/Ctrl+K unexpectedly opened Settings')
    }
    dispatchKey(window, 'Escape')
    await tick()
    await delay(50)

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // D. APPEARANCE THEMES PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Open Settings dialog for theme testing
    dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(50)
    dialog = document.querySelector<HTMLElement>('.settings-dialog')
    if (!dialog) {
      throw new Error('acceptance: failed to open Settings for theme tests')
    }

    const themeButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.appearance-option'))
    const lightBtn = themeButtons.find((b) => b.textContent?.trim() === 'Light')
    const darkBtn = themeButtons.find((b) => b.textContent?.trim() === 'Dark')
    const systemBtn = themeButtons.find((b) => b.textContent?.trim() === 'System')

    if (!lightBtn || !darkBtn || !systemBtn) {
      throw new Error('acceptance: appearance options (Light, Dark, System) not all rendered')
    }

    function getTheme(): string {
      return document.documentElement.getAttribute('data-theme') || ''
    }

    // 1. Explicit Light
    lightBtn.click()
    await tick()
    await delay(30)
    if (getTheme() !== 'light') {
      throw new Error(`acceptance: document theme dataset expected "light", got "${getTheme()}"`)
    }
    if (resolveTheme('light') !== 'light') {
      throw new Error('acceptance: resolveTheme("light") did not return "light"')
    }

    // 2. Explicit Dark
    darkBtn.click()
    await tick()
    await delay(30)
    if (getTheme() !== 'dark') {
      throw new Error(`acceptance: document theme dataset expected "dark", got "${getTheme()}"`)
    }
    if (resolveTheme('dark') !== 'dark') {
      throw new Error('acceptance: resolveTheme("dark") did not return "dark"')
    }

    // 3. System
    systemBtn.click()
    await tick()
    await delay(30)
    const expectedSystemTheme = resolveTheme('system')
    if (getTheme() !== expectedSystemTheme) {
      throw new Error(`acceptance: System theme dataset mismatch: expected "${expectedSystemTheme}", got "${getTheme()}"`)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E. FONT SIZE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const initialDocJSON = JSON.stringify(editor.getJSON())
    const fontSlider = dialog.querySelector<HTMLInputElement>('.font-size-slider')
    if (!fontSlider) {
      throw new Error('acceptance: font size slider not found in Settings')
    }

    // Change to 20px
    fontSlider.value = '20'
    fontSlider.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    await delay(30)

    const rootFontSizeVar = document.documentElement.style.getPropertyValue('--editor-font-size')
    if (rootFontSizeVar !== '20px') {
      throw new Error(`acceptance: --editor-font-size expected "20px", got "${rootFontSizeVar}"`)
    }

    const editorDom = document.querySelector<HTMLElement>('.prose-editor')
    if (!editorDom) {
      throw new Error('acceptance: .prose-editor element not found')
    }
    const computedFontSize = window.getComputedStyle(editorDom).fontSize
    if (computedFontSize !== '20px') {
      throw new Error(`acceptance: .prose-editor computed font-size expected "20px", got "${computedFontSize}"`)
    }

    // Verify document JSON was not mutated
    const currentDocJSON = JSON.stringify(editor.getJSON())
    if (currentDocJSON !== initialDocJSON) {
      throw new Error('acceptance: font size change mutated document JSON')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // F. SPELLCHECK PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const spellcheckCheckbox = dialog.querySelector<HTMLInputElement>('.spellcheck-checkbox')
    if (!spellcheckCheckbox) {
      throw new Error('acceptance: spellcheck checkbox not found in Settings')
    }

    // Toggle to false
    spellcheckCheckbox.checked = false
    spellcheckCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    await delay(30)

    if (editorDom.getAttribute('spellcheck') !== 'false') {
      throw new Error(`acceptance: editor spellcheck attribute expected "false", got "${editorDom.getAttribute('spellcheck')}"`)
    }

    // Toggle back to true
    spellcheckCheckbox.checked = true
    spellcheckCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    await delay(30)

    if (editorDom.getAttribute('spellcheck') !== 'true') {
      throw new Error(`acceptance: editor spellcheck attribute expected "true", got "${editorDom.getAttribute('spellcheck')}"`)
    }

    // Verify document JSON remains unmutated
    if (JSON.stringify(editor.getJSON()) !== initialDocJSON) {
      throw new Error('acceptance: spellcheck toggle mutated document JSON')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // G. EXPORT ALL PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const exportButton = dialog.querySelector<HTMLButtonElement>('.export-all-button')
    if (!exportButton) {
      throw new Error('acceptance: export-all-button not found in Settings')
    }
    if (exportButton.disabled) {
      throw new Error('acceptance: export-all-button was unexpectedly disabled initially')
    }
    // Verify button text and action readiness
    if (!exportButton.textContent?.includes('Export all')) {
      throw new Error(`acceptance: unexpected export button label: "${exportButton.textContent}"`)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // H. PERSISTENCE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Save specific test settings
    const testSettings: Settings = {
      appearance: 'dark',
      editorFontSize: 18,
      spellcheck: false,
    }
    saveSettings(testSettings)

    const reloaded = loadSettings()
    if (
      reloaded.appearance !== testSettings.appearance ||
      reloaded.editorFontSize !== testSettings.editorFontSize ||
      reloaded.spellcheck !== testSettings.spellcheck
    ) {
      throw new Error(`acceptance: settings persistence mismatch: ${JSON.stringify(reloaded)}`)
    }

    // Clean up to default state for application lifecycle
    saveSettings(DEFAULT_SETTINGS)
    applyTheme('system')
    applyEditorFontSize(16)

    // Close Settings dialog via close button
    const closeBtn = dialog.querySelector<HTMLButtonElement>('.settings-close-button')
    if (closeBtn) {
      closeBtn.click()
    } else {
      dispatchKey(window, 'Escape')
    }
    await tick()
    await delay(50)

    if (document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance: Settings dialog failed to close via close button')
    }

    console.log('FLASHNOTE_S1_ACCEPTANCE_SUCCESS')
    console.log('FLASHNOTE_SETTINGS_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_SETTINGS_ACCEPTANCE_FAILURE', error)
    throw error
  }
}
