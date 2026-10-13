/**
 * Canonical acceptance isolation policy.
 *
 * Acceptance runs are the only automation that mutates note data, so they must
 * never resolve onto the developer's real data directory. The isolated HOME the
 * runner intends is baked into the acceptance build
 * (VITE_FLASHNOTE_ACCEPTANCE_HOME) and the application reports its resolved data
 * directory at runtime; this module decides whether that pair proves isolation.
 *
 * It stays free of bindings and of `import.meta.env` so the decision itself is
 * directly testable, and so the runtime gate in `acceptanceIsolationGate` is the
 * only place that knows how those two values are obtained.
 */

export type AcceptanceIsolationDecision =
  | { isolated: true; dataDir: string; isolatedHome: string }
  | { isolated: false; reason: string }

export class AcceptanceIsolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcceptanceIsolationError'
  }
}

/** Collapses redundant separators and relative segments without touching the filesystem. */
export function normalizeAcceptancePath(value: string): string {
  const absolute = value.startsWith('/')
  const segments = value.split('/').filter((segment) => segment !== '' && segment !== '.')
  const resolved: string[] = []
  for (const segment of segments) {
    if (segment === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop()
        continue
      }
      if (absolute) {
        continue
      }
    }
    resolved.push(segment)
  }
  const joined = resolved.join('/')
  return absolute ? `/${joined}` : joined
}

/**
 * True only when the resolved data directory is the isolated HOME itself or a
 * descendant of it. A sibling directory that merely shares a prefix (for example
 * `/tmp/flashnote-accept-home` versus `/tmp/flashnote-accept-home-real`) is not
 * isolated.
 */
export function isolatedHomeIsProven(dataDir: string, isolatedHome: string): boolean {
  const home = normalizeAcceptancePath(isolatedHome)
  const dir = normalizeAcceptancePath(dataDir)
  if (home === '' || dir === '') {
    return false
  }
  return dir === home || dir.startsWith(`${home}/`)
}

/** Decides whether a resolved data directory is provably inside the isolated HOME. */
export function acceptanceIsolationDecision(
  dataDir: string,
  isolatedHome: string,
): AcceptanceIsolationDecision {
  const normalizedHome = normalizeAcceptancePath(isolatedHome)
  if (normalizedHome === '') {
    return {
      isolated: false,
      reason:
        'reason=missing-isolated-home: an acceptance build must declare VITE_FLASHNOTE_ACCEPTANCE_HOME',
    }
  }
  if (normalizeAcceptancePath(dataDir) === '') {
    return { isolated: false, reason: 'reason=unreadable-data-dir' }
  }
  if (!isolatedHomeIsProven(dataDir, isolatedHome)) {
    return {
      isolated: false,
      reason: `reason=data-dir-outside-isolated-home dataDir=${dataDir} isolatedHome=${isolatedHome}`,
    }
  }
  return { isolated: true, dataDir, isolatedHome }
}

/** Prefix shared by every refusal so logs and console output stay greppable. */
export const acceptanceIsolationRefusalPrefix = 'FLASHNOTE_ACCEPTANCE_ISOLATION_REFUSED'
