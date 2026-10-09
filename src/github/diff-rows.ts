import type { DiffInfo, RemovedRun } from '../core/diff-map';

export interface DiffRow {
  kind: 'add' | 'del' | 'ctx';
  right: number | null;
  text: string;
}

export function summarizeRows(rows: DiffRow[]): DiffInfo {
  const changedLines: number[] = [];
  const removed: RemovedRun[] = [];
  const rightLineText = new Map<number, string>();
  let lastRight = 0;
  let run: RemovedRun | null = null;
  for (const r of rows) {
    if (r.kind === 'del') {
      if (run) run.count++;
      else { run = { afterLine: lastRight, count: 1 }; removed.push(run); }
      continue;
    }
    if (r.kind === 'add' && run) removed.pop();
    run = null;
    if (r.right !== null) {
      lastRight = r.right;
      rightLineText.set(r.right, r.text);
      if (r.kind === 'add') changedLines.push(r.right);
    }
  }
  return { changedLines, removed, rightLineText };
}
