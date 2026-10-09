import { renderMarkdown } from '../../src/render/render';
import { createGutter } from '../../src/view/gutter';

function mount(md: string, changed: number[] = []) {
  const body = document.createElement('div');
  body.className = 'markdown-body mdr-body';
  body.innerHTML = renderMarkdown(md).html;
  const wrap = document.createElement('div');
  wrap.className = 'mdr-wrap';
  const g = createGutter(document, body, new Set(changed));
  wrap.append(g.el, body);
  document.body.replaceChildren(wrap);
  return { g, body };
}

const SRC = ['# Title', '', 'Para one', 'still para', '', '```js', ...Array.from({ length: 40 }, (_, i) => `line${i + 1}`), '```', ''].join('\n');

describe('createGutter', () => {
  it('makes one cell per leaf block and one per code line', () => {
    const { g } = mount(SRC);
    const labels = g.cells().map((c) => c.dataset.label);
    expect(labels.slice(0, 2)).toEqual(['1', '3–4']);
    expect(labels.slice(2)).toEqual(Array.from({ length: 40 }, (_, i) => String(7 + i)));
  });

  it('colors only changed lines inside a long code block', () => {
    const { g } = mount(SRC, [20]);
    const add = g.cells().filter((c) => c.classList.contains('mdr-gutter-add')).map((c) => c.dataset.label);
    expect(add).toEqual(['20']);
  });

  it('colors a prose block when any of its lines changed', () => {
    const { g } = mount(SRC, [4]);
    expect(g.cells().find((c) => c.dataset.label === '3–4')!.classList.contains('mdr-gutter-add')).toBe(true);
  });

  it('keeps numbers out of the body text', () => {
    const { body } = mount(SRC);
    expect(body.textContent).not.toMatch(/\b4\b.*Para/);
    expect(body.textContent).not.toContain('3–4');
    expect(body.querySelectorAll('[data-mdr-lines]')).toHaveLength(0);
    expect(body.querySelector('[data-label]')).toBeNull();
  });

  it('positions cells from measured layout', () => {
    const { g, body } = mount(SRC);
    const rect = (top: number, height: number) => ({ top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(100, 1000));
    const h1 = body.querySelector('h1')!;
    vi.spyOn(h1, 'getBoundingClientRect').mockReturnValue(rect(110, 30));
    g.layout();
    const cell = g.cells()[0];
    expect(cell.style.top).toBe('10px');
    expect(cell.style.height).toBe('30px');
  });

  describe('continuous strip', () => {
    const rect = (top: number, height: number) => ({ top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;

    it('sizes each cell from its top to the next shown cell top; the last ends at its target bottom', () => {
      const { g, body } = mount(SRC);
      vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(100, 2000));
      vi.spyOn(body.querySelector('h1')!, 'getBoundingClientRect').mockReturnValue(rect(100, 30));
      vi.spyOn(body.querySelector('p')!, 'getBoundingClientRect').mockReturnValue(rect(146, 40));
      const spans = [...body.querySelectorAll<HTMLElement>('pre span[data-src-line]')];
      spans.forEach((sp, i) => vi.spyOn(sp, 'getBoundingClientRect').mockReturnValue(rect(210 + i * 20, 20)));
      g.layout();
      const cell = (label: string) => g.cells().find((c) => c.dataset.label === label)!;
      expect([cell('1').style.top, cell('1').style.height]).toEqual(['0px', '46px']);
      expect([cell('3–4').style.top, cell('3–4').style.height]).toEqual(['46px', '64px']);
      expect([cell('7').style.top, cell('7').style.height]).toEqual(['110px', '20px']);
      expect(cell('30').style.height).toBe('20px');
      expect(cell('46').style.height).toBe('20px');
    });

    it('skips hidden cells when finding the next one', () => {
      const { g, body } = mount(SRC);
      vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(100, 2000));
      vi.spyOn(body.querySelector('h1')!, 'getBoundingClientRect').mockReturnValue(rect(100, 30));
      body.querySelector('p')!.classList.add('mdr-collapsed');
      const spans = [...body.querySelectorAll<HTMLElement>('pre span[data-src-line]')];
      spans.forEach((sp, i) => vi.spyOn(sp, 'getBoundingClientRect').mockReturnValue(rect(210 + i * 20, 20)));
      g.layout();
      expect(g.cells()[0].style.height).toBe('110px');
    });

    it('stops a cell at a hunk row', () => {
      const { g, body } = mount(SRC);
      vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(100, 2000));
      vi.spyOn(body.querySelector('h1')!, 'getBoundingClientRect').mockReturnValue(rect(100, 30));
      vi.spyOn(body.querySelector('p')!, 'getBoundingClientRect').mockReturnValue(rect(170, 40));
      const hunk = document.createElement('div');
      hunk.className = 'mdr-hunk';
      body.querySelector('p')!.before(hunk);
      vi.spyOn(hunk, 'getBoundingClientRect').mockReturnValue(rect(140, 24));
      g.layout();
      expect(g.cells()[0].style.height).toBe('40px');
    });
  });

  it('highlights cells that intersect the selected range', () => {
    const { g } = mount(SRC);
    g.setSelected({ start: 4, end: 7 });
    const sel = g.cells().filter((c) => c.classList.contains('mdr-gutter-selected')).map((c) => c.dataset.label);
    expect(sel).toEqual(['3–4', '7']);
    g.setSelected(null);
    expect(g.cells().some((c) => c.classList.contains('mdr-gutter-selected'))).toBe(false);
  });

  it('hides cells whose target is collapsed', () => {
    const { g, body } = mount(SRC);
    body.querySelector('h1')!.classList.add('mdr-collapsed');
    g.layout();
    expect(g.cells()[0].hidden).toBe(true);
  });

  describe('mermaid blocks', () => {
    const MD = ['```mermaid', 'graph TD', 'A-->B', '```', ''].join('\n');
    const state = (g: ReturnType<typeof mount>['g']) => g.cells().map((c) => [c.dataset.label, c.hidden]);

    it('shows only per-line cells while not rendered', () => {
      const { g } = mount(MD);
      g.layout();
      expect(state(g)).toEqual([['1–4', true], ['2', false], ['3', false]]);
    });

    it('shows only the range cell when rendered', () => {
      const { g, body } = mount(MD);
      body.querySelector('.md-mermaid')!.classList.add('mdr-mermaid-rendered');
      g.layout();
      expect(state(g)).toEqual([['1–4', false], ['2', true], ['3', true]]);
    });

    it('shows only per-line cells when rendered with source shown', () => {
      const { g, body } = mount(MD);
      body.querySelector('.md-mermaid')!.classList.add('mdr-mermaid-rendered', 'mdr-mermaid-show-source');
      g.layout();
      expect(state(g)).toEqual([['1–4', true], ['2', false], ['3', false]]);
    });
  });

  it('hides cells whose target is [hidden]', () => {
    const { g, body } = mount(SRC);
    body.querySelector('h1')!.hidden = true;
    g.layout();
    expect(g.cells()[0].hidden).toBe(true);
    expect(g.cells()[1].hidden).toBe(false);
  });

  it('gives a non-leaf list item a cell for its own text line', () => {
    const { g } = mount('- parent changed\n  - child\n', [1]);
    const cells = g.cells().map((c) => [c.dataset.label, c.classList.contains('mdr-gutter-add')]);
    expect(cells).toEqual([['1', true], ['2', false]]);
  });

  it('gives an item that holds a code block a cell for its text line', () => {
    const cases: [string, string[]][] = [
      ['- item text\n\n  ```\n  code\n  ```\n', ['1', '4']],
      ['- item text\n  ```\n  code\n  ```\n', ['1', '3']],
    ];
    for (const [md, want] of cases) {
      const cells = mount(md, [1]).g.cells();
      expect(cells.map((c) => c.dataset.label), md).toEqual(want);
      expect(cells[0].classList.contains('mdr-gutter-add'), md).toBe(true);
    }
  });

  it('makes one cell for a run of own-text lines, so wrapped lines never overlap', () => {
    const { g } = mount('5. **Managed** proxy\n   more text\n   `x` end:\n   - child\n', [1, 2]);
    expect(g.cells().map((c) => c.dataset.label)).toEqual(['1–3', '4']);
    expect(g.cells()[0].classList.contains('mdr-gutter-add')).toBe(true);
  });

  it('splits own-text runs around a nested block', () => {
    const { g } = mount('- before\n  ```\n  code\n  ```\n');
    expect(g.cells().map((c) => c.dataset.label)).toEqual(['1', '3']);
  });

  it('makes one own-text cell per line, not per inline span', () => {
    const { g } = mount('- **a** `x`\n  - c\n');
    expect(g.cells().map((c) => c.dataset.label)).toEqual(['1', '2']);
  });

  it('positions an own-text cell from the union of its line spans', () => {
    const { g, body } = mount('- **a** `x`\n  - c\n');
    const rect = (top: number, height: number) => ({ top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(100, 1000));
    const li = body.querySelector('li')!;
    const spans = [...li.querySelectorAll<HTMLElement>('span[data-src-line="1"]')].filter((s) => s.parentElement?.closest('[data-src-start]') === li);
    expect(spans.length).toBeGreaterThan(1);
    spans.forEach((s, i) => vi.spyOn(s, 'getBoundingClientRect').mockReturnValue(rect(110 + i * 2, 20 + i * 4)));
    g.layout();
    const cell = g.cells()[0];
    expect(cell.style.top).toBe('10px');
    expect(cell.style.height).toBe(`${Math.max(...spans.map((_, i) => 110 + i * 2 + 20 + i * 4)) - 110}px`);
  });

  it('hides a non-leaf text cell when its block is collapsed', () => {
    const { g, body } = mount('- parent\n  - child\n');
    body.querySelector('li')!.classList.add('mdr-collapsed');
    g.layout();
    expect(g.cells().every((c) => c.hidden)).toBe(true);
  });

  describe('binary-search lookups', () => {
    it('finds the innermost cell for a line, and a range cell that reaches past later cells', () => {
      const md = ['# T', '', '```mermaid', 'graph TD', 'A-->B', '```', '', 'Para one', 'two', ''].join('\n');
      const { g } = mount(md);
      const label = (n: number) => g.cellForLine(n)?.dataset.label ?? null;
      expect(label(1)).toBe('1');
      expect(label(4)).toBe('4');
      expect(label(6)).toBe('3–6');
      expect(label(9)).toBe('8–9');
      expect(label(2)).toBeNull();
      expect(label(99)).toBeNull();
    });

    it('finds the cell at a height, gaps included, from the last layout', () => {
      const { g, body } = mount(SRC);
      const rect = (top: number, height: number) => ({ top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
      vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(100, 2000));
      vi.spyOn(body.querySelector('h1')!, 'getBoundingClientRect').mockReturnValue(rect(100, 30));
      vi.spyOn(body.querySelector('p')!, 'getBoundingClientRect').mockReturnValue(rect(150, 40));
      body.querySelectorAll<HTMLElement>('pre span[data-src-line]').forEach((s, i) => vi.spyOn(s, 'getBoundingClientRect').mockReturnValue(rect(220 + i * 20, 20)));
      g.layout();
      expect(g.cellAtY(10)?.dataset.label).toBe('1');
      expect(g.cellAtY(40)?.dataset.label).toBe('1'); // the gap under the heading
      expect(g.cellAtY(60)?.dataset.label).toBe('3–4');
      expect(g.cellAtY(125)?.dataset.label).toBe('7');
      expect(g.cellAtY(-5)).toBeNull();
      expect(g.cellAtY(5000)).toBeNull();
    });
  });

  describe('cellAt', () => {
    it('gives each line of a 40-line code block its own cell', () => {
      const { g, body } = mount(SRC);
      const spans = [...body.querySelectorAll<HTMLElement>('pre span[data-src-line]')];
      expect(spans).toHaveLength(40);
      const cells = spans.map((s) => g.cellAt(s));
      expect(new Set(cells).size).toBe(40);
      expect(cells.map((c) => g.cellLines(c!))).toEqual(spans.map((s) => ({ start: Number(s.dataset.srcLine), end: Number(s.dataset.srcLine) })));
    });

    it('maps text inside a leaf block to the block cell', () => {
      const { g, body } = mount(SRC);
      const cell = g.cellAt(body.querySelector('p span[data-src-line="4"]')!);
      expect(cell?.dataset.label).toBe('3–4');
      expect(g.cellLines(cell!)).toEqual({ start: 3, end: 4 });
      expect(g.cellAnchor(cell!)).toBe(body.querySelector('p'));
    });

    it('maps a non-leaf block own-text line to its own-text run cell, anchored on the block', () => {
      const { g, body } = mount('- parent\n  more\n  - child\n');
      const li = body.querySelector('li')!;
      const cell = g.cellAt(li.querySelector('span[data-src-line="2"]')!);
      expect(cell?.dataset.label).toBe('1–2');
      expect(g.cellLines(cell!)).toEqual({ start: 1, end: 2 });
      expect(g.cellAnchor(cell!)).toBe(li);
    });

    it('anchors a code line after its pre', () => {
      const { g, body } = mount(SRC);
      const cell = g.cellAt(body.querySelector('pre span[data-src-line="20"]')!);
      expect(g.cellAnchor(cell!)).toBe(body.querySelector('pre'));
    });

    it('returns a gutter cell itself', () => {
      const { g } = mount(SRC);
      const cell = g.cells()[1];
      expect(g.cellAt(cell)).toBe(cell);
    });

    it('returns null for hidden targets and outside any cell', () => {
      const { g, body } = mount(SRC);
      body.querySelector('h1')!.classList.add('mdr-collapsed');
      expect(g.cellAt(body.querySelector('h1')!)).toBeNull();
      expect(g.cellAt(g.cells()[0])).toBeNull();
      expect(g.cellAt(body)).toBeNull();
    });

    it('follows Mermaid: the range cell while the diagram shows, line cells with the source', () => {
      const { g, body } = mount(['```mermaid', 'graph TD', 'A-->B', '```', ''].join('\n'));
      const host = body.querySelector<HTMLElement>('.md-mermaid')!;
      const line = host.querySelector('span[data-src-line="3"]')!;
      expect(g.cellAt(line)?.dataset.label).toBe('3');
      expect(g.cellAt(host)).toBeNull();
      host.classList.add('mdr-mermaid-rendered');
      expect(g.cellAt(line)).toBeNull();
      expect(g.cellAt(host)?.dataset.label).toBe('1–4');
      host.classList.add('mdr-mermaid-show-source');
      expect(g.cellAt(line)?.dataset.label).toBe('3');
      expect(g.cellAnchor(g.cellAt(line)!)).toBe(host);
    });
  });
});
