<script lang="ts">
  import type { ResolvedLanguage } from './settings'
  import { getMessages } from './i18n'
  import {
    clonePayload,
    isRecordComplete,
    newProperty,
    newRecord,
    optionName,
    propertyById,
    visibleRecords,
    type DatabasePayload,
    type DatabaseProperty,
    type DatabaseRecord,
    type FilterOp,
    type PropertyType,
  } from './databaseTypes'
  import { addCalendarDays, isValidCalendarDate, todayCalendarDate } from './databaseDates'
  import { isDueSoon, isManual, isOverdue } from './databaseHighlight'
  import {
    detachManualDate,
    reattachManualDate,
    ruleProblem,
    setDateValue,
  } from './databaseRules'
  import RecordPanel from './RecordPanel.svelte'
  import WeekView from './WeekView.svelte'
  import MonthView from './MonthView.svelte'

  type Props = {
    payload: DatabasePayload
    editable?: boolean
    // The resolved language reaches this node view as a store, because Tiptap
    // mounts it outside the component tree that resolves the language.
    language: import('svelte/store').Readable<ResolvedLanguage>
    onCreateTask: (date: string) => void
    onChange: (payload: DatabasePayload) => void
  }

  let {
    payload,
    editable = true,
    language,
    onCreateTask,
    onChange,
  }: Props = $props()

  export function setPayload(next: DatabasePayload) {
    payload = next
  }

  let resolvedLanguage = $derived($language)
  let messages = $derived(getMessages(resolvedLanguage).database)
  let records = $derived(visibleRecords(payload))
  let totalCount = $derived(payload.records.length)

  // UI state is deliberately local: it survives only as long as this node view
  // does, and none of it is ever written back into the document.
  let selected = $state<Set<string>>(new Set())
  let openedRecordId = $state<string | null>(null)
  let filtersOpen = $state(false)
  let rulesOpen = $state(false)

  let openedRecord = $derived.by(() => {
    const openId = openedRecordId
    if (!openId) return undefined
    return payload.records.find((record) => record.id === openId)
  })

  function commit(next: DatabasePayload) {
    if (!editable) return
    onChange(next)
  }

  function patch(next: DatabasePayload, message?: string) {
    if (message) console.error(message)
    commit(next)
  }

  // ── records ────────────────────────────────────────────────────────────
  function addRecord() {
    const title = propertyById(payload, titleId())
    const values: Record<string, unknown> = {}
    if (title) values[title.id] = ''
    commit({
      ...clonePayload(payload),
      records: [...payload.records, newRecord(crypto.randomUUID(), values)],
    })
  }

  function titleId(): string {
    return payload.properties.find((property) => property.type === 'title')?.id ?? ''
  }

  function setRecordValue(recordId: string, propertyId: string, value: unknown) {
    const property = propertyById(payload, propertyId)
    if (!property) return
    let next = clonePayload(payload)
    let target = next.records.find((record) => record.id === recordId)
    if (!target) return

    if (property.type === 'date') {
      const normalized = typeof value === 'string' && value !== '' && !isValidCalendarDate(value)
        ? null
        : value === ''
          ? null
          : value
      next = setDateValue(next, recordId, propertyId, normalized as string | null)
    } else {
      target.values[propertyId] = value
      if (property.type === 'title' || property.type === 'text') {
        if (typeof value === 'string' && value.trim() === '') target.values[propertyId] = value
      }
    }
    commit(next)
  }

  function deleteRecord(recordId: string) {
    commit({
      ...clonePayload(payload),
      records: payload.records.filter((record) => record.id !== recordId),
    })
    selected.delete(recordId)
    selected = new Set(selected)
    if (openedRecordId === recordId) openedRecordId = null
  }

  // ── properties ────────────────────────────────────────────────────────
  function addProperty() {
    const name = `${messages.addProperty} ${payload.properties.length + 1}`
    commit({
      ...clonePayload(payload),
      properties: [...payload.properties, newProperty(crypto.randomUUID(), name, 'text')],
    })
  }

  function renameProperty(propertyId: string, name: string) {
    commit({
      ...clonePayload(payload),
      properties: payload.properties.map((property) =>
        property.id === propertyId ? { ...property, name } : property,
      ),
    })
  }

  function changePropertyType(propertyId: string, type: PropertyType) {
    const property = propertyById(payload, propertyId)
    if (!property || property.type === type) return
    const next = clonePayload(payload)
    const target = next.properties.find((candidate) => candidate.id === propertyId)
    if (!target) return
    // Changing a type drops values the new type cannot hold rather than storing
    // data the schema would then reject.
    target.type = type
    if (type === 'status' || type === 'select' || type === 'multiSelect') {
      if (!target.options?.length) {
        target.options = [{ id: crypto.randomUUID(), name: messages.options + ' 1' }]
      }
    } else {
      delete target.options
    }
    for (const record of next.records) {
      const value = record.values[propertyId]
      if (value === undefined || value === null) continue
      if (!valueFitsType(target, value)) delete record.values[propertyId]
    }
    commit(next)
  }

  function valueFitsType(property: DatabaseProperty, value: unknown): boolean {
    switch (property.type) {
      case 'title':
      case 'text':
      case 'date':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number'
      case 'checkbox':
        return typeof value === 'boolean'
      case 'status':
      case 'select':
        return typeof value === 'string' && !!optionName(property, value)
      case 'multiSelect':
        return Array.isArray(value)
      default:
        return false
    }
  }

  function deleteProperty(propertyId: string) {
    const property = propertyById(payload, propertyId)
    if (!property || property.type === 'title') return
    const next = clonePayload(payload)
    next.properties = next.properties.filter((candidate) => candidate.id !== propertyId)
    for (const record of next.records) delete record.values[propertyId]
    // A rule that references the removed property cannot survive either.
    next.dateRules = next.dateRules.filter(
      (rule) => rule.basePropertyId !== propertyId && rule.targetPropertyId !== propertyId,
    )
    next.manualDates = next.manualDates.filter((entry) => entry.propertyId !== propertyId)
    if (next.sort?.propertyId === propertyId) delete next.sort
    next.filters = (next.filters ?? []).filter((filter) => filter.propertyId !== propertyId)
    commit(next)
  }

  function addOption(propertyId: string) {
    commit({
      ...clonePayload(payload),
      properties: payload.properties.map((property) =>
        property.id === propertyId
          ? {
              ...property,
              options: [
                ...(property.options ?? []),
                { id: crypto.randomUUID(), name: `${messages.options} ${(property.options ?? []).length + 1}` },
              ],
            }
          : property,
      ),
    })
  }

  function renameOption(propertyId: string, optionId: string, name: string) {
    commit({
      ...clonePayload(payload),
      properties: payload.properties.map((property) =>
        property.id === propertyId
          ? {
              ...property,
              options: (property.options ?? []).map((option) =>
                option.id === optionId ? { ...option, name } : option,
              ),
            }
          : property,
      ),
    })
  }

  // ── sort and filter ───────────────────────────────────────────────────
  function setSort(propertyId: string) {
    if (propertyId === '') {
      commit({ ...clonePayload(payload), sort: undefined })
      return
    }
    const direction = payload.sort?.direction === 'asc' ? 'asc' : 'asc'
    commit({ ...clonePayload(payload), sort: { propertyId, direction } })
  }

  function toggleSortDirection() {
    if (!payload.sort) return
    commit({
      ...clonePayload(payload),
      sort: {
        ...payload.sort,
        direction: payload.sort.direction === 'asc' ? 'desc' : 'asc',
      },
    })
  }

  function addFilter() {
    const first = payload.properties[0]
    if (!first) return
    commit({
      ...clonePayload(payload),
      filters: [...(payload.filters ?? []), { propertyId: first.id, op: 'isEmpty' }],
    })
    filtersOpen = true
  }

  function updateFilter(index: number, propertyId: string, op: FilterOp, value?: unknown) {
    const filters = [...(payload.filters ?? [])]
    const current = filters[index]
    if (!current) return
    // Changing the operation can change which value shapes are legal, so the
    // value is reset rather than carried into a filter it does not fit.
    filters[index] = { propertyId, op, ...(value === undefined ? {} : { value }) }
    commit({ ...clonePayload(payload), filters })
  }

  function removeFilter(index: number) {
    const filters = (payload.filters ?? []).filter((_, position) => position !== index)
    commit({ ...clonePayload(payload), filters })
  }

  function clearFilters() {
    commit({ ...clonePayload(payload), filters: [] })
  }

  // ── selection and batch edit ───────────────────────────────────────────
  function toggleSelected(recordId: string) {
    const next = new Set(selected)
    if (next.has(recordId)) next.delete(recordId)
    else next.add(recordId)
    selected = next
  }

  function clearSelection() {
    selected = new Set()
  }

  function selectedIds(): string[] {
    return records.filter((record) => selected.has(record.id)).map((record) => record.id)
  }

  /**
   * Applies one change to every selected record in a single commit, so the whole
   * batch edit is one Undo unit. Records hidden by a filter are not selected
   * rows in the first place, so a filter can never widen the batch.
   */
  function applyToSelected(apply: (record: DatabaseRecord, payload: DatabasePayload) => void) {
    const ids = selectedIds()
    if (ids.length === 0) return
    const next = clonePayload(payload)
    const idSet = new Set(ids)
    for (const record of next.records) {
      if (!idSet.has(record.id)) continue
      apply(record, next)
    }
    commit(next)
  }

  function batchSetDate(propertyId: string, date: string) {
    applyToSelected((record) => {
      record.values[propertyId] = date === '' ? null : date
    })
  }

  function batchShiftDate(propertyId: string, days: number) {
    const base = todayCalendarDate()
    applyToSelected((record) => {
      const current = record.values[propertyId]
      const from = isValidCalendarDate(current) ? (current as string) : base
      record.values[propertyId] = addCalendarDays(from, days)
    })
  }

  function batchSetStatus(propertyId: string, optionId: string) {
    applyToSelected((record) => {
      record.values[propertyId] = optionId === '' ? null : optionId
    })
  }

  function batchSetCheckbox(propertyId: string, checked: boolean) {
    applyToSelected((record) => {
      record.values[propertyId] = checked
    })
  }

  function batchToggleOption(propertyId: string, optionId: string) {
    applyToSelected((record) => {
      const current = record.values[propertyId]
      const options = Array.isArray(current) ? [...(current as string[])] : []
      const index = options.indexOf(optionId)
      if (index === -1) options.push(optionId)
      else options.splice(index, 1)
      record.values[propertyId] = options
    })
  }

  /**
   * Creates a task from a calendar date, giving it that date as its deadline.
   * The pick falls back to the first date property, so a converted table's date
   * column receives the picked day without a separate setting.
   */
  function createTaskOnDate(date: string) {
    const target =
      payload.properties.find(
        (property) => property.type === 'date' && /due|deadline|마감|기한/i.test(property.name),
      ) ?? payload.properties.find((property) => property.type === 'date')
    const title = payload.properties.find((property) => property.type === 'title')
    const values: Record<string, unknown> = {}
    if (title) values[title.id] = ''
    if (target) values[target.id] = date
    commit({
      ...clonePayload(payload),
      records: [...payload.records, newRecord(crypto.randomUUID(), values)],
    })
  }

  // ── date rules ────────────────────────────────────────────────────────
  function addRule(basePropertyId: string, targetPropertyId: string, offsetDays: number) {
    const problem = ruleProblem(payload, basePropertyId, targetPropertyId, offsetDays)
    if (problem) return
    const next = clonePayload(payload)
    next.dateRules.push({ id: crypto.randomUUID(), basePropertyId, targetPropertyId, offsetDays })
    commit(next)
  }

  function removeRule(ruleId: string) {
    const next = clonePayload(payload)
    next.dateRules = next.dateRules.filter((rule) => rule.id !== ruleId)
    // Manual dates recorded against the removed rule no longer mean anything.
    const orphaned = new Set(
      payload.dateRules.filter((rule) => rule.id === ruleId).map((rule) => rule.targetPropertyId),
    )
    next.manualDates = next.manualDates.filter((entry) => !orphaned.has(entry.propertyId))
    commit(next)
  }

  function detach(recordId: string, propertyId: string) {
    commit(detachManualDate(payload, recordId, propertyId))
  }

  function reattach(recordId: string, propertyId: string) {
    commit(reattachManualDate(payload, recordId, propertyId))
  }

  // ── date rule editor ───────────────────────────────────────────────────
  let ruleDraftBase = $state('')
  let ruleDraftTarget = $state('')
  let ruleDraftOffset = $state(7)
  let ruleError = $state('')

  $effect(() => {
    // Drafts only need a valid starting pair of date properties.
    if (ruleDraftBase === '' || ruleDraftTarget === '') {
      const dates = payload.properties.filter((property) => property.type === 'date')
      if (ruleDraftBase === '' && dates[0]) ruleDraftBase = dates[0].id
      if (ruleDraftTarget === '' && dates[1]) ruleDraftTarget = dates[1].id
    }
  })

  function submitRule() {
    const problem = ruleProblem(payload, ruleDraftBase, ruleDraftTarget, ruleDraftOffset)
    if (problem) {
      ruleError = problem.message
      return
    }
    ruleError = ''
    addRule(ruleDraftBase, ruleDraftTarget, ruleDraftOffset)
  }

  // ── highlights ────────────────────────────────────────────────────────
  function setHighlight(recordId: string, token: string) {
    const next = clonePayload(payload)
    if (token === '') {
      if (next.rowHighlights) delete next.rowHighlights[recordId]
    } else {
      next.rowHighlights = { ...(next.rowHighlights ?? {}), [recordId]: token } as Record<
        string,
        'yellow' | 'blue' | 'green' | 'red' | 'purple'
      >
    }
    commit(next)
  }
