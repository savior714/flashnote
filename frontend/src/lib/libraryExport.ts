import { ExportLibraryMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'
import { exportPresentation } from './i18n'
import { requestLibraryExport } from './markdownExportGate'

export type ExportPresentation = ReturnType<typeof exportPresentation>
export type LibraryExporter = (presentation: ExportPresentation) => Promise<string>

let testExporter: LibraryExporter | null = null

export function setLibraryExporterForTest(exporter: LibraryExporter | null) {
  testExporter = exporter
}

export async function exportLibraryMarkdown(presentation: ExportPresentation): Promise<string> {
  // Shares the canonical export durability boundary: the current
  // normal-note draft must be durably flushed before backend library
  // export begins. A failed flush throws (never a stale success, never a
  // silent cancel), preserving save-failure semantics for the caller.
  const exporter = testExporter ?? ExportLibraryMarkdown
  return requestLibraryExport(() => exporter(presentation))
}
