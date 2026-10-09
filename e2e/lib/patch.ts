import type { DiffRow } from '../../src/github/diff-rows';

/** A patch row that also knows its old-file (left) line; null for added lines. */
export interface PatchRow extends DiffRow {
  left: number | null;
}

export function parsePatch(patch: string): PatchRow[] {
  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const rows: PatchRow[] = [];
  let left = 0;
  let right = 0;
  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { left = Number(hunk[1]); right = Number(hunk[2]); continue; }
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) rows.push({ kind: 'add', right: right++, left: null, text: line.slice(1) });
    else if (line.startsWith('-')) rows.push({ kind: 'del', right: null, left: left++, text: line.slice(1) });
    else rows.push({ kind: 'ctx', right: right++, left: left++, text: line.slice(1) });
  }
  return rows;
}

/** First right line at or after the row holding left line `left`; null if that row is absent or nothing follows on the right. */
export function rightStartForLeft(rows: PatchRow[], left: number): number | null {
  const from = rows.findIndex((r) => r.left === left);
  if (from < 0) return null;
  return rows.slice(from).find((r) => r.right !== null)?.right ?? null;
}
