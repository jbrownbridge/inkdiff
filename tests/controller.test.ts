import { readFileSync } from 'node:fs';
import { SourceError } from '../src/core/source-fetch';
import { FileController, type ControllerDeps } from '../src/content/controller';
import { createGitHubAdapter } from '../src/github/adapter';
import { type GitHubAdapter, type MdFile, type NativeForm } from '../src/github/types';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

vi.mock('../src/view/mermaid-loader', () => ({ loadMermaidModule: async () => ({ initialize: vi.fn(), render: vi.fn() }) }));

const SOURCE = readFileSync('e2e/fixture-repo/head/docs/guide.md', 'utf8');

function setup(over: Partial<GitHubAdapter> = {}, deps: Partial<ControllerDeps> = {}) {
  const container = document.createElement('div');
  const rich = document.createElement('button');
  const src = document.createElement('button');
  const body = document.createElement('div');
  container.append(rich, src, body);
  document.body.replaceChildren(container);
  const bubbled = vi.fn();
  container.addEventListener('click', bubbled);
  const file: MdFile = { path: 'docs/guide.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'abc', container };
  const adapter: GitHubAdapter = {
    readOnlyNote: null,
    readHunks: () => [],
    viewerAvatar: () => null,
    pageLooksSupported: () => true,
    findMarkdownFiles: () => [file],
    richToggle: () => rich,
    sourceToggle: () => src,
    diffBody: () => body,
    readDiff: () => ({ changedLines: [9], removed: [], rightLineText: new Map([[9, 'an exact middle line.']]) }),
    readThreads: () => [],
    revealSourceLine: vi.fn(),
    observe: () => () => {},
    ...over,
  };
  const controller = new FileController(file, {
    adapter, fetchSource: vi.fn(async () => SOURCE), settings: { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: false }, doc: document,
    whenVisible: (_el, cb) => { cb(); return () => {}; }, ...deps,
  });
  return { controller, adapter, file, rich, src, body, bubbled, container };
}

describe('FileController', () => {
  it('leaves GitHub\'s view alone when the file is not found at the head commit', async () => {
    const { controller, container, body } = setup({}, { fetchSource: async () => { throw new SourceError('not-found', 'gone'); } });
    await controller.open();
    expect(container.querySelector('.mdr-panel, .mdr-load-error')).toBeNull();
    expect(body.classList.contains('mdr-hidden')).toBe(false);
    expect(container.classList.contains('mdr-src')).toBe(true);
  });

  it('keeps GitHub\'s view and warns when review threads cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSource = vi.fn(async () => SOURCE);
    const { controller, container, body } = setup({ threadsReadable: () => false }, { fetchSource });
    await controller.open();
    expect(container.querySelector('.mdr-panel')).toBeNull();
    expect(body.classList.contains('mdr-hidden')).toBe(false);
    expect(fetchSource).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('review threads');
    warn.mockRestore();
  });

  it('lets GitHub\'s rich-diff button work once it hands a file back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rich = document.createElement('button');
    const clicks = vi.fn();
    rich.addEventListener('click', clicks);
    const { controller, container } = setup({ threadsReadable: () => false, richToggle: () => rich });
    container.append(rich);
    controller.attach();
    rich.click(); // intercepted; Inkdiff hands back and clicks GitHub's button itself
    await vi.waitFor(() => expect(clicks).toHaveBeenCalledTimes(1));
    rich.click(); // now GitHub's own
    expect(clicks).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.mdr-panel')).toBeNull();
    warn.mockRestore();
  });

  it('removes an earlier error box when it opens again', async () => {
    let fail = true;
    const { controller, container } = setup({}, { fetchSource: async () => { if (fail) throw new SourceError('network', 'x'); return SOURCE; } });
    await controller.open();
    expect(container.querySelectorAll('.mdr-load-error')).toHaveLength(1);
    fail = false;
    await controller.open();
    expect(container.querySelectorAll('.mdr-load-error')).toHaveLength(0);
    expect(container.querySelector('.mdr-panel .mdr-body')).not.toBeNull();
  });

  it('lets the source diff show unless the file opens rendered by itself', async () => {
    const off = setup();
    off.controller.attach();
    expect(off.container.classList.contains('mdr-src')).toBe(true);
    const on = setup({}, { settings: { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: true } });
    on.controller.attach();
    expect(on.container.classList.contains('mdr-src')).toBe(false);
    await vi.waitFor(() => expect(on.container.querySelector('.mdr-panel:not(.mdr-loading)')).not.toBeNull());
    on.src.click();
    expect(on.container.classList.contains('mdr-src')).toBe(true);
  });

  it('opens again when GitHub collapses the file and expands it', async () => {
    let onChange = () => {};
    let body = document.createElement('div');
    const { controller, container } = setup(
      { diffBody: () => (body.isConnected ? body : null), observe: (_f, cb) => { onChange = cb; return () => {}; } },
      { settings: { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: true } },
    );
    const wrap = document.createElement('div');
    container.querySelector('div')!.replaceWith(wrap);
    wrap.append(body);
    controller.attach();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel .mdr-body')).not.toBeNull());
    // Collapse: GitHub removes the body's wrapper, and the rendered view in it.
    wrap.remove();
    onChange();
    expect(controller.isOpen()).toBe(false);
    // Expand: GitHub draws a new body.
    body = document.createElement('div');
    const again = document.createElement('div');
    again.append(body);
    container.append(again);
    await vi.waitFor(() => expect(again.querySelector('.mdr-panel .mdr-body')).not.toBeNull());
    expect(body.classList.contains('mdr-hidden')).toBe(true);
    expect(container.querySelectorAll('.mdr-panel')).toHaveLength(1);
  });

  it('hides the source diff while the rendered view loads', async () => {
    let release!: (s: string) => void;
    const { controller, body } = setup({}, { fetchSource: () => new Promise((r) => { release = r; }) });
    const opening = controller.open();
    expect(body.classList.contains('mdr-hidden')).toBe(true);
    release(SOURCE);
    await opening;
    expect(body.classList.contains('mdr-hidden')).toBe(true);
  });

  it('fetches nothing on attach for a file far from view (the idle prefetcher does)', () => {
    const fetchSource = vi.fn(() => new Promise<string>(() => {}));
    const { controller } = setup({}, { fetchSource, settings: { ...DEFAULT_SETTINGS, renderedByDefault: true }, whenVisible: () => () => {} });
    controller.attach();
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('opens on the rich toggle even after GitHub re-renders it', async () => {
    let toggle = document.createElement('button');
    const { controller, container, bubbled } = setup({ richToggle: () => toggle });
    container.prepend(toggle);
    controller.attach();
    const fresh = document.createElement('button');
    toggle.replaceWith(fresh);
    toggle = fresh;
    fresh.click();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel:not(.mdr-loading)')).not.toBeNull());
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('puts View rendered on source-diff threads; it opens the view at that thread', async () => {
    const marker = document.createElement('div');
    const thread = { id: 't1', startLine: 5, endLine: 5, resolved: true, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] };
    const { controller, container, body } = setup({ readThreads: () => [thread], threadMarkers: () => [{ id: 't1', el: marker }] });
    body.append(marker);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    controller.attach();
    const go = marker.querySelector<HTMLButtonElement>('.mdr-to-rendered')!;
    expect(go.textContent).toBe('View rendered');
    controller.attach();
    expect(marker.querySelectorAll('.mdr-to-rendered')).toHaveLength(1);
    go.click();
    await vi.waitFor(() => expect(container.querySelector('.mdr-thread[data-thread-id="t1"]')?.classList.contains('mdr-flash')).toBe(true));
    const shown = container.querySelector<HTMLDetailsElement>('.mdr-thread[data-thread-id="t1"]')!;
    expect(shown.open).toBe(true);
    expect(scroll).toHaveBeenCalled();
    controller.detach();
    expect(marker.querySelector('.mdr-to-rendered')).toBeNull();
  });

  it('passes the adapter\'s native form opener to the panel with this file', async () => {
    const box = document.createElement('div');
    box.innerHTML = '<textarea></textarea>';
    const form: NativeForm = { box, restore: vi.fn(), text: () => '', fill: vi.fn(), focus: vi.fn(), actionOf: () => null, watch: () => () => {}, settle: async () => 'gone' };
    const openNativeForm = vi.fn(async () => form);
    const { controller, file, container } = setup({ openNativeForm });
    await controller.open();
    container.querySelector('.mdr-body h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('.mdr-add')!.click();
    await vi.waitFor(() => expect(container.querySelector('.mdr-native-host')?.firstChild).toBe(box));
    expect(openNativeForm).toHaveBeenCalledWith(file, { start: 5, end: 5 });
  });

  it('uses our own form when the adapter has no native form opener', async () => {
    const { controller, container } = setup();
    await controller.open();
    container.querySelector('.mdr-body h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('.mdr-add')!.click();
    expect(container.querySelector('.mdr-comment-form')).not.toBeNull();
  });

  it('opens the panel on the rich toggle and stops GitHub handling the click', async () => {
    const { controller, rich, body, bubbled, container } = setup();
    controller.attach();
    rich.click();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel')).not.toBeNull());
    expect(body.classList.contains('mdr-hidden')).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('resolves relative links against the PR head commit', async () => {
    const { controller, container } = setup({}, { fetchSource: vi.fn(async () => '[x](other.md)\n') });
    await controller.open();
    expect(container.querySelector('.mdr-body a')!.getAttribute('href')).toBe('https://github.com/o/r/blob/abc/docs/other.md');
  });

  it('passes GitHub hunks and the showOnlyChanged setting to the panel', async () => {
    const { controller, container } = setup({ readHunks: () => [{ header: '@@ -9,1 +9,1 @@', start: 9 }] }, { settings: { ...DEFAULT_SETTINGS, showOnlyChanged: true } });
    await controller.open();
    expect(container.querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -9,1 +9,1 @@');
    expect(container.querySelector('.mdr-body .mdr-collapsed')).not.toBeNull();
  });

  it('shows the whole file when showOnlyChanged is off', async () => {
    const { controller, container } = setup({ readHunks: () => [{ header: '@@ -9,1 +9,1 @@', start: 9 }] });
    await controller.open();
    expect(container.querySelector('.mdr-hunk')).toBeNull();
    expect(container.querySelector('.mdr-collapsed')).toBeNull();
  });

  it('closes the panel on the source toggle', async () => {
    const { controller, src, body, container } = setup();
    controller.attach();
    await controller.open();
    src.click();
    expect(container.querySelector('.mdr-panel')).toBeNull();
    expect(body.classList.contains('mdr-hidden')).toBe(false);
  });

  it('opens by default when the setting is on', async () => {
    const { controller, container } = setup({}, { settings: { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: true } });
    controller.attach();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel')).not.toBeNull());
  });

  it('keeps waiting for the diff body when opening by default', async () => {
    let ready = false;
    const { controller, container, body } = setup({ diffBody: () => (ready ? body : null) }, { settings: { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: true } });
    body.remove();
    controller.attach();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.mdr-panel')).toBeNull();
    ready = true;
    container.append(body);
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel')).not.toBeNull());
  });

  it('opens on the rich toggle once a lazily loaded diff body arrives', async () => {
    let ready = false;
    const { controller, container, body, rich, bubbled } = setup({ diffBody: () => (ready ? body : null) });
    body.remove();
    controller.attach();
    rich.click();
    expect(bubbled).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.mdr-panel')).toBeNull();
    ready = true;
    container.append(body);
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel')).not.toBeNull());
  });

  it('keeps rendering with an accurate note when the diff has no lines (rename, empty, collapsed)', async () => {
    const { controller, container } = setup({ readDiff: () => ({ changedLines: [], removed: [], rightLineText: new Map() }) });
    await controller.open();
    expect(container.querySelector('.mdr-body h1')).not.toBeNull();
    expect(container.querySelector('.mdr-banner')!.textContent).toBe('No changed lines in this diff to comment on.');
  });

  it('disables comments when the source does not match the diff', async () => {
    const { controller, container } = setup({ readDiff: () => ({ changedLines: [], removed: [], rightLineText: new Map([[9, 'other']]) }) });
    await controller.open();
    expect(container.querySelector('.mdr-banner')!.textContent).toBe('File changed. Reload to comment.');
  });

  it('falls back to GitHub rich diff when the fetch fails', async () => {
    const { controller, container, bubbled } = setup({}, { fetchSource: vi.fn(async () => { throw new SourceError('network', 'x'); }) });
    controller.attach();
    await controller.open();
    expect(container.querySelector('.mdr-load-error')!.textContent).toContain('Could not load the rendered view.');
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Show GitHub rich diff')!.click();
    expect(container.querySelector('.mdr-load-error')).toBeNull();
    expect(bubbled).toHaveBeenCalledTimes(2);
    expect(controller.isOpen()).toBe(false);
  });

  it('explains when the file is too large', async () => {
    const { controller, container } = setup({}, { fetchSource: vi.fn(async () => { throw new SourceError('too-large', 'x'); }) });
    await controller.open();
    expect(container.querySelector('.mdr-load-error')!.textContent).toContain('This file is larger than 1 MB.');
  });

  it('does not re-set threads in a loop when the panel itself mutates the container', async () => {
    const real = createGitHubAdapter();
    const th = { id: 't1', startLine: 9, endLine: 9, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] };
    const { controller } = setup({ observe: real.observe, readThreads: vi.fn(() => [th]) });
    await controller.open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const mo = new MutationObserver(() => {});
      mo.observe(document.body, { childList: true, subtree: true });
      await vi.advanceTimersByTimeAsync(700);
      expect(mo.takeRecords().length).toBe(0);
      mo.disconnect();
      controller.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores panel-internal mutations in the adapter observe', async () => {
    const real = createGitHubAdapter();
    const { file, container } = setup();
    const panel = document.createElement('div');
    panel.className = 'mdr-panel';
    container.append(panel);
    const cb = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const stop = real.observe(file, cb);
      panel.append(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(300);
      expect(cb).not.toHaveBeenCalled();
      container.append(document.createElement('p'));
      await vi.advanceTimersByTimeAsync(300);
      expect(cb).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('only sets threads when they changed', async () => {
    let threads = [{ id: 't1', startLine: 9, endLine: 9, resolved: false, comments: [] as { author: string; bodyHtml: string }[] }];
    let fire = () => {};
    const { controller } = setup({ readThreads: () => threads, observe: (_f, cb) => { fire = cb; return () => {}; } });
    controller.attach();
    await controller.open();
    const mo = new MutationObserver(() => {});
    mo.observe(document.body, { childList: true, subtree: true });
    fire();
    expect(mo.takeRecords().length).toBe(0);
    threads = [{ ...threads[0], resolved: true }];
    fire();
    expect(mo.takeRecords().length).toBeGreaterThan(0);
    fire();
    expect(mo.takeRecords().length).toBe(0);
    mo.disconnect();
  });

  it('close during fetch removes loading and never shows the panel', async () => {
    let resolve!: (s: string) => void;
    const { controller, container, body } = setup({}, { fetchSource: () => new Promise<string>((r) => { resolve = r; }) });
    const p = controller.open();
    expect(container.querySelector('.mdr-loading')).not.toBeNull();
    controller.close();
    expect(container.querySelector('.mdr-loading')).toBeNull();
    resolve(SOURCE);
    await p;
    expect(container.querySelector('.mdr-panel')).toBeNull();
    expect(body.classList.contains('mdr-hidden')).toBe(false);
    expect(controller.isOpen()).toBe(false);
  });

  it('detach during fetch leaks no observer', async () => {
    let resolve!: (s: string) => void;
    const stopObserve = vi.fn();
    const observe = vi.fn(() => stopObserve);
    const { controller } = setup({ observe }, { fetchSource: () => new Promise<string>((r) => { resolve = r; }) });
    controller.attach();
    const p = controller.open();
    controller.detach();
    resolve(SOURCE);
    await p;
    expect(stopObserve).toHaveBeenCalledTimes(observe.mock.calls.length);
  });

  it('shows the load error and warns once when rendering throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controller, container, body } = setup({ readDiff: () => { throw new Error('boom'); } });
    await controller.open();
    expect(container.querySelector('.mdr-loading')).toBeNull();
    expect(container.querySelector('.mdr-load-error')!.textContent).toContain('Could not load the rendered view.');
    expect(body.classList.contains('mdr-hidden')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('[Inkdiff]');
    warn.mockRestore();
  });

  it('source toggle cancels the pending visibility open', async () => {
    const stop = vi.fn();
    const { controller, src } = setup({}, { settings: { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: true }, whenVisible: () => stop });
    controller.attach();
    src.click();
    expect(stop).toHaveBeenCalled();
  });
});

describe('FileController for a .mmd file', () => {
  const MMD = 'graph TD\n  A --> B\n';
  const off = { ...DEFAULT_SETTINGS, showOnlyChanged: false, renderedByDefault: false, autoRenderMermaid: false };
  function mmd(path = 'flow/chart.mmd') {
    const s = setup({ readDiff: () => ({ changedLines: [1, 2], removed: [], rightLineText: new Map([[1, 'graph TD'], [2, '  A --> B']]) }) }, { fetchSource: vi.fn(async () => MMD), settings: off });
    Object.assign(s.file, { path, kind: 'mermaid' });
    return s;
  }

  it('opens when visible and renders the diagram even with both settings off', async () => {
    const { controller, container } = mmd();
    controller.attach();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel .md-mermaid')).not.toBeNull());
    const host = container.querySelector<HTMLElement>('.md-mermaid')!;
    expect(host.dataset.srcStart).toBe('1');
    expect(host.dataset.srcEnd).toBe('2');
    expect(container.querySelector('.mdr-mermaid-render')).toBeNull();
  });

  it('leaves GitHub\'s rich toggle alone', async () => {
    const { controller, container, rich, bubbled } = mmd('flow/b.mmd');
    controller.attach();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel .md-mermaid')).not.toBeNull());
    rich.click();
    expect(bubbled).toHaveBeenCalled();
  });

  it('View source closes the panel and it does not reopen', async () => {
    const { controller, container, body } = mmd('flow/c.mmd');
    controller.attach();
    await vi.waitFor(() => expect(container.querySelector('.mdr-panel .md-mermaid')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('button.mdr-view-source')!.click();
    expect(container.querySelector('.mdr-panel')).toBeNull();
    expect(body.classList.contains('mdr-hidden')).toBe(false);
    controller.detach();
    controller.attach();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.mdr-panel')).toBeNull();
  });

  it('offers the source diff, not the rich diff, when loading fails', async () => {
    const { controller, container, rich } = mmd('flow/d.mmd');
    (controller as unknown as { deps: ControllerDeps }).deps.fetchSource = vi.fn(async () => { throw new Error('boom'); });
    const richClick = vi.fn();
    rich.addEventListener('click', richClick);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await controller.open();
    const b = [...container.querySelectorAll<HTMLButtonElement>('.mdr-load-error button')];
    expect(b.map((x) => x.textContent)).toEqual(['Show source diff']);
    b[0].click();
    expect(container.querySelector('.mdr-load-error')).toBeNull();
    expect(richClick).not.toHaveBeenCalled();
  });

  it('has no View source button for Markdown files', async () => {
    const { controller, container } = setup();
    await controller.open();
    expect(container.querySelector('button.mdr-view-source')).toBeNull();
  });
});
