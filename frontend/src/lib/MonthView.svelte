<script lang="ts">
  import type { Readable } from 'svelte/store'
  import type { ResolvedLanguage } from './settings'
  import { getMessages } from './i18n'
  import { dueProperty, dueState } from './databaseHighlight'
  import {
    addMonths,
    calendarDaysBetween,
    monthGridCells,
    startOfMonth,
    todayCalendarDate,
    weekdayLabels,
    type CalendarDate,
  } from './databaseDates'
  import { isRecordComplete } from './databaseTypes'
import type { DatabasePayload, DatabaseProperty, DatabaseRecord } from './databaseTypes'

  // 2024-01-01 is a Monday, so weekday numbering is derived from it.
  const MONDAY_REFERENCE: CalendarDate = '2024-01-01'

  type Props = {
    payload: DatabasePayload
    language: Readable<ResolvedLanguage>
    editable?: boolean
    onOpenRecord: (recordId: string) => void
    onCreateTask: (date: CalendarDate) => void
  }

  let { payload, language, editable = true, onOpenRecord, onCreateTask }: Props = $props()

  let messages = $derived(getMessages($language).database)
  // The anchor is always a month's first day, so navigation is month-aligned.
  let anchor = $state<CalendarDate>(startOfMonth(todayCalendarDate()))

  let today = $derived(todayCalendarDate())
  let due = $derived(dueProperty(payload))
  let cells = $derived(monthGridCells(anchor))

  function shiftMonth(offset: number) {
    anchor = addMonths(anchor, offset)
  }

  function titleProperty(): DatabaseProperty | undefined {
    return payload.properties.find((property) => property.type === 'title')
  }

  function recordTitle(record: DatabaseRecord): string {
    const property = titleProperty()
    const value = property ? record.values[property.id] : undefined
    const text = typeof value === 'string' ? value.trim() : ''
    return text === '' ? 'Untitled task' : text
  }

  function recordsOn(date: CalendarDate): DatabaseRecord[] {
    if (!due) return []
    return payload.records.filter((record) => record.values[due.id] === date)
  }

  function weekdayName(date: CalendarDate): string {
    const index = ((calendarDaysBetween(MONDAY_REFERENCE, date) % 7) + 7) % 7
    return weekdayLabels()[index]
  }
</script>

<section class="calendar" aria-label={messages.viewMonth}>
  <header class="calendar-header">
    <button type="button" class="quiet" onclick={() => shiftMonth(-1)} aria-label="previous month">
      ‹
    </button>
    <strong>{anchor.slice(0, 7)}</strong>
    <button type="button" class="quiet" onclick={() => shiftMonth(1)} aria-label="next month">
      ›
    </button>
    <button
      type="button"
      class="quiet"
      onclick={() => (anchor = startOfMonth(todayCalendarDate()))}
    >
      {messages.viewMonth}
    </button>
  </header>

  <div class="calendar-weekdays">
    {#each weekdayLabels() as name (name)}
      <span>{name}</span>
    {/each}
  </div>

  <div class="calendar-grid month-grid">
    {#each cells as day (day)}
      <div
        class="calendar-cell"
        class:today={day === today}
        class:outside={!day.startsWith(anchor.slice(0, 7))}
      >
        <div class="calendar-day">
          <span class="calendar-day-number">{day.slice(8)}</span>
          {#if editable}
            <button
              type="button"
              class="quiet calendar-add"
              aria-label={messages.createTaskOn(day)}
              onclick={() => onCreateTask(day)}
            >
              +
            </button>
          {/if}
        </div>
        <div class="calendar-tasks">
          {#each recordsOn(day) as record (record.id)}
            {@const state = dueState(payload, record)}
            <button
              type="button"
              class="calendar-task"
              class:complete={isRecordComplete(payload, record)}
              class:overdue={state === 'overdue'}
              class:due-soon={state === 'due-soon'}
              onclick={() => onOpenRecord(record.id)}
            >
              {recordTitle(record)}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .calendar {
    margin: 0 0 1.2em;
  }

  .calendar-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .calendar-weekdays {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 1px;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-align: center;
  }

  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 1px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }

  .month-grid .calendar-cell {
    min-height: 86px;
  }

  .calendar-cell {
    display: flex;
    flex-direction: column;
    padding: 5px;
    background: var(--surface-app);
  }

  .calendar-cell.today {
    background: var(--surface-active);
  }

  .calendar-cell.outside {
    background: var(--surface-sidebar);
    color: var(--text-muted);
  }

  .calendar-day {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .calendar-day-number {
    font-weight: 600;
    font-size: 0.82rem;
  }

  .calendar-add {
    margin-left: auto;
  }

  .calendar-tasks {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .calendar-task {
    padding: 2px 5px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--surface-elevated);
    color: inherit;
    font: inherit;
    font-size: 0.72rem;
    text-align: left;
    cursor: pointer;
  }

  .calendar-task.complete {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  .calendar-task.overdue {
    border-color: var(--danger-border);
  }

  .calendar-task.due-soon {
    border-color: var(--border-input-focus);
  }
</style>
