import { execFileSync } from 'node:child_process';
import type { RemovedRun } from '../../src/core/diff-map';
import { summarizeRows } from '../../src/github/diff-rows';
import { parsePatch, rightStartForLeft, type PatchRow } from './patch';

export interface Expected {
  pageUrl: string; repo: string; pr: number; path: string; headSha: string;
  deletions: number; changedLines: number[]; removed: RemovedRun[]; headLines: string[];
  threads: { startLine: number; endLine: number; resolved: boolean; firstBody: string; firstBodyText: string }[];
}

export interface Gh { raw(args: string[]): string }

/** The real `gh` CLI. */
export const realGh: Gh = {
  raw: (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
};

interface ApiThread {
  path: string; isResolved: boolean; line: number | null; startLine: number | null;
  diffSide: 'LEFT' | 'RIGHT'; startDiffSide: 'LEFT' | 'RIGHT' | null;
  comments: { nodes: { body: string; bodyText: string }[] };
}

/**
 * Right-side range of a thread, by the adapter's rule: threads ending on the LEFT are skipped;
 * a LEFT start (ending RIGHT) maps to the first right line at or after that left line in the patch.
 */
function rightRange(patchRows: PatchRow[], n: ApiThread): { startLine: number; endLine: number } | null {
  if (n.line === null || n.diffSide === 'LEFT') return null;
  if (n.startLine === null || n.startDiffSide !== 'LEFT') return { startLine: n.startLine ?? n.line, endLine: n.line };
  const startLine = rightStartForLeft(patchRows, n.startLine);
  return startLine === null ? null : { startLine, endLine: n.line };
}

/** Builds the expected.json content for a PR's Markdown file from the GitHub API. Throws on bad input. */
export function buildExpected(gh: Gh, prUrl: string, path: string | undefined): Expected {
  const m = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) throw new Error(`Not a GitHub PR URL: ${prUrl}`);
  const [, owner, name, prText] = m;
  const pr = Number(prText);
  const repo = `${owner}/${name}`;
  const run = (args: string[]) => gh.raw(args).trim();

  const files: { filename: string; patch?: string; deletions: number }[] = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${pr}/files?per_page=100`])).flat();
  const file = path
    ? files.find((f) => f.filename === path)
    : files.find((f) => /\.(md|mdx|markdown)$/i.test(f.filename));
  if (!file) throw new Error(path ? `${path} is not changed in ${prUrl}` : `No Markdown file changed in ${prUrl}`);
  if (file.patch === undefined) throw new Error(`${file.filename} has no patch (too large or binary)`);
  const filePath = file.filename;
  const headSha = run(['pr', 'view', String(pr), '-R', repo, '--json', 'headRefOid', '-q', '.headRefOid']);

  const patchRows = parsePatch(file.patch);
  const summary = summarizeRows(patchRows);
  const contentPath = filePath.split('/').map(encodeURIComponent).join('/');
  const headLines = gh.raw(['api', `repos/${repo}/contents/${contentPath}?ref=${headSha}`, '-H', 'Accept: application/vnd.github.raw'])
    .replace(/\r\n/g, '\n')
    .split('\n');
  const q = `query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:50){nodes{path isResolved line startLine diffSide startDiffSide comments(first:1){nodes{body bodyText}}}}}}}`;
  const data = JSON.parse(run(['api', 'graphql', '-f', `query=${q}`, '-f', `o=${owner}`, '-f', `n=${name}`, '-F', `p=${pr}`]));
  const threads = (data.data.repository.pullRequest.reviewThreads.nodes as ApiThread[])
    .filter((n) => n.path === filePath)
    .flatMap((n) => {
      const range = rightRange(patchRows, n);
      return range ? [{
        ...range,
        resolved: n.isResolved,
        firstBody: n.comments.nodes[0]?.body ?? '',
        firstBodyText: n.comments.nodes[0]?.bodyText ?? '',
      }] : [];
    })
    .sort((a, b) => a.endLine - b.endLine);

  return {
    pageUrl: `https://github.com/${repo}/pull/${pr}/files`, repo, pr, path: filePath, headSha,
    deletions: file.deletions,
    changedLines: summary.changedLines,
    removed: summary.removed,
    headLines,
    threads,
  };
}
