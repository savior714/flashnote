<script lang="ts">
  import type { ResolvedLanguage } from './settings'
  import { getMessages } from './i18n'
  import {
    displayValue,
    isRecordComplete,
    optionName,
    propertyById,
    type DatabasePayload,
    type DatabaseRecord,
    type PropertyType,
  } from './databaseTypes'
  import { isValidCalendarDate } from './databaseDates'
  import { setDateValue } from './databaseRules'
  import { dueState, isManual } from './databaseHighlight'

  type Props = {
    payload: DatabasePayload
    record: DatabaseRecord
    language: ResolvedLanguage
    editable?: boolean
    onChange: (payload: DatabasePayload) => void
    onClose: () => void
  }

  let {
    payload,
    record,
    language,
    editable = true,
    onChange,
    onClose,
  }: Props = $props()

  let messages = $derived(getMessages(language).database)
  let recordDue = $derived(dueState(payload, record))
  let complete = $derived(isRecordComplete(payload, record))

  // The textarea shows the typed text while the user is editing and the stored
  // memo otherwise, so an undo or a record change never presents a stale draft.
  // Switching records drops the edit that belonged to the previous one.
  let memoOverride = $state<string | null>(null)
  let effectiveMemo = $derived(memoOverride ?? record.memo ?? '')

  $effect(() => {
    void record.id
    memoOverride = null
  })

  function setValue(propertyId: string, value: unknown) {
    const property = payload.properties.find((candidate) => candidate.id === propertyId)
    // A date takes the same path the table takes, so a linked date follows the
    // edit and a deadline the user sets by hand is stored as a detached one.
    if (property?.type === 'date') {
      onChange(
        setDateValue(
          payload,
          record.id,
          propertyId,
          typeof value === 'string' || value === null ? value : null,
        ),
      )
      return
    }
    const next: DatabasePayload = {
      ...payload,
      properties: payload.properties.map((candidate) => ({ ...candidate })),
      records: payload.records.map((candidate) =>
        candidate.id === record.id
          ? { ...candidate, values: { ...candidate.values, [propertyId]: value } }
          : candidate,
      ),
    }
    onChange(next)
  }

  function setMemo(next: string) {
    memoOverride = next
    onChange({
      ...payload,
      properties: payload.properties.map((property) => ({ ...property })),
      records: payload.records.map((candidate) =>
        candidate.id === record.id ? { ...candidate, values: { ...candidate.values }, memo: next } : candidate,
      ),
    })
  }

  function titleValue(): string {
    const title = payload.properties.find((property) => property.type === 'title')
    if (!title) return ''
    return typeof record.values[title.id] === 'string' ? (record.values[title.id] as string) : ''
  }
</script>

<aside class="record-panel" aria-label={messages.openRecord}>
  <header>
    <input
      type="text"
      class="record-title"
      aria-label={messages.title}
      disabled={!editable}
      value={titleValue()}
      onchange={(event) => {
        const title = payload.properties.find((property) => property.type === 'title')
        if (title) setValue(title.id, (event.target as HTMLInputElement).value)
      }}
    />
    <button type="button" class="quiet" onclick={onClose}>{messages.closeRecord}</button>
  </header>

  {#if complete}
    <p class="record-badge complete">{messages.dueComplete}</p>
  {:else if recordDue === 'overdue'}
    <p class="record-badge overdue">{messages.dueOverdue}</p>
  {:else if recordDue === 'due-soon'}
    <p class="record-badge soon">{messages.dueSoon}</p>
  {/if}

  <dl class="record-properties">
    {#each payload.properties as property (property.id)}
      {#if property.type !== 'title'}
        <dt>{property.name}</dt>
        <dd>
          {#if property.type === 'text'}
            <textarea
              rows={2}
              disabled={!editable}
              value={typeof record.values[property.id] === 'string' ? (record.values[property.id] as string) : ''}
              onchange={(event) => setValue(property.id, (event.target as HTMLTextAreaElement).value)}
            ></textarea>
          {:else if property.type === 'number'}
            <input
              type="number"
              disabled={!editable}
              value={typeof record.values[property.id] === 'number' ? String(record.values[property.id]) : ''}
              onchange={(event) => {
                const raw = (event.target as HTMLInputElement).value
                setValue(property.id, raw === '' ? null : Number(raw))
              }}
            />
          {:else if property.type === 'date'}
            <input
              type="date"
              disabled={!editable}
              value={typeof record.values[property.id] === 'string' ? (record.values[property.id] as string) : ''}
              onchange={(event) => {
                const raw = (event.target as HTMLInputElement).value
                const value = isValidCalendarDate(raw) ? raw : null
                setValue(property.id, value)
              }}
            />
            {#if isManual(payload, record.id, property.id)}
              <span class="manual-flag">{messages.convertHint}</span>
            {/if}
          {:else if property.type === 'status' || property.type === 'select'}
            <select
              disabled={!editable}
              value={typeof record.values[property.id] === 'string' ? (record.values[property.id] as string) : ''}
              onchange={(event) => setValue(property.id, (event.target as HTMLSelectElement).value)}
            >
              <option value="">—</option>
              {#each property.options ?? [] as option (option.id)}
                <option value={option.id}>{option.name}</option>
              {/each}
            </select>
          {:else if property.type === 'checkbox'}
            <input
              type="checkbox"
              disabled={!editable}
              checked={record.values[property.id] === true}
              onchange={(event) => setValue(property.id, (event.target as HTMLInputElement).checked)}
            />
          {:else if property.type === 'multiSelect'}
            <span class="chips">
              {#each property.options ?? [] as option (option.id)}
                <button
                  type="button"
                  class="chip"
                  class:on={Array.isArray(record.values[property.id]) &&
                    (record.values[property.id] as string[]).includes(option.id)}
                  disabled={!editable}
                  onclick={() => {
                    const current = Array.isArray(record.values[property.id])
                      ? [...(record.values[property.id] as string[])]
                      : []
                    const index = current.indexOf(option.id)
                    if (index === -1) current.push(option.id)
                    else current.splice(index, 1)
                    setValue(property.id, current)
                  }}
                >
                  {option.name}
                </button>
              {/each}
            </span>
          {/if}
        </dd>
      {/if}
    {/each}
  </dl>

  <section class="record-memo">
    <label>
      <span>{messages.memo}</span>
      <textarea
        rows={8}
        disabled={!editable}
        placeholder={messages.memoPlaceholder}
        value={effectiveMemo}
        oninput={(event) => setMemo((event.target as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
  </section>
</aside>

<style>
  .record-panel {
    margin: 0 0 1.2em;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--surface-elevated);
  }

  .record-panel header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .record-title {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.15rem;
    font-weight: 600;
  }

  .record-badge {
    margin: 0 0 10px;
    font-size: 0.8rem;
  }

  .record-badge.overdue {
    color: var(--danger-text);
  }

  .record-badge.soon {
    color: var(--border-input-focus);
  }

  .record-badge.complete {
    color: var(--text-muted);
  }

  .record-properties {
    display: grid;
    grid-template-columns: minmax(90px, 20%) 1fr;
    gap: 6px 12px;
    margin: 0 0 12px;
  }

  .record-properties dt {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .record-properties dd {
    margin: 0;
  }

  .record-memo label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .record-memo span {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .record-memo textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--surface-app);
    color: var(--text-primary);
    font: inherit;
    resize: vertical;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    padding: 2px 7px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.82em;
    cursor: pointer;
  }

  .chip.on {
    background: var(--surface-active);
    border-color: var(--border-input-focus);
  }
</style>
