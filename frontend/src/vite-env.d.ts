/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FLASHNOTE_ACCEPTANCE_TEXT?: string
  readonly VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