</script>

<div class="database" data-database-view>
  <div class="database-toolbar">
    <button type="button" class="quiet" onclick={() => commit({ ...clonePayload(payload), view: 'table' })}>
      {messages.viewTable}
    </button>
    <button type="button" class="quiet" onclick={() => commit({ ...clonePayload(payload), view: 'week' })}>
      {messages.viewWeek}
    </button>
    <button
      type="button"
      class="quiet"
      onclick={() => commit({ ...clonePayload(payload), view: 'month' })}
    >
      {messages.viewMonth}
    </button>
    <span class="database-count">{messages.recordCount(totalCount)}</span>
    <span class="database-spacer"></span>
    {#if selected.size > 0}
      <span class="database-batch">{messages.selected(selected.size)}</span>
      <button type="button" class="quiet" onclick={clearSelection}>{messages.batchClear}</button>
    {/if}
    <button type="button" class="quiet" onclick={addRecord}>{messages.addRecord}</button>
  </div>

  {#if selected.size > 0}
    <div class="database-batch-bar">
      {#each payload.properties as property (property.id)}
        {#if property.type !== 'title'}
          <span class="batch-group">
            <span class="batch-label">{property.name}</span>
            {#if property.type === 'date'}
              <input
                type="date"
                onchange={(event) => batchSetDate(property.id, (event.target as HTMLInputElement).value)}
              />
              <button type="button" class="quiet" onclick={() => batchShiftDate(property.id, 7)}>
                {messages.batchShiftDate} +7
              </button>
              <button type="button" class="quiet" onclick={() => batchShiftDate(property.id, -2)}>
                {messages.batchShiftDate} -2
              </button>
            {:else if property.type === 'status' || property.type === 'select'}
              <select onchange={(event) => batchSetStatus(property.id, (event.target as HTMLSelectElement).value)}>
                <option value="">—</option>
                {#each property.options ?? [] as option (option.id)}
                  <option value={option.id}>{option.name}</option>
                {/each}
              </select>
            {:else if property.type === 'checkbox'}
              <button type="button" class="quiet" onclick={() => batchSetCheckbox(property.id, true)}>
                ✓
              </button>
              <button type="button" class="quiet" onclick={() => batchSetCheckbox(property.id, false)}>
                ✗
              </button>
            {:else if property.type === 'multiSelect'}
              {#each property.options ?? [] as option (option.id)}
                <button
                  type="button"
                  class="quiet"
                  onclick={() => batchToggleOption(property.id, option.id)}
                >
                  {option.name}
                </button>
              {/each}
            {/if}
          </span>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="database-controls">
    <label>
      <span>{messages.sort}</span>
      <select value={payload.sort?.propertyId ?? ''} onchange={(event) => setSort((event.target as HTMLSelectElement).value)}>
        <option value="">—</option>
        {#each payload.properties as property (property.id)}
          <option value={property.id}>{property.name}</option>
        {/each}
      </select>
    </label>
    {#if payload.sort}
      <button type="button" class="quiet" onclick={toggleSortDirection}>
        {payload.sort.direction === 'asc' ? messages.ascending : messages.descending}
      </button>
    {/if}
    <button type="button" class="quiet" onclick={() => (filtersOpen = !filtersOpen)}>
      {messages.filter}
    </button>
    <button type="button" class="quiet" onclick={() => (rulesOpen = !rulesOpen)}>
      {messages.ruleEditor}
    </button>
    {#each payload.filters ?? [] as filter, index (index)}
      <span class="filter-chip">{filter.propertyId}</span>
    {/each}
    {#if (payload.filters ?? []).length > 0}
      <button type="button" class="quiet" onclick={clearFilters}>{messages.clearFilters}</button>
    {/if}
  </div>

  {#if filtersOpen}
    <div class="database-filters">
      {#each payload.filters ?? [] as filter, index (index)}
        {@const property = propertyById(payload, filter.propertyId)}
        <div class="filter-row">
          <select
            value={filter.propertyId}
            onchange={(event) =>
              updateFilter(index, (event.target as HTMLSelectElement).value, filter.op)}
          >
            {#each payload.properties as candidate (candidate.id)}
              <option value={candidate.id}>{candidate.name}</option>
            {/each}
          </select>
          <select
            value={filter.op}
            onchange={(event) =>
              updateFilter(
                index,
                filter.propertyId,
                (event.target as HTMLSelectElement).value as FilterOp,
              )}
          >
            <option value="isEmpty">is empty</option>
            <option value="isNotEmpty">is not empty</option>
            <option value="is">is</option>
            <option value="isNot">is not</option>
            <option value="contains">contains</option>
            <option value="isChecked">is checked</option>
            <option value="isUnchecked">is unchecked</option>
            <option value="before">before</option>
            <option value="after">after</option>
          </select>
          {#if property && (property.type === 'status' || property.type === 'select')}
            <select
              value={typeof filter.value === 'string' ? filter.value : ''}
              onchange={(event) =>
                updateFilter(
                  index,
                  filter.propertyId,
                  filter.op,
                  (event.target as HTMLSelectElement).value,
                )}
            >
              <option value="">—</option>
              {#each property.options ?? [] as option (option.id)}
                <option value={option.id}>{option.name}</option>
              {/each}
            </select>
          {:else if property && filter.op !== 'isEmpty' && filter.op !== 'isNotEmpty' && filter.op !== 'isChecked' && filter.op !== 'isUnchecked'}
            <input
              type={property.type === 'date' ? 'date' : property.type === 'number' ? 'number' : 'text'}
              value={typeof filter.value === 'string' ? filter.value : ''}
              onchange={(event) =>
                updateFilter(
                  index,
                  filter.propertyId,
                  filter.op,
                  (event.target as HTMLInputElement).value,
                )}
            />
          {/if}
          <button type="button" class="quiet" onclick={() => removeFilter(index)}>
            {messages.removeFilter}
          </button>
        </div>
      {/each}
      <button type="button" class="quiet" onclick={addFilter}>{messages.addFilter}</button>
      {#if (payload.filters ?? []).length === 0}
        <span class="muted">{messages.noFilters}</span>
      {/if}
    </div>
  {/if}

  {#if payload.dateRules.length > 0}
    <div class="database-rules">
      {#each payload.dateRules as rule (rule.id)}
        <span class="rule-chip">
          {propertyById(payload, rule.basePropertyId)?.name}
          {rule.offsetDays >= 0 ? '+' : ''}{rule.offsetDays}
          {messages.shiftDays} →
          {propertyById(payload, rule.targetPropertyId)?.name}
          <button type="button" class="quiet" onclick={() => removeRule(rule.id)}>×</button>
        </span>
      {/each}
    </div>
  {/if}

  {#if rulesOpen}
    <div class="database-rules">
      <span class="muted">{messages.ruleEditor}:</span>
      <select bind:value={ruleDraftBase}>
        {#each payload.properties.filter((property) => property.type === 'date') as property (property.id)}
          <option value={property.id}>{property.name}</option>
        {/each}
      </select>
      <span class="muted">+</span>
      <input
        type="number"
        class="rule-offset"
        bind:value={ruleDraftOffset}
        aria-label={messages.shiftDays}
      />
      <span class="muted">{messages.shiftDays}</span>
      <span class="muted">→</span>
      <select bind:value={ruleDraftTarget}>
        {#each payload.properties.filter((property) => property.type === 'date') as property (property.id)}
          <option value={property.id}>{property.name}</option>
        {/each}
      </select>
      <button type="button" class="quiet" onclick={submitRule}>{messages.batchApply}</button>
      {#if ruleError}
        <span class="database-error" role="alert">{ruleError}</span>
      {/if}
    </div>
  {/if}

  {#if payload.view === 'week'}
    <WeekView
      {payload}
      {language}
      {editable}
      onOpenRecord={(recordId) => (openedRecordId = recordId)}
      onCreateTask={createTaskOnDate}
    />
  {:else if payload.view === 'month'}
    <MonthView
      {payload}
      {language}
      {editable}
      onOpenRecord={(recordId) => (openedRecordId = recordId)}
      onCreateTask={createTaskOnDate}
    />
  {/if}

  {#if payload.view === 'table'}
    {#if records.length === 0}
      <p class="database-empty">{messages.emptyRecords}</p>
    {:else}
      <div class="database-grid-scroll">
        <table class="database-grid">
          <thead>
            <tr>
              <th class="select-column"></th>
              {#each payload.properties as property (property.id)}
                <th>
                  <input
                    type="text"
                    class="property-name"
                    value={property.name}
                    onchange={(event) =>
                      renameProperty(property.id, (event.target as HTMLInputElement).value)}
                  />
                  <select
                    value={property.type}
                    onchange={(event) =>
                      changePropertyType(property.id, (event.target as HTMLSelectElement).value as PropertyType)}
                  >
                    <option value="title">{messages.title}</option>
                    <option value="text">{messages.text}</option>
                    <option value="number">{messages.number}</option>
                    <option value="date">{messages.date}</option>
                    <option value="status">{messages.status}</option>
                    <option value="checkbox">{messages.checkbox}</option>
                    <option value="select">{messages.select}</option>
                    <option value="multiSelect">{messages.multiSelect}</option>
                  </select>
                </th>
              {/each}
              <th class="add-column">
                <button type="button" class="quiet" onclick={addProperty}>+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each records as record (record.id)}
              <tr
                class:completed={isRecordComplete(payload, record)}
                class:selected={selected.has(record.id)}
                class:overdue={isOverdue(payload, record)}
                class:due-soon={isDueSoon(payload, record)}
                class={payload.rowHighlights?.[record.id]
                  ? `highlight-${payload.rowHighlights[record.id]}`
                  : ''}
              >
                <td class="select-column">
                  <input
                    type="checkbox"
                    checked={selected.has(record.id)}
                    onchange={() => toggleSelected(record.id)}
                  />
                </td>
                {#each payload.properties as property (property.id)}
                  <td>
                    {#if property.type === 'title' || property.type === 'text'}
                      <input
                        type="text"
                        value={typeof record.values[property.id] === 'string' ? (record.values[property.id] as string) : ''}
                        onchange={(event) =>
                          setRecordValue(record.id, property.id, (event.target as HTMLInputElement).value)}
                      />
                    {:else if property.type === 'number'}
                      <input
                        type="number"
                        value={typeof record.values[property.id] === 'number' ? String(record.values[property.id]) : ''}
                        onchange={(event) => {
                          const raw = (event.target as HTMLInputElement).value
                          setRecordValue(record.id, property.id, raw === '' ? null : Number(raw))
                        }}
                      />
                    {:else if property.type === 'date'}
                      <input
                        type="date"
                        value={typeof record.values[property.id] === 'string' ? (record.values[property.id] as string) : ''}
                        onchange={(event) =>
                          setRecordValue(record.id, property.id, (event.target as HTMLInputElement).value)}
                      />
                      {#if isManual(payload, record.id, property.id)}
                        <span class="manual-flag" title="manual">
                          <button type="button" class="quiet" onclick={() => reattach(record.id, property.id)}>↺</button>
                        </span>
                      {/if}
                    {:else if property.type === 'status' || property.type === 'select'}
                      <select
                        value={typeof record.values[property.id] === 'string' ? (record.values[property.id] as string) : ''}
                        onchange={(event) =>
                          setRecordValue(record.id, property.id, (event.target as HTMLSelectElement).value)}
                      >
                        <option value="">—</option>
                        {#each property.options ?? [] as option (option.id)}
                          <option value={option.id}>{option.name}</option>
                        {/each}
                      </select>
                    {:else if property.type === 'checkbox'}
                      <input
                        type="checkbox"
                        checked={record.values[property.id] === true}
                        onchange={(event) =>
                          setRecordValue(record.id, property.id, (event.target as HTMLInputElement).checked)}
                      />
                    {:else if property.type === 'multiSelect'}
                      <span class="chips">
                        {#each property.options ?? [] as option (option.id)}
                          <button
                            type="button"
                            class="chip"
                            class:on={Array.isArray(record.values[property.id]) &&
                              (record.values[property.id] as string[]).includes(option.id)}
                            onclick={() => {
                              const current = Array.isArray(record.values[property.id])
                                ? [...(record.values[property.id] as string[])]
                                : []
                              const index = current.indexOf(option.id)
                              if (index === -1) current.push(option.id)
                              else current.splice(index, 1)
                              setRecordValue(record.id, property.id, current)
                            }}
                          >
                            {option.name}
                          </button>
                        {/each}
                      </span>
                    {/if}
                  </td>
                {/each}
                <td class="record-actions">
                  <button
                    type="button"
                    class="quiet"
                    onclick={() => (openedRecordId = openedRecordId === record.id ? null : record.id)}
                  >
                    {messages.openRecord}
                  </button>
                  <span class="record-badges">
                    {#if isRecordComplete(payload, record)}
                      <span class="badge complete" title={messages.dueComplete}>✓</span>
                    {:else if isOverdue(payload, record)}
                      <span class="badge overdue" title={messages.dueOverdue}>!</span>
                    {:else if isDueSoon(payload, record)}
                      <span class="badge soon" title={messages.dueSoon}>·</span>
                    {/if}
                  </span>
                  <select
                    class="highlight-select"
                    aria-label={messages.highlight}
                    value={payload.rowHighlights?.[record.id] ?? ''}
                    onchange={(event) =>
                      setHighlight(record.id, (event.target as HTMLSelectElement).value)}
                  >
                    <option value="">{messages.highlightNone}</option>
                    <option value="yellow">{messages.highlightYellow}</option>
                    <option value="blue">{messages.highlightBlue}</option>
                    <option value="green">{messages.highlightGreen}</option>
                    <option value="red">{messages.highlightRed}</option>
                    <option value="purple">{messages.highlightPurple}</option>
                  </select>
                  <button type="button" class="quiet" onclick={() => deleteRecord(record.id)}>×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}

  {#if openedRecord}
    <RecordPanel
      {payload}
      record={openedRecord}
      language={resolvedLanguage}
      {editable}
      onChange={(next) => onChange(next)}
      onClose={() => (openedRecordId = null)}
    />
  {/if}
</div>

<style>
  .database {
    margin: 0 0 1.2em;
  }

  .database-toolbar,
  .database-controls,
  .database-batch-bar,
  .database-rules {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .database-count,
  .database-batch,
  .muted {
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .database-spacer {
    flex: 1;
  }

  .database-grid-scroll {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .database-grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .database-grid th,
  .database-grid td {
    padding: 4px 6px;
    border: 1px solid var(--border-subtle);
    vertical-align: top;
  }

  .database-grid thead th {
    background: var(--surface-app);
  }

  .property-name {
    width: 100%;
    min-width: 90px;
    border: none;
    background: transparent;
    font-weight: 600;
  }

  .select-column,
  .add-column,
  .record-actions {
    width: 1%;
    white-space: nowrap;
  }

  .database-grid tr.completed td {
    color: var(--text-muted);
  }

  .database-grid tr.selected td {
    background: var(--surface-active);
  }

  .database-grid tr.overdue td {
    box-shadow: inset 3px 0 0 var(--danger-text);
  }

  .database-grid tr.due-soon td {
    box-shadow: inset 3px 0 0 var(--border-input-focus);
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

  .filter-chip,
  .rule-chip {
    padding: 2px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    font-size: 0.8em;
  }

  .database-filters {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .rule-offset {
    width: 5em;
  }

  .highlight-select {
    max-width: 5.5em;
  }

  .database-error {
    color: var(--danger-text);
    font-size: 0.82rem;
  }

  .record-badges {
    display: inline-flex;
    gap: 2px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 999px;
    font-size: 0.7em;
    font-weight: 700;
    line-height: 1;
  }

  .badge.overdue {
    background: var(--danger-bg);
    color: var(--danger-text-strong);
  }

  .badge.soon {
    background: var(--surface-active);
    color: var(--text-secondary);
  }

  .badge.complete {
    background: var(--surface-active);
    color: var(--text-muted);
  }

  /* A manual row highlight tints the row. Conditional warnings stay a separate
     badge, so a user color is never lost when a deadline warning also applies. */
  .database-grid tr.highlight-yellow td {
    background: color-mix(in srgb, #e8c547 22%, transparent);
  }

  .database-grid tr.highlight-blue td {
    background: color-mix(in srgb, #4a7fd4 20%, transparent);
  }

  .database-grid tr.highlight-green td {
    background: color-mix(in srgb, #4fa36b 20%, transparent);
  }

  .database-grid tr.highlight-red td {
    background: color-mix(in srgb, #d4574a 20%, transparent);
  }

  .database-grid tr.highlight-purple td {
    background: color-mix(in srgb, #8a5fd4 20%, transparent);
  }

  .database-grid tr.selected.highlight-yellow td,
  .database-grid tr.selected.highlight-blue td,
  .database-grid tr.selected.highlight-green td,
  .database-grid tr.selected.highlight-red td,
  .database-grid tr.selected.highlight-purple td {
    background: var(--surface-active);
  }

  .database-empty {
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  .batch-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
  }

  .batch-label {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
</style>
