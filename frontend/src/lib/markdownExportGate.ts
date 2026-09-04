// Canonical owner of Markdown export admission/readiness.
//
// Before any Markdown export that projects canonical SQLite state, callers
// must resolve whether the export is currently allowed and ensure the latest
// current normal-note draft that belongs in the export has been durably
// flushed. Only then may the backend export operation be entered:
//
//   frontend current draft
//   -> existing durable save/flush owner (registered by App.svelte)
//   -> canonical SQLite state
//   -> existing backend Markdown export
//
// Single-note export is admitted only when an actual normal note is open
// (non-empty current note id) and the app is not in Trash. Admission comes
// from application state supplied at registration time, never from DOM
// discovery (no `.trash-row.active`, sidebar visibility, or other
// presentation-only markers), so Trash stays denied while the sidebar is
// hidden and a valid hidden-sidebar normal note stays admitted.
//
// Full-library export uses the same durability rule: it waits for the
// current normal-note draft flush and fails closed when the flush fails,
// so stale durable revisions are never exported as if current.
//
// Fail closed: when no readiness provider is registered, admission is
// denied and every ensure/request helper reports blocked without invoking
// any exporter.

export type MarkdownExportReadiness = {
  isTrashView: () => boolean
  currentNormalNoteId: () => string
  flushCurrentDraft: () => Promise<boolean>
}

export type SingleNoteExportOutcome = 'exported' | 'blocked' | 'busy'

let readiness: MarkdownExportReadiness | null = null
let singleNoteExportInFlight = false

export function setMarkdownExportReadiness(next: MarkdownExportReadiness | null): void {
  readiness = next
}

export function isSingleNoteExportAdmitted(): boolean {
  if (!readiness) {
    return false
  }
  if (readiness.isTrashView()) {
    return false
  }
  return readiness.currentNormalNoteId().trim().length > 0
}

export function isSingleNoteExportInFlight(): boolean {
  return singleNoteExportInFlight
}

async function flushSafely(): Promise<boolean> {
  if (!readiness) {
    return false
  }
  try {
    return await readiness.flushCurrentDraft()
  } catch {
    return false
  }
}

// Ensures the latest required current draft is durable for a single-note
// export. Re-checks admission after the flush so a transition into Trash
// (or away from a normal note) during the flush cannot release a stale
// export.
export async function ensureSingleNoteExportReady(): Promise<boolean> {
  if (!isSingleNoteExportAdmitted()) {
    return false
  }
  const flushed = await flushSafely()
  if (!flushed) {
    return false
  }
  return isSingleNoteExportAdmitted()
}

// Library export shares the same durability boundary: the current
// normal-note draft (when any) must be durable before backend library
// export begins. In Trash there is no editable draft, so the registered
// flush resolves true and library export proceeds.
export async function ensureLibraryExportReady(): Promise<boolean> {
  if (!readiness) {
    return false
  }
  return flushSafely()
}

// Runs one single-note export through admission, durability, and
// single-flight. The exporter (backend SQLite-owned Markdown operation) is
// invoked exactly once and only after the required flush succeeds.
// Returns 'busy' without invoking the exporter when another single-note
// export is in flight, and 'blocked' without invoking the exporter when
// admission fails or the required flush fails. Exporter rejections
// propagate to the caller for logging; the in-flight flag always clears.
export async function requestSingleNoteExport(
  exporter: () => Promise<unknown>,
): Promise<SingleNoteExportOutcome> {
  if (singleNoteExportInFlight) {
    return 'busy'
  }
  if (!isSingleNoteExportAdmitted()) {
    return 'blocked'
  }
  singleNoteExportInFlight = true
  try {
    const ready = await ensureSingleNoteExportReady()
    if (!ready) {
      return 'blocked'
    }
    await exporter()
    return 'exported'
  } finally {
    singleNoteExportInFlight = false
  }
}

// Runs one library export through the shared durability boundary. Throws
// when the required flush fails (or no provider is registered) so callers
// never present stale data as a successful export and never mistake the
// block for a user-cancelled directory picker.
export async function requestLibraryExport(exporter: () => Promise<string>): Promise<string> {
  const ready = await ensureLibraryExportReady()
  if (!ready) {
    throw new Error('Flashnote library export blocked: current draft could not be durably saved.')
  }
  return exporter()
}

export function resetMarkdownExportGateForTest(): void {
  readiness = null
  singleNoteExportInFlight = false
}
