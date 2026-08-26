import { ExportCurrentNoteMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'

type MarkdownExporter = () => Promise<boolean>

let exportInFlight = false
let markdownExporter: MarkdownExporter = ExportCurrentNoteMarkdown

function isMarkdownExportShortcut(event: KeyboardEvent): boolean {
  const modifier = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey
  return modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e'
}

function handleMarkdownExportShortcut(event: KeyboardEvent) {
  if (!isMarkdownExportShortcut(event)) {
    return
  }
  if (document.querySelector('.trash-row.active') || exportInFlight) {
    return
  }

  event.preventDefault()
  exportInFlight = true
  void markdownExporter()
    .catch((error: unknown) => {
      console.error('Flashnote Markdown export failed', error)
    })
    .finally(() => {
      exportInFlight = false
    })
}

export function installMarkdownExportShortcut() {
  window.addEventListener('keydown', handleMarkdownExportShortcut)
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

export function runMarkdownExportShortcutAcceptance(): void {
  const originalExporter = markdownExporter
  const originalInFlight = exportInFlight
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const primaryModifier = isMac ? { metaKey: true } : { ctrlKey: true }
  const pendingExport = new Promise<boolean>(() => {})
  let exportCallCount = 0
  const getExportCallCount = (): number => exportCallCount

  markdownExporter = () => {
    exportCallCount += 1
    return pendingExport
  }
  exportInFlight = false
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
      if (event.defaultPrevented || getExportCallCount() !== 0) {
        throw new Error('acceptance single-note export: invalid modifier unexpectedly triggered export')
      }
    }

    const firstExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(firstExport)
    if (!firstExport.defaultPrevented || getExportCallCount() !== 1 || !exportInFlight) {
      throw new Error('acceptance single-note export: Cmd/Ctrl+Shift+E did not enter the export boundary exactly once')
    }

    const duplicateExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(duplicateExport)
    if (getExportCallCount() !== 1) {
      throw new Error('acceptance single-note export: in-flight shortcut triggered a duplicate export')
    }

    exportInFlight = false
    const trashMarker = document.createElement('div')
    trashMarker.className = 'trash-row active'
    document.body.appendChild(trashMarker)
    try {
      const trashExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
      window.dispatchEvent(trashExport)
      if (trashExport.defaultPrevented || getExportCallCount() !== 1) {
        throw new Error('acceptance single-note export: Trash state did not block the shortcut')
      }
    } finally {
      trashMarker.remove()
    }

    const reusableExport = acceptanceKeyEvent('e', { ...primaryModifier, shiftKey: true })
    window.dispatchEvent(reusableExport)
    if (!reusableExport.defaultPrevented || getExportCallCount() !== 2) {
      throw new Error('acceptance single-note export: shortcut did not become reusable after the in-flight state cleared')
    }

    console.log('FLASHNOTE_SINGLE_NOTE_EXPORT_SHORTCUT_ACCEPTANCE_SUCCESS')
  } finally {
    window.removeEventListener('keydown', handleMarkdownExportShortcut)
    markdownExporter = originalExporter
    exportInFlight = originalInFlight
  }
}
