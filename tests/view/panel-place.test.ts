import { renderMarkdown } from '../../src/render/render';
import type { ThreadInfo } from '../../src/github/types';
import { createPanel, type PanelCallbacks } from '../../src/view/panel';

vi.mock('../../src/view/mermaid-loader', () => ({ loadMermaidModule: async () => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) }) }));

// An item with its own wrapped text (lines 2–3) and a nested list (4–5), like a numbered setup step.
const SOURCE = ['1. first', '2. **Proxy** setup text', '   that wraps:', '   - child a', '   - child b', '3. last', ''].join('\n');

function setup(threads: ThreadInfo[] = []) {
  sessionStorage.clear();
  const r = renderMarkdown(SOURCE);
  const callbacks: PanelCallbacks = { revealLine: vi.fn() };
  const panel = createPanel({
    html: r.html, blocks: r.blocks,
    diff: { changedLines: [2, 3], removed: [], rightLineText: new Map() },
    threads, context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: SOURCE },
    autoMermaid: false, callbacks, lineCount: r.lines.length,
  });
  document.body.replaceChildren(panel.el);
  const body = panel.el.querySelector<HTMLElement>('.mdr-body')!;
  const item = body.querySelector<HTMLElement>('li[data-src-start="2"]')!;
  return { panel, body, item, nested: item.querySelector('ul')! };
}

describe('placing comments on an item that holds a nested list', () => {
  it('opens the composer right under the item text, above the nested list', () => {
    const { panel, item, nested } = setup();
    item.querySelector('span[data-src-line="3"]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    panel.el.querySelector<HTMLButtonElement>('.mdr-add')!.click();
    const form = item.querySelector('.mdr-comment-form')!;
    expect(form.nextElementSibling).toBe(nested);
    expect(form.querySelector('.mdr-cf-header')!.textContent).toBe('Add a comment on lines R2 to R3');
  });

  it('shows a thread on the item text above the nested list', () => {
    const { item, nested } = setup([{ id: 't', startLine: 3, endLine: 3, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] }]);
    expect(item.querySelector('.mdr-thread')!.nextElementSibling).toBe(nested);
  });

  it('keeps a thread on a nested item after that item', () => {
    const { nested } = setup([{ id: 't', startLine: 4, endLine: 4, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] }]);
    expect(nested.querySelector('li[data-src-start="4"]')!.nextElementSibling!.classList.contains('mdr-thread')).toBe(true);
  });
});

