import { ExportCurrentNoteMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'
import {
  isSingleNoteExportAdmitted,
  isSingleNoteExportInFlight,
  requestSingleNoteExport,
  resetMarkdownExportGateForTest,
  setMarkdownExportReadiness,
} from './markdownExportGate'

type MarkdownExporter = (admittedNoteId: string) => Promise<boolean>

let markdownExporter: MarkdownExporter = ExportCurrentNoteMarkdown

export function setSingleNoteExporterForTest(exporter: MarkdownExporter | null): void {
  markdownExporter = exporter ?? ExportCurrentNoteMarkdown
}

function isMarkdownExportShortcut(event: KeyboardEvent): boolean {
  const modifier = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey
  return modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e'
}

function handleMarkdownExportShortcut(event: KeyboardEvent) {
  if (!isMarkdownExportShortcut(event)) {
    return
  }
  // Admission comes from application state owned by markdownExportGate
  // (registered by App.svelte), never from DOM discovery, so Trash stays
  // denied while the sidebar is hidden and a valid hidden-sidebar normal
  // note stays admitted.
  if (isSingleNoteExportInFlight() || !isSingleNoteExportAdmitted()) {
    return
  }

  event.preventDefault()
  // requestSingleNoteExport owns single-flight across the durability flush
  // plus the backend export: the backend exporter runs exactly once, bound
  // to the admitted note identity, and only after the required
  // current-draft flush succeeds with that same identity still current.
  void requestSingleNoteExport((admittedNoteId) => markdownExporter(admittedNoteId)).catch((error: unknown) => {
    console.error('Flashnote Markdown export failed', error)
  })
}

export function installMarkdownExportShortcut() {
  window.addEventListener('keydown', handleMarkdownExportShortcut)
}

export function isExportInFlight(): boolean {
  return isSingleNoteExportInFlight()
}

export async function exportCurrentNoteMarkdown(): Promise<void> {
  if (isSingleNoteExportInFlight() || !isSingleNoteExportAdmitted()) {
    return
  }
  try {
    await requestSingleNoteExport((admittedNoteId) => markdownExporter(admittedNoteId))
  } catch (error: unknown) {
    console.error('Flashnote Markdown export failed', error)
  }
}

function acceptanceKeyEvent(
  key: string,
  options: {
    metaKey?: boolean
    ctrlKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
  } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
  })
}

function acceptanceTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

export async function runMarkdownExportShortcutAcceptance(): Promise<void> {
  const originalExporter = markdownExporter
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const primaryModifier = isMac ? { metaKey: true } : { ctrlKey: true }
  resetMarkdownExportGateForTest()

  let trashView = false
  let currentNoteID = 'acceptance-note'
  let noteTransitionActive = false
  let flushShouldSucceed = true
  let flushCallCount = 0
  const pendingExport = new Promise<boolean>(() => {})
  let exportCallCount = 0
  const getExportCallCount = (): number => exportCallCount

  setMarkdownExportReadiness({
    isTrashView: () => trashView,
    currentNormalNoteId: () => currentNoteID,
    isNoteTransitionActive: () => noteTransitionActive,
    flushCurrentDraft: () => {
      flushCallCount += 1
      return Promise.resolve(flushShouldSucceed)
    },
  })
  markdownExporter = () => {
    exportCallCount += 1
    return pendingExport
  }
  window.addEventListener('keydown', handleMarkdownExportShortcut)

  try {
    const negativeEvents = [
      acceptanceKeyEvent('e', { shiftKey: true }),
      acceptanceKeyEvent('e', primaryModifier),
      acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true, altKey: true }),
      acceptanceKeyEvent('q', { ...primaryModifier, shiftKey: true }),
    ]
    for (const event of negativeEvents) {
      window.dispatchEvent(event)
      await acceptanceTick()
      if (event.defaultPrevented || getExportCallCount() !== 0) {
        throw new Error('acceptance single-note export: invalid modifier unexpectedly triggered export')
      }
    }

    const firstExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(firstExport)
    await acceptanceTick()
    await acceptanceTick()
    if (!firstExport.defaultPrevented || getExportCallCount() !== 1 || !isSingleNoteExportInFlight()) {
      throw new Error('acceptance single-note export: Cmd/Ctrl+Shift+E did not enter the export boundary exactly once')
    }
    if (flushCallCount !== 1) {
      throw new Error('acceptance single-note export: backend exporter was entered before the required flush')
    }

    const duplicateExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(duplicateExport)
    await acceptanceTick()
    if (getExportCallCount() !== 1) {
      throw new Error('acceptance single-note export: in-flight shortcut triggered a duplicate export')
    }

    // Trash admission comes from application state. No sidebar marker is
    // mounted here by design: hiding the sidebar (or never mounting it)
    // must not change the verdict.
    resetMarkdownExportGateForTest()
    trashView = true
    setMarkdownExportReadiness({
      isTrashView: () => trashView,
      currentNormalNoteId: () => currentNoteID,
      isNoteTransitionActive: () => noteTransitionActive,
      flushCurrentDraft: () => {
        flushCallCount += 1
        return Promise.resolve(true)
      },
    })
    const callsBeforeTrash = getExportCallCount()
    const trashExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(trashExport)
    await acceptanceTick()
    if (trashExport.defaultPrevented || getExportCallCount() !== callsBeforeTrash) {
      throw new Error('acceptance single-note export: Trash state did not block the shortcut')
    }

    // A valid hidden-sidebar normal note stays admitted: no sidebar or
    // trash marker is mounted, yet admission plus flush releases export.
    resetMarkdownExportGateForTest()
    trashView = false
    flushShouldSucceed = true
    setMarkdownExportReadiness({
      isTrashView: () => trashView,
      currentNormalNoteId: () => currentNoteID,
      isNoteTransitionActive: () => noteTransitionActive,
      flushCurrentDraft: () => {
        flushCallCount += 1
        return Promise.resolve(flushShouldSucceed)
      },
    })
    const reusableExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(reusableExport)
    await acceptanceTick()
    await acceptanceTick()
    if (!reusableExport.defaultPrevented || getExportCallCount() !== callsBeforeTrash + 1) {
      throw new Error('acceptance single-note export: shortcut did not become reusable after the in-flight state cleared')
    }

    console.log('FLASHNOTE_SINGLE_NOTE_EXPORT_SHORTCUT_ACCEPTANCE_SUCCESS')
  } finally {
    window.removeEventListener('keydown', handleMarkdownExportShortcut)
    markdownExporter = originalExporter
    resetMarkdownExportGateForTest()
  }
}
