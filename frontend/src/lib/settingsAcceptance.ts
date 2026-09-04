import type { Editor } from '@tiptap/core'
import { tick } from 'svelte'
import { setLibraryExporterForTest } from './libraryExport'
import {
  applyEditorFontSize,
  applyTheme,
  DEFAULT_SETTINGS,
  loadSettings,
  resolveTheme,
  sanitizeAppearance,
  sanitizeFontSize,
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
      'spellcheck' in defaults
    ) {
      throw new Error(`acceptance: default settings mismatch: ${JSON.stringify(defaults)}`)
    }

    // 1. Malformed JSON -> defaults
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{ invalid json')
    const fallbackFromMalformed = loadSettings()
    if (
      fallbackFromMalformed.appearance !== 'system' ||
      fallbackFromMalformed.editorFontSize !== 16 ||
      'spellcheck' in fallbackFromMalformed
    ) {
      throw new Error('acceptance: malformed stored json did not fallback to defaults')
    }

    // 2. Unknown appearance -> system, invalid font size -> 16. Legacy spellcheck is ignored.
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ appearance: 'neon-cyberpunk', editorFontSize: 'invalid-size', spellcheck: 'not-bool' }),
    )
    const sanitizedInvalidTypes = loadSettings()
    if (
      sanitizedInvalidTypes.appearance !== 'system' ||
      sanitizedInvalidTypes.editorFontSize !== 16 ||
      'spellcheck' in sanitizedInvalidTypes
    ) {
      throw new Error(`acceptance: invalid/legacy fields failed to sanitize: ${JSON.stringify(sanitizedInvalidTypes)}`)
    }

    // 3. Finite too-large font size: 999 -> 22; legacy spellcheck remains ignored.
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ appearance: 'dark', editorFontSize: 999, spellcheck: false }),
    )
    const sanitizedTooLarge = loadSettings()
    if (
      sanitizedTooLarge.appearance !== 'dark' ||
      sanitizedTooLarge.editorFontSize !== 22 ||
      'spellcheck' in sanitizedTooLarge
    ) {
      throw new Error(`acceptance: 999 font size or legacy field sanitization failed: ${JSON.stringify(sanitizedTooLarge)}`)
    }

    // 4. Finite too-small font size: 1 -> 14
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ appearance: 'light', editorFontSize: 1 }),
    )
    const sanitizedTooSmall = loadSettings()
    if (sanitizedTooSmall.appearance !== 'light' || sanitizedTooSmall.editorFontSize !== 14) {
      throw new Error(`acceptance: 1 font size was not clamped to 14: ${JSON.stringify(sanitizedTooSmall)}`)
    }

    // 5. Non-finite values tested directly against sanitizer -> 16
    if (sanitizeFontSize(Infinity) !== 16) {
      throw new Error('acceptance: sanitizeFontSize(Infinity) did not return 16')
    }
    if (sanitizeFontSize(-Infinity) !== 16) {
      throw new Error('acceptance: sanitizeFontSize(-Infinity) did not return 16')
    }
    if (sanitizeFontSize(NaN) !== 16) {
      throw new Error('acceptance: sanitizeFontSize(NaN) did not return 16')
    }
    if (sanitizeFontSize(undefined) !== 16) {
      throw new Error('acceptance: sanitizeFontSize(undefined) did not return 16')
    }

    if (sanitizeAppearance('unknown') !== 'system') {
      throw new Error('acceptance: sanitizeAppearance("unknown") did not return "system"')
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
    // B2. SETTINGS MODAL FOCUS LIFECYCLE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const focusInvoker =
      document.querySelector<HTMLElement>('.title') ??
      document.querySelector<HTMLElement>('.prose-editor')
    if (!focusInvoker) {
      throw new Error('acceptance: no focusable editor element available for Settings focus proof')
    }
    focusInvoker.focus()
    await tick()
    await delay(20)
    if (document.activeElement !== focusInvoker) {
      throw new Error('acceptance: could not place initial focus on the editor element')
    }
    const docJSONBeforeFocusProof = JSON.stringify(editor.getJSON())

    // A. INITIAL FOCUS: open through the real shortcut path (which itself
    // moves no focus) and prove focus transfers to the deterministic
    // descendant control — never the role="dialog" root itself (W3C APG
    // modal-dialog guidance advises against making the dialog container
    // focusable).
    dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(50)
    dialog = document.querySelector<HTMLElement>('.settings-dialog')
    if (!dialog) {
      throw new Error('acceptance: failed to open Settings for focus lifecycle proof')
    }
    if (!dialog.contains(document.activeElement)) {
      throw new Error('acceptance: opening Settings did not move focus into the modal')
    }
    if (document.activeElement === dialog) {
      throw new Error('acceptance: initial Settings focus landed on the dialog root itself instead of a descendant control')
    }
    const initialFocusTarget = dialog.querySelector<HTMLButtonElement>('.settings-close-button')
    if (!initialFocusTarget) {
      throw new Error('acceptance: Settings close button missing for initial-focus proof')
    }
    if (document.activeElement !== initialFocusTarget) {
      throw new Error('acceptance: opening Settings did not focus the deterministic close-button descendant')
    }
    if (document.activeElement === focusInvoker) {
      throw new Error('acceptance: background editor element remained the keyboard target after opening Settings')
    }

    function settingsTabbables(): HTMLElement[] {
      const root = document.querySelector<HTMLElement>('.settings-dialog')
      if (!root) {
        return []
      }
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0)
    }

    // B. TAB CONTAINMENT: Tab from the last boundary must wrap inside,
    // proved by interception (defaultPrevented) and not by markup alone.
    const tabbables = settingsTabbables()
    if (tabbables.length < 2) {
      throw new Error(`acceptance: expected at least 2 tabbable Settings controls, got ${tabbables.length}`)
    }
    const firstTabbable = tabbables[0]
    const lastTabbable = tabbables[tabbables.length - 1]
    lastTabbable.focus()
    await tick()
    await delay(20)
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    lastTabbable.dispatchEvent(tabEvent)
    await tick()
    await delay(20)
    if (!tabEvent.defaultPrevented) {
      throw new Error('acceptance: Tab from the last Settings control was not contained')
    }
    if (document.activeElement !== firstTabbable) {
      throw new Error('acceptance: Tab from the last Settings control did not wrap inside the modal')
    }

    // Shift+Tab from the first boundary must likewise wrap inside.
    firstTabbable.focus()
    await tick()
    await delay(20)
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    })
    firstTabbable.dispatchEvent(shiftTabEvent)
    await tick()
    await delay(20)
    if (!shiftTabEvent.defaultPrevented) {
      throw new Error('acceptance: Shift+Tab from the first Settings control was not contained')
    }
    if (document.activeElement !== lastTabbable) {
      throw new Error('acceptance: Shift+Tab from the first Settings control did not wrap inside the modal')
    }

    // C. CLOSE RESTORATION: ordinary close-button close must restore focus
    // to the invoking element while it still exists (reusing the proven
    // initial-focus descendant as the ordinary close control).
    initialFocusTarget.click()
    await tick()
    await delay(50)
    if (document.querySelector('.settings-dialog') !== null) {
      throw new Error('acceptance: Settings dialog failed to close during focus restoration proof')
    }
    if (document.activeElement !== focusInvoker) {
      throw new Error('acceptance: closing Settings did not restore focus to the invoking element')
    }

    // D. FOCUS-NAVIGATION REGRESSION: merely opening/navigating/closing
    // Settings must not mutate the document.
    if (JSON.stringify(editor.getJSON()) !== docJSONBeforeFocusProof) {
      throw new Error('acceptance: Settings focus navigation mutated document JSON')
    }
    console.log('FLASHNOTE_SETTINGS_FOCUS_LIFECYCLE_ACCEPTANCE_SUCCESS')

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
    // D. APPEARANCE THEMES + MINIMAL SETTINGS SURFACE PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    dispatchKey(window, ',', primaryModifier)
    await tick()
    await delay(50)
    dialog = document.querySelector<HTMLElement>('.settings-dialog')
    if (!dialog) {
      throw new Error('acceptance: failed to open Settings for theme tests')
    }

    const settingsBody = dialog.querySelector<HTMLElement>('.settings-body')
    const settingsSections = Array.from(
      settingsBody?.querySelectorAll<HTMLElement>(':scope > .settings-section') ?? [],
    )
    const sectionLabels = settingsSections.map(
      (section) => section.querySelector<HTMLElement>('.settings-section-title')?.textContent?.trim() ?? '',
    )
    if (
      !settingsBody ||
      settingsBody.children.length !== 3 ||
      settingsSections.length !== 3 ||
      JSON.stringify(sectionLabels) !== JSON.stringify(['Appearance', 'Editor', 'Data'])
    ) {
      throw new Error(
        `acceptance: Settings surface must contain exactly Appearance/Editor/Data sections, got ${JSON.stringify(sectionLabels)}`,
      )
    }

    const [appearanceSection, editorSection, dataSection] = settingsSections
    if (!appearanceSection || !editorSection || !dataSection) {
      throw new Error('acceptance: Settings surface section ownership is incomplete')
    }

    const appearanceLabels = Array.from(
      appearanceSection.querySelectorAll<HTMLButtonElement>('.appearance-option'),
    )
      .map((button) => button.textContent?.trim() ?? '')
      .sort()
    if (JSON.stringify(appearanceLabels) !== JSON.stringify(['Dark', 'Light', 'System'])) {
      throw new Error(
        `acceptance: Settings appearance surface must be exactly System/Light/Dark, got ${JSON.stringify(appearanceLabels)}`,
      )
    }

    const editorRows = Array.from(editorSection.querySelectorAll<HTMLElement>('.settings-row-item'))
    const editorLabels = editorRows.map(
      (row) => row.querySelector<HTMLElement>('.settings-label')?.textContent?.trim() ?? '',
    )
    if (editorRows.length !== 1 || JSON.stringify(editorLabels) !== JSON.stringify(['Font size'])) {
      throw new Error(
        `acceptance: Settings editor surface must contain only Font size, got ${JSON.stringify(editorLabels)}`,
      )
    }

    const dataRows = Array.from(dataSection.querySelectorAll<HTMLElement>('.settings-row-item'))
    const dataLabels = dataRows.map(
      (row) => row.querySelector<HTMLElement>('.settings-label')?.textContent?.trim() ?? '',
    )
    const dataExportButtons = dataSection.querySelectorAll<HTMLButtonElement>('.export-all-button')
    if (
      dataRows.length !== 1 ||
      JSON.stringify(dataLabels) !== JSON.stringify(['Export library']) ||
      dataExportButtons.length !== 1
    ) {
      throw new Error(
        `acceptance: Settings data surface must contain only Export library, got ${JSON.stringify(dataLabels)}`,
      )
    }

    const settingsInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('input'))
    if (
      settingsInputs.length !== 1 ||
      !settingsInputs[0]?.matches('.font-size-slider[type="range"]') ||
      dialog.querySelector('.spellcheck-checkbox, select, textarea') !== null ||
      dialog.textContent?.includes('Spellcheck')
    ) {
      throw new Error('acceptance: Settings exposed controls beyond font size and Export all')
    }
    console.log('FLASHNOTE_MINIMAL_SETTINGS_SURFACE_ACCEPTANCE_SUCCESS')

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
    // E. FONT SIZE + EDITOR POLICY PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const initialDocJSON = JSON.stringify(editor.getJSON())
    const fontSlider = dialog.querySelector<HTMLInputElement>('.font-size-slider')
    if (!fontSlider) {
      throw new Error('acceptance: font size slider not found in Settings')
    }

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
    if (editorDom.hasAttribute('spellcheck')) {
      throw new Error('acceptance: editor still forces an explicit spellcheck policy')
    }

    const currentDocJSON = JSON.stringify(editor.getJSON())
    if (currentDocJSON !== initialDocJSON) {
      throw new Error('acceptance: font size change mutated document JSON')
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // F. EXPORT ALL PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const exportButton = dialog.querySelector<HTMLButtonElement>('.export-all-button')
    if (!exportButton) {
      throw new Error('acceptance: export-all-button not found in Settings')
    }
    if (exportButton.disabled) {
      throw new Error('acceptance: export-all-button was unexpectedly disabled initially')
    }
    if (!exportButton.textContent?.includes('Export all')) {
      throw new Error(`acceptance: unexpected export button label: "${exportButton.textContent}"`)
    }

    let exportCallCount = 0
    let resolveExport!: (path: string) => void
    setLibraryExporterForTest(() => {
      exportCallCount++
      return new Promise<string>((resolve) => {
        resolveExport = resolve
      })
    })

    try {
      exportButton.click()
      await tick()
      await delay(20)

      if (exportCallCount !== 1) {
        throw new Error(`acceptance: expected 1 export call on click, got ${exportCallCount}`)
      }
      if (!exportButton.disabled) {
        throw new Error('acceptance: export button was not disabled while export in-flight')
      }

      exportButton.click()
      await tick()
      await delay(20)

      if (exportCallCount !== 1) {
        throw new Error(`acceptance: duplicate click while in-flight triggered second export call (${exportCallCount})`)
      }

      resolveExport('/path/to/exported-library')
      await tick()
      await delay(40)

      if (exportButton.disabled) {
        throw new Error('acceptance: export button remained disabled after export resolved')
      }

      const feedbackEl = dialog.querySelector<HTMLElement>('.export-feedback.is-success')
      if (!feedbackEl || !feedbackEl.textContent?.includes('successfully')) {
        throw new Error(`acceptance: export success feedback missing or incorrect: "${feedbackEl?.textContent}"`)
      }
    } finally {
      setLibraryExporterForTest(null)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // G. PERSISTENCE + LEGACY CLEANUP PROOF
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const testSettings: Settings = {
      appearance: 'dark',
      editorFontSize: 18,
    }
    saveSettings(testSettings)

    const reloaded = loadSettings()
    if (
      reloaded.appearance !== testSettings.appearance ||
      reloaded.editorFontSize !== testSettings.editorFontSize ||
      'spellcheck' in reloaded
    ) {
      throw new Error(`acceptance: settings persistence mismatch: ${JSON.stringify(reloaded)}`)
    }

    const storedAfterSave = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    if ('spellcheck' in storedAfterSave) {
      throw new Error('acceptance: saveSettings retained the removed spellcheck field')
    }

    saveSettings(DEFAULT_SETTINGS)
    applyTheme('system')
    applyEditorFontSize(16)

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