describe('commenting from the gutter', () => {
  const cell = (panel: ReturnType<typeof setup>['panel'], label: string) => panel.gutter.cells().find((c) => c.dataset.label === label)!;
  const mouse = (el: Element, type: string, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  const header = () => document.querySelector('.mdr-comment-form .mdr-cf-header')?.textContent;

  it('opens the composer with a plain click on a line number', () => {
    const { panel } = setup();
    mouse(cell(panel, '2–3'), 'mousedown');
    mouse(cell(panel, '2–3'), 'mouseup');
    expect(header()).toBe('Add a comment on lines R2 to R3');
  });

  it('comments on a range dragged across line numbers', () => {
    const { panel, nested } = setup();
    mouse(cell(panel, '1'), 'mousedown');
    mouse(cell(panel, '2–3'), 'mouseover');
    mouse(cell(panel, '4'), 'mouseover');
    expect(cell(panel, '2–3').classList.contains('mdr-gutter-selected')).toBe(true);
    mouse(cell(panel, '4'), 'mouseup');
    expect(header()).toBe('Add a comment on lines R1 to R4');
    expect(nested.querySelector('li[data-src-start="4"]')!.nextElementSibling!.classList.contains('mdr-comment-form')).toBe(true);
  });

  it('drags from the + too', () => {
    const { panel, item } = setup();
    mouse(item.querySelector('span[data-src-line="2"]')!, 'mouseover');
    mouse(panel.el.querySelector('.mdr-add')!, 'mousedown');
    mouse(cell(panel, '5'), 'mouseover');
    mouse(document.body, 'mouseup');
    expect(header()).toBe('Add a comment on lines R2 to R5');
  });

  it('grows the open comment with a shift-click', () => {
    const { panel } = setup();
    mouse(cell(panel, '1'), 'mousedown');
    mouse(cell(panel, '1'), 'mouseup');
    mouse(cell(panel, '4'), 'mousedown', { shiftKey: true });
    mouse(cell(panel, '4'), 'mouseup', { shiftKey: true });
    expect(header()).toBe('Add a comment on lines R1 to R4');
  });

  it('lights up the line numbers of the hovered text', () => {
    const { panel, item } = setup();
    mouse(item.querySelector('span[data-src-line="3"]')!, 'mouseover');
    expect(cell(panel, '2–3').classList.contains('mdr-gutter-hover')).toBe(true);
    mouse(panel.el.querySelector('h1, li[data-src-start="1"]')!, 'mouseover');
    expect(cell(panel, '2–3').classList.contains('mdr-gutter-hover')).toBe(false);
  });

  it('still opens from the + with the keyboard', () => {
    const { panel, item } = setup();
    mouse(item.querySelector('span[data-src-line="2"]')!, 'mouseover');
    panel.el.querySelector<HTMLButtonElement>('.mdr-add')!.click();
    expect(header()).toBe('Add a comment on lines R2 to R3');
  });
});

describe('GitHub\'s own threads in the rendered view', () => {
  const thread = (id: string, line: number): ThreadInfo => ({ id, startLine: line, endLine: line, resolved: false, comments: [{ author: 'a', bodyHtml: '<p>x</p>' }] });

  function hostedSetup() {
    sessionStorage.clear();
    const r = renderMarkdown(SOURCE);
    const boxes = new Map<string, HTMLElement>();
    const restored: string[] = [];
    const hostThread = vi.fn((id: string) => {
      let box = boxes.get(id);
      if (!box) { box = document.createElement('div'); box.className = 'gh-box'; box.textContent = `GitHub thread ${id}`; boxes.set(id, box); }
      // Like the real one: a detached box cannot go home.
      return { box, restore: () => { if (box!.isConnected) restored.push(id); box!.remove(); } };
    });
    const panel = createPanel({
      html: r.html, blocks: r.blocks, diff: { changedLines: [], removed: [], rightLineText: new Map() },
      threads: [thread('t1', 3)], context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: SOURCE },
      autoMermaid: false, lineCount: r.lines.length,
      callbacks: { revealLine: vi.fn(), hostThread },
    });
    document.body.replaceChildren(panel.el);
    const body = panel.el.querySelector<HTMLElement>('.mdr-body')!;
    return { panel, body, boxes, restored, nested: body.querySelector('li[data-src-start="2"] ul')! };
  }

  it('shows GitHub\'s element instead of our card, under its line', () => {
    const { body, boxes, nested } = hostedSetup();
    const wrap = body.querySelector('.mdr-gh-thread')!;
    expect(wrap.firstElementChild).toBe(boxes.get('t1'));
    expect(wrap.nextElementSibling).toBe(nested);
    expect(body.querySelector('.mdr-thread')).toBeNull();
  });

  it('leaves a hosted thread in place on later syncs (open editors keep focus)', () => {
    const { panel, body } = hostedSetup();
    const wrap = body.querySelector('.mdr-gh-thread');
    panel.setThreads([thread('t1', 3), thread('t2', 6)]);
    expect(body.querySelector('.mdr-gh-thread')).toBe(wrap);
    expect(body.querySelectorAll('.mdr-gh-thread')).toHaveLength(2);
  });

  it('puts GitHub\'s elements back when a thread goes and when the panel closes', () => {
    const { panel, restored } = hostedSetup();
    panel.setThreads([thread('t2', 6)]);
    expect(restored).toEqual(['t1']);
    panel.destroy();
    expect(restored).toEqual(['t1', 't2']);
  });

  it('falls back to our card when GitHub has no element', () => {
    const { body } = hostedSetup();
    const cb = vi.fn(() => null);
    const r = renderMarkdown(SOURCE);
    const p2 = createPanel({
      html: r.html, blocks: r.blocks, diff: { changedLines: [], removed: [], rightLineText: new Map() },
      threads: [thread('t1', 3)], context: { repo: 'o/r', pr: 1, path: 'a.md', headSha: 'abc', source: SOURCE },
      autoMermaid: false, lineCount: r.lines.length,
      callbacks: { revealLine: vi.fn(), hostThread: cb },
    });
    expect(p2.el.querySelector('.mdr-thread[data-thread-id="t1"]')).not.toBeNull();
    expect(body).toBeTruthy();
  });
});

