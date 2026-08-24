import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import './folder.css'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Flashnote app root is missing')
}

mount(App, { target })
