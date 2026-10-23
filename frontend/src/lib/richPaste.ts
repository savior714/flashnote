import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { normalizeExternalUrl } from './linkHelper'

const DISALLOWED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'canvas',
  'svg',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'audio',
  'video',
  'source',
  'track',
  'applet',
  'frame',
  'frameset',
  'meta',
  'link',
  'head',
  'template',
])

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'table',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'figure',
  'figcaption',
  'address',
  'nav',
  'details',
  'summary',
  'fieldset',
])

function containsBlockChild(element: Element): boolean {
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i]
    const tag = child.tagName.toLowerCase()
    if (BLOCK_TAGS.has(tag) || containsBlockChild(child)) {
      return true
    }
  }
  return false
}

function unwrapElement(element: Element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function degradeTable(table: HTMLTableElement, doc: Document): Node[] {
  const paragraphs: Node[] = []

  // A caption is table metadata rather than a cell; its text must not disappear
  // just because the table itself is being flattened.
  const caption = table.querySelector('caption')
  if (caption) {
    const captionText = (caption.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (captionText) {
      const p = doc.createElement('p')
      p.textContent = captionText
      paragraphs.push(p)
    }
  }

  const rows = Array.from(table.querySelectorAll('tr'))

  for (const row of rows) {
    // Only direct cells belonging to this row (avoid nested table cells if any)
    const cells = Array.from(row.children).filter((child) => {
      const tag = child.tagName.toLowerCase()
      return tag === 'th' || tag === 'td'
    })

    const cellTexts: string[] = []
    for (const cell of cells) {
      // Normalize whitespace inside cell
      const rawText = cell.textContent ?? ''
      const normalizedText = rawText.replace(/\s+/g, ' ').trim()
      cellTexts.push(normalizedText)
    }

    const rowText = cellTexts.join(' | ')
    const p = doc.createElement('p')
    if (rowText.length > 0) {
      p.textContent = rowText
    }
    paragraphs.push(p)
  }

  // If table had no rows but had text
  if (paragraphs.length === 0) {
    const fallbackText = (table.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (fallbackText.length > 0) {
      const p = doc.createElement('p')
      p.textContent = fallbackText
      paragraphs.push(p)
    }
  }

  return paragraphs
}

/**
 * A pasted table becomes a real table node only when its whole structure maps
 * onto Flashnote's canonical table vocabulary. A nested table is the case that
 * cannot map, because a Flashnote cell cannot hold another table; such a table
 * is flattened to text instead of being half-kept.
 */
function isRepresentableTable(table: HTMLTableElement): boolean {
  return table.querySelectorAll('table').length === 0
}

/**
 * Reshapes a representable HTML table into the shape the Flashnote table nodes
 * parse: plain `tr` children under `table`, a `colgroup` that carries column
 * widths, and cells that keep only colspan/rowspan.
 */
function normalizeTable(table: HTMLTableElement) {
  const caption = table.querySelector('caption')
  if (caption) {
    caption.remove()
  }

  for (const tag of ['thead', 'tbody', 'tfoot']) {
    for (const section of Array.from(table.querySelectorAll(tag))) {
      const parent = section.parentNode
      if (!parent) continue
      while (section.firstChild) {
        parent.insertBefore(section.firstChild, section)
      }
      parent.removeChild(section)
    }
  }

  const colgroup = table.querySelector('colgroup')
  if (colgroup) {
    for (const attr of Array.from(colgroup.attributes)) {
      if (attr.name !== 'span') {
        colgroup.removeAttribute(attr.name)
      }
    }
    for (const col of Array.from(colgroup.querySelectorAll('col'))) {
      for (const attr of Array.from(col.attributes)) {
        if (attr.name !== 'width') {
          col.removeAttribute(attr.name)
        }
      }
      // A col's width is only usable as a positive pixel number.
      const width = parseInt(col.getAttribute('width') ?? '', 10)
      if (Number.isInteger(width) && width > 0) {
        col.setAttribute('width', String(width))
      } else {
        col.removeAttribute('width')
      }
    }
  }

  for (const cell of Array.from(table.querySelectorAll('th, td'))) {
    for (const attr of Array.from(cell.attributes)) {
      if (attr.name !== 'colspan' && attr.name !== 'rowspan') {
        cell.removeAttribute(attr.name)
      }
    }
    for (const key of ['colspan', 'rowspan']) {
      const value = parseInt(cell.getAttribute(key) ?? '', 10)
      if (!Number.isInteger(value) || value < 1) {
        cell.removeAttribute(key)
      }
    }
  }
}

/**
 * Normalizes rich pasted HTML string into Flashnote's supported document vocabulary:
 * - Headings (h1, h2, h3)
 * - Paragraphs, blockquotes, lists (ul, ol, li), code blocks (pre/code), dividers (hr), line breaks (br)
 * - Inline formatting (strong, em, s, code, valid external links)
 * - Converts inline styles (font-weight, font-style, text-decoration) into semantic tags
 * - Strips unsupported styling (color, font-family, font-size, underline)
 * - Keeps a pasted table as a real table when its structure is representable,
 *   and flattens it to " | "-delimited paragraphs when it is not
 * - Degrades unsupported headings (h4..h6) and containers (div, section) into paragraphs
 * - Discards unsafe/widget tags and HTML-only remote images
 */
export function normalizeRichPasteHTML(html: string): string {
  if (!html || typeof html !== 'string') return ''
  const trimmed = html.trim()
  if (!trimmed) return ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(trimmed, 'text/html')
  const body = doc.body

  if (!body) return ''

  // 1. Remove dangerous / non-content elements
  for (const tag of DISALLOWED_TAGS) {
    const elements = Array.from(body.querySelectorAll(tag))
    for (const el of elements) {
      el.remove()
    }
  }

  // 2. Remove HTML-only remote images (preserve non-empty alt as text)
  const images = Array.from(body.querySelectorAll('img'))
  for (const img of images) {
    const alt = img.getAttribute('alt')?.trim()
    if (alt) {
      const textNode = doc.createTextNode(alt)
      img.parentNode?.replaceChild(textNode, img)
    } else {
      img.remove()
    }
  }

  // 3. Keep representable tables as tables; flatten the rest to text
  // (innermost first, so a nested table is judged inside its own context)
  const tables = Array.from(body.querySelectorAll('table')).reverse()
  for (const table of tables) {
    const parent = table.parentNode
    if (!parent) continue
    if (!isRepresentableTable(table)) {
      const degradedNodes = degradeTable(table, doc)
      for (const node of degradedNodes) {
        parent.insertBefore(node, table)
      }
      parent.removeChild(table)
      continue
    }
    normalizeTable(table)
  }

  // 4. Semanticize inline CSS styles on all elements
  const allElements = Array.from(body.querySelectorAll('*'))
  for (const el of allElements) {
    const rawStyle = el.getAttribute('style')
    if (rawStyle) {
      const fontWeightMatch = rawStyle.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i)
      const fontStyleMatch = rawStyle.match(/(?:^|;)\s*font-style\s*:\s*([^;]+)/i)
      const textDecorMatch = rawStyle.match(/(?:^|;)\s*text-decoration(?:-line)?\s*:\s*([^;]+)/i)

      let isBold = false
      if (fontWeightMatch) {
        const val = fontWeightMatch[1].trim().toLowerCase()
        if (val === 'bold' || val === 'bolder') {
          isBold = true
        } else {
          const num = parseInt(val, 10)
          if (!isNaN(num) && num >= 600 && num <= 900) {
            isBold = true
          }
        }
      }

      let isItalic = false
      if (fontStyleMatch) {
        const val = fontStyleMatch[1].trim().toLowerCase()
        if (val === 'italic' || val === 'oblique') {
          isItalic = true
        }
      }

      let isStrike = false
      if (textDecorMatch) {
        const val = textDecorMatch[1].trim().toLowerCase()
        if (val.includes('line-through')) {
          isStrike = true
        }
      }

      if (isBold || isItalic || isStrike) {
        // Wrap child nodes in semantic tags
        const fragment = doc.createDocumentFragment()
        while (el.firstChild) {
          fragment.appendChild(el.firstChild)
        }

        let inner: Node = fragment
        if (isStrike) {
          const s = doc.createElement('s')
          s.appendChild(inner)
          inner = s
        }
        if (isItalic) {
          const em = doc.createElement('em')
          em.appendChild(inner)
          inner = em
        }
        if (isBold) {
          const strong = doc.createElement('strong')
          strong.appendChild(inner)
          inner = strong
        }
        el.appendChild(inner)
      }
    }
  }

  // 5. Transform headings and block wrappers
  // h4, h5, h6 -> p
  const lowerHeadings = Array.from(body.querySelectorAll('h4, h5, h6'))
  for (const h of lowerHeadings) {
    const p = doc.createElement('p')
    while (h.firstChild) {
      p.appendChild(h.firstChild)
    }
    h.parentNode?.replaceChild(p, h)
  }

  // Unsupported container wrappers: div, section, article, header, footer, main, aside, figure, figcaption, address, nav, details, summary
  const containerSelectors =
    'div, section, article, header, footer, main, aside, figure, figcaption, address, nav, details, summary, fieldset'
  const containers = Array.from(body.querySelectorAll(containerSelectors))
  for (const container of containers) {
    if (containsBlockChild(container)) {
      unwrapElement(container)
    } else {
      // Check if parent is body or a container that expects a block
      const parentTag = container.parentElement?.tagName.toLowerCase()
      if (parentTag === 'body') {
        const p = doc.createElement('p')
        while (container.firstChild) {
          p.appendChild(container.firstChild)
        }
        container.parentNode?.replaceChild(p, container)
      } else {
        unwrapElement(container)
      }
    }
  }

  // 6. Handle inline formatting tags:
  // - b -> strong
  // - i -> em
  // - strike, del -> s
  // - u, ins, span, font, small, big, mark, abbr, cite, time -> unwrap
  const bTags = Array.from(body.querySelectorAll('b'))
  for (const b of bTags) {
    const strong = doc.createElement('strong')
    while (b.firstChild) {
      strong.appendChild(b.firstChild)
    }
    b.parentNode?.replaceChild(strong, b)
  }

  const iTags = Array.from(body.querySelectorAll('i'))
  for (const i of iTags) {
    const em = doc.createElement('em')
    while (i.firstChild) {
      em.appendChild(i.firstChild)
    }
    i.parentNode?.replaceChild(em, i)
  }

  const delTags = Array.from(body.querySelectorAll('strike, del'))
  for (const del of delTags) {
    const s = doc.createElement('s')
    while (del.firstChild) {
      s.appendChild(del.firstChild)
    }
    del.parentNode?.replaceChild(s, del)
  }

  // Unpack unsupported inline elements
  const unwrapInlineSelectors = 'u, ins, span, font, small, big, mark, abbr, cite, time, bdo, bdi, ruby, rt, rp'
  const inlineUnwraps = Array.from(body.querySelectorAll(unwrapInlineSelectors))
  for (const el of inlineUnwraps) {
    unwrapElement(el)
  }

  // 7. Normalize external links
  const links = Array.from(body.querySelectorAll('a'))
  for (const link of links) {
    const rawHref = link.getAttribute('href')
    const normalized = normalizeExternalUrl(rawHref)
    if (normalized) {
      link.setAttribute('href', normalized)
      // Strip all attributes except href
      for (const attr of Array.from(link.attributes)) {
        if (attr.name !== 'href') {
          link.removeAttribute(attr.name)
        }
      }
    } else {
      // Reject invalid or dangerous scheme (javascript:, data:, etc.) -> unwrap anchor text
      unwrapElement(link)
    }
  }

  // 8. Strip all remaining attributes from elements, keeping only the ones the
  // canonical vocabulary actually stores: link href, ordered-list start, code
  // language, and a table's merge spans and column widths.
  const remainingElements = Array.from(body.querySelectorAll('*'))
  for (const el of remainingElements) {
    const tag = el.tagName.toLowerCase()
    const attrs = Array.from(el.attributes)
    for (const attr of attrs) {
      if (tag === 'a' && attr.name === 'href') {
        continue
      }
      if (tag === 'ol' && attr.name === 'start') {
        const val = parseInt(attr.value, 10)
        if (!isNaN(val) && val > 0) {
          continue
        }
      }
      if (tag === 'code' && attr.name === 'class' && attr.value.startsWith('language-')) {
        continue
      }
      if (tag === 'col' && attr.name === 'width') {
        const val = parseInt(attr.value, 10)
        if (!isNaN(val) && val > 0) {
          continue
        }
      }
      if ((tag === 'td' || tag === 'th') && (attr.name === 'colspan' || attr.name === 'rowspan')) {
        const val = parseInt(attr.value, 10)
        if (!isNaN(val) && val > 0) {
          continue
        }
      }
      el.removeAttribute(attr.name)
    }
  }

  return body.innerHTML
}

function stripNonTextMarks(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      nodes.push(node)
      return
    }
    const content = node.content.size ? stripNonTextMarks(node.content) : node.content
    nodes.push(node.copy(content).mark([]))
  })
  return Fragment.fromArray(nodes)
}

export const RichPasteNormalization = Extension.create({
  name: 'richPasteNormalization',
  transformPastedHTML(html) {
    return normalizeRichPasteHTML(html)
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPasted: (slice: Slice) =>
            new Slice(stripNonTextMarks(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ]
  },
})
