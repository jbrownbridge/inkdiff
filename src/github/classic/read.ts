import type { DiffInfo } from '../../core/diff-map';
import type { Hunk } from '../../core/hunks';
import { summarizeRows, type DiffRow } from '../diff-rows';
import { parsePrUrl, selectsCommits } from '../read';
import { fileKind, type MdFile, type ThreadComment, type ThreadInfo } from '../types';
import { C } from './selectors';

const SHA40 = /^[0-9a-f]{40}$/i;

export function pageLooksSupported(doc: Document): boolean {
  return doc.querySelector(C.file) !== null && doc.querySelector(C.newPageRegion) === null;
}

function readHeadSha(doc: Document): string | null {
  const action = doc.querySelector(C.toggleForm)?.getAttribute('action');
  let sha: string | null = null;
  if (action) {
    try { sha = new URL(action, 'https://github.com').searchParams.get('sha2'); } catch { /* bad URL */ }
  }
  if (!sha || !SHA40.test(sha)) {
    const data = doc.querySelector(C.comparisonUrl)?.getAttribute('data-url');
    try { sha = data ? new URL(data, 'https://github.com').searchParams.get('end_commit_oid') : null; } catch { sha = null; }
  }
  return sha && SHA40.test(sha) ? sha : null;
}

/** Markdown files of the full PR diff; empty on commit and range views. */
export function findMarkdownFiles(doc: Document, url: URL): MdFile[] {
  const pr = parsePrUrl(url);
  if (!pr || selectsCommits(url)) return [];
  const headSha = readHeadSha(doc);
  if (!headSha) return [];
  return [...doc.querySelectorAll<HTMLElement>(C.file)]
    .filter((container) => container.getAttribute(C.deletedAttr) !== 'true')
    .map((container) => ({ container, path: container.getAttribute(C.pathAttr) ?? '' }))
    .flatMap((f) => {
      const kind = fileKind(f.path);
      return kind ? [{ ...f, kind, ...pr, headSha }] : [];
    });
}

export function richToggle(file: MdFile): HTMLElement | null {
  return file.container.querySelector<HTMLElement>(C.richToggle);
}

export function sourceToggle(file: MdFile): HTMLElement | null {
  return file.container.querySelector<HTMLElement>(C.sourceToggle);
}

export function diffBody(file: MdFile): HTMLElement | null {
  return file.container.querySelector<HTMLElement>(C.diffTable);
}

function rightNumber(cell: Element): number | null {
  const m = cell.id.match(/R(\d+)$/);
  return m ? Number(m[1]) : null;
}

function kindOf(cell: Element): DiffRow['kind'] | null {
  if (cell.classList.contains(C.delCode)) return 'del';
  if (cell.classList.contains(C.addCode)) return 'add';
  if (cell.classList.contains('blob-code-context')) return 'ctx';
  return null;
}

/** Rows of one `tr`: unified has one code cell, split has two (old side first). */
function rowsOf(tr: Element): DiffRow[] {
  if (tr.querySelector(C.hunkCode)) return [];
  const cells = [...tr.querySelectorAll(C.codeCell)];
  const out: DiffRow[] = [];
  cells.forEach((cell, i) => {
    const kind = kindOf(cell);
    if (!kind) return;
    if (cells.length > 1 && i === 0 && kind !== 'del') return; // context and additions come from the right side
    // The number cells that precede this code cell (back to the previous code cell).
    let right: number | null = null;
    for (let n = cell.previousElementSibling; n && !n.matches(C.codeCell); n = n.previousElementSibling) {
      if (n.matches(C.numCell)) right = right ?? rightNumber(n);
    }
    if (kind === 'del') right = null;
    out.push({ kind, right, text: cell.querySelector(C.codeInner)?.textContent ?? '' });
  });
  return out;
}

/** Diff rows of the table: comment rows, and any table inside them (a suggested change), are not diff rows. */
function diffTrs(body: Element): Element[] {
  return [...body.querySelectorAll('tr')].filter((tr) => !tr.closest(C.inlineCommentsRow));
}

function readRows(file: MdFile): DiffRow[] {
  const body = diffBody(file);
  return body ? diffTrs(body).flatMap(rowsOf) : [];
}

export function readDiff(file: MdFile): DiffInfo {
  return summarizeRows(readRows(file));
}

