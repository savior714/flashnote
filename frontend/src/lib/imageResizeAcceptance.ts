import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { tick } from 'svelte'
import { AttachmentImage } from './attachmentImage'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

// Deterministic 200x100 PNG (aspect ratio 2.0, width: 200, height: 100)
const DETERMINISTIC_200X100_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAYAAADDhn8LAAABHUlEQVR4nO3TMRHAIADAQNQhrJrwBwZ6WWH44fcsGfNbG/g3bgfAywwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDALBIBAMAsEgEAwCwSAQDtqt1LC/eBjEAAAAAElFTkSuQmCC'

function createPngFile(filename = 'acceptance-test-image.png'): File {
  const binary = atob(DETERMINISTIC_200X100_PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], filename, { type: 'image/png' })
}

export function dispatchImagePasteEvent(editor: Editor, file: File): boolean {
  const dt = new DataTransfer()
  try {
    dt.items.add(file)
  } catch {}

  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent

  const clipboardData = {
    files: [file],
    items: [
      {
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      },
    ],
    getData: () => '',
  }

  Object.defineProperty(event, 'clipboardData', {
    value: clipboardData,
    configurable: true,
  })

  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

export function dispatchImageDropEvent(editor: Editor, file: File): boolean {
  const rect = editor.view.dom.getBoundingClientRect()
  const event = new Event('drop', {
    bubbles: true,
    cancelable: true,
  }) as DragEvent

  const dataTransfer = {
    files: [file],
    items: [
      {
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      },
    ],
    types: ['Files'],
    dropEffect: 'copy',
    effectAllowed: 'all',
    getData: () => '',
    setData: () => {},
    clearData: () => {},
  }

  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer, configurable: true },
    clientX: { value: rect.left + 4, configurable: true },
    clientY: { value: rect.top + 4, configurable: true },
  })

  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

