import type { SourceRef } from './source-fetch';

export interface PrefetchScheduler {
  /** Resolves once the page has loaded (window `load`). */
  afterLoad(): Promise<void>;
  /** Resolves when the browser is idle. */
  idle(): Promise<void>;
}

export function browserScheduler(win: Window): PrefetchScheduler {
  return {
    afterLoad: () => new Promise((resolve) => {
      if (win.document.readyState === 'complete') resolve();
      else win.addEventListener('load', () => resolve(), { once: true });
    }),
    idle: () => new Promise((resolve) => {
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(() => resolve(), { timeout: 2000 });
      else win.setTimeout(resolve, 200);
    }),
  };
}

/** Statuses that mean "slow down": prefetching stops for the page, so it never adds load. */
const BACK_OFF = new Set([403, 429]);

/**
 * Fetch sources ahead of time without competing with the page: only after it has loaded, a few
 * files at a time (`parallel`), each in idle time and at low network priority. A file the reader
 * opens meanwhile shares the request already made (the source cache), or starts its own.
 * A rate-limit or forbidden answer (429, 403) stops prefetching for the rest of the page.
 */

export function createPrefetcher(get: (ref: SourceRef, low: boolean) => Promise<unknown>, scheduler: PrefetchScheduler, parallel = 1): (refs: SourceRef[]) => void {
  const queue: SourceRef[] = [];
  const seen = new Set<string>();
  let running = false;
  let stopped = false;
  async function worker() {
    while (queue.length && !stopped) {
      await scheduler.idle();
      const ref = queue.shift();
      if (!ref || stopped) continue;
      await get(ref, true).catch((e: unknown) => {
        const status = (e as { status?: unknown } | null)?.status;
        if (typeof status === 'number' && BACK_OFF.has(status)) { stopped = true; queue.length = 0; }
      });
    }
  }
  async function run() {
    running = true;
    await scheduler.afterLoad();
    await Promise.all(Array.from({ length: parallel }, worker));
    running = false;
  }
  return (refs) => {
    if (stopped) return;
    for (const ref of refs) {
      const key = `${ref.repo}@${ref.sha}:${ref.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(ref);
    }
    if (!running && queue.length) void run();
  };
}
