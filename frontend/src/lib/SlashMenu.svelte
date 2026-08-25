<script lang="ts">
  import type { SlashCommandItem } from './slashCommands'

  type Props = {
    items: SlashCommandItem[]
    selectedIndex: number
    x: number
    y: number
    onSelect: (item: SlashCommandItem) => void
    onHover: (index: number) => void
  }

  let { items, selectedIndex, x, y, onSelect, onHover }: Props = $props()
  let menuElement = $state<HTMLDivElement | null>(null)

  $effect(() => {
    if (menuElement && selectedIndex >= 0) {
      const buttons = menuElement.querySelectorAll('button')
      const selectedButton = buttons[selectedIndex]
      selectedButton?.scrollIntoView({ block: 'nearest' })
    }
  })
</script>

<div
  bind:this={menuElement}
  class="slash-menu"
  role="listbox"
  aria-label="Slash commands"
  style="left: {x}px; top: {y}px;"
  tabindex="-1"
  onmousedown={(e) => e.preventDefault()}
>
  {#if items.length === 0}
    <div class="slash-menu-empty" role="status">No matching commands</div>
  {:else}
    {#each items as item, index (item.id)}
      <button
        type="button"
        role="option"
        aria-selected={index === selectedIndex}
        class="slash-menu-item"
        class:is-selected={index === selectedIndex}
        onmouseenter={() => onHover(index)}
        onclick={() => onSelect(item)}
      >
        <span class="item-label">{item.label}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .slash-menu {
    position: fixed;
    z-index: 1000;
    min-width: 180px;
    max-width: 240px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--surface-elevated);
    border: 1px solid var(--border-dialog);
    border-radius: 8px;
    box-shadow: var(--shadow-menu);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    user-select: none;
  }

  .slash-menu:focus {
    outline: none;
  }

  .slash-menu-empty {
    padding: 8px 12px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .slash-menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
    line-height: 1.4;
    transition: background-color 0.1s ease;
  }

  .slash-menu-item:hover,
  .slash-menu-item.is-selected {
    background: var(--surface-hover);
  }

  .slash-menu-item:focus-visible {
    outline: none;
    background: var(--surface-active);
  }

  .item-label {
    flex: 1;
  }
</style>
