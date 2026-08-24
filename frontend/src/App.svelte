<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { GetRuntimeInfo } from '../bindings/github.com/savior714/flashnote/appservice'
  import NoteEditor from './lib/NoteEditor.svelte'

  async function verifyNativeRuntime() {
    await tick()
    const shell = document.querySelector('main.shell')
    const editorHost = document.querySelector('.editor-host')
    if (!shell || !editorHost) {
      throw new Error('Flashnote native UI did not mount')
    }

    const info = await GetRuntimeInfo()
    if (!info.databaseReady || info.schemaVersion < 1) {
      throw new Error('Flashnote runtime bridge returned invalid diagnostics')
    }
  }

  onMount(() => {
    void verifyNativeRuntime()
  })
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
