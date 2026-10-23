// Calendar-date helpers for the in-note task database.
//
// Date values are calendar dates in YYYY-MM-DD form, never millisecond
// timestamps, so arithmetic shifts on the calendar and cannot drift across a
// daylight-saving transition. internal/document.AddCalendarDays is the same
// arithmetic on the Go side and independently checks the result on save.

export type CalendarDate = string

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// UTC is the reference frame for all of this module's arithmetic: a UTC day has
// a fixed length, so adding days never crosses a daylight-saving boundary the
// way a local-time timestamp would.
const UTC_EPOCH_DAY = Date.UTC(1970, 0, 1)
const DAY_MS = 86_400_000

export function isValidCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  return true
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function isLeapYear(year: number): boolean {
  if (year % 4 !== 0) return false
  if (year % 100 !== 0) return true
  return year % 400 === 0
}

function toUtcTimestamp(value: CalendarDate): number {
  const match = DATE_PATTERN.exec(value)
  if (!match) throw new Error(`invalid calendar date ${value}`)
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(timestamp)) throw new Error(`invalid calendar date ${value}`)
  return timestamp
}

function fromUtcTimestamp(timestamp: number): CalendarDate {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Shifts a calendar date by a whole number of calendar days. Month-end,
 * year-end, and leap-year cases are handled by shifting the calendar date
 * itself rather than adding a fixed duration.
 */
export function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  return fromUtcTimestamp(toUtcTimestamp(value) + days * DAY_MS)
}

/**
 * Whole-day difference between two calendar dates. A positive result means
 * `to` is after `from`.
 */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtcTimestamp(to) - toUtcTimestamp(from)) / DAY_MS)
}

/** Monday-first start of the week holding `value`. */
export function startOfWeek(value: CalendarDate): CalendarDate {
  const timestamp = toUtcTimestamp(value)
  // Day 0 (1970-01-01) is a Thursday, so the Monday-first offset is (n + 3) % 7.
  const weekday = (((timestamp - UTC_EPOCH_DAY) / DAY_MS) % 7 + 7 + 3) % 7
  return fromUtcTimestamp(timestamp - weekday * DAY_MS)
}

/** First day of the month holding `value`. */
export function startOfMonth(value: CalendarDate): CalendarDate {
  const parsed = parseCalendarDate(value)
  return format(parsed.year, parsed.month, 1)
}

export function addMonths(value: CalendarDate, months: number): CalendarDate {
  const parsed = parseCalendarDate(value)
  const total = parsed.year * 12 + (parsed.month - 1) + months
  const year = Math.floor(total / 12)
  const month = total - year * 12 + 1
  const day = Math.min(parsed.day, daysInMonth(year, month))
  return format(year, month, day)
}

/**
 * The calendar cells of one month, starting on the Monday of the week that holds
 * the month's first day and always a whole number of weeks. The grid holds at
 * least five rows and never more than six, so its height stays stable between
 * months instead of jumping as the month length changes.
 */
export function monthGridCells(monthStart: CalendarDate): CalendarDate[] {
  const cells: CalendarDate[] = []
  for (let day = startOfWeek(monthStart); day < addMonths(monthStart, 1); day = addCalendarDays(day, 1)) {
    cells.push(day)
  }
  while (cells.length < 35 || cells.length % 7 !== 0) {
    cells.push(addCalendarDays(cells[cells.length - 1], 1))
  }
  return cells.slice(0, 42)
}

/** Today's calendar date in the local timezone, as a canonical date value. */
export function todayCalendarDate(now: Date = new Date()): CalendarDate {
  return format(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Monday-first weekday labels shared by the calendar views. */
export function weekdayLabels(): string[] {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
}

function parseCalendarDate(value: CalendarDate): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(value)
  if (!match) throw new Error(`invalid calendar date ${value}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function format(year: number, month: number, day: number): CalendarDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
