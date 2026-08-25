export type AppearanceMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface Settings {
  appearance: AppearanceMode
  editorFontSize: number
  spellcheck: boolean
}

export const MIN_FONT_SIZE = 14
export const MAX_FONT_SIZE = 22
export const DEFAULT_FONT_SIZE = 16

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  editorFontSize: DEFAULT_FONT_SIZE,
  spellcheck: true,
}

export const SETTINGS_STORAGE_KEY = 'flashnote:settings:v1'

export function sanitizeAppearance(value: unknown): AppearanceMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value
  }
  return DEFAULT_SETTINGS.appearance
}

export function sanitizeFontSize(value: unknown): number {
  if (typeof value === 'number' && !isNaN(value)) {
    const rounded = Math.round(value)
    return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, rounded))
  }
  return DEFAULT_FONT_SIZE
}

export function sanitizeSpellcheck(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return DEFAULT_SETTINGS.spellcheck
}

export function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_SETTINGS }
    }
    const parsed = JSON.parse(raw) as Partial<Settings>
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_SETTINGS }
    }
    return {
      appearance: sanitizeAppearance(parsed.appearance),
      editorFontSize: sanitizeFontSize(parsed.editorFontSize),
      spellcheck: sanitizeSpellcheck(parsed.spellcheck),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    const sanitized: Settings = {
      appearance: sanitizeAppearance(settings.appearance),
      editorFontSize: sanitizeFontSize(settings.editorFontSize),
      spellcheck: sanitizeSpellcheck(settings.spellcheck),
    }
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitized))
  } catch {
    // Fail safely without disrupting user workflow
  }
}

export function resolveTheme(appearance: AppearanceMode): ResolvedTheme {
  if (appearance === 'light') {
    return 'light'
  }
  if (appearance === 'dark') {
    return 'dark'
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function applyTheme(appearance: AppearanceMode): ResolvedTheme {
  const resolved = resolveTheme(appearance)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = resolved
  }
  return resolved
}

export function applyEditorFontSize(fontSize: number): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    const clamped = sanitizeFontSize(fontSize)
    document.documentElement.style.setProperty('--editor-font-size', `${clamped}px`)
  }
}

let systemThemeListenerCleanup: (() => void) | null = null

export function initSettingsListener(
  getAppearance: () => AppearanceMode,
  onResolvedChange?: (resolved: ResolvedTheme) => void,
): () => void {
  if (systemThemeListenerCleanup) {
    systemThemeListenerCleanup()
    systemThemeListenerCleanup = null
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = () => {
    if (getAppearance() === 'system') {
      const resolved = applyTheme('system')
      onResolvedChange?.(resolved)
    }
  }

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener)
    systemThemeListenerCleanup = () => {
      mediaQuery.removeEventListener('change', listener)
    }
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(listener)
    systemThemeListenerCleanup = () => {
      mediaQuery.removeListener(listener)
    }
  }

  return () => {
    if (systemThemeListenerCleanup) {
      systemThemeListenerCleanup()
      systemThemeListenerCleanup = null
    }
  }
}
