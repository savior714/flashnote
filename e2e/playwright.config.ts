import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.FLASHNOTE_E2E_BASE_URL
if (!baseURL) {
  throw new Error('FLASHNOTE_E2E_BASE_URL must point at the isolated Wails server')
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
})
