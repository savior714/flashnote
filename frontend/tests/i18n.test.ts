import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMessages,
  normalizeLanguageTag,
  presentNoteTitle,
  resolveLanguage,
  systemLanguageTag,
} from '../src/lib/i18n.ts'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from '../src/lib/settings.ts'

class MemoryStorage {
  private values = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value)
    }
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values)
  }
}

function installStorage(t: test.TestContext, storage = new MemoryStorage()): MemoryStorage {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  t.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, 'localStorage', previous)
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })
  return storage
}

test('missing language preference defaults to system without changing existing settings', (t) => {
  const storage = installStorage(t)
  storage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ appearance: 'dark', editorFontSize: 19 }),
  )

  assert.deepEqual(loadSettings(), {
    appearance: 'dark',
    editorFontSize: 19,
    language: 'system',
  })
})

test('malformed legacy settings use backward-compatible defaults', (t) => {
  const storage = installStorage(t)
  storage.setItem(SETTINGS_STORAGE_KEY, '{invalid')

  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS)
})

test('system language resolves Korean and English BCP 47 prefixes', () => {
  assert.equal(resolveLanguage('system', 'ko'), 'ko')
  assert.equal(resolveLanguage('system', 'ko-KR'), 'ko')
  assert.equal(resolveLanguage('system', 'en'), 'en')
  assert.equal(resolveLanguage('system', 'en-US'), 'en')
  assert.equal(resolveLanguage('system', 'en-GB'), 'en')
})

test('system language comes from the WebView navigator preference', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['ko-KR', 'en-US'], language: 'en-US' },
  })
  t.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, 'navigator', previous)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  })

  assert.equal(systemLanguageTag(), 'ko-KR')
  assert.equal(resolveLanguage('system'), 'ko')
})

test('unsupported or unavailable system language falls back to English', () => {
  assert.equal(normalizeLanguageTag('fr-FR'), 'en')
  assert.equal(normalizeLanguageTag('ja-JP'), 'en')
  assert.equal(resolveLanguage('system', null), 'en')
})

test('explicit language preference overrides the system language', () => {
  assert.equal(resolveLanguage('ko', 'en-US'), 'ko')
  assert.equal(resolveLanguage('en', 'ko-KR'), 'en')
})

test('language and existing settings persist and read back after storage restart', (t) => {
  const storage = installStorage(t)
  saveSettings({ appearance: 'light', editorFontSize: 18, language: 'ko' })
  const saved = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
  assert.equal(saved.language, 'ko')

  const restartedStorage = new MemoryStorage(storage.snapshot())
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: restartedStorage,
  })
  assert.deepEqual(loadSettings(), {
    appearance: 'light',
    editorFontSize: 18,
    language: 'ko',
  })
  assert.equal(restartedStorage.getItem(SETTINGS_STORAGE_KEY), storage.getItem(SETTINGS_STORAGE_KEY))
})

test('generated empty title is localized while authored Untitled remains user data', () => {
  assert.equal(presentNoteTitle('Untitled', true, 'ko'), '제목 없음')
  assert.equal(presentNoteTitle('Untitled', false, 'ko'), 'Untitled')
  assert.equal(presentNoteTitle('Untitled', true, 'en'), 'Untitled')
  assert.equal(getMessages('ko').sidebar.newNote, '새 노트')
})
