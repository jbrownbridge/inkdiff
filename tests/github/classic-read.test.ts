import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffBody, findMarkdownFiles, pageLooksSupported, readDiff, readHunks, readThreads, richToggle, sourceToggle } from '../../src/github/classic/read';

const ROOT = 'tests/fixtures/github-classic';
const isFixture = (d: string) => existsSync(join(d, 'expected.json')) && existsSync(join(d, 'files-page.html'));

/** FIXTURE_DIR pins one directory; otherwise every fixture subdirectory of the root. */
function fixtureDirs(): string[] {
  if (process.env.FIXTURE_DIR) return isFixture(process.env.FIXTURE_DIR) ? [process.env.FIXTURE_DIR] : [];
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(ROOT, e.name)).sort().filter(isFixture);
}

interface ExpectedThread { startLine: number; endLine: number; resolved: boolean }

// Captured pages are git-ignored (other people's content): a fresh clone has none to check.
if (fixtureDirs().length === 0) it.skip('classic fixtures not present (capture with npm run fixtures:classic)', () => {});

for (const dir of fixtureDirs()) {
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  const head: string[] = expected.headLines;

  describe(`classic GitHub read side (${expected.repo}#${expected.pr})`, () => {
    const doc = new DOMParser().parseFromString(readFileSync(join(dir, 'files-page.html'), 'utf8'), 'text/html');
    const url = new URL(expected.pageUrl);
    const file = () => findMarkdownFiles(doc, url).find((f) => f.path === expected.path)!;

    it('recognises the page and finds the file with its head SHA', () => {
      expect(pageLooksSupported(doc)).toBe(true);
      expect(file()).toMatchObject({ path: expected.path, repo: expected.repo, pr: expected.pr, headSha: expected.headSha });
    });

    it('finds two different toggles', () => {
      const f = file();
      expect(richToggle(f)).not.toBeNull();
      expect(sourceToggle(f)).not.toBeNull();
      expect(richToggle(f)).not.toBe(sourceToggle(f));
    });

    it('reads rows and hunks (skipped when the diff is lazy-loaded)', () => {
      const f = file();
      if (!diffBody(f)) return;
      const diff = readDiff(f);
      expect(diff.rightLineText.size).toBeGreaterThan(0);
      const present = (expected.changedLines as number[]).filter((n) => diff.rightLineText.has(n));
      expect(diff.changedLines).toEqual(present);
      for (const [line, text] of diff.rightLineText) expect(text.trimEnd()).toBe(head[line - 1].trimEnd());
      for (const h of readHunks(f)) expect(h.header).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
    });

    it('reads threads with exact line ranges and state', () => {
      const f = file();
      if (!diffBody(f)) return;
      const threads = readThreads(f).map(({ startLine, endLine, resolved }) => ({ startLine, endLine, resolved }));
      expect(threads).toEqual(expected.threads.map((t: ExpectedThread) => ({ startLine: t.startLine, endLine: t.endLine, resolved: t.resolved })));
      for (const t of readThreads(f)) expect(t.comments[0]?.author).toBeTruthy();
    });
  });
}
