// Conditional highlight computation for the in-note task database.
//
// A conditional highlight is a display-layer fact, never stored state: it is
// recomputed from the record's own values on every render, so no stored value
// can become stale highlight state. A completed record is never shown as
// overdue merely because its deadline has passed.

import { calendarDaysBetween, todayCalendarDate, type CalendarDate } from './databaseDates'
import {
  DUE_SOON_WINDOW_DAYS,
  isRecordComplete,
  propertyById,
  type DatabasePayload,
  type DatabaseRecord,
  type DatabaseProperty,
} from './databaseTypes'

export type DueState = 'complete' | 'overdue' | 'due-soon' | 'plain'

/**
 * The date property a record's deadline is read from. A property whose name
 * mentions a deadline wins; otherwise the first date property is used, which
 * keeps a converted table's date column behaving as expected without a setting.
 */
export function dueProperty(payload: DatabasePayload): DatabaseProperty | undefined {
  const dated = payload.properties.filter((property) => property.type === 'date')
  if (dated.length === 0) return undefined
  const named = dated.find((property) => /due|deadline|마감|기한/i.test(property.name))
  return named ?? dated[0]
}

export function recordDueDate(payload: DatabasePayload, record: DatabaseRecord): CalendarDate | null {
  const property = dueProperty(payload)
  if (!property) return null
  const value = record.values[property.id]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The conditional highlight for one record. A record with no due date, and a
 * completed record, has none.
 */
export function dueState(
  payload: DatabasePayload,
  record: DatabaseRecord,
  today: CalendarDate = todayCalendarDate(),
): DueState {
  if (isRecordComplete(payload, record)) return 'complete'
  const due = recordDueDate(payload, record)
  if (!due) return 'plain'
  const days = calendarDaysBetween(today, due)
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_WINDOW_DAYS) return 'due-soon'
  return 'plain'
}

export function isOverdue(
  payload: DatabasePayload,
  record: DatabaseRecord,
  today?: CalendarDate,
): boolean {
  return dueState(payload, record, today) === 'overdue'
}

export function isDueSoon(
  payload: DatabasePayload,
  record: DatabaseRecord,
  today?: CalendarDate,
): boolean {
  return dueState(payload, record, today) === 'due-soon'
}

/** The target property of the rule driving `propertyId`, if any. */
export function ruleTargetOf(payload: DatabasePayload, propertyId: string) {
  return payload.dateRules.find((rule) => rule.targetPropertyId === propertyId)
}

/** Whether this record's date on `propertyId` was set by hand. */
export function isManual(
  payload: DatabasePayload,
  recordId: string,
  propertyId: string,
): boolean {
  return payload.manualDates.some(
    (entry) => entry.recordId === recordId && entry.propertyId === propertyId,
  )
}

/** Whether a rule can still be created for this base and target pair. */
export function canCreateRule(
  payload: DatabasePayload,
  basePropertyId: string,
  targetPropertyId: string,
  offsetDays: number,
): boolean {
  return (
    payload.dateRules.every(
      (rule) => rule.targetPropertyId !== targetPropertyId,
    ) &&
    propertyById(payload, basePropertyId)?.type === 'date' &&
    propertyById(payload, targetPropertyId)?.type === 'date'
  ) && offsetDays === Math.round(offsetDays)
}
