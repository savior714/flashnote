<script lang="ts">
  import NoteEditor from './lib/NoteEditor.svelte'
</script>

<main class="shell">
  <aside class="sidebar" aria-label="Notes">
    <div class="brand-row">
      <strong>Flashnote</strong>
      <button class="quiet-button" type="button" aria-label="Create">+</button>
    </div>
    <div class="sidebar-placeholder">Your notes will appear here.</div>
    <div class="trash-row">Trash</div>
  </aside>

  <section class="document" aria-label="Editor">
    <div class="document-inner">
      <input class="title" aria-label="Note title" placeholder="Untitled" />
      <NoteEditor />
    </div>
  </section>
</main>
