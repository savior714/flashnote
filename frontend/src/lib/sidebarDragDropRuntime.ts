import { MoveNote } from '../../bindings/github.com/savior714/flashnote/appservice'

export async function moveSidebarNote(noteID: string, folderID: string): Promise<void> {
  await MoveNote(noteID, folderID)
}
