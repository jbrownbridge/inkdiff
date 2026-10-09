import type { DiffInfo } from '../core/diff-map';
import type { Hunk } from '../core/hunks';
import { summarizeRows, type DiffRow } from './diff-rows';
import { isSafeRef } from '../core/source-fetch';
import { inGitHubPlace, isOrphan } from './hosted-homes';
import { embeddedChangedFiles, embeddedHeadSha, embeddedIsFullComparison, embeddedThreadComments } from './embedded';
import { S } from './selectors';
import { fileKind, type MdFile, type ThreadComment, type ThreadInfo } from './types';

const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e]/g;

export function parsePrUrl(url: URL): { repo: string; pr: number } | null {
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  return m ? { repo: `${m[1]}/${m[2]}`, pr: Number(m[3]) } : null;
}

export function pageLooksSupported(doc: Document): boolean {
  return doc.querySelector(S.fileContainer) !== null;
}

/** Head SHA of PR `pr`; null when the embedded payload is missing or describes another PR. */
export function readHeadSha(doc: Document, pr: number): string | null {
  return embeddedHeadSha(doc, pr);
}

function readPath(container: HTMLElement): string {
  const code = container.querySelector(S.filePath)?.textContent?.replace(BIDI_MARKS, '').trim();
  if (code) return code;
  const label = container.querySelector(S.filePathLabelled)?.getAttribute('aria-label') ?? '';
  return label.startsWith(S.filePathLabelPrefix) ? label.slice(S.filePathLabelPrefix.length).trim() : '';
}

/** A commit or range selected in the Changes tab: anything after /files or /changes. */
export function selectsCommits(url: URL): boolean {
  return /^\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)\/[^/]/.test(url.pathname);
}

/**
 * Markdown files of the full PR diff. Empty on commit and range views: the panel renders the PR
 * head, which would not match a partial diff.
 */
export function findMarkdownFiles(doc: Document, url: URL): MdFile[] {
  const pr = parsePrUrl(url);
  const headSha = pr ? readHeadSha(doc, pr.pr) : null;
  if (!pr || !headSha || selectsCommits(url) || !embeddedIsFullComparison(doc, pr.pr)) return [];
  // A deleted file has no source at the head commit: GitHub's own diff is the right view.
  const deleted = new Set(embeddedChangedFiles(doc, pr.pr).filter((f) => DELETED.test(f.changeType)).map((f) => f.path));
  return [...doc.querySelectorAll<HTMLElement>(S.fileContainer)]
    .map((container) => ({ container, path: readPath(container) }))
    .flatMap((f) => {
      const kind = fileKind(f.path);
      return kind && !deleted.has(f.path) ? [{ ...f, kind, ...pr, headSha }] : [];
    });
}

const DELETED = /^(DELETED|REMOVED)$/i;

/** At most this many files are fetched ahead of time (idle, low priority); the rest load as they near the view. */
const PREFETCH_MAX = 25;

/** Every Markdown/Mermaid file the PR changes and keeps, from the page payload (before GitHub draws them). */
export function markdownRefs(doc: Document, url: URL): { repo: string; sha: string; path: string }[] {
  const pr = parsePrUrl(url);
  const sha = pr ? readHeadSha(doc, pr.pr) : null;
  if (!pr || !sha || selectsCommits(url) || !embeddedIsFullComparison(doc, pr.pr)) return [];
  return embeddedChangedFiles(doc, pr.pr)
    .filter((f) => fileKind(f.path) && !DELETED.test(f.changeType))
    .map((f) => ({ repo: pr.repo, sha, path: f.path }))
    .filter(isSafeRef)
    .slice(0, PREFETCH_MAX);
}

function accessibleName(el: HTMLElement): string {
  const ids = el.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  const byIds = ids.map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim();
  return byIds || el.getAttribute('aria-label') || el.textContent?.trim() || '';
}

function findToggle(file: MdFile, labels: readonly string[], icon: string): HTMLElement | null {
  const buttons = [...file.container.querySelectorAll<HTMLElement>(S.viewToggleButton)];
  const wanted = labels.map((l) => l.toLowerCase());
  return buttons.find((b) => wanted.some((l) => accessibleName(b).toLowerCase().includes(l)))
    ?? buttons.find((b) => b.querySelector(icon) !== null)
    ?? null;
}

export function richToggle(file: MdFile): HTMLElement | null {
  return findToggle(file, S.richToggleLabels, S.richToggleIcon);
}

export function sourceToggle(file: MdFile): HTMLElement | null {
  return findToggle(file, S.sourceToggleLabels, S.sourceToggleIcon);
}

export function diffBody(file: MdFile): HTMLElement | null {
  return file.container.querySelector<HTMLElement>(S.diffBody);
}

