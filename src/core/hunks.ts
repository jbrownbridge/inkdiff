import type { LineRange } from './diff-map';

export const REVEAL_LINES = 20;

export interface Hunk { header: string; start: number }
export interface Gap { from: number; to: number }
export type Expander = 'up' | 'down' | 'all';

/**
 * Blocks that contain no other block, without duplicates, in source order. O(n log n): sorted by
 * start, then end, a range holds another exactly when the next range with the same start exists
 * before it, or some later range ends no later than it does.
 */
export function leafRanges(blocks: LineRange[]): LineRange[] {
  const seen = new Set<string>();
  const ranges: LineRange[] = [];
  for (const b of blocks) {
    const key = `${b.start}:${b.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push({ start: b.start, end: b.end });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const minEndAfter = new Array<number>(ranges.length + 1).fill(Infinity);
  for (let i = ranges.length - 1; i >= 0; i--) minEndAfter[i] = Math.min(ranges[i].end, minEndAfter[i + 1]);
  return ranges.filter((r, i) => !(i > 0 && ranges[i - 1].start === r.start) && minEndAfter[i + 1] > r.end);
}

export function initialShown(leaves: LineRange[], visible: Set<number>, forced: number[]): boolean[] {
  return leaves.map((l) => {
    if (forced.some((n) => l.start <= n && n <= l.end)) return true;
    for (let n = l.start; n <= l.end; n++) if (visible.has(n)) return true;
    return false;
  });
}

export function findGaps(shown: boolean[]): Gap[] {
  const gaps: Gap[] = [];
  let from = -1;
  shown.forEach((s, i) => {
    if (!s && from < 0) from = i;
    if (s && from >= 0) { gaps.push({ from, to: i - 1 }); from = -1; }
  });
  if (from >= 0) gaps.push({ from, to: shown.length - 1 });
  return gaps;
}

export function gapLineCount(leaves: LineRange[], gap: Gap): number {
  return leaves[gap.to].end - leaves[gap.from].start + 1;
}

export function expandersFor(leaves: LineRange[], gap: Gap, total: number, n = REVEAL_LINES): Expander[] {
  if (gapLineCount(leaves, gap) <= n) return ['all'];
  if (gap.from === 0) return ['up'];
  if (gap.to === total - 1) return ['down'];
  return ['down', 'up'];
}

/** Leaves of the gap that overlap the n-line window next to the hunk below (up) or above (down); always at least one. */
export function revealIndexes(leaves: LineRange[], gap: Gap, dir: Expander, n = REVEAL_LINES): number[] {
  const idx: number[] = [];
  for (let i = gap.from; i <= gap.to; i++) {
    const keep =
      dir === 'all' ||
      (dir === 'up' && (i === gap.to || leaves[i].end >= leaves[gap.to].end - n + 1)) ||
      (dir === 'down' && (i === gap.from || leaves[i].start <= leaves[gap.from].start + n - 1));
    if (keep) idx.push(i);
  }
  return idx;
}

/**
 * The header of the hunk that follows `gap`: the last hunk starting after the shown leaf above the gap and
 * within the next leaf that was shown in the `initial` (diff-visible) state, so partial reveals keep it.
 * Only the last gap before that leaf gets it.
 */
export function headerForGap(leaves: LineRange[], shown: boolean[], gap: Gap, hunks: Hunk[], initial: boolean[] = shown): string | null {
  const next = initial.findIndex((s, i) => s && i > gap.to);
  if (next < 0) return null;
  for (let i = gap.to + 1; i < next; i++) if (!shown[i]) return null;
  let prevEnd = 0;
  for (let i = gap.from - 1; i >= 0; i--) if (shown[i]) { prevEnd = leaves[i].end; break; }
  const candidates = hunks.filter((h) => h.start > prevEnd && h.start <= leaves[next].end);
  return candidates.length ? candidates[candidates.length - 1].header : null;
}

/** The header of a hunk that starts at the first leaf when no gap precedes it (GitHub labels a hunk at line 1 too). */
export function headerAtStart(leaves: LineRange[], shown: boolean[], hunks: Hunk[]): string | null {
  if (!shown[0]) return null;
  const candidates = hunks.filter((h) => h.start <= leaves[0].end);
  return candidates.length ? candidates[candidates.length - 1].header : null;
}
