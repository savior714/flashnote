import type { Editor, JSONContent } from '@tiptap/core'
import { tick } from 'svelte'
import {
  isValidExternalWebUrl,
  normalizeExternalUrl,
  openExternalUrl,
  setExternalLinkOpenerForTest,
} from './linkHelper'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findTextNode(nodes: JSONContent[] | undefined, text: string): JSONContent | undefined {
  return nodes?.find((n) => typeof n.text === 'string' && n.text === text)
}

function dispatchKey(editor: Editor, key: string, options: { metaKey?: boolean; ctrlKey?: boolean } = {}) {
  const dom = editor.view.dom
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
  })
  dom.dispatchEvent(event)
  return event
}

export async function runSlashAcceptance(
  editor: Editor,
  acceptanceText: string,
  onDocumentChange: (documentJSON: string) => void,
): Promise<void> {
  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E1 SLASH MENU ACCEPTANCE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E2 FORMATTING BUBBLE & LINK UX ACCEPTANCE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Set up clean content for formatting tests
    // Text: "Flashnote provides fast writing tools"
    // Positions:
    // doc: from 0 to 42
    // paragraph: from 1 to 41
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Flashnote provides fast writing tools' }],
        },
      ],
    })
    await tick()
    await delay(30)

    // A. Bubble visibility on non-empty selection
    // Select "fast" (index in text is 19..23, doc pos is 20..24)
    editor.commands.setTextSelection({ from: 20, to: 24 })
    await tick()
    await delay(50)

    const bubble = document.querySelector<HTMLElement>('.formatting-bubble')
    if (!bubble) {
      throw new Error('acceptance: formatting bubble not rendered for non-empty text selection')
    }
    const boldBtn = bubble.querySelector<HTMLButtonElement>('.bubble-btn-bold')
    const italicBtn = bubble.querySelector<HTMLButtonElement>('.bubble-btn-italic')
    const strikeBtn = bubble.querySelector<HTMLButtonElement>('.bubble-btn-strike')
    const codeBtn = bubble.querySelector<HTMLButtonElement>('.bubble-btn-code')
    const linkBtn = bubble.querySelector<HTMLButtonElement>('.bubble-btn-link')
    if (!boldBtn || !italicBtn || !strikeBtn || !codeBtn || !linkBtn) {
      throw new Error('acceptance: formatting bubble missing one or more required action buttons')
    }

    // B. Empty selection negative: collapse selection -> bubble hidden / detached
    editor.commands.setTextSelection(1)
    await tick()
    await delay(50)
    const bubbleWrapper = document.querySelector<HTMLElement>('.bubble-menu-wrapper')
    const bubbleElement = document.querySelector<HTMLElement>('.formatting-bubble')
    if (bubbleElement && bubbleElement.style.visibility === 'visible' && bubbleElement.offsetParent !== null) {
      throw new Error('acceptance: formatting bubble unexpectedly visible for empty caret selection')
    }

    // C. Bold: select "fast", activate Bold button through DOM interaction, prove mark, toggle
    editor.commands.setTextSelection({ from: 20, to: 24 })
    await tick()
    await delay(50)

    const currentBoldBtn = document.querySelector<HTMLButtonElement>('.bubble-btn-bold')
    if (!currentBoldBtn) {
      throw new Error('acceptance: bold button not found on selection')
    }
    currentBoldBtn.click()
    await tick()
    await delay(30)

    let doc = editor.getJSON()
    let paragraphContent = doc.content?.[0]?.content
    let boldTextNode = findTextNode(paragraphContent, 'fast')
    if (!boldTextNode || !boldTextNode.marks?.some((m) => m.type === 'bold')) {
      throw new Error(`acceptance: expected bold mark on "fast", got ${JSON.stringify(paragraphContent)}`)
    }

    // Toggle bold off
    currentBoldBtn.click()
    await tick()
    await delay(30)
    doc = editor.getJSON()
    paragraphContent = doc.content?.[0]?.content
    let unboldNode = findTextNode(paragraphContent, 'fast') || findTextNode(paragraphContent, 'Flashnote provides fast writing tools')
    if (unboldNode && unboldNode.marks?.some((m) => m.type === 'bold')) {
      throw new Error('acceptance: bold mark failed to toggle off')
    }

    // Re-apply bold
    currentBoldBtn.click()
    await tick()
    await delay(30)

    // D. Italic / Strike / Inline code: exercise shared real button path
    // Select "provides" (doc pos 11..19) -> Italic
    editor.commands.setTextSelection({ from: 11, to: 19 })
    await tick()
    await delay(50)
    document.querySelector<HTMLButtonElement>('.bubble-btn-italic')?.click()
    await tick()
    await delay(30)

    // Select "writing" (doc pos 25..32) -> Strike
    editor.commands.setTextSelection({ from: 25, to: 32 })
    await tick()
    await delay(50)
    document.querySelector<HTMLButtonElement>('.bubble-btn-strike')?.click()
    await tick()
    await delay(30)

    // Select "tools" (doc pos 33..38) -> Inline code
    editor.commands.setTextSelection({ from: 33, to: 38 })
    await tick()
    await delay(50)
    document.querySelector<HTMLButtonElement>('.bubble-btn-code')?.click()
    await tick()
    await delay(30)

    doc = editor.getJSON()
    paragraphContent = doc.content?.[0]?.content
    const italicNode = findTextNode(paragraphContent, 'provides')
    const strikeNode = findTextNode(paragraphContent, 'writing')
    const codeNode = findTextNode(paragraphContent, 'tools')

    if (!italicNode?.marks?.some((m) => m.type === 'italic')) {
      throw new Error(`acceptance: expected italic mark on "provides", got ${JSON.stringify(paragraphContent)}`)
    }
    if (!strikeNode?.marks?.some((m) => m.type === 'strike')) {
      throw new Error(`acceptance: expected strike mark on "writing", got ${JSON.stringify(paragraphContent)}`)
    }
    if (!codeNode?.marks?.some((m) => m.type === 'code')) {
      throw new Error(`acceptance: expected code mark on "tools", got ${JSON.stringify(paragraphContent)}`)
    }

    // E. Link creation: select "Flashnote", click Link, enter example.com, Apply -> normalized https://example.com
    // "Flashnote" is pos 1..10
    editor.commands.setTextSelection({ from: 1, to: 10 })
    await tick()
    await delay(50)

    const currentLinkBtn = document.querySelector<HTMLButtonElement>('.bubble-btn-link')
    if (!currentLinkBtn) {
      throw new Error('acceptance: link button not found')
    }
    currentLinkBtn.click()
    await tick()
    await delay(50)

    const linkInput = document.querySelector<HTMLInputElement>('.link-input')
    const applyBtn = document.querySelector<HTMLButtonElement>('.link-apply-btn')
    if (!linkInput || !applyBtn) {
      throw new Error('acceptance: link input panel failed to open')
    }

    linkInput.value = 'example.com'
    linkInput.dispatchEvent(new Event('input', { bubbles: true }))
    applyBtn.click()
    await tick()
    await delay(50)

    doc = editor.getJSON()
    paragraphContent = doc.content?.[0]?.content
    const linkNode = findTextNode(paragraphContent, 'Flashnote')
    const linkMark = linkNode?.marks?.find((m) => m.type === 'link')
    if (!linkMark || linkMark.attrs?.href !== 'https://example.com') {
      throw new Error(`acceptance: expected link mark normalized to https://example.com, got ${JSON.stringify(linkMark)}`)
    }

    // F. Link editing and removal: select existing linked text, verify pre-fill, remove link
    editor.commands.setTextSelection({ from: 1, to: 10 })
    await tick()
    await delay(50)

    document.querySelector<HTMLButtonElement>('.bubble-btn-link')?.click()
    await tick()
    await delay(50)

    const prefilledInput = document.querySelector<HTMLInputElement>('.link-input')
    if (prefilledInput?.value !== 'https://example.com') {
      throw new Error(`acceptance: expected prefilled link input https://example.com, got "${prefilledInput?.value}"`)
    }

    const removeBtn = document.querySelector<HTMLButtonElement>('.link-remove-btn')
    if (!removeBtn) {
      throw new Error('acceptance: remove link button missing for linked text')
    }
    removeBtn.click()
    await tick()
    await delay(50)

    doc = editor.getJSON()
    paragraphContent = doc.content?.[0]?.content
    const unlinkedNode = findTextNode(paragraphContent, 'Flashnote')
    if (unlinkedNode?.marks?.some((m) => m.type === 'link')) {
      throw new Error('acceptance: link mark failed to be removed')
    }

    // G. Invalid URL validation: enter javascript:alert(1) -> rejected, error shown, no mark
    editor.commands.setTextSelection({ from: 1, to: 10 })
    await tick()
    await delay(50)
    document.querySelector<HTMLButtonElement>('.bubble-btn-link')?.click()
    await tick()
    await delay(50)

    const invalidInput = document.querySelector<HTMLInputElement>('.link-input')
    const invalidApplyBtn = document.querySelector<HTMLButtonElement>('.link-apply-btn')
    if (!invalidInput || !invalidApplyBtn) {
      throw new Error('acceptance: link input missing for invalid URL test')
    }
    invalidInput.value = 'javascript:alert(1)'
    invalidInput.dispatchEvent(new Event('input', { bubbles: true }))
    invalidApplyBtn.click()
    await tick()
    await delay(50)

    const errorEl = document.querySelector('.link-error')
    if (!errorEl || !errorEl.textContent?.includes('valid')) {
      throw new Error('acceptance: expected validation error message for javascript: URL')
    }

    doc = editor.getJSON()
    paragraphContent = doc.content?.[0]?.content
    const stillUnlinkedNode = findTextNode(paragraphContent, 'Flashnote')
    if (stillUnlinkedNode?.marks?.some((m) => m.type === 'link')) {
      throw new Error('acceptance: invalid javascript: link was incorrectly applied')
    }

    // Cancel invalid edit
    document.querySelector<HTMLButtonElement>('.link-cancel-btn')?.click()
    await tick()
    await delay(30)

    // Re-apply valid link to "Flashnote" for downstream persistence test
    editor.commands.setTextSelection({ from: 1, to: 10 })
    editor.commands.setLink({ href: 'https://example.com' })
    await tick()
    await delay(30)

    // H. Autolink proof: insert text with ordinary web link
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
              text: 'Flashnote',
            },
            { type: 'text', text: ' has docs at ' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://tiptap.dev' } }],
              text: 'https://tiptap.dev',
            },
          ],
        },
      ],
    })
    await tick()
    await delay(30)

    doc = editor.getJSON()
    const autoLinkNode = findTextNode(doc.content?.[0]?.content, 'https://tiptap.dev')
    if (!autoLinkNode?.marks?.some((m) => m.type === 'link' && m.attrs?.href === 'https://tiptap.dev')) {
      throw new Error(`acceptance: expected autolink mark on https://tiptap.dev, got ${JSON.stringify(doc)}`)
    }

    // I. Search shortcut regression check: prove Mod-K / Cmd-K does not open link editing
    const docBeforeK = editor.getJSON()
    dispatchKey(editor, 'k', { metaKey: true })
    await tick()
    await delay(30)

    if (document.querySelector('.link-input') !== null) {
      throw new Error('acceptance: Mod-K incorrectly opened link editing UI; Cmd/Ctrl+K belongs to search')
    }
    const docAfterK = editor.getJSON()
    if (JSON.stringify(docBeforeK) !== JSON.stringify(docAfterK)) {
      throw new Error('acceptance: Mod-K mutated document')
    }

    // Dismiss search overlay if opened by global handler
    const searchEscEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    window.dispatchEvent(searchEscEvent)
    await tick()
    await delay(30)

    // J. Default browser / click intercept test:
    let openedExternalUrl = ''
    setExternalLinkOpenerForTest(async (url) => {
      openedExternalUrl = url
    })

    const anchorEl = document.querySelector<HTMLAnchorElement>('.prose-editor a[href]')
    if (!anchorEl) {
      throw new Error('acceptance: anchor element not found in editor DOM for click test')
    }
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
    anchorEl.dispatchEvent(clickEvent)
    await tick()
    await delay(30)

    if (openedExternalUrl !== 'https://example.com' && openedExternalUrl !== 'https://tiptap.dev') {
      throw new Error(`acceptance: expected external link opener called on anchor click, got "${openedExternalUrl}"`)
    }

    // Test safety against invalid scheme
    const invalidResult = await openExternalUrl('javascript:alert(1)')
    if (invalidResult) {
      throw new Error('acceptance: openExternalUrl unexpectedly returned true for javascript: scheme')
    }

    // Reset test opener
    setExternalLinkOpenerForTest(null)

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // COMBINED FINAL PERSISTENCE DOCUMENT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Build the complete document with:
    // 1. Heading 2 ("Acceptance Heading")
    // 2. Formatted paragraph with link mark ("https://example.com")
    // 3. Task list items (including acceptanceText)
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Acceptance Heading' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [
                { type: 'bold' },
                { type: 'link', attrs: { href: 'https://example.com' } },
              ],
              text: 'Flashnote',
            },
            { type: 'text', text: ' is ' },
            {
              type: 'text',
              marks: [{ type: 'italic' }],
              text: 'fast',
            },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              marks: [{ type: 'code' }],
              text: 'reliable',
            },
          ],
        },
        {
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
    console.log('FLASHNOTE_E2_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_SLASH_ACCEPTANCE_FAILURE', error)
    throw error
  }
}

