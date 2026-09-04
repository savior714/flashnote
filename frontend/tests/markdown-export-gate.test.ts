import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ensureLibraryExportReady,
  ensureSingleNoteExportReady,
  isSingleNoteExportAdmitted,
  requestLibraryExport,
  requestSingleNoteExport,
  resetMarkdownExportGateForTest,
  setMarkdownExportReadiness,
} from '../src/lib/markdownExportGate.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('export gate fails closed when no provider is registered', async () => {
  resetMarkdownExportGateForTest()
  let exporterCalls = 0
  assert.equal(isSingleNoteExportAdmitted(), false)
  assert.equal(await ensureSingleNoteExportReady(), false)
  assert.equal(await ensureLibraryExportReady(), false)
  assert.equal(
    await requestSingleNoteExport(() => {
      exporterCalls += 1
      return Promise.resolve(true)
    }),
    'blocked',
  )
  assert.equal(exporterCalls, 0)
  await assert.rejects(() =>
    requestLibraryExport(() => {
      exporterCalls += 1
      return Promise.resolve('/tmp/x')
    }),
  )
  assert.equal(exporterCalls, 0)
})

test('single-note export admits a valid normal note with no DOM present', async () => {
  resetMarkdownExportGateForTest()
  assert.equal(typeof document, 'undefined')
  setMarkdownExportReadiness({
    isTrashView: () => false,
    currentNormalNoteId: () => 'note-1',
    flushCurrentDraft: () => Promise.resolve(true),
  })
  try {
    assert.equal(isSingleNoteExportAdmitted(), true)
    assert.equal(await ensureSingleNoteExportReady(), true)
  } finally {
    resetMarkdownExportGateForTest()
  }
})

test('single-note export is denied from Trash application state without any DOM marker', async () => {
  resetMarkdownExportGateForTest()
  assert.equal(typeof document, 'undefined')
  let flushCalls = 0
  let exporterCalls = 0
  setMarkdownExportReadiness({
    isTrashView: () => true,
    currentNormalNoteId: () => 'note-1',
    flushCurrentDraft: () => {
      flushCalls += 1
      return Promise.resolve(true)
    },
  })
  try {
    assert.equal(isSingleNoteExportAdmitted(), false)
    assert.equal(
      await requestSingleNoteExport(() => {
        exporterCalls += 1
        return Promise.resolve(true)
      }),
      'blocked',
    )
    assert.equal(flushCalls, 0)
    assert.equal(exporterCalls, 0)
  } finally {
    resetMarkdownExportGateForTest()
  }
})

test('single-note export is denied when no normal note is open', async () => {
  resetMarkdownExportGateForTest()
  for (const emptyID of ['', '   ']) {
    let flushCalls = 0
    setMarkdownExportReadiness({
      isTrashView: () => false,
      currentNormalNoteId: () => emptyID,
      flushCurrentDraft: () => {
        flushCalls += 1
        return Promise.resolve(true)
      },
    })
    try {
      assert.equal(isSingleNoteExportAdmitted(), false)
      assert.equal(await ensureSingleNoteExportReady(), false)
      assert.equal(flushCalls, 0)
    } finally {
      resetMarkdownExportGateForTest()
    }
  }
})

test('pending-draft success: exporter waits for flush and proceeds exactly once', async () => {
  resetMarkdownExportGateForTest()
  const order: string[] = []
  const flushGate = deferred<boolean>()
  const exporterGate = deferred<boolean>()
  setMarkdownExportReadiness({
    isTrashView: () => false,
    currentNormalNoteId: () => 'note-1',
    flushCurrentDraft: () => {
      order.push('flush-start')
      return flushGate.promise.then((ok) => {
        order.push('flush-done')
        return ok
      })
    },
  })
  try {
    const pending = requestSingleNoteExport(() => {
      order.push('exporter')
      return exporterGate.promise
    })
    await tick()
    await tick()
    // Backend exporter must not be entered before the required flush succeeds.
    assert.deepEqual(order, ['flush-start'])
    flushGate.resolve(true)
    await tick()
    await tick()
    assert.deepEqual(order, ['flush-start', 'flush-done', 'exporter'])
    exporterGate.resolve(true)
    assert.equal(await pending, 'exported')
    assert.deepEqual(order, ['flush-start', 'flush-done', 'exporter'])
  } finally {
    resetMarkdownExportGateForTest()
  }
})

test('pending-draft failure prevents backend exporter invocation', async () => {
  resetMarkdownExportGateForTest()
  for (const flushResult of [false, 'throw'] as const) {
    let exporterCalls = 0
    setMarkdownExportReadiness({
      isTrashView: () => false,
      currentNormalNoteId: () => 'note-1',
      flushCurrentDraft: () => {
        if (flushResult === 'throw') {
          return Promise.reject(new Error('save failed'))
        }
        return Promise.resolve(false)
      },
    })
    try {
      const outcome = await requestSingleNoteExport(() => {
        exporterCalls += 1
        return Promise.resolve(true)
      })
      assert.equal(outcome, 'blocked')
      assert.equal(exporterCalls, 0)
    } finally {
      resetMarkdownExportGateForTest()
    }
  }
})

