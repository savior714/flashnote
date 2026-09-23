import type { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { tick } from 'svelte'

const CODE_TEXT =
  'const answer = 42\nconst longLine = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-0123456789"'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dispatchKey(editor: Editor, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(event)
  return event
}

function dispatchMouseDown(target: Element, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent('mousedown', {
    button: 0,
    buttons: 1,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

function codeBlockPosition(editor: Editor): number {
  let found = -1
  editor.state.doc.descendants((node, position) => {
    if (found >= 0) return false
    if (node.type.name === 'codeBlock') {
      found = position
      return false
    }
    return true
  })
  if (found < 0) {
    throw new Error('acceptance code block: fixture node not found')
  }
  return found
}

function codeBlockText(editor: Editor): string {
  let text = ''
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock') {
      text = node.textContent
      return false
    }
    return text.length === 0
  })
  return text
}

function assertFixture(editor: Editor, expectedCodeText = CODE_TEXT): void {
  const content = editor.getJSON().content
  if (
    content?.length !== 3 ||
    content[0]?.type !== 'paragraph' ||
    content[1]?.type !== 'codeBlock' ||
    content[2]?.type !== 'paragraph'
  ) {
    throw new Error(`acceptance code block: invalid paragraph/code/paragraph fixture ${JSON.stringify(content)}`)
  }
  const actualCodeText = codeBlockText(editor)
  if (actualCodeText !== expectedCodeText) {
    throw new Error(`acceptance code block: expected ${JSON.stringify(expectedCodeText)}, got ${JSON.stringify(actualCodeText)}`)
  }
}

function parseColor(value: string): [number, number, number, number] {
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
  if (parts.length < 3) {
    throw new Error(`acceptance code block: unsupported color ${value}`)
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
}

function compositeColor(
  foreground: [number, number, number, number],
  background: [number, number, number, number],
): [number, number, number, number] {
  const alpha = foreground[3] + background[3] * (1 - foreground[3])
  if (alpha === 0) return [0, 0, 0, 0]
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ]
}

function relativeLuminance(color: [number, number, number, number]): number {
  const linear = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
}

function contrastRatio(
  foregroundValue: string,
  backgroundValue: string,
  backdropValue: string,
): number {
  const backdrop = parseColor(backdropValue)
  const background = compositeColor(parseColor(backgroundValue), backdrop)
  const foreground = compositeColor(parseColor(foregroundValue), background)
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function pageBackdrop(element: HTMLElement): string {
  let current: HTMLElement | null = element
  while (current) {
    const color = getComputedStyle(current).backgroundColor
    if (parseColor(color)[3] === 1) return color
    current = current.parentElement
  }
  return getComputedStyle(document.body).backgroundColor
}

function assertPresentation(pre: HTMLPreElement): CSSStyleDeclaration {
  const style = getComputedStyle(pre)
  if (style.borderTopWidth !== '1px' || style.borderTopStyle !== 'solid') {
    throw new Error(`acceptance code block: missing 1px boundary ${style.border}`)
  }
  if (parseFloat(style.borderTopLeftRadius) < 4 || parseFloat(style.borderTopLeftRadius) > 12) {
    throw new Error(`acceptance code block: border radius is not modest ${style.borderTopLeftRadius}`)
  }
  if (parseFloat(style.paddingTop) < 8 || parseFloat(style.paddingRight) < 8) {
    throw new Error(`acceptance code block: insufficient internal padding ${style.padding}`)
  }
  if (!style.fontFamily.toLowerCase().includes('mono')) {
    throw new Error(`acceptance code block: monospace token missing ${style.fontFamily}`)
  }
  if (parseFloat(style.marginBottom) <= 0) {
    throw new Error(`acceptance code block: vertical margin missing ${style.margin}`)
  }
  if (style.overflowX !== 'auto' || style.whiteSpace !== 'pre') {
    throw new Error(`acceptance code block: horizontal overflow semantics missing ${style.overflowX}/${style.whiteSpace}`)
  }
  if (parseColor(style.borderTopColor)[3] <= 0 || parseColor(style.backgroundColor)[3] <= 0) {
    throw new Error(`acceptance code block: idle boundary is visually absent ${style.border}/${style.backgroundColor}`)
  }
  if (pre.scrollWidth <= pre.clientWidth) {
    throw new Error(`acceptance code block: long line did not produce horizontal overflow ${pre.scrollWidth}/${pre.clientWidth}`)
  }
  const ratio = contrastRatio(style.color, style.backgroundColor, pageBackdrop(pre))
  if (ratio < 4.5) {
    throw new Error(`acceptance code block: insufficient text contrast ${ratio.toFixed(2)}:1`)
  }
  return style
}

async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  document.documentElement.dataset.theme = theme
  await tick()
  await delay(30)
}

export async function runCodeBlockAcceptance(editor: Editor): Promise<void> {
  const originalTheme = document.documentElement.dataset.theme
  try {
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before code' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: CODE_TEXT }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'After code' }] },
      ],
    })
    editor.commands.setTextSelection(1)
    await tick()
    await delay(30)

    const position = codeBlockPosition(editor)
    const pre = editor.view.dom.querySelector<HTMLPreElement>('pre')
    const code = pre?.querySelector<HTMLElement>(':scope > code')
    if (!pre || !code) {
      throw new Error('acceptance code block: rendered pre/code fixture is missing')
    }

    const idleBackgrounds = new Map<'light' | 'dark', string>()
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(theme)
      idleBackgrounds.set(theme, assertPresentation(pre).backgroundColor)
    }

    await delay(600)
    const textOffset = CODE_TEXT.indexOf('answer') + 1
    editor.commands.setTextSelection({
      from: position + 1 + textOffset - 1,
      to: position + 1 + textOffset,
    })
    let updateCount = 0
    const countUpdate = () => {
      updateCount += 1
    }
    editor.on('update', countUpdate)
    const textDeleteEvent = dispatchKey(editor, 'Backspace')
    editor.off('update', countUpdate)
    if (!textDeleteEvent.defaultPrevented) {
      throw new Error('acceptance code block: text Backspace was not handled by the editor')
    }
    if (updateCount !== 1) {
      throw new Error(`acceptance code block: text deletion produced ${updateCount} updates`)
    }
    assertFixture(editor, CODE_TEXT.replace('answer', 'nswer'))
    editor.commands.undo()
    assertFixture(editor)

    editor.commands.setTextSelection(position + 1 + textOffset)
    const escapeEvent = dispatchKey(editor, 'Escape')
    if (!escapeEvent.defaultPrevented) {
      throw new Error('acceptance code block: Escape was not handled')
    }
    const escapedSelection = editor.state.selection
    if (!(escapedSelection instanceof NodeSelection) || escapedSelection.node.type.name !== 'codeBlock') {
      throw new Error(
        `acceptance code block: Escape did not create a codeBlock NodeSelection ${escapedSelection.constructor.name}`,
      )
    }
    await tick()
    await delay(30)
    if (!pre.classList.contains('ProseMirror-selectednode')) {
      throw new Error('acceptance code block: canonical selected-node DOM class is missing')
    }

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(theme)
      const selectedStyle = assertPresentation(pre)
      if (
        selectedStyle.backgroundColor === idleBackgrounds.get(theme) ||
        selectedStyle.outlineStyle === 'none' ||
        parseFloat(selectedStyle.outlineWidth) < 2
      ) {
        throw new Error(
          `acceptance code block: selected appearance is not distinct ${selectedStyle.backgroundColor}/${selectedStyle.outline}`,
        )
      }
    }

    const codeRect = code.getBoundingClientRect()
    const preRect = pre.getBoundingClientRect()
    if (codeRect.width <= 0 || codeRect.height <= 0) {
      throw new Error('acceptance code block: code text has no rendered geometry')
    }
    dispatchMouseDown(
      code,
      Math.min(codeRect.right - 1, preRect.left + pre.clientWidth / 2),
      codeRect.top + codeRect.height / 2,
    )
    editor.commands.setTextSelection(position + 1 + textOffset)
    const textClickSelection = editor.state.selection
    if (
      !(textClickSelection instanceof TextSelection) ||
      textClickSelection.$from.parent.type.name !== 'codeBlock'
    ) {
      throw new Error(
        `acceptance code block: code text target did not preserve text editing ${textClickSelection.constructor.name}`,
      )
    }

    const preStyle = getComputedStyle(pre)
    const paddingX = parseFloat(preStyle.paddingLeft)
    const paddingY = parseFloat(preStyle.paddingTop)
    const chromeEvent = dispatchMouseDown(
      pre,
      preRect.left + paddingX / 2,
      preRect.top + paddingY / 2,
    )
    const chromeSelection = editor.state.selection
    if (
      !chromeEvent.defaultPrevented ||
      !(chromeSelection instanceof NodeSelection) ||
      chromeSelection.node.type.name !== 'codeBlock'
    ) {
      throw new Error('acceptance code block: block chrome click did not create a NodeSelection')
    }

    await delay(600)
    updateCount = 0
    editor.on('update', countUpdate)
    const deleteEvent = dispatchKey(editor, 'Backspace')
    editor.off('update', countUpdate)
    if (!deleteEvent.defaultPrevented || updateCount !== 1) {
      throw new Error(`acceptance code block: whole-node deletion was not one editor update ${updateCount}`)
    }
    const deletedContent = editor.getJSON().content
    if (
      deletedContent?.length !== 2 ||
      deletedContent[0]?.type !== 'paragraph' ||
      deletedContent[1]?.type !== 'paragraph' ||
      codeBlockText(editor).length > 0
    ) {
      throw new Error(`acceptance code block: whole node remained after Backspace ${JSON.stringify(deletedContent)}`)
    }

    const undoResult = editor.commands.undo()
    if (!undoResult) {
      throw new Error('acceptance code block: undo had no restorable deletion')
    }
    await tick()
    await delay(30)
    assertFixture(editor)

    console.log('FLASHNOTE_CODE_BLOCK_ACCEPTANCE_SUCCESS')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `CODE_BLOCK_ACCEPTANCE_FAILURE: ${message}` }] }],
    })
    throw error
  } finally {
    if (originalTheme === undefined) {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = originalTheme
    }
  }
}
