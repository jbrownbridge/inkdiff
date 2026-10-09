import { parsePatch, rightStartForLeft } from '../e2e/lib/patch';

describe('parsePatch', () => {
  it('assigns right-side line numbers from the hunk header', () => {
    const rows = parsePatch('@@ -7,3 +7,3 @@\n This paragraph\n-an exact line.\n+an exact middle line.\n');
    expect(rows).toEqual([
      { kind: 'ctx', right: 7, left: 7, text: 'This paragraph' },
      { kind: 'del', right: null, left: 8, text: 'an exact line.' },
      { kind: 'add', right: 8, left: null, text: 'an exact middle line.' },
    ]);
  });

  it('skips "no newline" markers', () => {
    expect(parsePatch('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b')).toHaveLength(2);
  });

  it('tracks left-side line numbers from the hunk header', () => {
    const rows = parsePatch('@@ -44,3 +46,3 @@\n ctx\n-gone\n+new\n ctx2');
    expect(rows.map((r) => [r.kind, r.left, r.right])).toEqual([['ctx', 44, 46], ['del', 45, null], ['add', null, 47], ['ctx', 46, 48]]);
  });
});

describe('rightStartForLeft', () => {
  // Mirrors rfcs#3982: L47-L48 deleted, R49-R50 added, then context.
  const rows = parsePatch('@@ -45,6 +47,6 @@\n a\n b\n-## Drawbacks\n-[drawbacks]\n+## Drawbacks and limitations\n+[drawbacks-and-limitations]\n c');

  it('maps a deleted left line to the first right line after it', () => {
    expect(rightStartForLeft(rows, 47)).toBe(49);
  });

  it('maps a context left line to its own right line', () => {
    expect(rightStartForLeft(rows, 46)).toBe(48);
  });

  it('returns null when the left line is not in the patch, or nothing follows it on the right', () => {
    expect(rightStartForLeft(rows, 10)).toBeNull();
    expect(rightStartForLeft(parsePatch('@@ -1,2 +1 @@\n a\n-b'), 2)).toBeNull();
  });
});
