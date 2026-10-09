import { renderMarkdown } from '../src/render/render';
import { anchorThreads, isBlockChanged, verifySource } from '../src/core/diff-map';

const blocks = [
  { start: 7, end: 9, kind: 'paragraph' },
  { start: 11, end: 14, kind: 'list' },
  { start: 13, end: 13, kind: 'listItem' },
];

describe('isBlockChanged', () => {
  it('is true when any line of the block changed', () => {
    expect(isBlockChanged(blocks[0], new Set([9]))).toBe(true);
    expect(isBlockChanged(blocks[0], new Set([10]))).toBe(false);
  });
});

describe('anchorThreads', () => {
  it('anchors a thread to the smallest block that holds its last line', () => {
    const map = anchorThreads(blocks, [
      { id: 'a', startLine: 13, endLine: 13 },
      { id: 'b', startLine: 7, endLine: 9 },
      { id: 'c', startLine: 40, endLine: 40 },
    ]);
    expect(map.get('a')).toEqual(blocks[2]);
    expect(map.get('b')).toEqual(blocks[0]);
    expect(map.get('c')).toEqual(blocks[1]);
  });

  it('falls back to the nearest block ending above an unrendered line', () => {
    const map = anchorThreads(blocks, [
      { id: 'gap', startLine: 10, endLine: 10 },
      { id: 'before', startLine: 3, endLine: 3 },
    ]);
    expect(map.get('gap')).toEqual(blocks[0]);
    expect(map.get('before')).toBeNull();
  });

  it('prefers the innermost block among those ending on the same line', () => {
    const nested = [{ start: 1, end: 4, kind: 'list' }, { start: 4, end: 4, kind: 'listItem' }];
    const map = anchorThreads(nested, [{ id: 'after', startLine: 6, endLine: 6 }]);
    expect(map.get('after')).toEqual(nested[1]);
  });

  it('anchors a thread on a link reference definition to the block above', () => {
    const r = renderMarkdown('# A\n\n[x]: #x\n\nPara\n');
    const map = anchorThreads(r.blocks, [{ id: 't', startLine: 3, endLine: 3 }]);
    expect(map.get('t')).toMatchObject({ start: 1, end: 1 });
  });
});

describe('verifySource', () => {
  const lines = ['# Title', '', 'Text  '];
  it('accepts matching lines and ignores trailing whitespace', () => {
    expect(verifySource(lines, new Map([[1, '# Title'], [3, 'Text']]))).toBe(true);
  });
  it('rejects a line that differs', () => {
    expect(verifySource(lines, new Map([[1, '# Other']]))).toBe(false);
  });
  it('does not verify against an empty diff', () => {
    expect(verifySource(lines, new Map())).toBe(false);
  });
  it('rejects a line beyond the end of the source', () => {
    expect(verifySource(lines, new Map([[9, 'x']]))).toBe(false);
  });
  it('checks long space runs in linear time', () => {
    const t0 = performance.now();
    verifySource([' '.repeat(200_000) + 'x'], new Map([[1, ' '.repeat(200_000) + 'x']]));
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
