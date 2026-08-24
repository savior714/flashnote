import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import './folder.css'
import './trash.css'
import { installMarkdownExportShortcut } from './lib/export-shortcut'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Flashnote app root is missing')
}

mount(App, { target })
installMarkdownExportShortcut()