function rightOf(cell: Element): number | null {
  const key = cell.getAttribute(S.lineKeyAttr)?.match(/(?:^|-)r:(\d+)/);
  if (key) return Number(key[1]);
  const n = cell.matches(S.rightLineNumber) ? Number(cell.getAttribute('data-line-number')) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cellKind(code: Element): DiffRow['kind'] {
  if (code.classList.contains(S.delRow)) return 'del';
  if (code.classList.contains(S.addRow)) return 'add';
  return 'ctx';
}

/**
 * Rows of one <tr>. Split view: the left half comes first as 'del', then the right half. A context
 * row appears once, read from its right cell when the row has one.
 */
function rowsOf(tr: Element): DiffRow[] {
  const out: DiffRow[] = [];
  for (const cell of tr.querySelectorAll(S.rowCell)) {
    const code = cell.querySelector(S.rowCode);
    if (!code) continue;
    const kind = cellKind(code);
    const text = cell.querySelector(S.rowText)?.textContent ?? '';
    const row: DiffRow = { kind, right: kind === 'del' ? null : rightOf(cell), text };
    const ctx = kind === 'ctx' ? out.findIndex((r) => r.kind === 'ctx') : -1;
    if (ctx < 0) out.push(row);
    else if (cell.getAttribute('data-diff-side') === 'right') out[ctx] = row;
  }
  return out;
}

export function readDiffRows(file: MdFile): DiffRow[] {
  const body = diffBody(file);
  return body ? [...body.querySelectorAll(S.diffRow)].flatMap(rowsOf) : [];
}

export function readDiff(file: MdFile): DiffInfo {
  return summarizeRows(readDiffRows(file));
}

export function findRightLineRow(file: MdFile, line: number): HTMLElement | null {
  const body = diffBody(file);
  if (!body) return null;
  const cell = [...body.querySelectorAll(S.rowCell)].find((c) => rightOf(c) === line && !c.querySelector(`.${S.delRow}`));
  return cell?.closest<HTMLElement>(S.diffRow) ?? null;
}

/** Left line of a row, read only from left-side cells (an add row's key carries the previous left line). */
function leftOfRow(tr: Element): number | null {
  const cell = tr.querySelector(S.leftSide);
  const n = Number(cell?.getAttribute('data-line-number') ?? cell?.getAttribute(S.lineKeyAttr)?.match(/(?:^|-)l:(\d+)/)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** First right line at or after the row holding left line `left` (a del row's key carries the previous right line). */
function rightAtOrAfterLeft(body: Element, left: number): number | null {
  const trs = [...body.querySelectorAll(S.diffRow)];
  const from = trs.findIndex((tr) => leftOfRow(tr) === left);
  if (from < 0) return null;
  for (const tr of trs.slice(from)) {
    const right = rowsOf(tr).find((r) => r.kind !== 'del' && r.right !== null)?.right;
    if (right) return right;
  }
  return null;
}

/**
 * Right-side line range of a thread. A left (old-file) line maps to the first right line at or
 * after its row, so a thread on removed lines shows where they were: "L<a> to R<b>" starts there,
 * and "L<a>" or "L<a> to L<b>" sits on the line after the removal. Null when a left line has no
 * right line at or after it, or the thread cannot be placed.
 */
function threadLines(el: Element): { startLine: number; endLine: number } | null {
  const m = el.querySelector(S.threadHeading)?.textContent?.match(/\b([LR])(\d+)(?:\s+to\s+([LR])(\d+))?/);
  if (m) {
    const body = inGitHubPlace(el).closest(S.diffBody);
    const right = (side: string, n: number) => (side === 'R' ? n : body ? rightAtOrAfterLeft(body, n) : null);
    const startLine = right(m[1], Number(m[2]));
    const endLine = right(m[3] ?? m[1], Number(m[4] ?? m[2]));
    if (startLine === null || endLine === null) return null;
    return { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) };
  }
  const cell = inGitHubPlace(el).closest(S.rowCell);
  const end = cell?.getAttribute('data-diff-side') === 'right' ? rightOf(cell) : null;
  return end ? { startLine: end, endLine: end } : null;
}

/**
 * Visible name of the nearest author link. Skips the image-only avatar link (no text) and
 * @mentions, which are user links inside the comment body.
 */
function authorIn(box: Element): string {
  return [...box.querySelectorAll(S.commentAuthor)]
    .filter((a) => !a.closest(S.commentBody))
    .map((a) => a.textContent?.trim() ?? '')
    .find((name) => name && !name.startsWith('@')) ?? '';
}

/** Avatar, time and Pending label of one comment, read outside its body; only the keys found. */
function detailsIn(box: Element): Partial<ThreadComment> {
  const out: Partial<ThreadComment> = {};
  const outside = (n: Element) => !n.closest(S.commentBody);
  const avatar = [...box.querySelectorAll<HTMLImageElement>('img')].filter(outside).map(githubAvatar).find(Boolean);
  if (avatar) out.avatarUrl = avatar;
  const time = [...box.querySelectorAll(S.commentTime)].filter(outside)[0]?.getAttribute('datetime');
  if (time) out.createdAt = time;
  if ([...box.querySelectorAll(S.threadLabel)].some((l) => outside(l) && l.textContent?.trim() === S.commentPendingText)) out.pending = true;
  return out;
}

/** One entry per rendered comment: wrappers that hold another body (e.g. `.comment-body > .markdown-body`) are skipped. */
function domComments(el: Element): ThreadComment[] {
  return [...el.querySelectorAll(S.commentBody)].filter((body) => !body.querySelector(S.commentBody)).map((body) => {
    let box: Element | null = body.parentElement;
    while (box && box !== el && !authorIn(box)) box = box.parentElement;
    return { author: box ? authorIn(box) : '', bodyHtml: body.innerHTML, ...(box ? detailsIn(box) : {}) };
  });
}

function readThread(el: Element, pr: number): ThreadInfo | null {
  const id = el.getAttribute(S.threadIdAttr);
  const lines = threadLines(el);
  if (!id || !lines) return null;
  const resolved = [...el.querySelectorAll(S.threadLabel)].some((l) => l.textContent?.trim() === S.threadResolvedText);
  const dom = domComments(el);
  const comments = dom.length ? dom : embeddedThreadComments(el.ownerDocument, pr, id);
  return { id, ...lines, resolved, comments };
}

/** GitHub's live thread elements in this file: hosted ones whose home GitHub removed are gone. */
function liveThreadEls(file: MdFile): HTMLElement[] {
  return [...file.container.querySelectorAll<HTMLElement>(S.thread)].filter((el) => !isOrphan(el));
}

/** Posted threads only: a marker with no comment is an open, unsent comment form. */
export function readThreads(file: MdFile): ThreadInfo[] {
  return liveThreadEls(file)
    .flatMap((el) => readThread(el, file.pr) ?? [])
    .filter((t) => t.comments.length > 0);
}

export function threadMarkers(file: MdFile): { id: string; el: HTMLElement }[] {
  return liveThreadEls(file).flatMap((el) => {
    const id = el.getAttribute(S.threadIdAttr);
    return id && el.matches(`:not(${S.newCommentMarker})`) && threadLines(el) ? [{ id, el }] : [];
  });
}

/**
 * False when the file shows review threads but none of them can be placed on a line: GitHub's
 * thread markup changed. The rendered view would then silently drop every comment.
 */
export function threadsReadable(file: MdFile): boolean {
  const els = liveThreadEls(file).filter((el) => el.matches(`:not(${S.newCommentMarker})`));
  return els.length === 0 || els.some((el) => threadLines(el) !== null);
}

export function findThread(file: MdFile, threadId: string): HTMLElement | null {
  return [...file.container.querySelectorAll<HTMLElement>(S.thread)].find((el) => el.getAttribute(S.threadIdAttr) === threadId) ?? null;
}

export function readHunks(file: MdFile): Hunk[] {
  const body = diffBody(file);
  if (!body) return [];
  const out: Hunk[] = [];
  let open: string | null = null;
  for (const tr of body.querySelectorAll(S.diffRow)) {
    if (tr.querySelector(S.hunkCell)) {
      const text = tr.querySelector(S.hunkText)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      open = text || null;
      continue;
    }
    if (open === null) continue;
    const right = rowsOf(tr).find((r) => r.kind !== 'del' && r.right !== null)?.right;
    if (right) { out.push({ header: open, start: right }); open = null; }
  }
  return out;
}

function githubAvatar(img: HTMLImageElement | null): string | null {
  if (!img) return null;
  try { return new URL(img.src).host === S.avatarHost ? img.src : null; } catch { return null; /* bad URL */ }
}

export function viewerLogin(doc: Document): string | null {
  return doc.querySelector(S.viewerLogin)?.getAttribute('content') || null;
}

/** The signed-in viewer's avatar: the user-menu avatar, else an `img[alt="@<login>"]`. GitHub-hosted only. */
export function viewerAvatar(doc: Document): string | null {
  const menu = githubAvatar(doc.querySelector<HTMLImageElement>(S.viewerMenuAvatar));
  if (menu) return menu;
  const login = doc.querySelector(S.viewerLogin)?.getAttribute('content');
  if (!login) return null;
  for (const img of doc.querySelectorAll<HTMLImageElement>('img')) {
    if (img.alt !== `@${login}`) continue;
    const src = githubAvatar(img);
    if (src) return src;
  }
  return null;
}
