import type { LineRange } from './diff-map';

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function lineOf(node: Node, edge: 'start' | 'end'): number | null {
  const el = elementOf(node);
  const lineEl = el?.closest('[data-src-line]');
  if (lineEl) return Number(lineEl.getAttribute('data-src-line'));
  const block = el?.closest('[data-src-start]');
  if (!block) return null;
  return Number(block.getAttribute(edge === 'start' ? 'data-src-start' : 'data-src-end'));
}

function lastTextBefore(root: Element, boundary: Node): Text | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let prev: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const after = n === boundary || boundary.contains(n) || (boundary.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (after) break;
    if (n.textContent?.trim()) prev = n as Text;
  }
  return prev;
}

export function rangeToLines(range: Range, root: Element): LineRange | null {
  if (range.collapsed) return null;
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = lineOf(range.startContainer, 'start');
  let endNode: Node = range.endContainer;
  if (range.endOffset === 0 && range.endContainer !== range.startContainer) {
    const prev = lastTextBefore(root, range.endContainer);
    if (prev) endNode = prev;
  }
  const end = lineOf(endNode, 'end');
  if (start === null || end === null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
