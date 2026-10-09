import type { ThreadComment, ThreadInfo } from '../github/types';
import { sanitizeComment } from '../render/sanitize';
import { button, div } from './dom';

export interface ThreadActions {
  revealLine(line: number): void;
}

export interface ThreadOptions {
  /** For tests: the current time in ms. */
  now?: number;
}

const AVATAR_HOST = 'avatars.githubusercontent.com';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub-style short relative time: "just now", "5m ago", "3h ago", "2d ago", then "Aug 1". */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function githubAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host === AVATAR_HOST ? url : null; } catch { return null; /* bad URL */ }
}

function label(doc: Document, text: string, kind?: string): HTMLElement {
  const l = doc.createElement('span');
  l.className = kind ? `mdr-label mdr-label-${kind}` : 'mdr-label';
  l.textContent = text;
  return l;
}

function renderComment(doc: Document, c: ThreadComment, now: number | undefined): HTMLElement {
  const item = div(doc, 'mdr-comment');
  const head = div(doc, 'mdr-comment-head');
  const avatar = githubAvatar(c.avatarUrl);
  if (avatar) {
    const img = doc.createElement('img');
    img.className = 'mdr-avatar';
    img.src = avatar;
    img.alt = '';
    head.append(img);
  }
  const who = doc.createElement('strong');
  who.className = 'mdr-author';
  who.textContent = c.author;
  head.append(who);
  const ago = c.createdAt ? timeAgo(c.createdAt, now) : '';
  if (ago) {
    const time = doc.createElement('span');
    time.className = 'mdr-time';
    time.textContent = ago;
    time.title = new Date(c.createdAt!).toLocaleString();
    head.append(time);
  }
  if (c.pending) head.append(label(doc, 'Pending', 'pending'));
  const body = div(doc, 'mdr-comment-body markdown-body');
  body.innerHTML = sanitizeComment(c.bodyHtml);
  item.append(head, body);
  return item;
}

/**
 * A review thread drawn like GitHub's: heading and one card per comment. Used where GitHub's own
 * thread element cannot be hosted (logged out, or switched off); replies happen in GitHub's view.
 */
export function renderThread(doc: Document, t: ThreadInfo, a: ThreadActions, opts: ThreadOptions = {}): HTMLElement {
  const root = doc.createElement('details');
  root.className = 'mdr-thread';
  root.dataset.threadId = t.id;
  root.open = !t.resolved;

  const summary = doc.createElement('summary');
  summary.className = 'mdr-thread-head';
  const title = doc.createElement('span');
  title.className = 'mdr-thread-title';
  title.textContent = t.startLine === t.endLine ? `Comment on line R${t.endLine}` : `Comment on lines R${t.startLine} to R${t.endLine}`;
  summary.append(title);
  if (t.resolved) summary.append(label(doc, 'Resolved'));
  root.append(summary);

  const list = div(doc, 'mdr-comments');
  for (const c of t.comments) list.append(renderComment(doc, c, opts.now));
  root.append(list);

  const view = button(doc, 'mdr-link', 'View in source');
  view.addEventListener('click', () => a.revealLine(t.endLine));
  const foot = div(doc, 'mdr-thread-foot');
  const actions = div(doc, 'mdr-actions');
  actions.append(view);
  foot.append(actions);
  root.append(foot);
  return root;
}

/**
 * Stand-in for a comment GitHub is still posting: drawn like the thread it becomes, at the same
 * place, so nothing jumps when the real one arrives.
 */
export function renderPostingThread(doc: Document, lines: { start: number; end: number }, c: { author: string; avatarUrl?: string | null; text: string }): HTMLElement {
  const root = div(doc, 'mdr-thread mdr-thread-posting');
  const head = div(doc, 'mdr-thread-head');
  const title = doc.createElement('span');
  title.className = 'mdr-thread-title';
  title.textContent = lines.start === lines.end ? `Comment on line R${lines.end}` : `Comment on lines R${lines.start} to R${lines.end}`;
  head.append(title, label(doc, 'Posting…', 'posting'));
  const comment = renderComment(doc, { author: c.author, avatarUrl: c.avatarUrl, bodyHtml: '' }, undefined);
  const body = comment.querySelector<HTMLElement>('.mdr-comment-body')!;
  body.classList.add('mdr-plain');
  body.textContent = c.text;
  const list = div(doc, 'mdr-comments');
  list.append(comment);
  root.append(head, list);
  return root;
}
