import type { LineRange } from '../core/diff-map';

export function draftKey(c: { repo: string; pr: number; path: string; lines: LineRange }): string {
  return `mdr:draft:${c.repo}#${c.pr}:${c.path}:${c.lines.start}-${c.lines.end}`;
}

export function loadDraft(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

export function saveDraft(storage: Storage, key: string, value: string): void {
  try { if (value) storage.setItem(key, value); else storage.removeItem(key); } catch { /* storage blocked */ }
}

/**
 * Where unsent drafts live: the extension's memory for this page (they survive closing and
 * reopening the form, not a reload). Never the page's storage, which any script on github.com
 * can read.
 */
const memory = new Map<string, string>();
export const draftStore: Storage = {
  get length() { return memory.size; },
  key: (i) => [...memory.keys()][i] ?? null,
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => { memory.set(k, String(v)); },
  removeItem: (k) => { memory.delete(k); },
  clear: () => memory.clear(),
};
