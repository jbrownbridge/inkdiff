// Rendered blocks: finding them by source range, placing our UI among them, and marking what changed.
import { isBlockChanged, type LineRange, type RemovedRun } from '../core/diff-map';
import { leafRanges } from '../core/hunks';
import type { Block } from '../render/render';
import { button, div } from './dom';

const rangeOf = (el: HTMLElement): LineRange => ({ start: Number(el.dataset.srcStart), end: Number(el.dataset.srcEnd) });

function insertAfterBlock(anchor: HTMLElement, node: HTMLElement): void {
  const host = anchor.tagName === 'TR' ? (anchor.closest('table') as HTMLElement) : anchor;
  host.after(node);
}

/**
 * Put a comment UI node where the reader sees `endLine`: after its block, except for an item's own
 * text, where it goes right under that text, above the item's nested list or code.
 */
export function insertAtLine(anchor: HTMLElement, endLine: number, node: HTMLElement): void {
  if (anchor.tagName === 'LI') {
    const next = [...anchor.children].find((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-src-start') && Number(c.dataset.srcStart) > endLine);
    if (next) { next.before(node); return; }
  }
  insertAfterBlock(anchor, node);
}

export function findBlockEl(body: HTMLElement, b: Block): HTMLElement | null {
  const all = body.querySelectorAll<HTMLElement>(`[data-src-start="${b.start}"][data-src-end="${b.end}"]`);
  return all.length ? all[all.length - 1] : null;
}

/** Every block element by its range (the innermost one wins), in one pass: lookups stay O(1). */
export function blockIndex(body: HTMLElement): Map<string, HTMLElement> {
  const index = new Map<string, HTMLElement>();
  for (const el of body.querySelectorAll<HTMLElement>('[data-src-start]')) index.set(`${el.dataset.srcStart}:${el.dataset.srcEnd}`, el);
  return index;
}

export function markChanged(body: HTMLElement, changedLines: number[]): void {
  const changed = new Set(changedLines);
  const els = [...body.querySelectorAll<HTMLElement>('[data-src-start]')];
  for (const el of els) {
    const r = rangeOf(el);
    if (isBlockChanged({ ...r, kind: '' }, changed)) el.classList.add('mdr-changed');
  }
  for (const el of els) if (el.querySelector('.mdr-changed')) el.classList.remove('mdr-changed');
  // Code is tinted per line, like GitHub's added rows.
  for (const span of body.querySelectorAll<HTMLElement>('pre span[data-src-line]'))
    if (changed.has(Number(span.dataset.srcLine))) span.classList.add('mdr-line-changed');
}

export function isAllChanged(changedLines: number[], lineCount: number | undefined): boolean {
  if (!lineCount || changedLines.length === 0) return false;
  const changed = new Set(changedLines);
  for (let line = 1; line <= lineCount; line++) if (!changed.has(line)) return false;
  return true;
}

export function insertRemoved(doc: Document, body: HTMLElement, run: RemovedRun, reveal: (line: number) => void): void {
  const marker = button(doc, 'mdr-removed', `${run.count} ${run.count === 1 ? 'line' : 'lines'} removed`);
  marker.addEventListener('click', () => reveal(Math.max(1, run.afterLine)));
  const tops = [...body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-src-start'));
  const host =
    tops.find((t) => rangeOf(t).start <= run.afterLine && run.afterLine <= rangeOf(t).end) ??
    [...tops].reverse().find((t) => rangeOf(t).end < run.afterLine);
  if (run.afterLine === 0 || !host) body.prepend(marker);
  else host.after(marker);
}

/**
 * Changed lines that render as nothing (link definitions such as `[//]: # (…)`, and anything else
 * outside every block) show as a note at their place: the rendered view replaces the source diff,
 * so a change must never be invisible.
 */
export function insertUnseenLines(doc: Document, body: HTMLElement, blocks: Block[], changed: number[], lines: string[]): void {
  // Leaf blocks hold the visible content; a container (list, quote, table) also spans lines that
  // render as nothing, such as a link definition inside a list item.
  const leaves = leafRanges(blocks);
  const covered = new Uint8Array(lines.length + 2);
  for (const b of leaves) for (let n = b.start; n <= b.end && n <= lines.length; n++) covered[n] = 1;
  // Pure syntax lines show as structure, not text: blank, quote markers, table delimiters, list markers.
  const syntax = (t: string) => /^[\s>]*([-*+]|\d+[.)])?\s*$/.test(t) || /^[\s>]*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(t);
  const unseen = [...new Set(changed)].filter((n) => n >= 1 && n <= lines.length && !covered[n] && !syntax(lines[n - 1])).sort((a, b) => a - b);
  if (!unseen.length) return;
  const runs: number[][] = [];
  for (const n of unseen) {
    const run = runs[runs.length - 1];
    if (run && n - run[run.length - 1] <= 2) run.push(n);
    else runs.push([n]);
  }
  const index = blockIndex(body);
  // Leaves sorted by end: walk them alongside the runs to find the last leaf before each run.
  const byEnd = [...leaves].sort((a, b) => a.end - b.end);
  let i = -1;
  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    while (i + 1 < byEnd.length && byEnd[i + 1].end < first) i++;
    const note = div(doc, 'mdr-unseen-lines');
    note.setAttribute('role', 'note');
    const label = div(doc, 'mdr-unseen-label', first === last ? `Line ${first} changed; it does not show in the rendered view:` : `Lines ${first}–${last} changed; they do not show in the rendered view:`);
    const pre = doc.createElement('pre');
    pre.textContent = lines.slice(first - 1, last).join('\n');
    note.append(label, pre);
    const host = i >= 0 ? index.get(`${byEnd[i].start}:${byEnd[i].end}`) : undefined;
    // After the leaf that ends just before (inside its list item or quote), else first in the file.
    // A row or a tight list item cannot hold a note: it goes after the table or list.
    const place = host && (host.tagName === 'TR' || host.tagName === 'LI') ? host.closest('table, ul, ol') ?? host : host;
    if (place) place.after(note);
    else body.prepend(note);
  }
}


/** The outermost element with the same source range as `el` (a loose list's li, not its p). */
export function rowAnchor(el: HTMLElement | null): HTMLElement | null {
  let n = el;
  while (n?.parentElement && n.parentElement.dataset.srcStart === n.dataset.srcStart && n.parentElement.dataset.srcEnd === n.dataset.srcEnd) n = n.parentElement;
  return n;
}

/** `el`, or the last of our own UI nodes (threads, composer) that directly follow it. */
export function afterOwnUi(el: HTMLElement): HTMLElement {
  let n = el;
  while (n.nextElementSibling instanceof HTMLElement && n.nextElementSibling.matches(FOLLOWING_UI)) n = n.nextElementSibling;
  return n;
}

/** Our UI that sits right after a block (threads, composer, notes); a hunk row starts the next gap. */
const FOLLOWING_UI = '.mdr-thread, .mdr-gh-thread, .mdr-comment-form, .mdr-native-tools, .mdr-native-host, .mdr-native-pending, .mdr-removed, .mdr-unseen-lines';
/** Our own UI inside the body: hover and selection there never target a block. */
const OWN_UI = `${FOLLOWING_UI}, .mdr-hunk`;

export const inOwnUi = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest(OWN_UI) != null;
