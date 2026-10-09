import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diffBody, findMarkdownFiles, findRightLineRow, findThread, pageLooksSupported, readDiff, readDiffRows, readHunks, readThreads, richToggle, sourceToggle,
} from '../../src/github/read';

// Captured GitHub pages are large (megabytes of HTML): give each test time to parse them.
vi.setConfig({ testTimeout: 30_000 });

const ROOT = 'tests/fixtures/github';
const isFixture = (d: string) => existsSync(join(d, 'expected.json')) && existsSync(join(d, 'files-page.html'));

/** FIXTURE_DIR pins one directory; otherwise the root (if it is a fixture) plus every fixture subdirectory. */
function fixtureDirs(): string[] {
  if (process.env.FIXTURE_DIR) return isFixture(process.env.FIXTURE_DIR) ? [process.env.FIXTURE_DIR] : [];
  if (!existsSync(ROOT)) return [];
  const subs = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(ROOT, e.name)).sort();
  return [ROOT, ...subs].filter(isFixture);
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
function renderedText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return squash(el.textContent ?? '');
}

interface ExpectedThread { startLine: number; endLine: number; resolved: boolean; firstBodyText: string }

// Captured pages are git-ignored (other people's content): a fresh clone has none to check.
if (fixtureDirs().length === 0) it.skip('GitHub page fixtures not present (capture with npm run fixtures:capture; see CONTRIBUTING.md)', () => {});

for (const dir of fixtureDirs()) {
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  const head: string[] = expected.headLines;
  const changed: number[] = expected.changedLines;

  describe(`GitHub read side (${expected.repo}#${expected.pr})`, () => {
    const doc = new DOMParser().parseFromString(readFileSync(join(dir, 'files-page.html'), 'utf8'), 'text/html');
    const url = new URL(expected.pageUrl);
    const file = () => findMarkdownFiles(doc, url).find((f) => f.path === expected.path)!;

    it('recognises the page', () => {
      expect(pageLooksSupported(doc)).toBe(true);
    });

    it('finds the Markdown file with repo, PR, and head SHA', () => {
      const files = findMarkdownFiles(doc, url);
      // A PR may touch several Markdown files (rfcs#3878 touches 15). Cross-check against the
      // diff tables' "Diff for: <path>" labels, read independently of the adapter's header lookup.
      const labelled = [...doc.querySelectorAll('table[aria-label^="Diff for: "]')]
        .map((t) => t.getAttribute('aria-label')!.slice('Diff for: '.length).trim())
        .filter((p) => /\.(md|mdx|markdown)$/i.test(p));
      expect(files.map((f) => f.path).sort()).toEqual([...new Set(labelled)].sort());
      expect(files.map((f) => f.path)).toContain(expected.path);
      expect(file()).toMatchObject({ path: expected.path, repo: expected.repo, pr: expected.pr, headSha: expected.headSha });
    });

    it('reads hunk headers that match the API patch', () => {
      const hunks = readHunks(file());
      const allNew = expected.deletions === 0 && expected.changedLines.length >= expected.headLines.length - 1;
      if (allNew) return; // a new file has no hunk to collapse around
      expect(hunks.length).toBeGreaterThan(0);
      for (const h of hunks) expect(h.header).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
    });

    it('finds the toggles and the diff body', () => {
      const f = file();
      expect(richToggle(f)).not.toBeNull();
      expect(sourceToggle(f)).not.toBeNull();
      expect(richToggle(f)).not.toBe(sourceToggle(f));
      expect(diffBody(f)).not.toBeNull();
    });

    it('reads changed and removed lines', () => {
      const diff = readDiff(file());
      expect(diff.changedLines).toEqual(expected.changedLines);
      expect(diff.removed).toEqual(expected.removed);
    });

    it('reads right-side text that matches the head file', () => {
      const diff = readDiff(file());
      expect(diff.rightLineText.size).toBeGreaterThan(0);
      for (const [line, text] of diff.rightLineText) expect(text.trimEnd()).toBe(head[line - 1].trimEnd());
    });

    it('reads context rows when unchanged lines are shown, and deletion rows when lines were removed', () => {
      const f = file();
      const rows = readDiffRows(f);
      const shownUnchanged = [...readDiff(f).rightLineText.keys()].some((n) => n <= head.length && !changed.includes(n));
      if (shownUnchanged) expect(rows.some((r) => r.kind === 'ctx')).toBe(true);
      // `deletions` comes from the API file entry; fixtures captured before it existed skip this check.
      if (typeof expected.deletions === 'number') expect(rows.some((r) => r.kind === 'del')).toBe(expected.deletions > 0);
      for (const r of rows) expect(r.kind === 'del' ? r.right === null : r.right !== null).toBe(true);
    });

    it('finds the row of a right-side line', () => {
      const f = file();
      for (const line of changed) expect(findRightLineRow(f, line), `line ${line}`).not.toBeNull();
      expect(findRightLineRow(f, 100000)).toBeNull();
    });

    it('reads threads with exact line ranges and state', () => {
      const threads = readThreads(file())
        .map((t) => ({ startLine: t.startLine, endLine: t.endLine, resolved: t.resolved, comments: t.comments }))
        .sort((a, b) => a.endLine - b.endLine);
      expect(threads.map(({ startLine, endLine, resolved }) => ({ startLine, endLine, resolved }))).toEqual(
        expected.threads.map((t: ExpectedThread) => ({ startLine: t.startLine, endLine: t.endLine, resolved: t.resolved })),
      );
      threads.forEach((t, i) => {
        expect(renderedText(t.comments[0]?.bodyHtml ?? '')).toContain(squash(expected.threads[i].firstBodyText).slice(0, 60));
        const bodies = t.comments.map((c) => c.bodyHtml);
        expect(new Set(bodies).size, 'no duplicate comments').toBe(bodies.length);
      });
    });

    it('finds a thread element by id', () => {
      const f = file();
      const [t] = readThreads(f);
      expect(t.comments[0]?.author).toBeTruthy();
      expect(findThread(f, t.id)).not.toBeNull();
      expect(findThread(f, 'no-such-thread')).toBeNull();
    });
  });
}

describe('GitHub read side (no match)', () => {
  it('returns empty results on a page without diffs', () => {
    const doc = new DOMParser().parseFromString('<html><body><p>hi</p></body></html>', 'text/html');
    expect(pageLooksSupported(doc)).toBe(false);
    expect(findMarkdownFiles(doc, new URL('https://github.com/a/b/pull/1/files'))).toEqual([]);
  });
});
