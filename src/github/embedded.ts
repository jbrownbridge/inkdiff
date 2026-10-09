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

/** PR data fetched from GitHub's JSON routes, per document, when the embedded payload describes another page. */
const fetched = new WeakMap<Document, { repo: string; pr: number; payload: Json }>();
/** PRs already tried on this page, so a failed fetch is not repeated until the next navigation. */
const tried = new WeakMap<Document, Set<string>>();

function locationRepo(doc: Document): string | null {
  const m = doc.location?.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/\d+/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function scriptPayload(doc: Document, pr: number): Json | null {
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

/**
 * The page's embedded React payload, only when it describes PR `pr`; else data fetched for PR `pr`
 * on this page (see loadPrPayload). Missing, malformed, or belonging to another PR gives null.
 */
export function embeddedPayload(doc: Document, pr: number): Json | null {
  const own = scriptPayload(doc, pr);
  if (own) return own;
  const f = fetched.get(doc);
  return f && f.pr === pr && (locationRepo(doc) ?? f.repo) === f.repo ? f.payload : null;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const PAGE_DATA_TIMEOUT_MS = 10_000;

/**
 * After a soft navigation (from the pull request list, say), GitHub keeps the embedded payload of
 * the page it came from and fetches the PR's data separately. Fetch PR `pr`'s data from the same
 * JSON routes GitHub's page uses, once per navigation. Resolves true when new data arrived.
 */
export async function loadPrPayload(doc: Document, repo: string, pr: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (embeddedPayload(doc, pr)) return false;
  const key = `${repo}#${pr}`;
  const seen = tried.get(doc) ?? new Set<string>();
  tried.set(doc, seen);
  if (seen.has(key)) return false;
  seen.add(key);
  const [owner, name, ...rest] = repo.split('/');
  if (rest.length || !SEGMENT.test(owner ?? '') || !SEGMENT.test(name ?? '') || !Number.isInteger(pr) || pr <= 0) return false;
  const get = async (route: string): Promise<Json | null> => {
    try {
      const res = await fetchImpl(`https://github.com/${owner}/${name}/pull/${pr}/${route}`, {
        headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: AbortSignal.timeout(PAGE_DATA_TIMEOUT_MS),
      });
      return res.ok ? obj(obj(await res.json())?.payload) : null;
    } catch {
      return null;
    }
  };
  const [layout, changes] = await Promise.all([get('_layout'), get('changes')]);
  const payload: Json = { pullRequestsLayoutRoute: layout?.pullRequestsLayoutRoute, pullRequestsChangesRoute: changes?.pullRequestsChangesRoute };
  const layoutPr = obj(obj(payload.pullRequestsLayoutRoute)?.pullRequest)?.number;
  const changesPr = obj(obj(payload.pullRequestsChangesRoute)?.pullRequest)?.number;
  if (layoutPr !== pr || (changesPr !== undefined && changesPr !== pr)) return false;
  // The page may have moved on while the requests ran.
  if ((locationRepo(doc) ?? repo) !== repo) return false;
  fetched.set(doc, { repo, pr, payload });
  return true;
}

/** Drop data fetched for an earlier page (on navigation). */
export function forgetPrPayload(doc: Document): void {
  fetched.delete(doc);
  tried.delete(doc);
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
