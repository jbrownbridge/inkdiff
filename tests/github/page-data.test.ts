import { findMarkdownFiles, forgetPageData, loadPageData, readHeadSha } from '../../src/github/read';

const SHA = 'c'.repeat(40);
const url = (pr: number) => new URL(`https://github.com/o/r/pull/${pr}/changes`);

/** A Files changed page that still holds the pull request list's payload, as after a soft navigation from it. */
function staleDoc(): Document {
  const json = JSON.stringify({ payload: { repoPullsDashboardContentRoute: {}, repoPullsDashboardLayoutRoute: {}, repoLayoutRoute: {} } });
  return new DOMParser().parseFromString(`<html><body>
    <div role="region" id="diff-x"><div data-diff-header-wrapper="true"><h3><a><code>docs/a.md</code></a></h3></div>
    <table data-diff-anchor="diff-x"><tbody></tbody></table></div>
    <script type="application/json" data-target="react-app.embeddedData">${json}</script></body></html>`, 'text/html');
}

function routes(pr: number, sha = SHA) {
  return vi.fn<typeof fetch>(async (input) => {
    const u = String(input);
    const payload = u.endsWith('/_layout')
      ? { pullRequestsLayoutRoute: { pullRequest: { number: pr, headSha: sha } } }
      : { pullRequestsChangesRoute: { pullRequest: { number: pr }, comparison: { viewing: 'FULL', selectedRange: null }, diffSummaries: [{ path: 'docs/a.md', changeType: 'MODIFIED' }] } };
    return new Response(JSON.stringify({ payload }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('page data after a soft navigation from the pull request list', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the PR data from GitHub\'s JSON routes, then finds the files', async () => {
    const doc = staleDoc();
    expect(findMarkdownFiles(doc, url(9))).toEqual([]);
    const fetchMock = routes(9);
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadPageData(doc, url(9))).toBe(true);
    expect(readHeadSha(doc, 9)).toBe(SHA);
    expect(findMarkdownFiles(doc, url(9)).map((f) => [f.path, f.headSha])).toEqual([['docs/a.md', SHA]]);
    const calls = fetchMock.mock.calls.map(([u, init]) => [String(u), init?.credentials, new Headers(init?.headers).get("accept")]);
    expect(calls).toEqual([
      ['https://github.com/o/r/pull/9/_layout', 'same-origin', 'application/json'],
      ['https://github.com/o/r/pull/9/changes', 'same-origin', 'application/json'],
    ]);
  });

  it('does nothing when the page already holds the PR\'s data', async () => {
    const doc = staleDoc();
    const json = JSON.stringify({ payload: { pullRequestsLayoutRoute: { pullRequest: { number: 9, headSha: SHA } } } });
    doc.querySelector('script')!.textContent = json;
    const fetchMock = routes(9);
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadPageData(doc, url(9))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tries once per navigation, and again after the page data is forgotten', async () => {
    const doc = staleDoc();
    const failing = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', failing);
    expect(await loadPageData(doc, url(9))).toBe(false);
    expect(await loadPageData(doc, url(9))).toBe(false);
    expect(failing).toHaveBeenCalledTimes(2); // _layout and changes, once
    forgetPageData(doc);
    vi.stubGlobal('fetch', routes(9));
    expect(await loadPageData(doc, url(9))).toBe(true);
    forgetPageData(doc);
    expect(readHeadSha(doc, 9)).toBeNull();
  });

  it('rejects data that describes another PR', async () => {
    const doc = staleDoc();
    vi.stubGlobal('fetch', routes(8));
    expect(await loadPageData(doc, url(9))).toBe(false);
    expect(readHeadSha(doc, 9)).toBeNull();
    expect(readHeadSha(doc, 8)).toBeNull();
  });

  it('never fetches for a repository name that is not a plain owner/name', async () => {
    const doc = staleDoc();
    const fetchMock = routes(9);
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadPageData(doc, new URL('https://github.com/o/r%2F..%2Fx/pull/9/changes'))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch on a commit or range view', async () => {
    const doc = staleDoc();
    const fetchMock = routes(9);
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadPageData(doc, new URL(`https://github.com/o/r/pull/9/changes/${SHA}`))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
