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
// Single-note export is admitted only when one exact normal note is open
// (non-empty current note id), the app is not in Trash, and no normal-note
// transition is active. The admitted note identity is captured before the
// durability drain and must still be the current normal note after the
// drain, so a concurrent transition to a different normal note can never
// silently turn the request into an export of that other note. Admission
// comes from application state supplied at registration time, never from
// DOM discovery (no `.trash-row.active`, sidebar visibility, or other
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
  // Existing normal-note transition lifecycle owned by App.svelte
  // (noteTransitionActive). While a transition is active the current note
  // is ambiguous: the backend current-note pointer may already have moved
  // before the frontend note id follows, so no current-note export may be
  // admitted or released.
  isNoteTransitionActive: () => boolean
  flushCurrentDraft: () => Promise<boolean>
}

export type SingleNoteExportOutcome = 'exported' | 'blocked' | 'busy'

let readiness: MarkdownExportReadiness | null = null
let singleNoteExportInFlight = false

export function setMarkdownExportReadiness(next: MarkdownExportReadiness | null): void {
  readiness = next
}

// Test-only accessor so Settings acceptance can install a deterministic
// readiness for its UI proof (success/error feedback, single request,
// in-flight suppression) without racing the real App autosave flush, then
// restore the live App registration. Production export still flows through
// requestLibraryExport/requestSingleNoteExport and remains fail-closed.
export function getMarkdownExportReadinessForTest(): MarkdownExportReadiness | null {
  return readiness
}

// Resolves the single admitted normal-note identity, or null when no
// unambiguous current-note export may proceed (no provider, Trash,
// active transition, or no normal note open).
export function admittedNormalNoteId(): string | null {
  if (!readiness) {
    return null
  }
  if (readiness.isTrashView()) {
    return null
  }
  if (readiness.isNoteTransitionActive()) {
    return null
  }
  const noteId = readiness.currentNormalNoteId().trim()
  return noteId.length > 0 ? noteId : null
}

export function isSingleNoteExportAdmitted(): boolean {
  return admittedNormalNoteId() !== null
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
// export and binds the export to the admitted note identity. Captures the
// admitted id before the flush, then requires after the flush that no
// transition into Trash, away from a normal note, onto a different normal
// note, or into an active transition happened during the flush. Any
// identity change or ambiguity blocks the export so the exporter is never
// entered for an unintended note.
async function ensureSingleNoteExportAdmittedId(): Promise<string | null> {
  const admittedId = admittedNormalNoteId()
  if (admittedId === null) {
    return null
  }
  const flushed = await flushSafely()
  if (!flushed) {
    return null
  }
  if (!readiness) {
    return null
  }
  if (readiness.isTrashView()) {
    return null
  }
  if (readiness.isNoteTransitionActive()) {
    return null
  }
  if (readiness.currentNormalNoteId().trim() !== admittedId) {
    return null
  }
  return admittedId
}

export async function ensureSingleNoteExportReady(): Promise<boolean> {
  return (await ensureSingleNoteExportAdmittedId()) !== null
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

// Runs one single-note export through admission, durability, identity
// binding, and single-flight. The exporter (backend SQLite-owned Markdown
// operation) receives the admitted note identity and is invoked exactly
// once, only after the required flush succeeds with that same identity
// still current. Returns 'busy' without invoking the exporter when another
// single-note export is in flight, and 'blocked' without invoking the
// exporter when admission fails, the required flush fails, or the admitted
// identity did not survive the flush. Exporter rejections propagate to the
// caller for logging; the in-flight flag always clears.
export async function requestSingleNoteExport(
  exporter: (admittedNoteId: string) => Promise<unknown>,
): Promise<SingleNoteExportOutcome> {
  if (singleNoteExportInFlight) {
    return 'busy'
  }
  if (admittedNormalNoteId() === null) {
    return 'blocked'
  }
  singleNoteExportInFlight = true
  try {
    const admittedId = await ensureSingleNoteExportAdmittedId()
    if (admittedId === null) {
      return 'blocked'
    }
    await exporter(admittedId)
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
