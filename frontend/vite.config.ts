import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const devServerPort = parseInt(process.env.WAILS_VITE_PORT ?? '9245', 10)

export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: {
    port: devServerPort,
    strictPort: true,
  },
})
