import { ExportCurrentNoteMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'

let exportInFlight = false

export function installMarkdownExportShortcut() {
  window.addEventListener('keydown', (event) => {
    const modifier = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey
    if (!modifier || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'e') {
      return
    }
    if (document.querySelector('.trash-row.active') || exportInFlight) {
      return
    }

    event.preventDefault()
    exportInFlight = true
    void ExportCurrentNoteMarkdown()
      .catch((error: unknown) => {
        console.error('Flashnote Markdown export failed', error)
      })
      .finally(() => {
        exportInFlight = false
      })
  })
}