describe('the + stays on the row; a single click comments', () => {
  const rect = (top: number, height: number) => ({ top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
  const mouse = (el: Element, type: string, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  const click = (el: Element, init: MouseEventInit = {}) => { mouse(el, 'mousedown', init); mouse(el, 'mouseup', init); mouse(el, 'click', { detail: 1, ...init }); };
  const header = () => document.querySelector('.mdr-comment-form .mdr-cf-header')?.textContent;

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps the + over a list number (no cell there): the pointer height picks the line', () => {
    const { panel, body, item } = setup();
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(0, 500));
    vi.spyOn(panel.gutter.el, 'getBoundingClientRect').mockReturnValue(rect(0, 500));
    vi.spyOn(body.querySelector('li[data-src-start="1"]')!, 'getBoundingClientRect').mockReturnValue(rect(0, 20));
    for (const s of item.querySelectorAll(':scope > span[data-src-line], :scope > strong')) vi.spyOn(s, 'getBoundingClientRect').mockReturnValue(rect(20, 40));
    body.querySelectorAll<HTMLElement>('ul li, li[data-src-start="6"]').forEach((li, i) => vi.spyOn(li, 'getBoundingClientRect').mockReturnValue(rect(60 + i * 20, 20)));
    panel.gutter.layout();
    const add = panel.el.querySelector<HTMLButtonElement>('.mdr-add')!;
    mouse(body.querySelector('ol')!, 'mouseover', { clientY: 30 });
    expect(add.hidden).toBe(false);
    expect(add.getAttribute('aria-label')).toBe('Comment on lines 2 to 3');
    mouse(add, 'mouseover', { clientY: 30 });
    expect(add.hidden).toBe(false);
  });

  it('opens the composer on a plain click on the text', () => {
    const { item } = setup();
    const span = item.querySelector('span[data-src-line="3"]')!;
    mouse(span, 'mouseover');
    click(span);
    expect(header()).toBeUndefined();
    vi.advanceTimersByTime(300);
    expect(header()).toBe('Add a comment on lines R2 to R3');
  });

  it('ignores links, double clicks, drags and clicks while a comment is open', () => {
    const { item } = setup();
    const span = item.querySelector('span[data-src-line="3"]')!;
    mouse(span, 'mouseover');
    const a = document.createElement('a');
    a.href = '#x';
    span.append(a);
    click(a);
    vi.advanceTimersByTime(300);
    expect(header()).toBeUndefined();
    click(span);
    mouse(span, 'click', { detail: 2 });
    mouse(span, 'dblclick');
    vi.advanceTimersByTime(300);
    expect(header()).toBeUndefined();
    mouse(span, 'mousedown', { clientX: 0 });
    mouse(span, 'click', { detail: 1, clientX: 40 });
    vi.advanceTimersByTime(300);
    expect(header()).toBeUndefined();
    click(span);
    vi.advanceTimersByTime(300);
    expect(header()).toBe('Add a comment on lines R2 to R3');
    const li1 = document.querySelector('li[data-src-start="1"]')!;
    mouse(li1, 'mouseover');
    click(li1);
    vi.advanceTimersByTime(300);
    expect(header()).toBe('Add a comment on lines R2 to R3');
  });
});
