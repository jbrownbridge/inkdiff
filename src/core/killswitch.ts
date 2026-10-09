/**
 * Remote kill switch: a version listed in the public repo's killswitch.json stays idle, and a
 * feature listed under `off` falls back to a safer mode, so a GitHub page change that breaks the
 * extension can be handled without a store release.
 * Read at most once a day, without cookies or Referer. The last answer is kept in the extension's
 * own storage (chrome.storage.local), which pages cannot change. Anything that fails leaves the
 * extension on.
 */
export const KILLSWITCH_URL = 'https://github.com/jbrownbridge/inkdiff/raw/main/killswitch.json';
const KEY = 'killswitch';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The part of chrome.storage.local this uses. */
export interface LocalArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface Kept { at: number; disabled: string[]; off?: string[] }

/** Parts that can be switched off on their own; each falls back to a safer mode. */
export type Feature = 'host-threads' | 'native-form' | 'early-hide';

async function read(area: LocalArea | null): Promise<Kept | null> {
  try {
    const v = (await area?.get(KEY))?.[KEY] as Kept | undefined;
    return v && typeof v.at === 'number' && Array.isArray(v.disabled) && (v.off === undefined || Array.isArray(v.off)) ? v : null;
  } catch {
    return null;
  }
}

/** Whether this version is switched off, from the last answer kept. */
export async function isDisabled(version: string, area: LocalArea | null): Promise<boolean> {
  return (await read(area))?.disabled.includes(version) ?? false;
}

/**
 * Features switched off for this version: an `off` entry is "feature" (every version) or
 * "version:feature".
 */
export async function featuresOff(version: string, area: LocalArea | null): Promise<Set<Feature>> {
  const out = new Set<Feature>();
  for (const entry of (await read(area))?.off ?? []) {
    const [v, f] = entry.includes(':') ? entry.split(':', 2) : [version, entry];
    if (v === version) out.add(f as Feature);
  }
  return out;
}

/** Fetch the list when the kept answer is missing or a day old; never throws. */
export async function refreshKillswitch(area: LocalArea | null, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<void> {
  const kept = await read(area);
  if (kept && now - kept.at < MAX_AGE_MS) return;
  try {
    // No cookies and no Referer: the request says nothing about the user or the page they are on.
    const res = await fetchImpl(KILLSWITCH_URL, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!res.ok) return;
    const body = (await res.json()) as { disabled?: unknown; off?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    await area?.set({ [KEY]: { at: now, disabled: strings(body.disabled), off: strings(body.off) } });
  } catch { /* offline, blocked or malformed: stay on */ }
}
