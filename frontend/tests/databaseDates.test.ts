import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addCalendarDays,
  addMonths,
  calendarDaysBetween,
  isValidCalendarDate,
  startOfMonth,
  startOfWeek,
} from '../src/lib/databaseDates.ts'

test('shifts a calendar date by whole days', () => {
  assert.equal(addCalendarDays('2026-10-01', 7), '2026-10-08')
  assert.equal(addCalendarDays('2026-10-01', -2), '2026-09-29')
  assert.equal(addCalendarDays('2026-10-01', 0), '2026-10-01')
})

test('crosses month and year boundaries on the calendar', () => {
  assert.equal(addCalendarDays('2026-10-29', 5), '2026-11-03')
  assert.equal(addCalendarDays('2026-12-29', 5), '2027-01-03')
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addCalendarDays('2026-01-31', 1), '2026-02-01')
})

test('handles leap years and the 2100 century rule', () => {
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addCalendarDays('2024-02-27', 2), '2024-02-29')
  assert.equal(addCalendarDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addCalendarDays('2100-02-28', 1), '2100-03-01')
  assert.equal(addCalendarDays('2000-02-28', 1), '2000-02-29')
})

test('does not drift across daylight-saving transitions', () => {
  // These windows cover US daylight-saving changes. A timestamp-based
  // implementation would return a date one day off here.
  assert.equal(addCalendarDays('2026-03-08', 1), '2026-03-09')
  assert.equal(addCalendarDays('2026-11-01', 1), '2026-11-02')
  assert.equal(calendarDaysBetween('2026-03-08', '2026-11-01'), 238)
})

test('rejects values that are not real calendar dates', () => {
  for (const value of ['', '2026-13-01', '2026-02-30', '2026-00-10', '2026-1-1', 'not-a-date', null, 5]) {
    assert.equal(isValidCalendarDate(value), false, `${String(value)} must not be a date`)
  }
  assert.equal(isValidCalendarDate('2024-02-29'), true)
  assert.equal(isValidCalendarDate('2026-02-29'), false)
})

test('finds week and month starts on a Monday-first calendar', () => {
  // 2026-10-22 is a Thursday.
  assert.equal(startOfWeek('2026-10-22'), '2026-10-19')
  assert.equal(startOfWeek('2026-10-19'), '2026-10-19')
  assert.equal(startOfWeek('2026-10-01'), '2026-09-28')
  assert.equal(startOfWeek('2027-01-02'), '2026-12-28')
  assert.equal(startOfMonth('2026-10-22'), '2026-10-01')
  assert.equal(startOfMonth('2026-12-31'), '2026-12-01')
})

test('shifts months without producing an impossible day', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
  assert.equal(addMonths('2026-01-31', -1), '2025-12-31')
})
