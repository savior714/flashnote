import { ExportLibraryMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'
import { requestLibraryExport } from './markdownExportGate'

export type LibraryExporter = () => Promise<string>

let testExporter: LibraryExporter | null = null

export function setLibraryExporterForTest(exporter: LibraryExporter | null) {
  testExporter = exporter
}

export async function exportLibraryMarkdown(): Promise<string> {
  // Shares the canonical export durability boundary: the current
  // normal-note draft must be durably flushed before backend library
  // export begins. A failed flush throws (never a stale success, never a
  // silent cancel), preserving save-failure semantics for the caller.
  const exporter = testExporter ?? ExportLibraryMarkdown
  return requestLibraryExport(() => exporter())
}
