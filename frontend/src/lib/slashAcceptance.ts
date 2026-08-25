import type { Editor, JSONContent } from '@tiptap/core'
import { tick } from 'svelte'
import {
  isValidExternalWebUrl,
  normalizeExternalUrl,
  openExternalUrl,
  setExternalLinkOpenerForTest,
} from './linkHelper'
import { dispatchPasteEvent, runRichPasteAcceptance } from './richPasteAcceptance'

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

    // A. Initial bubble visibility negative proof: before any non-empty selection, bubble is NOT visually exposed
    const initialBubbleWrapper = document.querySelector<HTMLElement>('.bubble-menu-wrapper')
    if (initialBubbleWrapper && initialBubbleWrapper.isConnected) {
      const computedInitial = window.getComputedStyle(initialBubbleWrapper)
      if (computedInitial.visibility !== 'hidden' || computedInitial.opacity !== '0') {
        throw new Error(
          `acceptance: initial bubble wrapper visually exposed before selection (visibility=${computedInitial.visibility}, opacity=${computedInitial.opacity})`,
        )
      }
    }

    // B. Bubble visibility on non-empty selection: select "fast" (doc pos 20..24)
    editor.commands.setTextSelection({ from: 20, to: 24 })
    await tick()
    await delay(50)

    const bubbleWrapper = document.querySelector<HTMLElement>('.bubble-menu-wrapper')
    if (!bubbleWrapper || !bubbleWrapper.isConnected) {
      throw new Error('acceptance: bubble menu wrapper not connected on non-empty selection')
    }
    const computedBubble = window.getComputedStyle(bubbleWrapper)
    if (computedBubble.visibility !== 'visible' || computedBubble.opacity !== '1') {
      throw new Error(
        `acceptance: bubble menu wrapper not visibly shown on non-empty selection (visibility=${computedBubble.visibility}, opacity=${computedBubble.opacity})`,
      )
    }

    const boldBtn = bubbleWrapper.querySelector<HTMLButtonElement>('.bubble-btn-bold')
    const italicBtn = bubbleWrapper.querySelector<HTMLButtonElement>('.bubble-btn-italic')
    const strikeBtn = bubbleWrapper.querySelector<HTMLButtonElement>('.bubble-btn-strike')
    const codeBtn = bubbleWrapper.querySelector<HTMLButtonElement>('.bubble-btn-code')
    const linkBtn = bubbleWrapper.querySelector<HTMLButtonElement>('.bubble-btn-link')
    if (!boldBtn || !italicBtn || !strikeBtn || !codeBtn || !linkBtn) {
      throw new Error('acceptance: formatting bubble missing one or more required action buttons')
    }

    // C. Empty selection negative: collapse selection -> bubble hidden / detached
    editor.commands.setTextSelection(1)
    await tick()
    await delay(50)
    const collapsedWrapper = document.querySelector<HTMLElement>('.bubble-menu-wrapper')
    if (collapsedWrapper && collapsedWrapper.isConnected) {
      const computedCollapsed = window.getComputedStyle(collapsedWrapper)
      if (computedCollapsed.visibility !== 'hidden' || computedCollapsed.opacity !== '0') {
        throw new Error('acceptance: formatting bubble unexpectedly visible for empty caret selection')
      }
    }

    // D. Bold: select "fast", activate Bold button through DOM interaction, prove mark, toggle
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

    // E. Italic / Strike / Inline code: exercise shared real button path
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

    // F. Link creation: select "Flashnote", click Link, enter example.com, Apply -> normalized https://example.com
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

    // G. Link editing and removal: select existing linked text, verify pre-fill, remove link
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

    // H. Invalid URL validation: enter javascript:alert(1) -> rejected, error shown, no mark
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

    // I. REAL autolink proof: start from plain unmarked paragraph and insert URL text with trailing delimiter
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
          ],
        },
      ],
    })
    editor.commands.focus('end')
    editor.commands.insertContent('https://tiptap.dev ')
    await tick()
    await delay(50)

    doc = editor.getJSON()
    const autoLinkParagraphNodes = doc.content?.[0]?.content
    const autoLinkNode = findTextNode(autoLinkParagraphNodes, 'https://tiptap.dev')
    if (!autoLinkNode?.marks?.some((m) => m.type === 'link' && m.attrs?.href === 'https://tiptap.dev')) {
      throw new Error(`acceptance: expected real autolink mark generated on https://tiptap.dev, got ${JSON.stringify(autoLinkParagraphNodes)}`)
    }

    // J. Search shortcut regression check: prove Mod-K / Cmd-K does not open link editing
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

    // K. Default browser / click intercept test:
    const openedCalls: string[] = []
    setExternalLinkOpenerForTest(async (url) => {
      openedCalls.push(url)
    })
    try {
      const anchorEl = document.querySelector<HTMLAnchorElement>('.prose-editor a[href]')
      if (!anchorEl) {
        throw new Error('acceptance: anchor element not found in editor DOM for click test')
      }
      const docBeforeClick = JSON.stringify(editor.getJSON())
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      })
      anchorEl.dispatchEvent(clickEvent)
      await tick()
      await delay(30)

      if (!clickEvent.defaultPrevented) {
        throw new Error('acceptance: anchor click event was not default-prevented')
      }
      if (openedCalls.length !== 1) {
        throw new Error(`acceptance: expected exactly 1 external opener call, got ${openedCalls.length} (${JSON.stringify(openedCalls)})`)
      }
      const expectedHref = anchorEl.getAttribute('href')
      if (openedCalls[0] !== expectedHref) {
        throw new Error(`acceptance: expected opener called with ${expectedHref}, got ${openedCalls[0]}`)
      }
      const docAfterClick = JSON.stringify(editor.getJSON())
      if (docBeforeClick !== docAfterClick) {
        throw new Error('acceptance: anchor click unexpectedly mutated editor document')
      }

      // Prove invalid schemes never reach the opener
      const openerCountBefore = openedCalls.length
      const invalidResult = await openExternalUrl('javascript:alert(1)')
      if (invalidResult || openedCalls.length !== openerCountBefore) {
        throw new Error('acceptance: openExternalUrl unexpectedly called opener for javascript: scheme')
      }
    } finally {
      setExternalLinkOpenerForTest(null)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // E3 RICH PASTE NORMALIZATION ACCEPTANCE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    await runRichPasteAcceptance(editor)

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // COMBINED FINAL PERSISTENCE DOCUMENT VIA REAL RICH PASTE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Construct the canonical persisted fixture through REAL ClipboardEvent paste
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    editor.commands.focus('start')
    await tick()
    await delay(30)

    dispatchPasteEvent(editor, {
      html: `
        <h2 class="legacy-h2" style="color: blue; font-size: 32px">Acceptance Heading</h2>
        <p class="source-p" style="margin: 20px">
          <strong style="font-weight: 700"><a href="example.com" class="link-styled" style="color: red">Flashnote</a></strong> is
          <em>fast</em>,
          <del style="text-decoration: line-through">slow</del>, and
          <code>reliable</code>.
        </p>
        <table class="data-table" style="border: 1px solid black">
          <thead>
            <tr><th>Feature</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr><td>Rich Paste</td><td>Normalized</td></tr>
          </tbody>
        </table>
      `,
      text: 'Acceptance Heading\nFlashnote is fast, slow, and reliable.\nFeature | Status\nRich Paste | Normalized',
    })
    await tick()
    await delay(50)

    // Append task list items for acceptanceText round trip
    editor.commands.focus('end')
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
    await tick()
    await delay(30)

    onDocumentChange(
      JSON.stringify({
        schemaVersion: 1,
        doc: editor.getJSON(),
      }),
    )

    console.log('FLASHNOTE_SLASH_ACCEPTANCE_SUCCESS')
    console.log('FLASHNOTE_E2_ACCEPTANCE_SUCCESS')
    console.log('FLASHNOTE_E3_ACCEPTANCE_SUCCESS')
  } catch (error) {
    console.error('FLASHNOTE_SLASH_ACCEPTANCE_FAILURE', error)
    throw error
  }
}