export function readHunks(file: MdFile): Hunk[] {
  const body = diffBody(file);
  if (!body) return [];
  const out: Hunk[] = [];
  let open: string | null = null;
  for (const tr of diffTrs(body)) {
    const hunk = tr.querySelector(C.hunkCode);
    if (hunk) {
      const text = hunk.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      open = text.startsWith('@@') ? text : null;
      continue;
    }
    if (open === null) continue;
    const right = rowsOf(tr).find((r) => r.right !== null)?.right;
    if (right) { out.push({ header: open, start: right }); open = null; }
  }
  return out;
}

/** The last right-side line of the nearest diff row before `row`; null when that row has none. */
function lineAbove(row: Element): number | null {
  for (let p = row.previousElementSibling; p; p = p.previousElementSibling) {
    if (p.matches(C.inlineCommentsRow)) continue;
    const rights = rowsOf(p).map((r) => r.right).filter((r): r is number => r !== null);
    return rights.length ? rights[rights.length - 1] : null;
  }
  return null;
}

/** First right line at or after the row holding old-side line `left`. */
function firstRightFromLeft(file: MdFile, left: number): number | null {
  const cell = [...file.container.querySelectorAll(C.numCell)].find((c) => !c.closest(C.inlineCommentsRow) && new RegExp(`L${left}$`).test(c.id));
  for (let tr: Element | null = cell?.closest('tr') ?? null; tr; tr = tr.nextElementSibling) {
    if (tr.matches(C.inlineCommentsRow)) continue;
    const r = rowsOf(tr).find((x) => x.right !== null)?.right;
    if (r != null) return r;
  }
  return null;
}

function parseSigned(el: Element | null): { sign: '+' | '-'; n: number } | null {
  const m = el?.textContent?.trim().match(/^([+-])\s*(\d+)$/);
  return m ? { sign: m[1] as '+' | '-', n: Number(m[2]) } : null;
}

/** True when `el` sits in the old-side (left) half of a split-view comment row. */
function inLeftHalf(el: Element, row: Element): boolean {
  const cells = [...row.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  if (cells.length < 2) return false; // unified view: one cell spans the row
  let cell: Element | null = el.closest('td, th');
  while (cell && cell.parentElement !== row) cell = cell.parentElement?.closest('td, th') ?? null;
  if (!cell) return false;
  const span = (c: Element) => Math.max(1, Number(c.getAttribute('colspan')) || 1);
  const total = cells.reduce((n, c) => n + span(c), 0);
  let offset = 0;
  for (const c of cells) { if (c === cell) break; offset += span(c); }
  return offset < total / 2;
}

function readLines(file: MdFile, el: Element, row: Element): { startLine: number; endLine: number } | null {
  const startEl = el.querySelector(C.threadStart);
  const endEl = el.querySelector(C.threadEnd);
  if (!startEl || !endEl) {
    // A single-line thread on the old side has no right-side line.
    if (inLeftHalf(el, row)) return null;
    const line = lineAbove(row);
    return line === null ? null : { startLine: line, endLine: line };
  }
  const start = parseSigned(startEl);
  const end = parseSigned(endEl);
  if (!start || !end || end.sign === '-') return null;
  const startLine = start.sign === '+' ? start.n : firstRightFromLeft(file, start.n);
  return startLine === null ? null : { startLine, endLine: end.n };
}

function readComments(el: Element): ThreadComment[] {
  const out: ThreadComment[] = [];
  let author = '';
  for (const n of el.querySelectorAll(`${C.commentAuthor}, ${C.commentBody}`)) {
    if (n.closest(C.commentBody) && !n.matches(C.commentBody)) continue;
    if (n.matches(C.commentBody)) out.push({ author, bodyHtml: n.innerHTML });
    else author = n.textContent?.trim() ?? '';
  }
  return out;
}

export function readThreads(file: MdFile): ThreadInfo[] {
  const out: ThreadInfo[] = [];
  for (const row of file.container.querySelectorAll(C.inlineCommentsRow)) {
    for (const el of row.querySelectorAll(C.thread)) {
      const frameId = (el.closest(C.threadFrame) ?? el.querySelector(C.threadFrame))?.id;
      if (!frameId) continue;
      const lines = readLines(file, el, row);
      const comments = readComments(el);
      if (!lines || comments.length === 0) continue;
      out.push({ id: frameId.slice(C.threadFramePrefix.length), ...lines, resolved: el.getAttribute('data-resolved') === 'true', comments });
    }
  }
  return out;
}

export function findLineCell(file: MdFile, line: number): HTMLElement | null {
  return file.container.querySelector<HTMLElement>(`${C.numCell}:not(.blob-num-hunk)[id$="R${line}"]`);
}
