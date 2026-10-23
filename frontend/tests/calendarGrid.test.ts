import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addCalendarDays,
  calendarDaysBetween,
  monthGridCells,
  startOfWeek,
} from '../src/lib/databaseDates.ts'

const MONTHS = [
  '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01',
  '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01',
  '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
  '2024-02-01', '2025-02-01', '2100-02-01',
]

function daysOfMonth(month: string): string[] {
  const days: string[] = []
  for (let day = month; day.slice(0, 7) === month.slice(0, 7); day = addCalendarDays(day, 1)) {
    days.push(day)
  }
  return days
}

test('a month grid always holds a whole number of weeks', () => {
  for (const month of MONTHS) {
    const cells = monthGridCells(month)
    assert.equal(cells.length % 7, 0, `${month} grid is not a whole number of weeks`)
    assert.ok(cells.length >= 35, `${month} grid is shorter than five rows`)
    assert.ok(cells.length <= 42, `${month} grid is longer than six rows`)
    // The grid opens on the Monday of the week holding the first of the month.
    assert.equal(cells[0], startOfWeek(month), `${month} grid does not start on a Monday`)
    // Every day of the month itself is present in its own grid.
    for (const day of daysOfMonth(month)) {
      assert.ok(cells.includes(day), `${month} grid is missing its own day ${day}`)
    }
  }
})

const WEEK_ANCHORS = ['2026-10-01', '2026-10-04', '2026-10-05', '2026-10-11', '2026-12-31', '2027-01-02']

test('a week view anchor always opens on a Monday', () => {
  for (const date of WEEK_ANCHORS) {
    const weekStart = startOfWeek(date)
    assert.ok(weekStart <= date, `${date} week start is after the date`)
    assert.ok(
      calendarDaysBetween(weekStart, date) < 7,
      `${date} is more than a week from its week start`,
    )
  }
})

test('calendar navigation keeps dates contiguous', () => {
  let anchor = '2026-10-05'
  const seen: string[] = []
  for (let index = 0; index < 7; index += 1) {
    seen.push(anchor)
    anchor = addCalendarDays(anchor, 1)
  }
  assert.deepEqual(seen, [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11',
  ])
})
