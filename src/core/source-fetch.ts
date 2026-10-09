import type { SourceStore } from './session-cache';

export const MAX_SOURCE_BYTES = 1_000_000;

export type SourceErrorReason = 'network' | 'not-found' | 'too-large' | 'http';

export class SourceError extends Error {
  /** The HTTP status, for 'http' errors. */
  constructor(readonly reason: SourceErrorReason, message: string, readonly status?: number) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface SourceRef {
  repo: string;
  sha: string;
  path: string;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * Whether a ref can only name a file in its own repo: owner/name, a hex commit, and a path with no
 * empty, "." or ".." segment (which URL normalisation would turn into another github.com URL).
 */
export function isSafeRef({ repo, sha, path }: SourceRef): boolean {
  const plain = (seg: string) => seg !== '' && seg !== '.' && seg !== '..';
  return REPO.test(repo) && repo.split('/').every(plain) && /^[0-9a-f]+$/i.test(sha) && path.split('/').every(plain);
}

/** The raw host's own URL for a file: one round trip, no redirect; public repos only. */
export function directRawUrl({ repo, sha, path }: SourceRef): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function rawUrl({ repo, sha, path }: SourceRef): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repo}/raw/${sha}/${encoded}`;
}

export interface FetchOptions {
  /** Low network priority, for prefetching. */
  low?: boolean;
  /** Fetch from raw.githubusercontent.com directly, without cookies (public repos only). */
  direct?: boolean;
  /** Give up after this long (default FETCH_TIMEOUT_MS). */
  timeoutMs?: number;
}

export const FETCH_TIMEOUT_MS = 20_000;
/** Sources kept in memory per tab (at most 1 MB each; most are a few KB). */
export const MEMORY_ENTRIES = 200;

export async function fetchSource(ref: SourceRef, fetchImpl: typeof fetch = fetch, opts: FetchOptions = {}): Promise<string> {
  if (!isSafeRef(ref)) throw new SourceError('not-found', `Not a file path: ${ref.path}`);
  const init: RequestInit & { priority?: 'low' | 'auto' } = opts.direct
    // Public repos: GitHub's raw host directly, without cookies or Referer (it sends CORS *).
    ? { credentials: 'omit', referrerPolicy: 'no-referrer' }
    : { credentials: 'same-origin' };
  if (opts.low) init.priority = 'low';
  // A request that hangs must not keep "Loading…" up with the source diff hidden.
  init.signal = AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  let res: Response;
  let buf: ArrayBuffer;
  try {
    res = await fetchImpl(opts.direct ? directRawUrl(ref) : rawUrl(ref), init);
    if (res.status === 404) throw new SourceError('not-found', `Not found: ${ref.path}`, 404);
    if (!res.ok) throw new SourceError('http', `HTTP ${res.status}`, res.status);
    if (Number(res.headers.get('content-length') ?? '0') > MAX_SOURCE_BYTES) throw new SourceError('too-large', 'File is larger than 1 MB');
    buf = await res.arrayBuffer();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError('network', String(e));
  }
  if (buf.byteLength > MAX_SOURCE_BYTES) throw new SourceError('too-large', 'File is larger than 1 MB');
  return new TextDecoder().decode(buf);
}

/** Repos known to need the github.com route (private, or the direct host refused). */
export interface RepoMemory {
  has(repo: string): boolean;
  add(repo: string): void;
}

/**
 * Fetch a source the fastest safe way. github.com/<repo>/raw/... answers with a redirect to
 * raw.githubusercontent.com (two round trips, the first one slow); for a public repo the raw host
 * answers directly. So: try the raw host without cookies; when it refuses (404 or another HTTP
 * error), use the github.com route with the session, and once that works remember the repo
 * (private), so it pays the extra request only once.
 */
export function createSourceFetcher(fetchImpl: typeof fetch, needsSession: RepoMemory): (ref: SourceRef, opts?: FetchOptions) => Promise<string> {
  return async (ref, opts = {}) => {
    if (needsSession.has(ref.repo)) return fetchSource(ref, fetchImpl, opts);
    try {
      return await fetchSource(ref, fetchImpl, { ...opts, direct: true });
    } catch (e) {
      // Too large, or offline / timed out: the github.com route would fail the same way.
      if (e instanceof SourceError && (e.reason === 'too-large' || e.reason === 'network')) throw e;
    }
    const text = await fetchSource(ref, fetchImpl, opts);
    // Only now is it known that this repo needs the session (private): remember it.
    needsSession.add(ref.repo);
    return text;
  };
}

/**
 * `get` with a cache: a file at a commit never changes, so one request serves every open.
 * Concurrent calls share one request; a failure is not cached. The cache lives in the extension's
 * memory, and optionally in `store` (chrome.storage.session, extension-only) so a reload needs no
 * fetch. Never in the page's storage: file sources can come from private repositories, and any
 * script on github.com (the page's own, another extension's) could read page storage.
 */
export function cachedSource(get: (ref: SourceRef, opts?: FetchOptions) => Promise<string>, store?: SourceStore): (ref: SourceRef, opts?: FetchOptions) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (ref, opts) => {
    const key = `${ref.repo}@${ref.sha}:${ref.path}`;
    const hit = cache.get(key);
    if (hit) {
      // Most recently used goes last; the oldest goes first when the cache is full.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    if (cache.size >= MEMORY_ENTRIES) cache.delete(cache.keys().next().value!);
    const p = (async () => {
      const kept = store ? await store.get(key) : null;
      if (kept !== null) return kept;
      const text = await get(ref, opts);
      void store?.set(key, text);
      return text;
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    return p;
  };
}

/** Keys older builds wrote to github.com's session storage (sources, drafts); removed at start. */
const LEGACY_PREFIXES = ['mdr-src:', 'mdr:draft:'];

export function removeLegacyCopies(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && LEGACY_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch { /* storage blocked */ }
}
