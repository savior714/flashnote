import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const scrollSource = readFileSync(
  new URL('../src/lib/scrollStructureAcceptance.ts', import.meta.url),
  'utf8',
)

/** The index of every scroll-structure verification guard in execution order. */
function verificationGuardIndexes(): number[] {
  // assertViewportDoesNotScroll is the shared guard each section ends with, and
  // the search-overlay open/close checks are the last verification group.
  const indexes: number[] = []
  const guards = [
    /throw new Error\(\s*'acceptance scroll:/g,
    /assertViewportDoesNotScroll\(/g,
  ]
  for (const guard of guards) {
    for (const match of scrollSource.matchAll(guard)) {
      indexes.push(match.index ?? -1)
    }
  }
  return indexes.filter((index) => index >= 0)
}

const okVerdictIndex = scrollSource.indexOf("recordVerdict('ok'")

test('the OK verdict is recorded after every scroll-structure verification', () => {
  assert.ok(okVerdictIndex >= 0, 'the success verdict is recorded')

  const guards = verificationGuardIndexes()
  assert.ok(guards.length > 0, 'the suite asserts scroll-structure verification failures')

  // Every guard must come before the OK verdict write. A guard after it means a
  // later failure would still have left a durable OK behind for this run.
  const guardsAfterOk = guards.filter((index) => index > okVerdictIndex)
  assert.deepEqual(
    guardsAfterOk.length,
    0,
    `${guardsAfterOk.length} verification guard(s) execute after the OK verdict write`,
  )
})

test('the search overlay open and close checks precede the OK verdict', () => {
  // The specific regression this suite was written for: the search overlay was
  // verified after the verdict had already been persisted.
  const overlayOpenGuard = scrollSource.indexOf('the search overlay did not open over the shell')
  const overlayCloseGuard = scrollSource.indexOf('the search overlay did not close')
  assert.ok(overlayOpenGuard >= 0, 'the search-overlay open check is present')
  assert.ok(overlayCloseGuard >= 0, 'the search-overlay close check is present')
  assert.ok(overlayOpenGuard < okVerdictIndex, 'the overlay open check runs before the OK verdict')
  assert.ok(overlayCloseGuard < okVerdictIndex, 'the overlay close check runs before the OK verdict')
})

test('the verdict write does not swallow its own errors', () => {
  // The failure mode: CreateNote/SaveNote rejected, the catch was empty, and
  // the run still reported success. recordVerdict must have no catch block.
  const verdictBody = scrollSource.slice(
    scrollSource.indexOf('async function recordVerdict('),
    scrollSource.indexOf('async function recordFailureVerdict('),
  )
  assert.ok(
    !/\}\s*catch\s*\{/.test(verdictBody),
    'recordVerdict must propagate a failed verdict write instead of swallowing it',
  )
  assert.ok(
    verdictBody.includes('throw new Error('),
    'a verdict that cannot be read back is an explicit failure, not a silent return',
  )
})

test('a failed verdict write cannot replace the verification failure', () => {
  // The runner judges the run by the exception the suite throws, so the FAILED
  // marker write must be isolated from it.
  const failureVerdictBody = scrollSource.slice(
    scrollSource.indexOf('async function recordFailureVerdict('),
    scrollSource.indexOf("async function reportStageToLog(", scrollSource.indexOf('async function recordFailureVerdict(')),
  )
  assert.ok(
    /try\s*\{[\s\S]*recordVerdict\('failed'[\s\S]*\}\s*catch/.test(failureVerdictBody),
    'the FAILED verdict write is wrapped so its own error stays contained',
  )
  assert.ok(
    failureVerdictBody.includes('throw error'),
    'the original verification exception is still the one that leaves the suite',
  )
})

test('the scroll suite reports its own stages so a stopped run is locatable', () => {
  assert.ok(
    scrollSource.includes('scrollStageEntered('),
    'scroll stage entry is reported',
  )
  assert.ok(
    scrollSource.includes('scrollStageFailed('),
    'scroll stage failure is reported',
  )
  assert.ok(
    scrollSource.includes('await reportAcceptanceStage(status === \'ok\' ? 1000 : 1100)'),
    'the OK and FAILED verdict writes are respectively reported',
  )
})

test('the search overlay verification runs under a stage of its own', () => {
  // The overlay checks used to run inside the previous section's stage span, so
  // a failure there was indistinguishable from that section's failure in the
  // stage history a stopped run leaves behind.
  const stageEntries = [
    ...scrollSource.matchAll(
      /await reportAcceptanceStage\(scrollStageEntered\((\d+)\)\)\n\s*stage = (\d+)/g,
    ),
  ]
  assert.ok(stageEntries.length >= 11, 'each verification section reports its own stage entry')

  const stageNumbers: string[] = []
  for (const entry of stageEntries) {
    const [reported, recorded] = [entry[1], entry[2]]
    // The stage recorded for a failure must be the stage that was reported, or
    // the last entered stage cannot locate the failing section.
    assert.equal(reported, recorded, 'the reported and recorded stage numbers agree')
    stageNumbers.push(reported)
  }
  // Two sections sharing one stage number make that stage ambiguous as a
  // failure location, which is the ambiguity this suite is meant to remove.
  assert.equal(
    new Set(stageNumbers).size,
    stageNumbers.length,
    'every verification section reports a distinct stage',
  )

  const overlayOpenGuard = scrollSource.indexOf('the search overlay did not open over the shell')
  const overlayCloseGuard = scrollSource.indexOf('the search overlay did not close')
  const overlayStageEntry = stageEntries[stageEntries.length - 1]
  assert.ok(overlayStageEntry.index !== undefined)
  assert.ok(
    overlayStageEntry.index! < overlayOpenGuard && overlayStageEntry.index! < overlayCloseGuard,
    'the overlay checks run after their own stage entry',
  )
})
