import type { Editor } from '@tiptap/core'
import { tick } from 'svelte'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dispatchKey(editor: Editor, key: string) {
  const dom = editor.view.dom
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  dom.dispatchEvent(event)
}

export async function runSlashAcceptance(
  editor: Editor,
  acceptanceText: string,
  onDocumentChange: (documentJSON: string) => void,
): Promise<void> {
  try {
    // 1. Negative trigger: "ordinary text /" should not open slash menu
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'ordinary text ' }],
        },
      ],
    })
    editor.commands.focus('end')
    editor.commands.insertContent('/')
    await tick()
    await delay(30)

    if (document.querySelector('.slash-menu') !== null) {
      throw new Error('acceptance: slash menu unexpectedly opened after non-leading text')
    }

    // 2. Negative trigger: "/" inside a non-paragraph block (codeBlock) should not open slash menu
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          content: [],
        },
      ],
    })
    editor.commands.focus('start')
    editor.commands.insertContent('/')
    await tick()
    await delay(30)

    if (document.querySelector('.slash-menu') !== null) {
      throw new Error('acceptance: slash menu unexpectedly opened inside code block')
    }

    // 3. Positive trigger: "/" at the start of an empty paragraph opens SlashMenu with all 10 items
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    editor.commands.focus('start')
    editor.commands.insertContent('/')
    await tick()
    await delay(30)

    const menu = document.querySelector<HTMLElement>('.slash-menu')
    if (!menu) {
      throw new Error('acceptance: slash menu failed to open on "/" trigger')
    }
    const items = menu.querySelectorAll('.slash-menu-item')
    if (items.length !== 10) {
      throw new Error(`acceptance: expected 10 slash items on trigger, got ${items.length}`)
    }
    const initialSelected = menu.querySelector('.slash-menu-item.is-selected')
    if (!initialSelected || initialSelected.textContent?.trim() !== 'Text') {
      throw new Error(`acceptance: expected "Text" selected initially, got "${initialSelected?.textContent?.trim()}"`)
    }

    // 4. Filtering: typing "hea" filters menu to Heading 1, Heading 2, Heading 3
    editor.commands.insertContent('hea')
    await tick()
    await delay(30)

    const filteredItems = document.querySelectorAll('.slash-menu-item')
    if (filteredItems.length !== 3) {
      throw new Error(`acceptance: expected 3 items for /hea query, got ${filteredItems.length}`)
    }
    const labels = Array.from(filteredItems).map((el) => el.textContent?.trim())
    if (!labels.includes('Heading 1') || !labels.includes('Heading 2') || !labels.includes('Heading 3')) {
      throw new Error(`acceptance: expected Heading 1/2/3 in filtered menu, got ${JSON.stringify(labels)}`)
    }

    // 5. Keyboard navigation: ArrowDown -> select Heading 2
    dispatchKey(editor, 'ArrowDown')
    await tick()
    await delay(30)

    let selected = document.querySelector('.slash-menu-item.is-selected')
    if (selected?.textContent?.trim() !== 'Heading 2') {
      throw new Error(`acceptance: expected "Heading 2" selected after ArrowDown, got "${selected?.textContent?.trim()}"`)
    }

    // ArrowUp -> select Heading 1
    dispatchKey(editor, 'ArrowUp')
    await tick()
    await delay(30)

    selected = document.querySelector('.slash-menu-item.is-selected')
    if (selected?.textContent?.trim() !== 'Heading 1') {
      throw new Error(`acceptance: expected "Heading 1" selected after ArrowUp, got "${selected?.textContent?.trim()}"`)
    }

    // Escape -> dismiss menu without document mutation
    dispatchKey(editor, 'Escape')
    await tick()
    await delay(30)

    if (document.querySelector('.slash-menu') !== null) {
      throw new Error('acceptance: slash menu remained open after Escape')
    }
    const docAfterEscape = editor.getJSON()
    const firstNode = docAfterEscape.content?.[0]
    if (firstNode?.type !== 'paragraph') {
      throw new Error(`acceptance: expected paragraph after Escape, got node type "${firstNode?.type}"`)
    }

    // 6. Execution: reopen /hea, navigate to Heading 2, press Enter
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    editor.commands.focus('start')
    editor.commands.insertContent('/hea')
    await tick()
    await delay(30)

    if (!document.querySelector('.slash-menu')) {
      throw new Error('acceptance: slash menu failed to reopen for execution step')
    }

    // ArrowDown to select Heading 2
    dispatchKey(editor, 'ArrowDown')
    await tick()
    await delay(30)

    selected = document.querySelector('.slash-menu-item.is-selected')
    if (selected?.textContent?.trim() !== 'Heading 2') {
      throw new Error(`acceptance: expected "Heading 2" selected before Enter, got "${selected?.textContent?.trim()}"`)
    }

    // Enter to execute Heading 2
    dispatchKey(editor, 'Enter')
    await tick()
    await delay(30)

    if (document.querySelector('.slash-menu') !== null) {
      throw new Error('acceptance: slash menu remained open after Enter execution')
    }

    const docAfterExec = editor.getJSON()
    const headingNode = docAfterExec.content?.[0]
    if (headingNode?.type !== 'heading' || headingNode.attrs?.level !== 2) {
      throw new Error(`acceptance: expected heading level 2 node after execution, got ${JSON.stringify(headingNode)}`)
    }
    const docText = editor.getText()
    if (docText.includes('/hea') || docText.includes('/')) {
      throw new Error(`acceptance: expected slash query to be removed, but text was "${docText}"`)
    }

    // Insert heading text so the heading block remains populated
    editor.commands.insertContent('Acceptance Heading')

    // 7. Append task list content so existing downstream acceptance round trip succeeds
    editor.commands.insertContent({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: acceptanceText }],
            },
          ],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Completed checklist item' }],
            },
          ],
        },
      ],
    })

    onDocumentChange(
      JSON.stringify({
        schemaVersion: 1,
        doc: editor.getJSON(),
      }),
    )

    console.log('FLASHNOTE_SLASH_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_SLASH_ACCEPTANCE_FAILURE', error)
    throw error
  }
}
