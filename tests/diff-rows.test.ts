import { summarizeRows, type DiffRow } from '../src/github/diff-rows';

const row = (kind: DiffRow['kind'], right: number | null, text = ''): DiffRow => ({ kind, right, text });

describe('summarizeRows', () => {
  it('collects added lines and right-side text', () => {
    const info = summarizeRows([row('ctx', 1, 'a'), row('add', 2, 'b')]);
    expect(info.changedLines).toEqual([2]);
    expect(info.rightLineText.get(1)).toBe('a');
    expect(info.rightLineText.get(2)).toBe('b');
  });

  it('records a pure removal after the last right line', () => {
    const info = summarizeRows([row('ctx', 13), row('del', null), row('ctx', 14)]);
    expect(info.removed).toEqual([{ afterLine: 13, count: 1 }]);
  });

  it('treats deletions followed by additions as a change, not a removal', () => {
    const info = summarizeRows([row('ctx', 8), row('del', null), row('add', 9), row('ctx', 10)]);
    expect(info.removed).toEqual([]);
    expect(info.changedLines).toEqual([9]);
  });

  it('counts a run of removed lines at the top of the file', () => {
    const info = summarizeRows([row('del', null), row('del', null), row('ctx', 1)]);
    expect(info.removed).toEqual([{ afterLine: 0, count: 2 }]);
  });
});