test('transition into Trash during flush blocks the stale export', async () => {
  resetMarkdownExportGateForTest()
  let trashView = false
  let exporterCalls = 0
  const flushGate = deferred<boolean>()
  // isTrashView reads the mutable flag, so a transition during the flush is
  // observable to the gate's post-flush admission re-check.
  setMarkdownExportReadiness({
    isTrashView: () => trashView,
    currentNormalNoteId: () => 'note-1',
    flushCurrentDraft: () =>
      flushGate.promise.then(() => {
        trashView = true
        return true
      }),
  })
  try {
    const pending = requestSingleNoteExport(() => {
      exporterCalls += 1
      return Promise.resolve(true)
    })
    await tick()
    flushGate.resolve(true)
    assert.equal(await pending, 'blocked')
    assert.equal(exporterCalls, 0)
  } finally {
    resetMarkdownExportGateForTest()
  }
})

test('hidden-sidebar normal note stays admitted: verdict uses no DOM', async () => {
  resetMarkdownExportGateForTest()
  // No sidebar element is mounted in this environment; admission must still
  // hold for a valid normal note and must not query the document.
  assert.equal(typeof document, 'undefined')
  let exporterCalls = 0
  setMarkdownExportReadiness({
    isTrashView: () => false,
    currentNormalNoteId: () => 'note-9',
    flushCurrentDraft: () => Promise.resolve(true),
  })
  try {
    assert.equal(
      await requestSingleNoteExport(() => {
        exporterCalls += 1
        return Promise.resolve(true)
      }),
      'exported',
    )
    assert.equal(exporterCalls, 1)
  } finally {
    resetMarkdownExportGateForTest()
  }
})

test('full-library export waits for the same durability boundary', async () => {
  resetMarkdownExportGateForTest()
  const order: string[] = []
  const flushGate = deferred<boolean>()
  setMarkdownExportReadiness({
    isTrashView: () => false,
    currentNormalNoteId: () => 'note-1',
    flushCurrentDraft: () => {
      order.push('flush')
      return flushGate.promise
    },
  })
  try {
    const pending = requestLibraryExport(() => {
      order.push('exporter')
      return Promise.resolve('/tmp/Flashnote Export')
    })
    await tick()
    await tick()
    assert.deepEqual(order, ['flush'])
    flushGate.resolve(true)
    assert.equal(await pending, '/tmp/Flashnote Export')
    assert.deepEqual(order, ['flush', 'exporter'])
  } finally {
    resetMarkdownExportGateForTest()
  }
})

test('full-library export failure never produces stale data as success', async () => {
  resetMarkdownExportGateForTest()
  for (const flushResult of [false, 'throw'] as const) {
    let exporterCalls = 0
    setMarkdownExportReadiness({
      isTrashView: () => false,
      currentNormalNoteId: () => 'note-1',
      flushCurrentDraft: () => {
        if (flushResult === 'throw') {
          return Promise.reject(new Error('save timed out'))
        }
        return Promise.resolve(false)
      },
    })
    try {
      await assert.rejects(() =>
        requestLibraryExport(() => {
          exporterCalls += 1
          return Promise.resolve('/tmp/Flashnote Export')
        }),
      )
      assert.equal(exporterCalls, 0)
    } finally {
      resetMarkdownExportGateForTest()
    }
  }
})

test('single-note export preserves in-flight single-flight behavior', async () => {
  resetMarkdownExportGateForTest()
  let flushCalls = 0
  let exporterCalls = 0
  const flushGate = deferred<boolean>()
  const exporterGate = deferred<boolean>()
  setMarkdownExportReadiness({
    isTrashView: () => false,
    currentNormalNoteId: () => 'note-1',
    flushCurrentDraft: () => {
      flushCalls += 1
      return flushGate.promise
    },
  })
  try {
    const first = requestSingleNoteExport(() => {
      exporterCalls += 1
      return exporterGate.promise
    })
    await tick()
    assert.equal(flushCalls, 1)
    assert.equal(await requestSingleNoteExport(() => Promise.resolve(true)), 'busy')
    assert.equal(flushCalls, 1)
    assert.equal(exporterCalls, 0)
    flushGate.resolve(true)
    await tick()
    await tick()
    assert.equal(exporterCalls, 1)
    exporterGate.resolve(true)
    assert.equal(await first, 'exported')
    // Reusable after the in-flight state clears.
    assert.equal(
      await requestSingleNoteExport(() => {
        exporterCalls += 1
        return Promise.resolve(true)
      }),
      'exported',
    )
    assert.equal(exporterCalls, 2)
  } finally {
    resetMarkdownExportGateForTest()
  }
})
