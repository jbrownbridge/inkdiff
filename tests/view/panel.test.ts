import { readFileSync } from 'node:fs';
import { clearProviders, registerBuiltInProviders } from '../../src/core/comment-draft';
import { renderMarkdown } from '../../src/render/render';
import type { ThreadInfo } from '../../src/github/types';
import { createPanel, type PanelCallbacks } from '../../src/view/panel';

vi.mock('../../src/view/mermaid-loader', () => ({ loadMermaidModule: async () => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) }) }));

const SOURCE = readFileSync('e2e/fixture-repo/head/docs/guide.md', 'utf8');

function setup(over: Partial<PanelCallbacks> = {}, readOnlyNote?: string | null) {
  clearProviders();
  registerBuiltInProviders();
  sessionStorage.clear();
  const r = renderMarkdown(SOURCE);
  const callbacks: PanelCallbacks = { revealLine: vi.fn(), ...over,
  };
  const panel = createPanel({
    html: r.html, blocks: r.blocks,
    diff: { changedLines: [9, 19, 21], removed: [{ afterLine: 13, count: 1 }], rightLineText: new Map() },
    threads: [
      { id: 't1', startLine: 5, endLine: 5, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>Title?</p>' }] },
      { id: 't2', startLine: 7, endLine: 9, resolved: true, comments: [{ author: 'b', bodyHtml: '<p>Para</p>' }] },
    ],
    context: { repo: 'o/r', pr: 1, path: 'docs/guide.md', headSha: 'abc', source: SOURCE },
    autoMermaid: false, callbacks, lineCount: r.lines.length, readOnlyNote,
  });
  document.body.replaceChildren(panel.el);
  return { panel, callbacks, body: panel.el.querySelector<HTMLElement>('.mdr-body')! };
}

describe('createPanel', () => {
  it('marks only the innermost changed blocks', () => {
    const { body } = setup();
    expect(body.querySelector('p[data-src-start="7"]')!.classList.contains('mdr-changed')).toBe(true);
    expect(body.querySelector('tr[data-src-start="19"]')!.classList.contains('mdr-changed')).toBe(true);
    expect(body.querySelector('table')!.classList.contains('mdr-changed')).toBe(false);
    expect(body.querySelector('blockquote')!.classList.contains('mdr-changed')).toBe(false);
    expect(body.querySelector('blockquote p')!.classList.contains('mdr-changed')).toBe(true);
  });

  it('shows a removed marker after the list', () => {
    const { body, callbacks } = setup();
    const marker = body.querySelector<HTMLButtonElement>('.mdr-removed')!;
    expect(marker.textContent).toBe('1 line removed');
    expect(marker.previousElementSibling!.tagName).toBe('UL');
    marker.click();
    expect(callbacks.revealLine).toHaveBeenCalledWith(13);
  });

  it('shows threads inline after their block', () => {
    const { body } = setup();
    const threads = body.querySelectorAll('.mdr-thread');
    expect(threads).toHaveLength(2);
    expect(body.querySelector('h1')!.nextElementSibling!.classList.contains('mdr-thread')).toBe(true);
  });

  it('opens a composer for the hovered block (GitHub\'s form unavailable: copy to source)', async () => {
    const { panel, body, callbacks } = setup();
    body.querySelector('h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const add = panel.el.querySelector<HTMLButtonElement>('.mdr-add')!;
    expect(add.hidden).toBe(false);
    add.click();
    const composer = body.querySelector<HTMLElement>('.mdr-comment-form')!;
    expect(composer.querySelector('.mdr-cf-header')!.textContent).toBe('Add a comment on line R5');
    composer.querySelector('textarea')!.value = 'Nice title';
    [...composer.querySelectorAll('button')].find((b) => b.textContent === 'Copy and open source view')!.click();
    await vi.waitFor(() => expect(callbacks.revealLine).toHaveBeenCalledWith(5));
  });

  it('opens a composer for a text selection', () => {
    const { panel, body } = setup();
    const t = body.querySelector('[data-src-line="8"]')!.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 7);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const sel = panel.el.querySelector<HTMLButtonElement>('.mdr-select')!;
    expect(sel.hidden).toBe(false);
    sel.click();
    expect(body.querySelector<HTMLElement>('.mdr-comment-form')!.querySelector('.mdr-cf-header')!.textContent).toBe('Add a comment on line R8');
  });

  it('highlights the commented block and its gutter cell until Cancel', () => {
    const { panel, body } = setup();
    body.querySelector('h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    panel.el.querySelector<HTMLButtonElement>('.mdr-add')!.click();
    expect(body.querySelector('h1')!.classList.contains('mdr-selected')).toBe(true);
    expect(panel.el.querySelector('.mdr-gutter-selected')).not.toBeNull();
    [...body.querySelectorAll('.mdr-comment-form button')].find((b) => b.textContent === 'Cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(body.querySelector('.mdr-selected')).toBeNull();
    expect(panel.el.querySelector('.mdr-gutter-selected')).toBeNull();
    expect(body.querySelector('.mdr-comment-form')).toBeNull();
  });

  it('ignores hover inside threads, composers, and removed markers', () => {
    const { panel, body } = setup();
    const add = panel.el.querySelector<HTMLButtonElement>('.mdr-add')!;
    body.querySelector('h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    add.click();
    const composer = body.querySelector<HTMLElement>('.mdr-comment-form')!;
    // Threads and composers anchored to list items or nested blocks sit inside a stamped block.
    const li = body.querySelector('li')!;
    li.append(body.querySelector('.mdr-thread')!, composer, body.querySelector('.mdr-removed')!);
    add.hidden = true;
    for (const sel of ['.mdr-thread summary', '.mdr-comment-form textarea', '.mdr-removed']) {
      body.querySelector(sel)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(add.hidden, sel).toBe(true);
    }
    expect(composer.isConnected).toBe(true);
  });

  it('ignores selections inside a thread', () => {
    const { panel, body } = setup();
    body.querySelector('li')!.append(body.querySelector('.mdr-thread')!);
    const t = body.querySelector('.mdr-thread .mdr-comment-body p')!.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 3);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    t.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(panel.el.querySelector<HTMLButtonElement>('.mdr-select')!.hidden).toBe(true);
  });

  it('hides comment controls when disabled', () => {
    const { panel, body } = setup();
    panel.setDisabled('File changed. Reload to comment.');
    expect(panel.el.querySelector('.mdr-banner')!.textContent).toBe('File changed. Reload to comment.');
    body.querySelector('h1')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(panel.el.querySelector<HTMLButtonElement>('.mdr-add')!.hidden).toBe(true);
  });

  it('builds a gutter with one cell per leaf block', () => {
    const { panel, body } = setup();
    const labels = panel.gutter.cells().map((c) => c.dataset.label);
    expect(labels).toContain('7\u20139');
    expect(labels).toContain('5');
    expect(panel.el.querySelector('.mdr-body [data-mdr-lines]')).toBeNull();
    expect(body.querySelector('[data-mdr-lines]')).toBeNull();
  });

  it('places the gutter before the body inside .mdr-wrap', () => {
    const { panel } = setup();
    const wrap = panel.el.querySelector('.mdr-wrap')!;
    expect([...wrap.children].map((c) => c.className.split(' ')[0])).toEqual(['mdr-gutter', 'markdown-body']);
  });

  it('numbers code lines but not containers', () => {
    const { panel, body } = setup();
    expect(body.querySelector('pre [data-src-line]')).not.toBeNull();
    const starts = panel.gutter.cells().map((c) => c.dataset.start);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('hides change bars when every line is changed (new file)', () => {
    const r = renderMarkdown('# A\n\nPara\n');
    const panel = createPanel({
      html: r.html, blocks: r.blocks,
      diff: { changedLines: [1, 2, 3], removed: [], rightLineText: new Map() },
      threads: [], context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: '# A\n\nPara\n' },
      autoMermaid: false, lineCount: 3,
      callbacks: { revealLine: vi.fn() },
    });
    expect(panel.el.querySelector('.mdr-changed')).toBeNull();
  });
});

const LIST_SRC = ['# Doc', '', ...Array.from({ length: 30 }, (_, i) => `- item ${i + 1}`), '', 'tail para', ''].join('\n');

function hunkPanel(visibleLines: number[], threads: ThreadInfo[] = [], hunks = [{ header: '@@ -14,7 +14,7 @@', start: 14 }]) {
  return hunkPanelHandle(visibleLines, threads, hunks).body;
}

function hunkPanelHandle(visibleLines: number[], threads: ThreadInfo[], hunks: { header: string; start: number }[]) {
  const r = renderMarkdown(LIST_SRC);
  const panel = createPanel({
    html: r.html, blocks: r.blocks,
    diff: { changedLines: [17], removed: [], rightLineText: new Map(visibleLines.map((n) => [n, ''])) },
    hunks,
    showOnlyChanged: true,
    threads,
    context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: LIST_SRC },
    autoMermaid: false, lineCount: r.lines.length,
    callbacks: { revealLine: vi.fn() },
  });
  document.body.replaceChildren(panel.el);
  return { panel, body: panel.el.querySelector<HTMLElement>('.mdr-body')! };
}

describe('hunks view', () => {
  it('reveals the block of a thread that arrives after the panel opens', () => {
    const { panel, body } = hunkPanelHandle([14, 15, 16], [], [{ header: '@@ -14,3 +14,3 @@', start: 14 }]);
    expect(body.querySelector('p[data-src-start="34"]')!.classList.contains('mdr-collapsed')).toBe(true);
    panel.setThreads([{ id: 't', startLine: 34, endLine: 34, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] }]);
    expect(body.querySelector('p[data-src-start="34"]')!.classList.contains('mdr-collapsed')).toBe(false);
  });

  it('reveals the last leaf of a container-anchored thread', () => {
    // Line 6 is the blank line between items b and c: the thread anchors on the whole list (3..7)
    // and renders after it, so item c (the list's last leaf) must show, not item a.
    const src = ['# Doc', '', '- a', '', '- b', '', '- c', '', 'tail', ''].join('\n');
    const r = renderMarkdown(src);
    const panel = createPanel({
      html: r.html, blocks: r.blocks,
      diff: { changedLines: [1], removed: [], rightLineText: new Map([[1, '']]) },
      hunks: [{ header: '@@ -1 +1 @@', start: 1 }], showOnlyChanged: true,
      threads: [{ id: 't', startLine: 6, endLine: 6, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] }],
      context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: src },
      autoMermaid: false, lineCount: r.lines.length,
      callbacks: { revealLine: vi.fn() },
    });
    document.body.replaceChildren(panel.el);
    const shown = [...panel.el.querySelectorAll('li:not(.mdr-collapsed):not(.mdr-hunk)')].map((li) => li.textContent!.trim());
    expect(shown).toEqual(['c']);
  });

  it('puts a gap row inside a list right before the next shown item', () => {
    const body = hunkPanel([7, 27], [], [{ header: '@@ -7 +7 @@', start: 7 }, { header: '@@ -27 +27 @@', start: 27 }]);
    const item25 = [...body.querySelectorAll('li')].find((li) => li.textContent!.trim() === 'item 25')!;
    const row = item25.previousElementSibling as HTMLElement;
    expect(row.tagName).toBe('LI');
    expect(row.classList.contains('mdr-hunk')).toBe(true);
    expect(row.getAttribute('role')).toBe('presentation');
    expect(row.querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -27 +27 @@');
    const item5 = [...body.querySelectorAll('li')].find((li) => li.textContent!.trim() === 'item 5')!;
    expect((item5.previousElementSibling as HTMLElement).querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -7 +7 @@');
  });

  it('puts the trailing gap row after the last shown leaf', () => {
    const body = hunkPanel([7, 27], [], [{ header: '@@ -7 +7 @@', start: 7 }, { header: '@@ -27 +27 @@', start: 27 }]);
    const item25 = [...body.querySelectorAll('li')].find((li) => li.textContent!.trim() === 'item 25')!;
    expect(item25.nextElementSibling!.classList.contains('mdr-hunk')).toBe(true);
    expect(item25.nextElementSibling!.tagName).toBe('LI');
  });

  it('uses a table row for a gap inside a table', () => {
    const src = ['| a |', '| - |', ...Array.from({ length: 30 }, (_, i) => `| r${i + 1} |`), ''].join('\n');
    const r = renderMarkdown(src);
    const panel = createPanel({
      html: r.html, blocks: r.blocks,
      diff: { changedLines: [27], removed: [], rightLineText: new Map([[27, '']]) },
      hunks: [{ header: '@@ -27 +27 @@', start: 27 }], showOnlyChanged: true, threads: [],
      context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: src },
      autoMermaid: false, lineCount: r.lines.length,
      callbacks: { revealLine: vi.fn() },
    });
    document.body.replaceChildren(panel.el);
    const tr = panel.el.querySelector<HTMLElement>('tr[data-src-start="27"]')!;
    const row = tr.previousElementSibling as HTMLElement;
    expect(row.tagName).toBe('TR');
    expect(row.classList.contains('mdr-hunk')).toBe(true);
    const td = row.querySelector('td')!;
    expect(td.getAttribute('colspan')).toBe('99');
    expect(td.querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -27 +27 @@');
  });

  it('shows only the changed list item and context, keeping the list', () => {
    const body = hunkPanel([14, 15, 16, 17, 18, 19, 20]);
    const shownItems = [...body.querySelectorAll('li:not(.mdr-collapsed):not(.mdr-hunk)')].map((li) => li.textContent!.trim());
    expect(shownItems).toEqual(['item 12', 'item 13', 'item 14', 'item 15', 'item 16', 'item 17', 'item 18']);
    expect(body.querySelector('ul')!.classList.contains('mdr-collapsed')).toBe(false);
    expect(body.querySelector('h1')!.classList.contains('mdr-collapsed')).toBe(true);
  });

  it('labels the gap with the hunk header and offers expanders', () => {
    const body = hunkPanel([14, 15, 16, 17, 18, 19, 20]);
    const rows = [...body.querySelectorAll('.mdr-hunk')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -14,7 +14,7 @@');
    expect([...rows[0].querySelectorAll<HTMLElement>('.mdr-expand')].map((b) => b.dataset.dir)).toEqual(['all']);
  });

  it('reveals hidden blocks when an expander is clicked', () => {
    const body = hunkPanel([14, 15, 16, 17, 18, 19, 20]);
    body.querySelector<HTMLButtonElement>('.mdr-hunk .mdr-expand')!.click();
    expect(body.querySelector('h1')!.classList.contains('mdr-collapsed')).toBe(false);
  });

  it('keeps a thread visible outside every hunk', () => {
    const body = hunkPanel([14, 15, 16], [{ id: 't', startLine: 34, endLine: 34, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] }]);
    expect(body.querySelector('p[data-src-start="34"]')!.classList.contains('mdr-collapsed')).toBe(false);
  });

  it('toggles the whole file', () => {
    const body = hunkPanel([14, 15, 16, 17, 18, 19, 20]);
    const toggle = document.querySelector<HTMLButtonElement>('.mdr-whole-file')!;
    toggle.click();
    expect(body.querySelectorAll('.mdr-collapsed')).toHaveLength(0);
    expect(body.querySelectorAll('.mdr-hunk')).toHaveLength(0);
    toggle.click();
    expect(body.querySelectorAll('.mdr-collapsed').length).toBeGreaterThan(0);
  });
});

const OL_SRC = ['# Doc', '', ...Array.from({ length: 30 }, (_, i) => `${i + 1}. item ${i + 1}`), '', 'tail para', ''].join('\n');

function olPanel(visibleLines: number[], hunks: { header: string; start: number }[], doc: Document = document, src = OL_SRC) {
  const r = renderMarkdown(src);
  const panel = createPanel({
    html: r.html, blocks: r.blocks,
    diff: { changedLines: [visibleLines[0]], removed: [], rightLineText: new Map(visibleLines.map((n) => [n, ''])) },
    hunks, showOnlyChanged: true, threads: [],
    context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: src },
    autoMermaid: false, lineCount: r.lines.length, doc,
    callbacks: { revealLine: vi.fn() },
  });
  doc.body.replaceChildren(panel.el);
  return { panel, body: panel.el.querySelector<HTMLElement>('.mdr-body')! };
}

describe('hunks view fixes', () => {
  it('keeps ordered-list numbers when items are collapsed', () => {
    const { body } = olPanel([20, 21, 22, 23, 24, 25, 26], [{ header: '@@ -20,7 +20,7 @@', start: 20 }]);
    const shown = [...body.querySelectorAll<HTMLLIElement>('ol > li:not(.mdr-collapsed):not(.mdr-hunk)')];
    expect(shown.map((li) => li.textContent!.trim())).toEqual(['item 18', 'item 19', 'item 20', 'item 21', 'item 22', 'item 23', 'item 24']);
    expect(shown.map((li) => li.getAttribute('value'))).toEqual(['18', '19', '20', '21', '22', '23', '24']);
    document.querySelector<HTMLButtonElement>('.mdr-whole-file')!.click();
    expect(body.querySelectorAll('li[value]')).toHaveLength(0);
  });

  it('keeps ordered-list numbers when a hunk row sits inside the list', () => {
    const src = ['# Doc', '', '1. a', '2. b', '', 'tail', ''].join('\n');
    const { body } = olPanel([3, 4], [{ header: '@@ -3,2 +3,2 @@', start: 3 }], document, src);
    expect(body.querySelector('ol > li.mdr-hunk')).not.toBeNull();
    expect([...body.querySelectorAll('ol > li:not(.mdr-hunk)')].map((li) => li.getAttribute('value'))).toEqual(['1', '2']);
  });

  it('keeps the hunk header after a partial expand up', () => {
    const { body } = olPanel([30, 31, 32], [{ header: '@@ -30,3 +30,3 @@', start: 30 }]);
    const first = body.querySelector<HTMLElement>('.mdr-hunk')!;
    expect(first.querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -30,3 +30,3 @@');
    first.querySelector<HTMLButtonElement>('.mdr-expand[data-dir="up"]')!.click();
    expect(body.querySelector('li[data-src-start="20"]')!.classList.contains('mdr-collapsed')).toBe(false);
    const headers = [...body.querySelectorAll('.mdr-hunk-header')].map((h) => h.textContent);
    expect(headers).toEqual(['@@ -30,3 +30,3 @@']);
  });

  it('shows a header-only row for a hunk that starts at the top of the file', () => {
    const { body } = olPanel([1, 2, 3, 4], [{ header: '@@ -1,4 +1,4 @@', start: 1 }]);
    const row = body.firstElementChild as HTMLElement;
    expect(row.classList.contains('mdr-hunk')).toBe(true);
    expect(row.querySelector('.mdr-hunk-header')!.textContent).toBe('@@ -1,4 +1,4 @@');
    expect(row.querySelector('.mdr-expand')).toBeNull();
    expect(row.nextElementSibling!.tagName).toBe('H1');
  });

  it('shows the whole file and warns once when GitHub gave no hunk headers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = document.implementation.createHTMLDocument('t');
    try {
      const { body } = olPanel([20, 21], [], doc);
      expect(body.querySelectorAll('.mdr-collapsed')).toHaveLength(0);
      expect(body.querySelectorAll('.mdr-hunk')).toHaveLength(0);
      olPanel([20, 21], [], doc);
      expect(warn.mock.calls.filter((c) => c[0] === '[Inkdiff] hunk headers not found; showing the whole file.')).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('read-only panel', () => {
  it('shows the note and offers no comment affordance', () => {
    const { panel, body } = setup({}, 'Sign in to comment');
    const note = panel.el.querySelector<HTMLElement>('.mdr-readonly')!;
    expect(note.textContent).toBe('Sign in to comment');
    expect((note.closest('.mdr-toolbar') as HTMLElement).hidden).toBe(false);
    body.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(panel.el.querySelector<HTMLElement>('.mdr-add')?.hidden ?? true).toBe(true);
    const p = body.querySelector('p[data-src-start="7"]')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(panel.el.querySelector<HTMLElement>('.mdr-select')?.hidden ?? true).toBe(true);
  });

  it('has no read-only note when signed in', () => {
    const { panel } = setup();
    expect(panel.el.querySelector('.mdr-readonly')).toBeNull();
  });
});

describe('the + follows the gutter cell under the pointer', () => {
  const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const header = (body: HTMLElement) => body.querySelector('.mdr-comment-form .mdr-cf-header')!.textContent;
  const addOf = (panel: { el: HTMLElement }) => panel.el.querySelector<HTMLButtonElement>('.mdr-add')!;

  it('opens a form for the single hovered code line, after its pre', () => {
    const { panel, body } = setup();
    over(body.querySelector('pre span[data-src-line="29"]')!);
    addOf(panel).click();
    expect(header(body)).toBe('Add a comment on line R29');
    expect(body.querySelector('.mdr-comment-form')!.previousElementSibling!.tagName).toBe('PRE');
  });

  it('passes the single code line to the native form opener', async () => {
    const openNativeForm = vi.fn<(lines: { start: number; end: number }) => Promise<null>>(async () => null);
    const { panel, body } = setup({ openNativeForm });
    over(body.querySelector('pre span[data-src-line="29"]')!);
    addOf(panel).click();
    expect(openNativeForm).toHaveBeenCalledWith({ start: 29, end: 29 });
    await vi.waitFor(() => expect(header(body)).toBe('Add a comment on line R29'));
  });

  it('opens a paragraph range when hovering its text', () => {
    const { panel, body } = setup();
    over(body.querySelector('p span[data-src-line="8"]')!);
    addOf(panel).click();
    expect(header(body)).toBe('Add a comment on lines R7 to R9');
  });

  it('shows the + for a hovered gutter cell, for exactly its lines', () => {
    const { panel, body } = setup();
    const cell = (label: string) => panel.gutter.cells().find((c) => c.dataset.label === label)!;
    over(cell('7–9'));
    expect(addOf(panel).hidden).toBe(false);
    addOf(panel).click();
    expect(header(body)).toBe('Add a comment on lines R7 to R9');
    over(cell('29'));
    addOf(panel).click();
    expect(header(body)).toBe('Add a comment on line R29');
  });

  it('places the + at the cell top', () => {
    const { panel, body } = setup();
    const rect = (top: number) => ({ top, height: 20, left: 0, right: 0, bottom: top + 20, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
    vi.spyOn(panel.el, 'getBoundingClientRect').mockReturnValue(rect(100));
    const span = body.querySelector<HTMLElement>('pre span[data-src-line="29"]')!;
    vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(rect(342));
    over(span);
    expect(addOf(panel).style.top).toBe('242px');
  });

  it('shows no + for a hidden cell', () => {
    const { panel, body } = setup();
    body.querySelector('h1')!.classList.add('mdr-collapsed');
    over(body.querySelector('h1')!);
    expect(addOf(panel).hidden).toBe(true);
    over(panel.gutter.cells().find((c) => c.dataset.label === '5')!);
    expect(addOf(panel).hidden).toBe(true);
  });

  it('gives a 40-line code block 40 distinct + targets', async () => {
    clearProviders();
    const md = ['```js', ...Array.from({ length: 40 }, (_, i) => `line${i + 1}`), '```', ''].join('\n');
    const r = renderMarkdown(md);
    const openNativeForm = vi.fn<(lines: { start: number; end: number }) => Promise<null>>(async () => null);
    const panel = createPanel({
      html: r.html, blocks: r.blocks, diff: { changedLines: [], removed: [], rightLineText: new Map() }, threads: [],
      context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: md }, autoMermaid: false, lineCount: r.lines.length,
      callbacks: { revealLine: vi.fn(), openNativeForm },
    });
    document.body.replaceChildren(panel.el);
    for (const span of panel.el.querySelectorAll('pre span[data-src-line]')) {
      over(span);
      addOf(panel).click();
    }
    expect(openNativeForm.mock.calls.map((c) => JSON.stringify(c[0]))).toEqual(Array.from({ length: 40 }, (_, i) => JSON.stringify({ start: i + 2, end: i + 2 })));
    panel.destroy();
  });
});

describe('changed content tint', () => {
  it('marks changed code lines, not the whole pre', () => {
    const md = ['Intro', '', '```js', 'a', 'b', 'c', '```', ''].join('\n');
    const r = renderMarkdown(md);
    const panel = createPanel({
      html: r.html, blocks: r.blocks, diff: { changedLines: [5], removed: [], rightLineText: new Map() }, threads: [],
      context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: md }, autoMermaid: false, lineCount: r.lines.length,
      callbacks: { revealLine: vi.fn() },
    });
    const changed = [...panel.el.querySelectorAll<HTMLElement>('pre .mdr-line-changed')].map((s) => s.dataset.srcLine);
    expect(changed).toEqual(['5']);
    panel.destroy();
  });
});
