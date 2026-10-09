import { renderThread, timeAgo } from '../../src/view/threads';

const actions = () => ({ revealLine: vi.fn() });

describe('renderThread', () => {
  it('sanitizes comment HTML', () => {
    const el = renderThread(document, {
      id: 't', startLine: 1, endLine: 1, resolved: false,
      comments: [{ author: 'x', bodyHtml: '<p>hi</p><script>alert(1)</script><img src="x" onerror="alert(1)">' }],
    }, actions());
    expect(el.innerHTML).not.toContain('<script');
    expect(el.innerHTML).not.toContain('onerror');
    expect(el.textContent).toContain('hi');
  });

  it('offers only View in source (replies happen in GitHub\'s own thread)', () => {
    const a = actions();
    const el = renderThread(document, { id: 't', startLine: 3, endLine: 4, resolved: false, comments: [] }, a);
    expect(el.querySelector('textarea')).toBeNull();
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['View in source']);
    buttons[0].click();
    expect(a.revealLine).toHaveBeenCalledWith(4);
  });

  it('starts collapsed when resolved', () => {
    const el = renderThread(document, { id: 't', startLine: 1, endLine: 1, resolved: true, comments: [] }, actions()) as HTMLDetailsElement;
    expect(el.open).toBe(false);
    expect(el.querySelector('.mdr-thread-head')!.textContent).toContain('Resolved');
  });

  it('looks like a GitHub review comment: heading, avatar, author, time, Pending', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const el = renderThread(document, {
      id: 't', startLine: 17, endLine: 17, resolved: false,
      comments: [{ author: 'jb', bodyHtml: '<p>Test</p>', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', createdAt: '2026-10-08T11:59:00Z', pending: true }],
    }, actions(), { now });
    expect(el.querySelector('summary')!.textContent).toBe('Comment on line R17');
    const head = el.querySelector('.mdr-comment-head')!;
    expect(head.querySelector<HTMLImageElement>('img.mdr-avatar')!.src).toBe('https://avatars.githubusercontent.com/u/1?v=4');
    expect(head.querySelector('.mdr-author')!.textContent).toBe('jb');
    expect(head.querySelector('.mdr-time')!.textContent).toBe('1m ago');
    expect(head.querySelector('.mdr-label-pending')!.textContent).toBe('Pending');
  });

  it('names a range and labels a resolved thread', () => {
    const el = renderThread(document, { id: 't', startLine: 2, endLine: 5, resolved: true, comments: [{ author: 'a', bodyHtml: 'x' }] }, actions());
    expect(el.querySelector('.mdr-thread-title')!.textContent).toBe('Comment on lines R2 to R5');
    expect(el.querySelector('summary .mdr-label')!.textContent).toBe('Resolved');
  });

  it('drops avatars from other hosts', () => {
    const el = renderThread(document, { id: 't', startLine: 1, endLine: 1, resolved: false, comments: [{ author: 'a', bodyHtml: 'x', avatarUrl: 'https://evil.example/a.png' }] }, actions());
    expect(el.querySelector('img')).toBeNull();
  });

});

describe('comment HTML (security review)', () => {
  it('strips style, forms, data-* and unknown classes; keeps highlighting and mention classes', () => {
    const html = '<style>body{display:none}</style><div style="position:fixed;inset:0" data-hotkey="a">x</div>'
      + '<form><button>Approve</button></form><span class="pl-k evil">fn</span><a class="user-mention" href="/u">@u</a><h1 id="top">t</h1>';
    const el = renderThread(document, { id: 't', startLine: 1, endLine: 1, resolved: false, comments: [{ author: 'a', bodyHtml: html }] }, actions());
    const body = el.querySelector('.mdr-comment-body')!;
    expect(body.querySelector('style, form, button, [style], [data-hotkey]')).toBeNull();
    expect(body.querySelector('span')!.className).toBe('pl-k');
    expect(body.querySelector('a')!.className).toBe('user-mention');
    expect(body.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(body.querySelector('h1')!.id).toBe('user-content-top');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  it.each([
    ['2026-10-08T11:59:40Z', 'just now'],
    ['2026-10-08T11:55:00Z', '5m ago'],
    ['2026-10-08T09:00:00Z', '3h ago'],
    ['2026-10-06T12:00:00Z', '2d ago'],
    ['2026-08-01T12:00:00Z', 'Aug 1'],
    ['nonsense', ''],
  ])('%s → %s', (iso, want) => expect(timeAgo(iso, now)).toBe(want));
});
