import type { ThreadComment } from './types';
import { S } from './selectors';

type Json = Record<string, unknown>;

/** Keyed on the script element (GitHub replaces it on soft navigation); text guards in-place edits. */
const cache = new WeakMap<Element, { text: string; payload: Json | null }>();

function obj(v: unknown): Json | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function parsePayload(text: string): Json | null {
  try {
    return obj(obj(JSON.parse(text))?.payload);
  } catch {
    return null;
  }
}

function payloadPr(payload: Json): number | null {
  const n = obj(obj(payload.pullRequestsLayoutRoute)?.pullRequest)?.number
    ?? obj(obj(payload.pullRequestsChangesRoute)?.pullRequest)?.number;
  return typeof n === 'number' ? n : null;
}

/**
 * The page's embedded React payload, only when it describes PR `pr`.
 * Missing, malformed, or belonging to another PR (stale after soft navigation) gives null.
 */
export function embeddedPayload(doc: Document, pr: number): Json | null {
  const script = doc.querySelector(S.embeddedData);
  if (!script) return null;
  const text = script.textContent ?? '';
  let hit = cache.get(script);
  if (!hit || hit.text !== text) {
    hit = { text, payload: parsePayload(text) };
    cache.set(script, hit);
  }
  return hit.payload && payloadPr(hit.payload) === pr ? hit.payload : null;
}

export function embeddedHeadSha(doc: Document, pr: number): string | null {
  const sha = obj(obj(embeddedPayload(doc, pr)?.pullRequestsLayoutRoute)?.pullRequest)?.headSha;
  return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * False when the payload says the Changes tab shows a single commit or a commit range rather than
 * the full PR diff. A payload without comparison data counts as full.
 */
export function embeddedIsFullComparison(doc: Document, pr: number): boolean {
  const comparison = obj(obj(embeddedPayload(doc, pr)?.pullRequestsChangesRoute)?.comparison);
  if (!comparison) return true;
  const viewing = comparison.viewing;
  if (typeof viewing === 'string' && viewing !== 'FULL') return false;
  return comparison.selectedRange === null || comparison.selectedRange === undefined;
}

/** Comments of one thread from the embedded payload (a page-load snapshot); [] when absent. */
export function embeddedThreadComments(doc: Document, pr: number, threadId: string): ThreadComment[] {
  const threads = obj(obj(obj(embeddedPayload(doc, pr)?.pullRequestsChangesRoute)?.markers)?.threads);
  const comments = obj(obj(threads?.[threadId])?.commentsData)?.comments;
  if (!Array.isArray(comments)) return [];
  return comments.flatMap((c) => {
    const author = obj(obj(c)?.author)?.login;
    const avatarUrl = obj(obj(c)?.author)?.avatarUrl;
    const bodyHtml = obj(c)?.bodyHTML;
    const createdAt = obj(c)?.createdAt;
    if (typeof bodyHtml !== 'string') return [];
    const out: ThreadComment = { author: typeof author === 'string' ? author : '', bodyHtml };
    if (typeof avatarUrl === 'string') out.avatarUrl = avatarUrl;
    if (typeof createdAt === 'string') out.createdAt = createdAt;
    if (typeof obj(c)?.state === 'string' && (obj(c)!.state as string).toLowerCase() === 'pending') out.pending = true;
    return [out];
  });
}

/** Changed files listed in the payload: path and change type (e.g. ADDED, MODIFIED, DELETED). */
export function embeddedChangedFiles(doc: Document, pr: number): { path: string; changeType: string }[] {
  const list = obj(embeddedPayload(doc, pr)?.pullRequestsChangesRoute)?.diffSummaries;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => {
    const path = obj(d)?.path;
    const changeType = obj(d)?.changeType;
    return typeof path === 'string' ? [{ path, changeType: typeof changeType === 'string' ? changeType : '' }] : [];
  });
}
