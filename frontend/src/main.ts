import { System, Window } from '@wailsio/runtime'
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

const macInvisibleTitlebarHeight = 48
const interactiveTitlebarSelector =
  'button, input, textarea, select, a, [role="button"], [contenteditable="true"]'

function installMacTitlebarDoubleClickFallback() {
  window.addEventListener('dblclick', (event) => {
    if (
      !System.IsMac() ||
      event.button !== 0 ||
      event.clientY < 0 ||
      event.clientY >= macInvisibleTitlebarHeight
    ) {
      return
    }

    const eventTarget = event.target
    if (eventTarget instanceof Element && eventTarget.closest(interactiveTitlebarSelector)) {
      return
    }

    event.preventDefault()
    void Window.ToggleMaximise()
  })
}

if (
  import.meta.env.VITE_FLASHNOTE_ACCEPTANCE_TEXT &&
  !import.meta.env.VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE
) {
  runMarkdownExportShortcutAcceptance()
}

mount(App, { target })
installMarkdownExportShortcut()
installMacTitlebarDoubleClickFallback()