export async function runImageResizeAcceptance(editor: Editor): Promise<{ attachmentId: string; width: number; height: number }> {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. CANONICAL PASTE + DROP INGEST PATH PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  const pngFile = createPngFile()
  dispatchImagePasteEvent(editor, pngFile)

  let attachmentId = ''
  for (let i = 0; i < 60; i++) {
    const doc = editor.getJSON()
    const imgNode = findNodeByType(doc.content, 'image')
    if (imgNode && typeof imgNode.attrs?.attachmentId === 'string' && imgNode.attrs.attachmentId.length > 0) {
      attachmentId = imgNode.attrs.attachmentId
      break
    }
    await delay(30)
  }

  if (!attachmentId) {
    throw new Error('acceptance E4: canonical image paste failed to ingest attachment and insert image node')
  }

  const pasteAttachmentId = attachmentId
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  editor.commands.focus('start')
  await tick()
  await delay(20)

  const dropFile = createPngFile('acceptance-drop-image.png')
  const dropPrevented = dispatchImageDropEvent(editor, dropFile)
  if (!dropPrevented) {
    throw new Error('acceptance E4: image drop event was not handled by the editor')
  }

  let droppedAttachmentId = ''
  let droppedImage: JSONContent | undefined
  for (let i = 0; i < 60; i++) {
    const doc = editor.getJSON()
    droppedImage = findNodeByType(doc.content, 'image')
    if (
      droppedImage &&
      typeof droppedImage.attrs?.attachmentId === 'string' &&
      droppedImage.attrs.attachmentId.length > 0
    ) {
      droppedAttachmentId = droppedImage.attrs.attachmentId
      break
    }
    await delay(30)
  }

  if (!droppedAttachmentId) {
    throw new Error('acceptance E4: image drag/drop failed to ingest attachment and insert image node')
  }
  if (droppedAttachmentId === pasteAttachmentId) {
    throw new Error('acceptance E4: image drop did not perform an independent attachment ingest')
  }
  if (
    droppedImage?.attrs?.alt !== dropFile.name ||
    droppedImage?.attrs?.width !== null ||
    droppedImage?.attrs?.height !== null
  ) {
    throw new Error(`acceptance E4: dropped image did not use canonical image node attrs: ${JSON.stringify(droppedImage?.attrs)}`)
  }

  attachmentId = droppedAttachmentId
  console.log('FLASHNOTE_IMAGE_DROP_ACCEPTANCE_SUCCESS')
  await tick()
  await delay(50)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. HANDLE PRESENCE PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const container = editor.view.dom.querySelector<HTMLElement>('[data-resize-container]')
  if (!container) {
    throw new Error('acceptance E4: [data-resize-container] not found in editor DOM for AttachmentImage')
  }
  const img = container.querySelector<HTMLImageElement>('img[data-attachment-image]')
  if (!img) {
    throw new Error('acceptance E4: img[data-attachment-image] not found inside resize container')
  }
  if (!img.src.includes(`/attachments/${encodeURIComponent(attachmentId)}`)) {
    throw new Error(`acceptance E4: img src mismatch: expected /attachments/${attachmentId}, got ${img.src}`)
  }

  const leftHandle = container.querySelector<HTMLElement>('[data-resize-handle="bottom-left"]')
  const rightHandle = container.querySelector<HTMLElement>('[data-resize-handle="bottom-right"]')
  if (!leftHandle || !rightHandle) {
    throw new Error('acceptance E4: missing bottom-left or bottom-right resize handle in ResizableNodeView')
  }
  const wrapper = container.querySelector('[data-resize-wrapper]')
  if (leftHandle.parentElement !== wrapper || rightHandle.parentElement !== wrapper) {
    throw new Error('acceptance E4: resize handles do not belong to ResizableNodeView wrapper')
  }

  const nonImageHandles = editor.view.dom.querySelectorAll('p [data-resize-handle], blockquote [data-resize-handle], pre [data-resize-handle]')
  if (nonImageHandles.length > 0) {
    throw new Error('acceptance E4: resize handles leaked into non-image content')
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. ACTUAL DRAG / RESIZE PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let doc = editor.getJSON()
  let imageNode = findNodeByType(doc.content, 'image')
  if (imageNode?.attrs?.width !== null || imageNode?.attrs?.height !== null) {
    throw new Error(`acceptance E4: expected initial width/height to be null, got width=${imageNode?.attrs?.width}, height=${imageNode?.attrs?.height}`)
  }

  // Drive right handle: drag start at (200, 100) -> move to (300, 150) -> mouseup
  rightHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100, bubbles: true, cancelable: true }))
  await tick()

  if (container.dataset.resizeState !== 'true') {
    throw new Error('acceptance E4: container dataset.resizeState did not become "true" upon mousedown')
  }

  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 150, bubbles: true, cancelable: true }))
  await tick()

  document.dispatchEvent(new MouseEvent('mouseup', { clientX: 300, clientY: 150, bubbles: true, cancelable: true }))
  await tick()
  await delay(50)

  doc = editor.getJSON()
  imageNode = findNodeByType(doc.content, 'image')
  const resizedWidth = imageNode?.attrs?.width
  const resizedHeight = imageNode?.attrs?.height

  if (typeof resizedWidth !== 'number' || typeof resizedHeight !== 'number' || resizedWidth <= 0 || resizedHeight <= 0) {
    throw new Error(`acceptance E4: expected positive integer width and height after drag resize, got width=${resizedWidth}, height=${resizedHeight}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. ASPECT RATIO PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const aspect = resizedWidth / resizedHeight
  // Natural aspect ratio for 200x100 is 2.0; allow small pixel rounding tolerance
  if (Math.abs(aspect - 2.0) > 0.08) {
    throw new Error(`acceptance E4: aspect ratio drifted materially: expected ~2.0, got ${aspect} (${resizedWidth}x${resizedHeight})`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. MINIMUM SIZE PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Drag right handle drastically inward towards (0, 0)
  rightHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 300, clientY: 150, bubbles: true, cancelable: true }))
  await tick()

  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true, cancelable: true }))
  await tick()

  document.dispatchEvent(new MouseEvent('mouseup', { clientX: 0, clientY: 0, bubbles: true, cancelable: true }))
  await tick()
  await delay(50)

  doc = editor.getJSON()
  imageNode = findNodeByType(doc.content, 'image')
  const clampedWidth = imageNode?.attrs?.width
  const clampedHeight = imageNode?.attrs?.height

  if (typeof clampedWidth !== 'number' || typeof clampedHeight !== 'number') {
    throw new Error('acceptance E4: width/height attrs missing after clamped resize')
  }
  if (clampedWidth < 48 || clampedHeight < 32) {
    throw new Error(`acceptance E4: dimensions fell below declared minimums (min width 48, min height 32): got ${clampedWidth}x${clampedHeight}`)
  }
  const clampedAspect = clampedWidth / clampedHeight
  if (Math.abs(clampedAspect - 2.0) > 0.08) {
    throw new Error(`acceptance E4: aspect ratio broken during minimum size clamping: got ${clampedAspect} (${clampedWidth}x${clampedHeight})`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. LEFT HANDLE RESIZE PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Drag left handle outward: deltaX = -100 increases width
  leftHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100, bubbles: true, cancelable: true }))
  await tick()

  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
  await tick()

  document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
  await tick()
  await delay(50)

  doc = editor.getJSON()
  imageNode = findNodeByType(doc.content, 'image')
  if (typeof imageNode?.attrs?.width !== 'number' || imageNode.attrs.width < 48) {
    throw new Error(`acceptance E4: left handle resize failed: ${JSON.stringify(imageNode?.attrs)}`)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. READ-ONLY & TRANSITION PROOF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // A. Transition to non-editable:
  const docBeforeDisable = JSON.stringify(editor.getJSON())
  editor.setEditable(false)
  await tick()
  await delay(30)

  const currentHandle = editor.view.dom.querySelector<HTMLElement>('[data-resize-handle="bottom-right"]')
  if (currentHandle) {
    currentHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100, bubbles: true, cancelable: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 300, bubbles: true, cancelable: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 600, clientY: 300, bubbles: true, cancelable: true }))
    await tick()
    await delay(30)
  }

  const docAfterNonEditableAttempt = JSON.stringify(editor.getJSON())
  if (docBeforeDisable !== docAfterNonEditableAttempt) {
    throw new Error('acceptance E4: resize drag mutated document while editor was not editable')
  }

  // Restore editable state
  editor.setEditable(true)
  await tick()
  await delay(30)

  // B. Read-only note view (e.g. Flashnote Trash):
  const tempHost = document.createElement('div')
  document.body.appendChild(tempHost)
  try {
    const readOnlyEditor = new Editor({
      element: tempHost,
      content: editor.getJSON(),
      editable: false,
      extensions: [
        StarterKit,
        AttachmentImage,
      ],
    })
    await tick()
    await delay(30)

    const roImg = tempHost.querySelector<HTMLImageElement>('img[data-attachment-image]')
    if (!roImg) {
      throw new Error('acceptance E4: read-only editor failed to render img[data-attachment-image]')
    }
    const roHandles = tempHost.querySelectorAll('[data-resize-handle]')
    if (roHandles.length > 0) {
      throw new Error(`acceptance E4: read-only editor unexpectedly rendered ${roHandles.length} resize handles`)
    }
    const roContainer = tempHost.querySelector('[data-resize-container]')
    if (roContainer) {
      throw new Error('acceptance E4: read-only editor unexpectedly mounted ResizableNodeView container')
    }
    readOnlyEditor.destroy()
  } finally {
    tempHost.remove()
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. FINAL CANONICAL RESIZE FOR PERSISTENCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Set clean final dimensions (e.g. width: 280, height: 140) through handle drag
  const currentRightHandle = editor.view.dom.querySelector<HTMLElement>('[data-resize-handle="bottom-right"]')
  if (!currentRightHandle) {
    throw new Error('acceptance E4: right handle not found for final resize commit')
  }
  currentRightHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 100, bubbles: true, cancelable: true }))
  await tick()
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 280, clientY: 140, bubbles: true, cancelable: true }))
  await tick()
  document.dispatchEvent(new MouseEvent('mouseup', { clientX: 280, clientY: 140, bubbles: true, cancelable: true }))
  await tick()
  await delay(50)

  const finalDoc = editor.getJSON()
  const finalImage = findNodeByType(finalDoc.content, 'image')
  const finalWidth = finalImage?.attrs?.width
  const finalHeight = finalImage?.attrs?.height

  if (typeof finalWidth !== 'number' || typeof finalHeight !== 'number' || finalWidth <= 0 || finalHeight <= 0) {
    throw new Error(`acceptance E4: invalid final image dimensions: width=${finalWidth}, height=${finalHeight}`)
  }

  console.log('FLASHNOTE_IMAGE_RESIZE_ACCEPTANCE_SUCCESS')
  return {
    attachmentId,
    width: finalWidth,
    height: finalHeight,
  }
}
