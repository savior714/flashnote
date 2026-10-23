// Linked date rules for the in-note task database.
//
// A rule links one date property to another with a calendar-day offset. When the
// base date changes, every still-linked target is recomputed in the same
// ProseMirror transaction, so the base change and its consequences commit
// atomically to the document. A manual edit to a target detaches only that
// record, stores the detachment, and leaves the rule and every other record's
// link intact.

import { addCalendarDays, isValidCalendarDate } from './databaseDates'
import {
  clonePayload,
  type DatabasePayload,
  type DatabaseRecord,
  propertyById,
} from './databaseTypes'

export function ruleTargetFor(payload: DatabasePayload, propertyId: string) {
  return payload.dateRules.find((rule) => rule.targetPropertyId === propertyId)
}

export function isManualDate(
  payload: DatabasePayload,
  recordId: string,
  propertyId: string,
): boolean {
  return payload.manualDates.some(
    (entry) => entry.recordId === recordId && entry.propertyId === propertyId,
  )
}

function manualKey(recordId: string, propertyId: string): string {
  return `${recordId}\u0000${propertyId}`
}

/**
 * Recomputes every rule-driven date that is still linked. A record whose base
 * date is missing or invalid gets no derived value: Flashnote never invents a
 * date for a record that has none.
 *
 * A chain of rules (Start -> Mid -> Due) settles only after every pass has
 * pushed a value one level further, so the pass repeats until nothing moves
 * instead of trusting the order the rules happen to be stored in. The rule set
 * is acyclic by construction, so the passes terminate.
 */
export function recomputeLinkedDates(payload: DatabasePayload): DatabasePayload {
  const next = clonePayload(payload)
  const manual = new Set(payload.manualDates.map((entry) => manualKey(entry.recordId, entry.propertyId)))

  for (let pass = 0; pass < next.dateRules.length + 1; pass += 1) {
    let changed = false
    for (const rule of next.dateRules) {
      for (const record of next.records) {
        if (manual.has(manualKey(record.id, rule.targetPropertyId))) continue
        const base = record.values[rule.basePropertyId]
        const recomputed = isValidCalendarDate(base)
          ? addCalendarDays(base, rule.offsetDays)
          : null
        if (record.values[rule.targetPropertyId] !== recomputed) {
          record.values[rule.targetPropertyId] = recomputed
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return next
}

/**
 * Sets one date value and reconciles the result with the rule that targets it.
 * A value the rule would not have produced detaches this record from the rule;
 * a value the rule would have produced stays linked, so a rule still moves this
 * record later.
 */
export function setDateValue(
  payload: DatabasePayload,
  recordId: string,
  propertyId: string,
  value: string | null,
): DatabasePayload {
  const next = clonePayload(payload)
  const record = next.records.find((candidate) => candidate.id === recordId)
  if (!record) return payload

  const rule = ruleTargetFor(next, propertyId)
  if (rule && !isManualDate(next, recordId, propertyId)) {
    const base = record.values[rule.basePropertyId]
    const expected = isValidCalendarDate(base)
      ? addCalendarDays(base, rule.offsetDays)
      : null
    if (value !== expected) {
      next.manualDates.push({ recordId, propertyId })
    }
  }

  record.values[propertyId] = value
  return recomputeLinkedDates(next)
}

/** Detaches one record from the rule targeting `propertyId`. */
export function detachManualDate(
  payload: DatabasePayload,
  recordId: string,
  propertyId: string,
): DatabasePayload {
  const next = clonePayload(payload)
  if (ruleTargetFor(next, propertyId) === undefined) return payload
  if (isManualDate(next, recordId, propertyId)) return payload
  next.manualDates.push({ recordId, propertyId })
  return next
}

/** Re-attaches one record to the rule targeting `propertyId`. */
export function reattachManualDate(
  payload: DatabasePayload,
  recordId: string,
  propertyId: string,
): DatabasePayload {
  const next = clonePayload(payload)
  next.manualDates = next.manualDates.filter(
    (entry) => !(entry.recordId === recordId && entry.propertyId === propertyId),
  )
  return recomputeLinkedDates(next)
}

export interface RuleProblem {
  message: string
}

/**
 * Explains why a proposed rule cannot be saved. The same checks the Go side
 * performs live in this editor, so a rule is refused at the point of creation
 * instead of turning into a rejected save.
 */
export function ruleProblem(
  payload: DatabasePayload,
  basePropertyId: string,
  targetPropertyId: string,
  offsetDays: number,
): RuleProblem | null {
  if (basePropertyId === targetPropertyId) {
    return { message: 'A rule cannot use the same property as its base and its target.' }
  }
  const base = propertyById(payload, basePropertyId)
  if (!base) return { message: 'The base property does not exist.' }
  if (base.type !== 'date') return { message: 'The base property must be a date property.' }
  const target = propertyById(payload, targetPropertyId)
  if (!target) return { message: 'The target property does not exist.' }
  if (target.type !== 'date') return { message: 'The target property must be a date property.' }
  const owner = payload.dateRules.find((rule) => rule.targetPropertyId === targetPropertyId)
  if (owner) {
    return { message: 'That target property is already the target of another rule.' }
  }
  if (wouldCreateCycle(payload, basePropertyId, targetPropertyId)) {
    return { message: 'That rule would form a cycle, so it can never settle.' }
  }
  if (!Number.isInteger(offsetDays) || Math.abs(offsetDays) > 36500) {
    return { message: 'The day offset is outside the supported range.' }
  }
  return null
}

/**
 * Reports whether making `basePropertyId` drive `targetPropertyId` would close a
 * cycle in the base-to-target edges.
 */
export function wouldCreateCycle(
  payload: DatabasePayload,
  basePropertyId: string,
  targetPropertyId: string,
): boolean {
  const following = new Map<string, string>()
  for (const rule of payload.dateRules) {
    following.set(rule.basePropertyId, rule.targetPropertyId)
  }
  following.set(basePropertyId, targetPropertyId)

  const seen = new Set<string>([basePropertyId])
  let current = following.get(basePropertyId)
  while (current !== undefined) {
    if (seen.has(current)) return true
    seen.add(current)
    current = following.get(current)
  }
  return false
}

/**
 * The rules that start a chain: their target is no other rule's base. Chained
 * rules (whose target drives another rule) are excluded so display can render
 * one chain head per chain.
 */
export function ruleChains(payload: DatabasePayload): DatabasePayload['dateRules'] {
  const following = new Map<string, string>()
  for (const rule of payload.dateRules) {
    following.set(rule.basePropertyId, rule.targetPropertyId)
  }
  return payload.dateRules
    .filter((rule) => !following.has(rule.targetPropertyId))
    .map((rule) => ({ ...rule }))
}

/** The date value a rule would produce for one record, before any edit. */
export function ruleExpectation(
  payload: DatabasePayload,
  record: DatabaseRecord,
  basePropertyId: string,
  offsetDays: number,
): string | null {
  const base = record.values[basePropertyId]
  return isValidCalendarDate(base) ? addCalendarDays(base, offsetDays) : null
}
