import { svelte } from '@sveltejs/vite-plugin-svelte'
import wails from '@wailsio/runtime/plugins/vite'
import { defineConfig } from 'vite'

const devServerPort = Number(process.env.WAILS_VITE_PORT) || 9245

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: devServerPort,
    strictPort: true,
  },
  plugins: [svelte(), wails('./bindings')],
})
