import { writable } from 'svelte/store'
import type { ResolvedLanguage } from './settings'

// The database node view is mounted by Tiptap, outside the component tree that
// owns the resolved language. This one small store is how the resolved language
// reaches it: the editor sets it, the node view reads it, and no second locale
// owner is created.
export const databaseLanguage = writable<ResolvedLanguage>('en')

export function setDatabaseLanguage(language: ResolvedLanguage): void {
  databaseLanguage.set(language)
}
