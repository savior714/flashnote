<script lang="ts">
  import { ExportLibraryMarkdown } from '../../bindings/github.com/savior714/flashnote/exportservice'
  import {
    type AppearanceMode,
    type Settings,
    MIN_FONT_SIZE,
    MAX_FONT_SIZE,
  } from './settings'

  type Props = {
    settings: Settings
    onUpdate: (updater: (prev: Settings) => Settings) => void
    onClose: () => void
    onExportTriggered?: () => void
  }

  let { settings, onUpdate, onClose, onExportTriggered }: Props = $props()

  let exportStatus = $state<'' | 'exporting' | 'success' | 'error'>('')
  let exportMessage = $state('')

  function handleAppearanceChange(mode: AppearanceMode) {
    onUpdate((prev) => ({ ...prev, appearance: mode }))
  }

  function handleFontSizeChange(event: Event) {
    const input = (event.currentTarget || event.target) as HTMLInputElement
    const val = parseInt(input.value, 10)
    if (!isNaN(val)) {
      const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, val))
      onUpdate((prev) => ({ ...prev, editorFontSize: clamped }))
    }
  }

  function handleSpellcheckToggle(event: Event) {
    const input = (event.currentTarget || event.target) as HTMLInputElement
    onUpdate((prev) => ({ ...prev, spellcheck: input.checked }))
  }

  async function handleExportAll() {
    if (exportStatus === 'exporting') {
      return
    }
    exportStatus = 'exporting'
    exportMessage = ''
    onExportTriggered?.()
    try {
      const exportPath = await ExportLibraryMarkdown()
      if (exportPath) {
        exportStatus = 'success'
        exportMessage = 'Library exported successfully.'
      } else {
        // User cancelled directory picker
        exportStatus = ''
        exportMessage = ''
      }
    } catch (error) {
      exportStatus = 'error'
      exportMessage = error instanceof Error ? error.message : 'Export failed.'
    } finally {
      if (exportStatus === 'exporting') {
        exportStatus = ''
      }
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }
</script>

<div
  class="modal-backdrop settings-backdrop"
  role="presentation"
  onclick={handleBackdropClick}
  onkeydown={handleDialogKeydown}
>
  <div
    class="settings-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    tabindex="-1"
  >
    <div class="settings-header">
      <h2 id="settings-title">Settings</h2>
      <button
        type="button"
        class="quiet-button settings-close-button"
        aria-label="Close settings"
        onclick={onClose}
      >✕</button>
    </div>

    <div class="settings-body">
      <!-- Section: Appearance -->
      <section class="settings-section" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading" class="settings-section-title">Appearance</h3>
        <div class="appearance-picker" role="radiogroup" aria-label="Appearance theme">
          <button
            type="button"
            role="radio"
            class="appearance-option"
            class:active={settings.appearance === 'system'}
            aria-checked={settings.appearance === 'system'}
            onclick={() => handleAppearanceChange('system')}
          >
            System
          </button>
          <button
            type="button"
            role="radio"
            class="appearance-option"
            class:active={settings.appearance === 'light'}
            aria-checked={settings.appearance === 'light'}
            onclick={() => handleAppearanceChange('light')}
          >
            Light
          </button>
          <button
            type="button"
            role="radio"
            class="appearance-option"
            class:active={settings.appearance === 'dark'}
            aria-checked={settings.appearance === 'dark'}
            onclick={() => handleAppearanceChange('dark')}
          >
            Dark
          </button>
        </div>
      </section>

      <!-- Section: Editor -->
      <section class="settings-section" aria-labelledby="editor-heading">
        <h3 id="editor-heading" class="settings-section-title">Editor</h3>
        
        <div class="settings-row-item">
          <label for="font-size-input" class="settings-label">Font size</label>
          <div class="font-size-control">
            <input
              id="font-size-input"
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step="1"
              class="font-size-slider"
              value={settings.editorFontSize}
              oninput={handleFontSizeChange}
              aria-label="Editor font size"
            />
            <span class="font-size-display">{settings.editorFontSize}px</span>
          </div>
        </div>

        <div class="settings-row-item">
          <label for="spellcheck-toggle" class="settings-label">Spellcheck</label>
          <input
            id="spellcheck-toggle"
            type="checkbox"
            class="spellcheck-checkbox"
            checked={settings.spellcheck}
            onchange={handleSpellcheckToggle}
            aria-label="Editor spellcheck"
          />
        </div>
      </section>

      <!-- Section: Data -->
      <section class="settings-section" aria-labelledby="data-heading">
        <h3 id="data-heading" class="settings-section-title">Data</h3>
        <div class="settings-row-item data-export-row">
          <div>
            <div class="settings-label">Export library</div>
            <div class="settings-hint">Save all notes as Markdown files</div>
          </div>
          <button
            type="button"
            class="secondary-button export-all-button"
            disabled={exportStatus === 'exporting'}
            onclick={handleExportAll}
          >
            {exportStatus === 'exporting' ? 'Exporting…' : 'Export all…'}
          </button>
        </div>
        {#if exportMessage}
          <div
            class="export-feedback"
            class:is-error={exportStatus === 'error'}
            class:is-success={exportStatus === 'success'}
            role="status"
          >
            {exportMessage}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .settings-dialog {
    width: min(460px, 100%);
    padding: 22px 24px 26px;
    border: 1px solid var(--border-dialog);
    border-radius: 12px;
    background: var(--surface-elevated);
    box-shadow: var(--shadow-dialog);
    color: var(--text-primary);
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 650;
  }

  .settings-close-button {
    font-size: 14px;
    color: var(--text-muted);
  }

  .settings-body {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .settings-section-title {
    margin: 0;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .appearance-picker {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 3px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--surface-sidebar);
  }

  .appearance-option {
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
    transition: background-color 0.12s ease, color 0.12s ease;
  }

  .appearance-option:hover {
    color: var(--text-primary);
  }

  .appearance-option.active {
    background: var(--surface-elevated);
    color: var(--text-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    font-weight: 600;
  }

  .settings-row-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .settings-label {
    font-size: 14px;
    color: var(--text-primary);
  }

  .settings-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .font-size-control {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .font-size-slider {
    width: 110px;
    accent-color: var(--text-primary);
    cursor: pointer;
  }

  .font-size-display {
    font-size: 13px;
    color: var(--text-muted);
    min-width: 36px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .spellcheck-checkbox {
    width: 17px;
    height: 17px;
    accent-color: var(--text-primary);
    cursor: pointer;
  }

  .export-feedback {
    font-size: 12px;
    padding: 6px 8px;
    border-radius: 6px;
  }

  .export-feedback.is-success {
    background: var(--surface-selected);
    color: var(--text-secondary);
  }

  .export-feedback.is-error {
    background: var(--danger-bg);
    border: 1px solid var(--danger-border);
    color: var(--danger-text);
  }
</style>
