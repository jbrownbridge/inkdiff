import { parseFilesPage, startRouter } from '../src/content/router';
import type { GitHubAdapter, MdFile } from '../src/github/types';

describe('parseFilesPage', () => {
  it('accepts files and changes tabs', () => {
    expect(parseFilesPage(new URL('https://github.com/o/r/pull/12/files'))).toEqual({ repo: 'o/r', pr: 12 });
    expect(parseFilesPage(new URL('https://github.com/o/r/pull/12/changes'))).toEqual({ repo: 'o/r', pr: 12 });
  });
  it('rejects other pages', () => {
    expect(parseFilesPage(new URL('https://github.com/o/r/pull/12'))).toBeNull();
    expect(parseFilesPage(new URL('https://github.com/o/r/blob/main/README.md'))).toBeNull();
  });
});

describe('startRouter', () => {
  beforeEach(() => history.replaceState(null, '', '/o/r/pull/1/files'));

  it('creates one controller per file and detaches on stop', () => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const file = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container } as MdFile;
    const adapter = { findMarkdownFiles: () => [file], pageLooksSupported: () => true } as unknown as GitHubAdapter;
    const c = { attach: vi.fn(), detach: vi.fn() };
    const stop = startRouter({ doc: document, adapters: [adapter], makeController: () => c });
    expect(c.attach).toHaveBeenCalledTimes(1);
    stop();
    expect(c.detach).toHaveBeenCalledTimes(1);
  });

  it('warns once when the page structure is not recognised', async () => {
    const adapter = { findMarkdownFiles: () => [], pageLooksSupported: () => false } as unknown as GitHubAdapter;
    const warn = vi.fn();
    const stop = startRouter({ doc: document, adapters: [adapter], makeController: vi.fn(), warn, healthDelayMs: 10 });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn.mock.calls[0][0]).toContain('[Inkdiff]');
    stop();
  });

  it('reports the manifest version in the warning', async () => {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '9.9.9' }) } });
    try {
      const adapter = { findMarkdownFiles: () => [], pageLooksSupported: () => false } as unknown as GitHubAdapter;
      const warn = vi.fn();
      const stop = startRouter({ doc: document, adapters: [adapter], makeController: vi.fn(), warn, healthDelayMs: 10 });
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn.mock.calls[0][0]).toContain('v9.9.9');
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('scans again once the adapter fetched page data the page lacked', async () => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const file = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container } as MdFile;
    let loaded = false;
    const forgetPageData = vi.fn();
    const adapter = {
      findMarkdownFiles: () => (loaded ? [file] : []),
      pageLooksSupported: () => true,
      loadPageData: vi.fn(async () => { await Promise.resolve(); if (loaded) return false; loaded = true; return true; }),
      forgetPageData,
    } as unknown as GitHubAdapter;
    const c = { attach: vi.fn(), detach: vi.fn() };
    const stop = startRouter({ doc: document, adapters: [adapter], makeController: () => c });
    expect(c.attach).not.toHaveBeenCalled();
    expect(forgetPageData).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(c.attach).toHaveBeenCalledTimes(1));
    stop();
  });

  it('replaces the controller when GitHub reuses a container for another PR', async () => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    let file = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container } as MdFile;
    const adapter = { findMarkdownFiles: () => [file], pageLooksSupported: () => true } as unknown as GitHubAdapter;
    const made: { file: MdFile; attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> }[] = [];
    const stop = startRouter({
      doc: document, adapters: [adapter],
      makeController: (f) => { const c = { file: f, attach: vi.fn(), detach: vi.fn() }; made.push(c); return c; },
    });
    expect(made).toHaveLength(1);
    history.pushState(null, '', '/o/r/pull/2/files');
    file = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 2, headSha: 'y', container } as MdFile;
    document.body.append(document.createElement('span'));
    await vi.waitFor(() => expect(made).toHaveLength(2));
    expect(made[0].detach).toHaveBeenCalledTimes(1);
    expect(made[1].file.pr).toBe(2);
    expect(made[1].attach).toHaveBeenCalledTimes(1);
    stop();
    expect(made[1].detach).toHaveBeenCalledTimes(1);
  });

  it('keeps the controller while the file identity is unchanged', async () => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const adapter = {
      findMarkdownFiles: () => [{ path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container } as MdFile],
      pageLooksSupported: () => true,
    } as unknown as GitHubAdapter;
    const make = vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const stop = startRouter({ doc: document, adapters: [adapter], makeController: make });
      document.body.append(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(200);
      expect(make).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the first adapter whose page looks supported, and re-picks when support changes', async () => {
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const file = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container } as MdFile;
    let firstSupported = false;
    const first = { findMarkdownFiles: () => [file], pageLooksSupported: () => firstSupported } as unknown as GitHubAdapter;
    const second = { findMarkdownFiles: () => [file], pageLooksSupported: () => true } as unknown as GitHubAdapter;
    const made: { adapter: GitHubAdapter; attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> }[] = [];
    const stop = startRouter({
      doc: document, adapters: [first, second],
      makeController: (_f, a) => { const c = { adapter: a, attach: vi.fn(), detach: vi.fn() }; made.push(c); return c; },
    });
    expect(made).toHaveLength(1);
    expect(made[0].adapter).toBe(second);
    firstSupported = true;
    document.body.append(document.createElement('span'));
    await vi.waitFor(() => expect(made).toHaveLength(2));
    expect(made[0].detach).toHaveBeenCalledTimes(1);
    expect(made[1].adapter).toBe(first);
    expect(made[1].attach).toHaveBeenCalledTimes(1);
    stop();
  });

  it('scans on the next frame when GitHub draws a file (selector observer) or ends a navigation', async () => {
    const container = document.createElement('div');
    document.body.replaceChildren();
    let files: MdFile[] = [];
    const adapter = { findMarkdownFiles: () => files, pageLooksSupported: () => true } as unknown as GitHubAdapter;
    const c = { attach: vi.fn(), detach: vi.fn() };
    const stop = startRouter({ doc: document, adapters: [adapter], makeController: () => c });
    files = [{ path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container } as MdFile];
    const e = new Event('animationstart', { bubbles: true }) as AnimationEvent;
    Object.defineProperty(e, 'animationName', { value: 'mdr-seen' });
    document.dispatchEvent(e);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(c.attach).toHaveBeenCalledTimes(1);
    files = [];
    document.dispatchEvent(new Event('soft-nav:end'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(c.detach).toHaveBeenCalledTimes(1);
    stop();
  });

  it('lets the source diff show for file regions no controller takes', () => {
    document.body.innerHTML = '<div role="region" id="diff-a"></div><div role="region" id="diff-b"></div>';
    const [a, b] = [...document.querySelectorAll<HTMLElement>('[role="region"]')];
    const file = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'x', container: a } as MdFile;
    const adapter = { findMarkdownFiles: () => [file], pageLooksSupported: () => true } as unknown as GitHubAdapter;
    const stop = startRouter({ doc: document, adapters: [adapter], makeController: () => ({ attach() {}, detach() {} }) });
    expect(a.classList.contains('mdr-src')).toBe(false);
    expect(b.classList.contains('mdr-src')).toBe(true);
    stop();
  });

  it('prefetches the PR\'s Markdown files once per page', () => {
    document.body.replaceChildren();
    const refs = [{ repo: 'o/r', sha: 'x', path: 'a.md' }];
    const adapter = { findMarkdownFiles: () => [], pageLooksSupported: () => true, markdownRefs: vi.fn(() => refs) } as unknown as GitHubAdapter;
    const prefetch = vi.fn();
    const stop = startRouter({ doc: document, adapters: [adapter], makeController: vi.fn(), prefetch });
    document.dispatchEvent(new Event('soft-nav:end'));
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith(refs);
    stop();
  });
});
