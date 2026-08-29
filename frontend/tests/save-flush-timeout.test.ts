import assert from 'node:assert/strict'
import test from 'node:test'

import { waitForSaveFlush } from '../src/lib/save-flush-timeout.ts'

test('successful save flush cancels the stale timeout side effect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let saveError = ''

  const result = await waitForSaveFlush(Promise.resolve(true), 5000, () => {
    saveError = 'Save timed out'
  })

  assert.equal(result, true)
  t.mock.timers.tick(5000)
  assert.equal(saveError, '')
})

test('unresolved save flush reports timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let saveError = ''
  const pendingFlush = new Promise<boolean>(() => {})

  const resultPromise = waitForSaveFlush(pendingFlush, 5000, () => {
    saveError = 'Save timed out'
  })

  t.mock.timers.tick(5000)

  assert.equal(await resultPromise, false)
  assert.equal(saveError, 'Save timed out')
})
