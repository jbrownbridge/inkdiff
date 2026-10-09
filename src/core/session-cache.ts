/**
 * File sources kept across reloads in chrome.storage.session: memory only, readable by this
 * extension only (never by github.com pages or other extensions), cleared when the browser closes.
 * Bounded: the oldest entries go first once the total passes the budget.
 */
export interface SessionArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear?(): Promise<void>;
  getKeys?(): Promise<string[]>;
}

export interface SourceStore {
  get(key: string): Promise<string | null>;
  set(key: string, text: string): Promise<void>;
}

const PREFIX = 'src:';
const INDEX = 'src-index';
/** Bytes kept in total (chrome.storage.session holds 10 MB, counted as UTF-8 JSON). */
export const SESSION_BUDGET = 6_000_000;

interface Entry { k: string; n: number }

/** UTF-8 size, as the storage quota counts it. */
const bytes = (text: string) => new TextEncoder().encode(text).length;

export function sessionSourceStore(area: SessionArea, budget = SESSION_BUDGET): SourceStore {
  // One write at a time in this tab: the index is read, changed and written back.
  let writes: Promise<void> = Promise.resolve();

  async function readIndex(): Promise<Entry[]> {
    const raw = (await area.get(INDEX))[INDEX];
    return (Array.isArray(raw) ? raw : []).filter((e: Entry) => e && typeof e.k === 'string' && typeof e.n === 'number') as Entry[];
  }

  /** Drop the oldest entries until `free` more bytes fit. */
  async function makeRoom(index: Entry[], free: number): Promise<Entry[]> {
    let total = index.reduce((sum, e) => sum + e.n, 0);
    const gone: string[] = [];
    while (index.length && total + free > budget) {
      const old = index.shift()!;
      total -= old.n;
      gone.push(PREFIX + old.k);
    }
    if (gone.length) await area.remove(gone);
    return index;
  }

  /** After a quota error: drop the oldest half, and sources no index lists (lost by a race between tabs). */
  async function recover(index: Entry[]): Promise<Entry[]> {
    const gone = index.splice(0, Math.ceil(index.length / 2)).map((e) => PREFIX + e.k);
    if (area.getKeys) {
      const known = new Set(index.map((e) => PREFIX + e.k));
      for (const k of await area.getKeys()) if (k.startsWith(PREFIX) && !known.has(k)) gone.push(k);
    }
    if (gone.length) await area.remove(gone);
    return index;
  }

  return {
    async get(key) {
      try {
        const v = (await area.get(PREFIX + key))[PREFIX + key];
        return typeof v === 'string' ? v : null;
      } catch {
        return null; // not open to content scripts yet, or unavailable: fetch instead
      }
    },
    set(key, text) {
      const n = bytes(text);
      if (n > budget) return Promise.resolve();
      writes = writes.then(async () => {
        try {
          const index = await makeRoom((await readIndex()).filter((e) => e.k !== key), n);
          try {
            await area.set({ [PREFIX + key]: text, [INDEX]: [...index, { k: key, n }] });
          } catch {
            // Over quota (another tab wrote meanwhile): make room, then try once more.
            const kept = await recover(index);
            await area.set({ [PREFIX + key]: text, [INDEX]: [...kept, { k: key, n }] });
          }
        } catch { /* unavailable or full: memory cache only */ }
      });
      return writes;
    },
  };
}

const NEEDS_SESSION = 'repos-needing-session';

/**
 * Repos that need the github.com route, kept for the browser session (extension-only memory), so
 * a private repo's first file pays the failed direct try once per session, not once per page.
 */
export function sessionRepoMemory(area: SessionArea | null): { memory: { has(repo: string): boolean; add(repo: string): void }; ready: Promise<void> } {
  const repos = new Set<string>();
  const ready = (async () => {
    try {
      const v = (await area?.get(NEEDS_SESSION))?.[NEEDS_SESSION];
      if (Array.isArray(v)) for (const r of v) if (typeof r === 'string') repos.add(r);
    } catch { /* unavailable: memory only */ }
  })();
  return {
    ready,
    memory: {
      has: (repo) => repos.has(repo),
      add: (repo) => {
        if (repos.has(repo)) return;
        repos.add(repo);
        void area?.set({ [NEEDS_SESSION]: [...repos] }).catch(() => {});
      },
    },
  };
}

const VIEWER = 'viewer';

/**
 * Kept sources belong to the GitHub account that could read them. When the signed-in account
 * changes (another login, or signed out), drop everything kept; the returned area waits for that
 * check before any read or write.
 */
export function sessionForViewer(area: SessionArea, login: string | null): SessionArea {
  const me = login ?? '';
  const ready = (async () => {
    try {
      const kept = (await area.get(VIEWER))[VIEWER];
      if (kept === me) return;
      if (kept !== undefined) await area.clear?.();
      await area.set({ [VIEWER]: me });
    } catch { /* unavailable: reads fail and fall back to fetching */ }
  })();
  return {
    get: async (keys) => { await ready; return area.get(keys); },
    set: async (items) => { await ready; return area.set(items); },
    remove: async (keys) => { await ready; return area.remove(keys); },
    getKeys: area.getKeys ? async () => { await ready; return area.getKeys!(); } : undefined,
  };
}
