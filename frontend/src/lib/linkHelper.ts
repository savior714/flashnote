import { Browser } from '@wailsio/runtime'

export type ExternalLinkOpener = (url: string) => Promise<void>

let testOpener: ExternalLinkOpener | null = null

export function setExternalLinkOpenerForTest(opener: ExternalLinkOpener | null) {
  testOpener = opener
}

/**
 * Normalizes user-entered or document link URLs into safe external web URLs.
 * Returns normalized URL string (e.g. 'https://example.com') or null if invalid/rejected.
 */
export function normalizeExternalUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Reject dangerous or non-web schemes explicitly before prepending https
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  let candidate = trimmed
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      return null
    }
  } else {
    // No scheme provided (e.g. "example.com" or "sub.domain.co/path")
    candidate = `https://${trimmed}`
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    // Must have a valid hostname (not empty, not relative like 'https:///foo')
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return null
    }
    // Return the normalized URL without altering user-provided path structure unnecessarily
    return candidate
  } catch {
    return null
  }
}

/**
 * Validates whether a given URL is an allowed external web URL.
 */
export function isValidExternalWebUrl(raw: string | undefined | null): boolean {
  return normalizeExternalUrl(raw) !== null
}

/**
 * Opens an external web URL in the user's default browser via Wails Browser.OpenURL.
 * Prevents default WebView navigation and validates protocol.
 */
export async function openExternalUrl(rawUrl: string): Promise<boolean> {
  const normalized = normalizeExternalUrl(rawUrl)
  if (!normalized) {
    return false
  }

  try {
    if (testOpener) {
      await testOpener(normalized)
    } else {
      await Browser.OpenURL(normalized)
    }
    return true
  } catch (error) {
    console.error('Flashnote failed to open external URL:', error)
    return false
  }
}
