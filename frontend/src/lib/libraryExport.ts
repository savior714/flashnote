import { ExportLibraryMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'

export type LibraryExporter = () => Promise<string>

let testExporter: LibraryExporter | null = null

export function setLibraryExporterForTest(exporter: LibraryExporter | null) {
  testExporter = exporter
}

export async function exportLibraryMarkdown(): Promise<string> {
  if (testExporter) {
    return testExporter()
  }
  return ExportLibraryMarkdown()
}
