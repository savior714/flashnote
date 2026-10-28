import { SearchNotes } from '../../bindings/github.com/savior714/flashnote/appservice'

/**
 * Shared acceptance-stage reporting for the native acceptance pipeline.
 *
 * The frontend's console is not carried into the application log, so a run that
 * stops early is otherwise indistinguishable from a step that never started.
 * The backend logs every search request with its query length, and the runner
 * reads the application log, so the stage number travels through a channel that
 * already exists rather than introducing a logging framework.
 *
 * The stage numbers are kept in distinct bands so a reported stage is never
 * ambiguous about which boundary it describes:
 *
 *   0, 99      editor acceptance entry and completion
 *   100-199    the App-owned pipeline, per step and completion
 *   200-210    scroll suite stage entry (stage 1 enters at 200)
 *   900-910    scroll suite failure at stage 1-11
 *   1000-1001  OK verdict persistence start and completion
 *   1100-1101  FAILED verdict persistence start and completion
 *
 * A stage report is deliberately failure-tolerant: reporting must never turn a
 * passing acceptance into a failing one.
 */
export async function reportAcceptanceStage(stage: number): Promise<void> {
  try {
    await SearchNotes('f'.repeat(1000 + stage))
  } catch {
    // Reporting must never alter the acceptance result.
  }
}

/** Scroll suite stage entry: stage 1 enters at 200. */
export const scrollStageEntered = (stage: number): number => 200 + stage - 1

/** Scroll suite failure: stage 1 failing at 900. */
export const scrollStageFailed = (stage: number): number => 900 + stage
