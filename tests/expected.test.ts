import { describe, expect, it } from 'vitest';
import { buildExpected, type Gh } from '../e2e/lib/expected';

const sha = 'f'.repeat(40);
const fake: Gh = {
  raw(args) {
    if (args[0] === 'api' && args[1] === '--paginate') {
      return JSON.stringify([[{ filename: 'docs/a.md', deletions: 1, patch: '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d' }]]);
    }
    if (args[0] === 'pr') return `${sha}\n`;
    if (args[0] === 'api' && args[1] === 'graphql') {
      return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
        { path: 'docs/a.md', isResolved: false, line: 2, startLine: null, diffSide: 'RIGHT', startDiffSide: null, comments: { nodes: [{ body: '**hi**', bodyText: 'hi' }] } },
        { path: 'other.md', isResolved: false, line: 1, startLine: null, diffSide: 'RIGHT', startDiffSide: null, comments: { nodes: [] } },
      ] } } } } });
    }
    if (args[0] === 'api' && args[1].startsWith('repos/o/r/contents/docs/a.md?ref=')) return 'a\nc\nd\n';
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  },
};

describe('buildExpected', () => {
  it('builds expected data from gh output', () => {
    const e = buildExpected(fake, 'https://github.com/o/r/pull/5', undefined);
    expect(e.pageUrl.endsWith('/pull/5/files')).toBe(true);
    expect(e).toMatchObject({ repo: 'o/r', pr: 5, path: 'docs/a.md', headSha: sha, deletions: 1, changedLines: [2, 3], removed: [] });
    expect(e.headLines).toEqual(['a', 'c', 'd', '']);
    expect(e.threads).toEqual([{ startLine: 2, endLine: 2, resolved: false, firstBody: '**hi**', firstBodyText: 'hi' }]);
  });

  it('throws when the requested path is not changed', () => {
    expect(() => buildExpected(fake, 'https://github.com/o/r/pull/5', 'nope.md')).toThrow(/not changed/);
  });
});
