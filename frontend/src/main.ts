import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import './folder.css'
import './trash.css'
import './sidebar-dnd.css'
import {
  installMarkdownExportShortcut,
  runMarkdownExportShortcutAcceptance,
} from './lib/export-shortcut'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Flashnote app root is missing')
}

if (
  import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_TEXT &&
  !import.meta.env.VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE
) {
  runMarkdownExportShortcutAcceptance()
}

mount(App, { target })
installMarkdownExportShortcut()
