import type { Editor, JSONContent } from '@tiptap/core'
import { tick } from 'svelte'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getNodeText(node?: JSONContent): string {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (node.content) {
    return node.content.map((c) => getNodeText(c)).join('')
  }
  return ''
}

function findNodeByType(nodes: JSONContent[] | undefined, type: string): JSONContent | undefined {
  if (!nodes) return undefined
  for (const node of nodes) {
    if (node.type === type) return node
    if (node.content) {
      const found = findNodeByType(node.content, type)
      if (found) return found
    }
  }
  return undefined
}

function findTextNodesWithMark(nodes: JSONContent[] | undefined, markType: string): JSONContent[] {
  const result: JSONContent[] = []
  if (!nodes) return result
  for (const node of nodes) {
    if (node.type === 'text' && node.marks?.some((m) => m.type === markType)) {
      result.push(node)
    }
    if (node.content) {
      result.push(...findTextNodesWithMark(node.content, markType))
    }
  }
  return result
}

export function dispatchPasteEvent(
  editor: Editor,
  data: { html?: string; text?: string },
): boolean {
  const dt = new DataTransfer()
  if (data.html !== undefined) {
    dt.setData('text/html', data.html)
  }
  if (data.text !== undefined) {
    dt.setData('text/plain', data.text)
  }
  const event = new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

export async function runRichPasteAcceptance(editor: Editor): Promise<void> {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // A. Semantic rich formatting preservation & attribute stripping
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<h2 class="legacy-h2" style="color: blue">Semantic Heading</h2><p class="styled-p" style="margin: 10px"><strong style="color:red">bold text</strong>, <em>italic text</em>, <del style="font-size:18px">strike text</del>, <code>inline code</code>, and <a href="example.com" class="link-cls" style="color: green">link text</a></p>',
    text: 'Semantic Heading\nbold text, italic text, strike text, inline code, and link text',
  })
  await tick()
  await delay(40)

  let doc = editor.getJSON()
  const heading2 = findNodeByType(doc.content, 'heading')
  if (!heading2 || heading2.attrs?.level !== 2) {
    throw new Error(`acceptance A: expected heading level 2, got ${JSON.stringify(heading2)}`)
  }
  const boldNodes = findTextNodesWithMark(doc.content, 'bold')
  if (!boldNodes.some((n) => n.text === 'bold text')) {
    throw new Error(`acceptance A: expected bold mark on "bold text", got ${JSON.stringify(doc.content)}`)
  }
  const italicNodes = findTextNodesWithMark(doc.content, 'italic')
  if (!italicNodes.some((n) => n.text === 'italic text')) {
    throw new Error(`acceptance A: expected italic mark on "italic text", got ${JSON.stringify(doc.content)}`)
  }
  const strikeNodes = findTextNodesWithMark(doc.content, 'strike')
  if (!strikeNodes.some((n) => n.text === 'strike text')) {
    throw new Error(`acceptance A: expected strike mark on "strike text", got ${JSON.stringify(doc.content)}`)
  }
  const codeNodes = findTextNodesWithMark(doc.content, 'code')
  if (!codeNodes.some((n) => n.text === 'inline code')) {
    throw new Error(`acceptance A: expected code mark on "inline code", got ${JSON.stringify(doc.content)}`)
  }
  const linkNodes = findTextNodesWithMark(doc.content, 'link')
  const validLink = linkNodes.find((n) => n.text === 'link text')
  const linkMark = validLink?.marks?.find((m) => m.type === 'link')
  if (!linkMark || linkMark.attrs?.href !== 'https://example.com') {
    throw new Error(`acceptance A: expected normalized link mark https://example.com, got ${JSON.stringify(linkMark)}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // B. Inline-style semantic conversion
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<p><span style="font-weight: 700; font-style: italic; color: red; font-family: Comic Sans MS;">Style Converted</span></p>',
    text: 'Style Converted',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const convertedBold = findTextNodesWithMark(doc.content, 'bold')
  const convertedItalic = findTextNodesWithMark(doc.content, 'italic')
  if (!convertedBold.some((n) => n.text === 'Style Converted') || !convertedItalic.some((n) => n.text === 'Style Converted')) {
    throw new Error(`acceptance B: expected bold and italic on "Style Converted", got ${JSON.stringify(doc.content)}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // C. Underline stripping
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<p><u>Underlined Content</u></p>',
    text: 'Underlined Content',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const pNode = doc.content?.[0]
  const pText = getNodeText(pNode)
  if (pText !== 'Underlined Content') {
    throw new Error(`acceptance C: expected text "Underlined Content", got ${JSON.stringify(pNode)}`)
  }
  const textNode = pNode?.content?.[0]
  if (textNode?.marks && textNode.marks.length > 0) {
    throw new Error(`acceptance C: underline mark should not exist, got marks: ${JSON.stringify(textNode.marks)}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // D. Link normalization
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<p><a href="example.com" style="color:red" class="source-link">Normalized Link</a></p>',
    text: 'Normalized Link',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const normLinkNodes = findTextNodesWithMark(doc.content, 'link')
  const normLink = normLinkNodes.find((n) => getNodeText(n) === 'Normalized Link')
  const normLinkMark = normLink?.marks?.find((m) => m.type === 'link')
  if (!normLinkMark || normLinkMark.attrs?.href !== 'https://example.com') {
    throw new Error(`acceptance D: expected href "https://example.com", got ${JSON.stringify(normLinkMark)}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // E. Unsafe link degradation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<p><a href="javascript:alert(1)">Unsafe Text</a></p>',
    text: 'Unsafe Text',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const unsafeNode = doc.content?.[0]
  const unsafeText = getNodeText(unsafeNode)
  if (unsafeText !== 'Unsafe Text') {
    throw new Error(`acceptance E: expected text "Unsafe Text" to survive, got ${JSON.stringify(doc.content)}`)
  }
  const unsafeTextNode = unsafeNode?.content?.[0]
  if (unsafeTextNode?.marks?.some((m) => m.type === 'link')) {
    throw new Error('acceptance E: unsafe javascript: link unexpectedly retained link mark')
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // F. Table degradation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td>10</td></tr><tr><td>Bob</td><td></td></tr></tbody></table>',
    text: 'Name | Score\nAlice | 10\nBob | ',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const tableNode = findNodeByType(doc.content, 'table') || findNodeByType(doc.content, 'tableRow') || findNodeByType(doc.content, 'tableCell')
  if (tableNode) {
    throw new Error(`acceptance F: table nodes must not exist in editor document, found ${JSON.stringify(tableNode)}`)
  }
  const paragraphs = doc.content?.filter((n) => n.type === 'paragraph') ?? []
  const row1Text = getNodeText(paragraphs[0])
  const row2Text = getNodeText(paragraphs[1])
  const row3Text = getNodeText(paragraphs[2])

  if (row1Text !== 'Name | Score' || row2Text !== 'Alice | 10' || row3Text !== 'Bob |') {
    throw new Error(`acceptance F: table rows mismatch: row1=${row1Text}, row2=${row2Text}, row3=${row3Text}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // G. Unsupported blocks / widgets
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<h4>Heading Four Text</h4><iframe src="https://evil.com"></iframe><script>alert("bad")</script><div style="font-size:24px"><p>Div Inner Paragraph</p></div>',
    text: 'Heading Four Text\nDiv Inner Paragraph',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const rawJSON = JSON.stringify(doc)
  if (rawJSON.includes('evil.com') || rawJSON.includes('alert') || rawJSON.includes('iframe') || rawJSON.includes('script')) {
    throw new Error(`acceptance G: dangerous widget / script leaked into document: ${rawJSON}`)
  }
  if (!rawJSON.includes('Heading Four Text') || !rawJSON.includes('Div Inner Paragraph')) {
    throw new Error(`acceptance G: meaningful text lost: ${rawJSON}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // H. HTML-only remote image negative
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    html: '<p>Photo: <img src="https://remote.example/photo.png" alt="Alt Description"> <img src="data:image/png;base64,AAAA"></p>',
    text: 'Photo: Alt Description',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const imageNode = findNodeByType(doc.content, 'image')
  if (imageNode) {
    throw new Error(`acceptance H: remote/data HTML img unexpectedly created an image node: ${JSON.stringify(imageNode)}`)
  }
  const photoText = JSON.stringify(doc.content)
  if (!photoText.includes('Photo:') || !photoText.includes('Alt Description')) {
    throw new Error(`acceptance H: alt description text was not preserved as text: ${photoText}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // I. Plain text regression
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  dispatchPasteEvent(editor, {
    text: 'Ordinary Plain Text',
  })
  await tick()
  await delay(40)

  doc = editor.getJSON()
  const plainTextFound = JSON.stringify(doc.content)
  if (!plainTextFound.includes('Ordinary Plain Text')) {
    throw new Error(`acceptance I: plain text paste failed, got ${plainTextFound}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // J. Read-only regression
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original Readonly Text' }] }],
  })
  editor.setEditable(false)
  await tick()
  await delay(20)

  const docBeforeReadonlyPaste = JSON.stringify(editor.getJSON())
  dispatchPasteEvent(editor, {
    html: '<p>Mutated Readonly Content</p>',
    text: 'Mutated Readonly Content',
  })
  await tick()
  await delay(40)

  const docAfterReadonlyPaste = JSON.stringify(editor.getJSON())
  if (docBeforeReadonlyPaste !== docAfterReadonlyPaste) {
    throw new Error('acceptance J: paste event mutated read-only editor document')
  }

  editor.setEditable(true)
  await tick()
  await delay(20)

  console.log('FLASHNOTE_RICH_PASTE_ACCEPTANCE_SUCCESS')
}
