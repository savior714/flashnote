import { GetDataDir, LogAcceptanceIsolationRefusal } from '../../bindings/github.com/savior714/flashnote/appservice'

import {
  AcceptanceIsolationError,
  acceptanceIsolationDecision,
  acceptanceIsolationRefusalPrefix,
} from './acceptanceIsolation'

/**
 * Canonical acceptance isolation gate.
 *
 * Every acceptance step that mutates note data awaits this before its first
 * write. A lost HOME between build and run - the failure that once pointed
 * acceptance at real notes - now fails closed instead of mutating: the build
 * carries one isolated HOME, the process resolves its actual data directory, and
 * any mismatch stops the pipeline before it can write.
 */
export async function assertAcceptanceIsolation(): Promise<{
  dataDir: string
  isolatedHome: string
}> {
  const isolatedHome = import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_HOME ?? ''

  let dataDir: string
  try {
    dataDir = await GetDataDir()
  } catch (error: unknown) {
    const reason = `reason=unreadable-data-dir error=${String(error)}`
    await logRefusal(reason)
    throw new AcceptanceIsolationError(`${acceptanceIsolationRefusalPrefix} ${reason}`)
  }

  const decision = acceptanceIsolationDecision(dataDir, isolatedHome)
  if (!decision.isolated) {
    await logRefusal(decision.reason)
    throw new AcceptanceIsolationError(`${acceptanceIsolationRefusalPrefix} ${decision.reason}`)
  }
  return { dataDir: decision.dataDir, isolatedHome: decision.isolatedHome }
}

/**
 * Mirrors the refusal into the application log. The frontend console is not
 * carried into the application log, so a refusal that only reaches the console
 * would be indistinguishable from a silent acceptance failure.
 */
async function logRefusal(reason: string): Promise<void> {
  try {
    await LogAcceptanceIsolationRefusal(reason)
  } catch {
    // Logging the refusal must never replace the refusal itself.
  }
}
