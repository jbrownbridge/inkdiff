import { findMarkdownFiles, markdownRefs, readDiff, readHeadSha, readHunks, readThreads, threadsReadable, viewerAvatar } from '../../src/github/read';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function payloadScript(pr: number, sha: string, threads: Record<string, unknown> = {}, changes: Record<string, unknown> = {}): string {
  const json = JSON.stringify({
    payload: {
      pullRequestsLayoutRoute: { pullRequest: { number: pr, headSha: sha } },
      pullRequestsChangesRoute: { pullRequest: { number: pr }, markers: { threads }, ...changes },
    },
  });
  return `<script type="application/json" data-target="react-app.embeddedData">${json}</script>`;
}

const comment = (login: string, html: string) => ({ commentsData: { comments: [{ author: { login }, bodyHTML: html }] } });

function marker(id: string, heading: string | null): string {
  return `<div data-marker-id="${id}">${heading === null ? '' : `<h2>${heading}</h2>`}<span data-component="Label">Resolved</span></div>`;
}

/** One file region; `rows` are extra <tr> strings. Path is wrapped in U+200E marks like GitHub does. */
function page(script: string, rows = ''): Document {
  const html = `<div role="region" id="diff-x">
    <div data-diff-header-wrapper="true"><h3><a><code>‎docs/a.md‎</code></a></h3></div>
    <table data-diff-anchor="diff-x"><tbody>${rows}</tbody></table>
  </div>${script}`;
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

function row(n: number, inner = '', side: 'left' | 'right' = 'right'): string {
  const left = side === 'left' ? `<td class="diff-text-cell" data-diff-side="left" data-diff-line-key="l:${n}-r:null"><code class="diff-text deletion"><div class="diff-text-inner">x</div></code>${inner}</td>` : '';
  const right = `<td class="diff-text-cell" data-diff-side="right" data-line-number="${n}" data-diff-line-key="b:${n}-l:null-r:${n}"><code class="diff-text addition"><div class="diff-text-inner">y</div></code>${side === 'right' ? inner : ''}</td>`;
  return `<tr class="diff-line-row">${left}${right}</tr>`;
}

const urlFor = (pr: number) => new URL(`https://github.com/o/r/pull/${pr}/files`);

describe('commit and range views', () => {
  const full = { comparison: { selectedRange: null, viewing: 'FULL' } };

  it('finds files on the full comparison', () => {
    expect(findMarkdownFiles(page(payloadScript(1, SHA_A, {}, full)), urlFor(1))).toHaveLength(1);
  });

  it('finds .mmd files as Mermaid and Markdown files as Markdown', () => {
    const kinds = (path: string) => {
      const doc = page(payloadScript(1, SHA_A, {}, full));
      doc.querySelector('code')!.textContent = `\u200e${path}\u200e`;
      return findMarkdownFiles(doc, urlFor(1)).map((f) => [f.path, f.kind]);
    };
    expect(kinds('docs/a.md')).toEqual([['docs/a.md', 'markdown']]);
    expect(kinds('docs/a.MDX')).toEqual([['docs/a.MDX', 'markdown']]);
    expect(kinds('flow/chart.mmd')).toEqual([['flow/chart.mmd', 'mermaid']]);
    expect(kinds('flow/chart.MMD')).toEqual([['flow/chart.MMD', 'mermaid']]);
    expect(kinds('flow/chart.mmdx')).toEqual([]);
  });

  it('stays idle when the URL selects a commit or range', () => {
    const doc = page(payloadScript(1, SHA_A, {}, full));
    for (const tail of ['changes/abc123', 'files/abc123..def456', 'changes/abc123/', 'files/abc'])
      expect(findMarkdownFiles(doc, new URL(`https://github.com/o/r/pull/1/${tail}`))).toEqual([]);
  });

  it('stays idle when the payload is not the full comparison', () => {
    const range = { comparison: { selectedRange: { start: 'a', end: 'b' }, viewing: 'FULL' } };
    const commit = { comparison: { selectedRange: null, viewing: 'COMMIT' } };
    expect(findMarkdownFiles(page(payloadScript(1, SHA_A, {}, range)), urlFor(1))).toEqual([]);
    expect(findMarkdownFiles(page(payloadScript(1, SHA_A, {}, commit)), urlFor(1))).toEqual([]);
  });
});

describe('embedded payload after soft navigation', () => {
  it('reads the head SHA only for the PR the payload describes', () => {
    const doc = page(payloadScript(1, SHA_A));
    expect(readHeadSha(doc, 1)).toBe(SHA_A);
    expect(readHeadSha(doc, 2)).toBeNull();
    expect(findMarkdownFiles(doc, urlFor(2))).toEqual([]);
  });

  it('strips bidi marks from the path', () => {
    const doc = page(payloadScript(1, SHA_A));
    expect(findMarkdownFiles(doc, urlFor(1)).map((f) => f.path)).toEqual(['docs/a.md']);
  });

  it('does not serve a stale payload when the script element is replaced', () => {
    const doc = page(payloadScript(1, SHA_A));
    expect(readHeadSha(doc, 1)).toBe(SHA_A);
    doc.querySelector('script')!.remove();
    doc.body.insertAdjacentHTML('beforeend', payloadScript(2, SHA_B));
    expect(readHeadSha(doc, 2)).toBe(SHA_B);
    expect(readHeadSha(doc, 1)).toBeNull();
  });

  it('does not serve a stale payload when the script text changes in place', () => {
    const doc = page(payloadScript(1, SHA_A));
    expect(readHeadSha(doc, 1)).toBe(SHA_A);
    const fresh = new DOMParser().parseFromString(payloadScript(2, SHA_B), 'text/html').querySelector('script')!;
    doc.querySelector('script')!.textContent = fresh.textContent;
    expect(readHeadSha(doc, 2)).toBe(SHA_B);
  });

  it('ignores a payload with no PR number', () => {
    const json = JSON.stringify({ payload: { pullRequestsLayoutRoute: { pullRequest: { headSha: SHA_A } } } });
    const doc = page(`<script type="application/json" data-target="react-app.embeddedData">${json}</script>`);
    expect(readHeadSha(doc, 1)).toBeNull();
  });

  it('does not take thread comments from another PR payload', () => {
    const doc = page(payloadScript(1, SHA_A, { 7: comment('alice', '<p>hi</p>') }), row(3, marker('7', 'Comment on line R3')));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    expect(readThreads(file)[0].comments).toEqual([{ author: 'alice', bodyHtml: '<p>hi</p>' }]);
    expect(readThreads({ ...file, pr: 2 })).toEqual([]);
  });
});

describe('split view', () => {
  const cell = (side: 'left' | 'right', n: number, text: string) =>
    `<td class="diff-text-cell" data-diff-side="${side}" data-line-number="${n}" data-diff-line-key="${side === 'left' ? 'l' : 'r'}:${n}"><code class="diff-text"><div class="diff-text-inner">${text}</div></code></td>`;

  it('reads context rows from the right cell', () => {
    const doc = page(payloadScript(1, SHA_A), `<tr class="diff-line-row">${cell('left', 4, 'old side')}${cell('right', 6, 'new side')}</tr>`);
    const [file] = findMarkdownFiles(doc, urlFor(1));
    const diff = readDiff(file);
    expect([...diff.rightLineText]).toEqual([[6, 'new side']]);
    expect(diff.changedLines).toEqual([]);
  });
});

describe('threadsReadable (markup-change guard)', () => {
  const fileWith = (rows: string) => findMarkdownFiles(page(payloadScript(1, SHA_A, {}), rows), urlFor(1))[0];
  it('is true with no threads, or when a thread can be placed on a line', () => {
    expect(threadsReadable(fileWith(''))).toBe(true);
    expect(threadsReadable(fileWith(row(3, marker('7', 'Comment on line R3'))))).toBe(true);
  });
  it('is false when threads show but none has a line GitHub\'s heading names', () => {
    // Neither the heading nor the surrounding cell names a line (a markup change GitHub could make).
    const loose = `<tr class="diff-line-row"><td>${marker('7', 'Kommentar zu Zeile 3')}</td></tr><tr class="diff-line-row"><td>${marker('8', null)}</td></tr>`;
    expect(threadsReadable(fileWith(loose))).toBe(false);
  });
});

describe('thread line ranges', () => {
  function threadsOf(rows: string, threads: Record<string, unknown> = {}) {
    const doc = page(payloadScript(1, SHA_A, threads), rows);
    const [file] = findMarkdownFiles(doc, urlFor(1));
    return readThreads(file).map((t) => ({ id: t.id, startLine: t.startLine, endLine: t.endLine }));
  }

  it('reads right-side ranges from the heading', () => {
    expect(threadsOf(row(5, marker('1', 'Comment on lines R4 to R5')), { 1: comment('alice', '<p>hi</p>') })).toEqual([{ id: '1', startLine: 4, endLine: 5 }]);
  });

  /** Unified-view rows as GitHub renders them: a del row's key carries the previous right line, an add row's the previous left line. */
  const del = (l: number, prevRight: number, inner = '') => `<tr class="diff-line-row"><td data-diff-side="left" data-line-number="${l}"></td>
    <td class="diff-text-cell" data-diff-side="left" data-line-number="${l}" data-diff-line-key="b:${l}-l:${l}-r:${prevRight}"><code class="diff-text deletion"><div class="diff-text-inner">x</div></code>${inner}</td></tr>`;
  const line = (kind: 'addition' | '', l: number, r: number, inner = '') => `<tr class="diff-line-row">${kind ? '<td></td>' : `<td data-diff-side="left" data-line-number="${l}"></td>`}
    <td class="diff-text-cell" data-diff-side="right" data-line-number="${r}" data-diff-line-key="b:${r}-l:${l}-r:${r}"><code class="diff-text ${kind}"><div class="diff-text-inner">y</div></code>${inner}</td></tr>`;

  it('maps a left start to the first right line at or after its row', () => {
    // L10 and L11 deleted, then R12..R13 added; the thread "L10 to R13" covers right lines 12-13.
    const rows = line('', 9, 11) + del(10, 11) + del(11, 11) + line('addition', 11, 12) + line('addition', 11, 13, marker('1', 'Comment on lines L10 to R13'));
    expect(threadsOf(rows, { 1: comment('alice', '<p>hi</p>') })).toEqual([{ id: '1', startLine: 12, endLine: 13 }]);
  });

  it('shows a thread on removed lines on the line after the removal', () => {
    const rows = (heading: string) => line('', 9, 11) + del(10, 11) + del(11, 11, marker('1', heading)) + line('', 12, 12);
    expect(threadsOf(rows('Comment on line L11'), { 1: comment('alice', '<p>x</p>') })).toEqual([{ id: '1', startLine: 12, endLine: 12 }]);
    expect(threadsOf(rows('Comment on lines L10 to L11'), { 1: comment('alice', '<p>x</p>') })).toEqual([{ id: '1', startLine: 12, endLine: 12 }]);
  });

  it('skips a thread on removed lines at the end of the diff', () => {
    expect(threadsOf(line('', 9, 11) + del(10, 11, marker('1', 'Comment on line L10')), { 1: comment('alice', '<p>x</p>') })).toEqual([]);
  });

  it("maps a left start on a context row to that row's right line", () => {
    const rows = line('', 7, 9) + line('addition', 7, 10, marker('1', 'Comment on lines L7 to R10'));
    expect(threadsOf(rows, { 1: comment('alice', '<p>hi</p>') })).toEqual([{ id: '1', startLine: 9, endLine: 10 }]);
  });

  it('skips a left-start thread whose start row is not in the diff', () => {
    expect(threadsOf(row(5, marker('2', 'Comment on lines L4 to R5')), { 2: comment('alice', '<p>x</p>') })).toEqual([]);
  });

  it('falls back to the row number only when the marker sits in a right-side cell', () => {
    expect(threadsOf(row(8, marker('1', null)), { 1: comment('alice', '<p>hi</p>') })).toEqual([{ id: '1', startLine: 8, endLine: 8 }]);
    expect(threadsOf(row(8, marker('2', null), 'left'), { 2: comment('alice', '<p>x</p>') })).toEqual([]);
  });
});

describe('expanded thread comments in the DOM', () => {
  /** Mirrors GitHub's expanded thread: an avatar link (image only) precedes the named author link. */
  function domComment(login: string, body: string): string {
    return `<div data-testid="comment-header">
      <a href="/${login}" data-hovercard-type="user" aria-label="@${login}'s profile"><img alt="@${login}"></a>
      <a href="/${login}" data-testid="avatar-link" data-hovercard-type="user">${login}</a>
    </div><div class="comment-body"><div class="markdown-body">${body}</div></div>`;
  }

  function commentsOf(inner: string) {
    const thread = `<div data-marker-id="9"><h2>Comment on line R3</h2>${inner}</div>`;
    const doc = page(payloadScript(1, SHA_A, { 9: comment('embedded', '<p>stale</p>') }), row(3, thread));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    return readThreads(file)[0].comments;
  }

  it('reads each comment once with the named author, not the avatar link', () => {
    const comments = commentsOf(`<div>${domComment('alice', '<p>one</p>')}</div><div>${domComment('bob', '<p>two</p>')}</div>`);
    expect(comments).toEqual([{ author: 'alice', bodyHtml: '<p>one</p>' }, { author: 'bob', bodyHtml: '<p>two</p>' }]);
  });

  it('attributes a comment that @mentions someone to its author, not the mentioned user', () => {
    // Real nesting: the header is a sibling of the body's wrapper chain, reached only a few ancestors up.
    const mention = '<p>ping <a class="user-mention" data-hovercard-type="user" href="/carol">@carol</a></p>';
    const comments = commentsOf(`<div><div>${domComment('alice', '').replace('<div class="comment-body"><div class="markdown-body"></div></div>', '')}</div>
      <div><div><div><div class="markdown-body">${mention}</div></div></div></div></div>`);
    expect(comments).toEqual([{ author: 'alice', bodyHtml: mention }]);
  });
});

describe('comment details for the thread card', () => {
  const AVATAR = 'https://avatars.githubusercontent.com/u/1?v=4';

  it('reads avatar, time and Pending from an expanded thread', () => {
    const thread = `<div data-marker-id="9"><h2>Comment on line R3</h2><div>
      <div><a href="/jb" data-hovercard-type="user"><img src="${AVATAR}" alt="@jb"></a>
      <a href="/jb" data-testid="avatar-link" data-hovercard-type="user">jb</a>
      <relative-time datetime="2026-10-08T11:59:00Z">1m ago</relative-time><span data-component="Label">Pending</span></div>
      <div class="markdown-body"><p>Test</p></div></div></div>`;
    const doc = page(payloadScript(1, SHA_A), row(3, thread));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    expect(readThreads(file)[0].comments).toEqual([{ author: 'jb', bodyHtml: '<p>Test</p>', avatarUrl: AVATAR, createdAt: '2026-10-08T11:59:00Z', pending: true }]);
  });

  it('reads avatar, time and pending state from the embedded payload', () => {
    const data = { commentsData: { comments: [{ author: { login: 'jb', avatarUrl: AVATAR }, bodyHTML: '<p>x</p>', createdAt: '2026-10-08T11:59:00Z', state: 'pending' }] } };
    const doc = page(payloadScript(1, SHA_A, { 7: data }), row(3, marker('7', 'Comment on line R3')));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    expect(readThreads(file)[0].comments).toEqual([{ author: 'jb', bodyHtml: '<p>x</p>', avatarUrl: AVATAR, createdAt: '2026-10-08T11:59:00Z', pending: true }]);
  });
});

describe('deleted files', () => {
  it('leaves a deleted Markdown file to GitHub\'s own diff', () => {
    const diffSummaries = [{ path: 'docs/a.md', changeType: 'DELETED' }];
    const doc = page(payloadScript(1, SHA_A, {}, { diffSummaries }));
    expect(findMarkdownFiles(doc, urlFor(1))).toEqual([]);
  });
});

describe('markdownRefs', () => {
  it('lists changed Markdown and Mermaid files still present at head', () => {
    const diffSummaries = [
      { path: 'a.md', changeType: 'MODIFIED' }, { path: 'b.ts', changeType: 'ADDED' },
      { path: 'gone.md', changeType: 'DELETED' }, { path: 'c.mmd', changeType: 'ADDED' },
    ];
    const doc = page(payloadScript(1, SHA_A, {}, { diffSummaries }));
    expect(markdownRefs(doc, urlFor(1))).toEqual([
      { repo: 'o/r', sha: SHA_A, path: 'a.md' }, { repo: 'o/r', sha: SHA_A, path: 'c.mmd' },
    ]);
  });
});

describe('draft comment forms', () => {
  it('ignores a thread marker that holds no posted comment', () => {
    const draft = `<div data-marker-id="99"><h2>Comment on line R3</h2></div>`;
    const doc = page(payloadScript(1, SHA_A), row(3, draft));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    expect(readThreads(file)).toEqual([]);
  });

  it('keeps a collapsed thread whose comments come from the payload', () => {
    const doc = page(payloadScript(1, SHA_A, { 7: comment('alice', '<p>hi</p>') }), row(3, marker('7', 'Comment on line R3')));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    expect(readThreads(file).map((t) => t.id)).toEqual(['7']);
  });
});

describe('hunks', () => {
  const hunk = (text: string) =>
    `<tr class="diff-line-row"><td colspan="4" class="diff-hunk-cell"><code class="diff-text-cell hunk"><div class="diff-text-inner color-fg-muted">${text}</div></code></td></tr>`;

  it('reads each hunk header with the first new-side line after it', () => {
    const doc = page(payloadScript(1, SHA_A), hunk('@@ -17,7 +17,9 @@') + row(17) + row(18) + hunk('@@ -44,16   +46,18 @@  Guide') + row(46) + hunk(''));
    const [file] = findMarkdownFiles(doc, urlFor(1));
    expect(readHunks(file)).toEqual([
      { header: '@@ -17,7 +17,9 @@', start: 17 },
      { header: '@@ -44,16 +46,18 @@ Guide', start: 46 },
    ]);
  });
});

describe('viewerAvatar', () => {
  it('returns the signed-in viewer avatar from a GitHub host', () => {
    const doc = new DOMParser().parseFromString(
      '<meta name="user-login" content="me"><img alt="@me" src="https://avatars.githubusercontent.com/u/1?v=4"><img alt="@me" src="https://evil.example/x.png">', 'text/html');
    expect(viewerAvatar(doc)).toBe('https://avatars.githubusercontent.com/u/1?v=4');
  });
  it('returns the user-menu avatar on the new page (alt is the display name)', () => {
    const doc = new DOMParser().parseFromString(
      '<meta name="user-login" content="me"><button data-login="me" aria-haspopup="menu"><img data-component="Avatar" alt="Jason Brownbridge" src="https://avatars.githubusercontent.com/u/127297?v=4&amp;size=64"></button>', 'text/html');
    expect(viewerAvatar(doc)).toBe('https://avatars.githubusercontent.com/u/127297?v=4&size=64');
  });
  it('ignores a user-menu avatar from another host and falls back to the alt match', () => {
    const doc = new DOMParser().parseFromString(
      '<meta name="user-login" content="me"><button data-login="me"><img data-component="Avatar" alt="Me" src="https://evil.example/x.png"></button><img alt="@me" src="https://avatars.githubusercontent.com/u/1?v=4">', 'text/html');
    expect(viewerAvatar(doc)).toBe('https://avatars.githubusercontent.com/u/1?v=4');
  });
  it('returns null when logged out', () => {
    expect(viewerAvatar(new DOMParser().parseFromString('<img alt="@me" src="https://avatars.githubusercontent.com/u/1">', 'text/html'))).toBeNull();
  });
});
