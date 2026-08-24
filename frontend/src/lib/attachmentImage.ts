import { Node, ResizableNodeView, type JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

function attachmentURL(attachmentID: string): string {
  return `/attachments/${encodeURIComponent(attachmentID)}`
}

function applyImageAttributes(element: HTMLImageElement, node: ProseMirrorNode) {
  const attachmentID = typeof node.attrs.attachmentId === 'string' ? node.attrs.attachmentId : ''
  element.src = attachmentURL(attachmentID)

  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  element.alt = alt

  if (typeof node.attrs.title === 'string' && node.attrs.title) {
    element.title = node.attrs.title
  } else {
    element.removeAttribute('title')
  }

  const width = typeof node.attrs.width === 'number' && node.attrs.width > 0 ? node.attrs.width : null
  const height = typeof node.attrs.height === 'number' && node.attrs.height > 0 ? node.attrs.height : null
  if (width) {
    element.style.width = `${width}px`
  } else {
    element.style.removeProperty('width')
  }
  if (height) {
    element.style.height = `${height}px`
  } else {
    element.style.removeProperty('height')
  }
}

function parsedDimension(element: HTMLElement, name: 'width' | 'height'): number | null {
  const raw = element.getAttribute(name)
  if (!raw) {
    return null
  }
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

function makeResizeHandle(direction: 'bottom-left' | 'bottom-right'): HTMLElement {
  const handle = document.createElement('div')
  handle.dataset.resizeHandle = direction
  handle.style.position = 'absolute'
  handle.style.bottom = '-5px'
  handle.style.width = '10px'
  handle.style.height = '10px'
  handle.style.border = '1px solid currentColor'
  handle.style.borderRadius = '999px'
  handle.style.background = 'Canvas'
  handle.style.boxSizing = 'border-box'
  handle.style.cursor = direction === 'bottom-left' ? 'nesw-resize' : 'nwse-resize'
  if (direction === 'bottom-left') {
    handle.style.left = '-5px'
  } else {
    handle.style.right = '-5px'
  }
  return handle
}

export function attachmentImageContent(attachmentId: string, alt?: string): JSONContent {
  return {
    type: 'image',
    attrs: {
      attachmentId,
      alt: alt || null,
      title: null,
      width: null,
      height: null,
    },
  }
}

export const AttachmentImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-attachment-id'),
      },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: element => parsedDimension(element, 'width'),
      },
      height: {
        default: null,
        parseHTML: element => parsedDimension(element, 'height'),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-attachment-id]' }]
  },

  renderHTML({ node }) {
    const attrs = node.attrs
    return [
      'img',
      {
        src: attachmentURL(String(attrs.attachmentId ?? '')),
        'data-attachment-id': String(attrs.attachmentId ?? ''),
        alt: typeof attrs.alt === 'string' ? attrs.alt : '',
        title: typeof attrs.title === 'string' ? attrs.title : null,
        width: typeof attrs.width === 'number' ? attrs.width : null,
        height: typeof attrs.height === 'number' ? attrs.height : null,
      },
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const image = document.createElement('img')
      image.dataset.attachmentImage = ''
      image.draggable = false
      image.style.display = 'block'
      image.style.maxWidth = '100%'
      image.style.borderRadius = '6px'
      applyImageAttributes(image, node)

      if (!editor.isEditable) {
        return {
          dom: image,
          update(updatedNode) {
            if (updatedNode.type !== node.type) {
              return false
            }
            applyImageAttributes(image, updatedNode)
            return true
          },
        }
      }

      const nodeView = new ResizableNodeView({
        element: image,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          image.style.width = `${width}px`
          image.style.height = `${height}px`
        },
        onCommit: (width, height) => {
          const position = getPos()
          if (position === undefined) {
            return
          }
          editor
            .chain()
            .setNodeSelection(position)
            .updateAttributes('image', {
              width: Math.max(1, Math.round(width)),
              height: Math.max(1, Math.round(height)),
            })
            .run()
        },
        onUpdate: updatedNode => {
          if (updatedNode.type !== node.type) {
            return false
          }
          applyImageAttributes(image, updatedNode)
          return true
        },
        options: {
          directions: ['bottom-left', 'bottom-right'],
          min: { width: 48, height: 32 },
          preserveAspectRatio: true,
          createCustomHandle: direction =>
            makeResizeHandle(direction === 'bottom-left' ? 'bottom-left' : 'bottom-right'),
        },
      })
      nodeView.container.style.margin = '16px 0'
      nodeView.container.style.maxWidth = '100%'
      return nodeView
    }
  },
})
