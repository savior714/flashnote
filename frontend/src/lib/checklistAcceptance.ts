import type { Editor, JSONContent } from '@tiptap/core'
import { tick } from 'svelte'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nodeText(node: JSONContent): string {
  return `${node.text ?? ''}${(node.content ?? []).map(nodeText).join('')}`
}

function checklistSnapshot(editor: Editor, acceptanceText: string) {
  const document = editor.getJSON()
  const taskListIndex = document.content?.findIndex(
    (node) => node.type === 'taskList' && nodeText(node).includes(acceptanceText),
  ) ?? -1
  const taskList = taskListIndex >= 0 ? document.content?.[taskListIndex] : undefined
  const items = taskList?.content ?? []

  if (taskList?.type !== 'taskList' || items.length !== 2) {
    throw new Error('acceptance checklist: expected one two-item task list fixture')
  }

  const texts = items.map(nodeText)
  const checked = items.map((item) => item.attrs?.checked)
  for (const item of items) {
    const attributeKeys = Object.keys(item.attrs ?? {}).sort()
    if (attributeKeys.length !== 1 || attributeKeys[0] !== 'checked') {
      throw new Error(`acceptance checklist: task item gained non-checked attributes: ${JSON.stringify(item.attrs)}`)
    }
  }

  return { taskListIndex, texts, checked }
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '.prose-editor li[data-type="taskItem"] input[type="checkbox"]',
    ),
  )
}

function assertStableStructure(
  snapshot: ReturnType<typeof checklistSnapshot>,
  taskListIndex: number,
  texts: string[],
) {
  if (snapshot.taskListIndex !== taskListIndex) {
    throw new Error('acceptance checklist: toggling reordered the task list')
  }
  if (JSON.stringify(snapshot.texts) !== JSON.stringify(texts)) {
    throw new Error('acceptance checklist: toggling reordered, hid, or changed task item text')
  }
}

export async function runChecklistInteractionAcceptance(
  editor: Editor,
  acceptanceText: string,
): Promise<void> {
  try {
    const initial = checklistSnapshot(editor, acceptanceText)
    if (
      initial.texts[0] !== acceptanceText ||
      initial.texts[1] !== 'Completed checklist item' ||
      initial.checked[0] !== false ||
      initial.checked[1] !== true
    ) {
      throw new Error(`acceptance checklist: unexpected initial fixture ${JSON.stringify(initial)}`)
    }

    let controls = checkboxes()
    if (controls.length !== 2 || controls[0].checked || !controls[1].checked) {
      throw new Error('acceptance checklist: rendered checkbox state does not match document state')
    }

    controls[0].click()
    await tick()
    await delay(30)

    const afterFirstToggle = checklistSnapshot(editor, acceptanceText)
    assertStableStructure(afterFirstToggle, initial.taskListIndex, initial.texts)
    if (afterFirstToggle.checked[0] !== true || afterFirstToggle.checked[1] !== true) {
      throw new Error('acceptance checklist: first checkbox click did not update only its checked state')
    }

    controls = checkboxes()
    const taskItemsAfterFirst = Array.from(
      document.querySelectorAll<HTMLElement>('.prose-editor li[data-type="taskItem"]'),
    )
    if (
      controls.length !== 2 ||
      !controls[0].checked ||
      !controls[1].checked ||
      taskItemsAfterFirst[0]?.dataset.checked !== 'true' ||
      taskItemsAfterFirst[1]?.dataset.checked !== 'true'
    ) {
      throw new Error('acceptance checklist: visual checked state did not follow the document after first toggle')
    }

    controls[1].click()
    await tick()
    await delay(30)

    const final = checklistSnapshot(editor, acceptanceText)
    assertStableStructure(final, initial.taskListIndex, initial.texts)
    if (final.checked[0] !== true || final.checked[1] !== false) {
      throw new Error('acceptance checklist: second checkbox click did not update only its checked state')
    }

    controls = checkboxes()
    const finalTaskItems = Array.from(
      document.querySelectorAll<HTMLElement>('.prose-editor li[data-type="taskItem"]'),
    )
    if (
      controls.length !== 2 ||
      !controls[0].checked ||
      controls[1].checked ||
      finalTaskItems[0]?.dataset.checked !== 'true' ||
      finalTaskItems[1]?.dataset.checked !== 'false'
    ) {
      throw new Error('acceptance checklist: final visual state diverged from document state')
    }

    console.log('FLASHNOTE_CHECKLIST_INTERACTION_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_CHECKLIST_INTERACTION_ACCEPTANCE_FAILURE', error)
    throw error
  }
}
