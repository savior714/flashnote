export type SidebarDragState = {
  noteID: string
  targetFolderID: string | null
}

export function clearSidebarDragState(): SidebarDragState {
  return { noteID: '', targetFolderID: null }
}
