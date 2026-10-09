import type { Block } from '../render/render';

export interface RemovedRun {
  afterLine: number;
  count: number;
}

export interface DiffInfo {
  changedLines: number[];
  removed: RemovedRun[];
  rightLineText: Map<number, string>;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface ThreadAnchorInput {
  id: string;
  startLine: number;
  endLine: number;
}

export function isBlockChanged(block: Block, changed: Set<number>): boolean {
  for (let line = block.start; line <= block.end; line++) if (changed.has(line)) return true;
  return false;
}

const size = (b: Block) => b.end - b.start;

/**
 * Anchor each thread to the smallest block containing its last line. Lines that render nothing
 * (blank lines, link definitions, HTML comments) fall back to the nearest block ending above;
 * among blocks ending on the same line the innermost wins. Null only when nothing precedes.
 */
export function anchorThreads(blocks: Block[], threads: ThreadAnchorInput[]): Map<string, Block | null> {
  const out = new Map<string, Block | null>();
  for (const t of threads) {
    let best: Block | null = null;
    for (const b of blocks) {
      if (b.start <= t.endLine && t.endLine <= b.end && (!best || size(b) < size(best))) best = b;
    }
    if (!best) {
      for (const b of blocks) {
        if (b.end < t.endLine && (!best || b.end > best.end || (b.end === best.end && size(b) < size(best)))) best = b;
      }
    }
    out.set(t.id, best);
  }
  return out;
}

// String.prototype.trimEnd is linear; /\s+$/ backtracks quadratically on long space runs.
const trimEnd = (s: string) => s.trimEnd();

/** True when every diff line matches the fetched source. An empty diff (not loaded) verifies nothing. */
export function verifySource(lines: string[], rightLineText: Map<number, string>): boolean {
  if (rightLineText.size === 0) return false;
  for (const [line, text] of rightLineText) {
    const actual = lines[line - 1];
    if (actual === undefined || trimEnd(actual) !== trimEnd(text)) return false;
  }
  return true;
}
