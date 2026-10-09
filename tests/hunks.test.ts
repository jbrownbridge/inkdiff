import { expandersFor, findGaps, gapLineCount, headerAtStart, headerForGap, initialShown, leafRanges, revealIndexes } from '../src/core/hunks';

const r = (start: number, end: number) => ({ start, end });

describe('leafRanges', () => {
  it('drops containers and duplicates, sorts by start', () => {
    expect(leafRanges([r(1, 10), r(5, 5), r(1, 2), r(5, 5), r(12, 12)])).toEqual([r(1, 2), r(5, 5), r(12, 12)]);
  });
});

describe('initialShown', () => {
  const leaves = [r(1, 1), r(3, 4), r(6, 6), r(8, 30)];
  it('shows leaves that hold a visible line', () => {
    expect(initialShown(leaves, new Set([4, 20]), [])).toEqual([false, true, false, true]);
  });
  it('always shows leaves with a forced line', () => {
    expect(initialShown(leaves, new Set([4]), [6])).toEqual([false, true, true, false]);
  });
});

describe('gaps and expanders', () => {
  const leaves = Array.from({ length: 30 }, (_, i) => r(i * 2 + 1, i * 2 + 1)); // lines 1,3,...,59
  const shown = leaves.map((_, i) => i === 15);
  const gaps = findGaps(shown);

  it('finds the gaps before and after the shown leaf', () => {
    expect(gaps).toEqual([{ from: 0, to: 14 }, { from: 16, to: 29 }]);
    expect(gapLineCount(leaves, gaps[0])).toBe(29);
  });

  it('offers only up at the file start and only down at the end', () => {
    expect(expandersFor(leaves, gaps[0], leaves.length)).toEqual(['up']);
    expect(expandersFor(leaves, gaps[1], leaves.length)).toEqual(['down']);
  });

  it('offers both directions in the middle and all for small gaps', () => {
    const mid = leaves.map((_, i) => i === 0 || i === 29);
    const [g] = findGaps(mid);
    expect(expandersFor(leaves, g, leaves.length)).toEqual(['down', 'up']);
    expect(expandersFor(leaves, { from: 1, to: 3 }, leaves.length)).toEqual(['all']);
  });

  it('reveals 20 lines next to the hunk below (up) or above (down)', () => {
    // gap 0 = leaves 0..14 (lines 1..29); up reveals lines >= 29 - 19 = 10 → leaves 5..14
    expect(revealIndexes(leaves, gaps[0], 'up')).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // gap 1 = leaves 16..29 (lines 33..59); down reveals lines <= 33 + 19 = 52 → leaves 16..25
    expect(revealIndexes(leaves, gaps[1], 'down')).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(revealIndexes(leaves, { from: 2, to: 4 }, 'all')).toEqual([2, 3, 4]);
  });

  it('always reveals at least one leaf, even a long one', () => {
    const big = [r(1, 1), r(2, 100), r(101, 101)];
    expect(revealIndexes(big, { from: 1, to: 1 }, 'up')).toEqual([1]);
    expect(revealIndexes(big, { from: 1, to: 1 }, 'down')).toEqual([1]);
  });
});

describe('revealIndexes rounding', () => {
  it('rounds out to whole blocks that overlap the 20-line window', () => {
    // up from leaf 1 (lines 41..50): window is lines 31..50; leaf 0 (1..40) holds lines 31..40
    expect(revealIndexes([r(1, 40), r(41, 50), r(51, 51)], { from: 0, to: 1 }, 'up')).toEqual([0, 1]);
  });
  it('rounds out downward the same way', () => {
    // down from leaf 1 (lines 2..11): window is lines 2..21; leaf 2 (12..60) holds lines 12..21
    expect(revealIndexes([r(1, 1), r(2, 11), r(12, 60), r(61, 61)], { from: 1, to: 2 }, 'down')).toEqual([1, 2]);
  });
});

describe('headerForGap', () => {
  const leaves = [r(1, 1), r(3, 3), r(110, 110), r(112, 115), r(150, 150)];
  const shown = [false, false, true, true, false];
  const hunks = [{ header: '@@ -110,6 +110,44 @@ title UDP Packet', start: 110 }];

  it('labels the gap above a hunk with its header', () => {
    expect(headerForGap(leaves, shown, { from: 0, to: 1 }, hunks)).toBe('@@ -110,6 +110,44 @@ title UDP Packet');
  });

  it('returns null for the trailing gap', () => {
    expect(headerForGap(leaves, shown, { from: 4, to: 4 }, hunks)).toBeNull();
  });

  it('picks the last hunk that starts before the next initially shown leaf', () => {
    const two = [{ header: 'A', start: 100 }, { header: 'B', start: 109 }, ...hunks];
    expect(headerForGap(leaves, shown, { from: 0, to: 1 }, two, shown)).toBe('@@ -110,6 +110,44 @@ title UDP Packet');
  });

  it('keeps the header after a partial reveal above the hunk', () => {
    const initial = [false, false, true, true, false];
    const now = [false, true, true, true, false];
    expect(headerForGap(leaves, now, { from: 0, to: 0 }, hunks, initial)).toBe('@@ -110,6 +110,44 @@ title UDP Packet');
  });

  it('gives the header to the last gap before the hunk only', () => {
    // leaf 1 shows for a thread; the hunk header belongs to the gap right above leaf 2
    const now = [false, true, false, true, false];
    const initial = [false, false, false, true, false];
    const ls = [r(1, 1), r(3, 3), r(5, 5), r(110, 115), r(150, 150)];
    expect(headerForGap(ls, now, { from: 0, to: 0 }, hunks, initial)).toBeNull();
    expect(headerForGap(ls, now, { from: 2, to: 2 }, hunks, initial)).toBe('@@ -110,6 +110,44 @@ title UDP Packet');
  });
});

describe('headerAtStart', () => {
  const leaves = [r(1, 1), r(3, 3), r(10, 10)];
  it('labels a hunk that starts at the first shown leaf', () => {
    expect(headerAtStart(leaves, [true, true, false], [{ header: 'H', start: 1 }])).toBe('H');
  });
  it('is null when a gap comes first or no hunk starts there', () => {
    expect(headerAtStart(leaves, [false, true, false], [{ header: 'H', start: 3 }])).toBeNull();
    expect(headerAtStart(leaves, [true, false, true], [{ header: 'H', start: 10 }])).toBeNull();
    expect(headerAtStart(leaves, [true, false, false], [])).toBeNull();
  });
});

describe('leafRanges matches the direct definition', () => {
  const naive = (blocks: { start: number; end: number }[]) => {
    const inside = (a: { start: number; end: number }, b: { start: number; end: number }) => b.start <= a.start && a.end <= b.end && (a.start !== b.start || a.end !== b.end);
    const seen = new Set<string>();
    return blocks
      .filter((b) => { const k = `${b.start}:${b.end}`; if (seen.has(k) || blocks.some((o) => inside(o, b))) return false; seen.add(k); return true; })
      .map((b) => ({ start: b.start, end: b.end }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  };
  it('on 500 random block sets', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let t = 0; t < 500; t++) {
      const blocks = Array.from({ length: 1 + rnd(30) }, () => { const start = 1 + rnd(40); return { start, end: start + rnd(8) }; });
      expect(leafRanges(blocks)).toEqual(naive(blocks));
    }
  });
});
