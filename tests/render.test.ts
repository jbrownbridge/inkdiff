import { readFileSync } from 'node:fs';
import { renderMarkdown } from '../src/render/render';

const SOURCE = readFileSync('e2e/fixture-repo/head/docs/guide.md', 'utf8');

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('renderMarkdown', () => {
  const { html, blocks, lines } = renderMarkdown(SOURCE);
  const root = dom(html);

  it('returns the source lines', () => {
    expect(lines[4]).toBe('# Fixture guide');
  });

  it('stamps headings and paragraphs with their line range', () => {
    const h1 = root.querySelector('h1')!;
    expect(h1.dataset.srcStart).toBe('5');
    expect(h1.dataset.srcEnd).toBe('5');
    const p = root.querySelector('p[data-src-start="7"]') as HTMLElement;
    expect(p.dataset.srcEnd).toBe('9');
  });

  it('wraps each text line of a paragraph', () => {
    const span = root.querySelector('p[data-src-start="7"] [data-src-line="8"]')!;
    expect(span.textContent).toContain('so that a selection can map to');
  });

  it('stamps nested list items and table rows', () => {
    const nested = [...root.querySelectorAll('li')].find((li) => li.textContent?.trim() === 'Nested item')!;
    expect(nested.dataset.srcStart).toBe('13');
    const beta = [...root.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('beta'))!;
    expect(beta.dataset.srcStart).toBe('19');
    expect(beta.dataset.srcEnd).toBe('19');
  });

  it('renders front matter with line numbers', () => {
    const fm = root.querySelector('pre.md-frontmatter') as HTMLElement;
    expect(fm.dataset.srcStart).toBe('1');
    expect(fm.dataset.srcEnd).toBe('3');
    expect(fm.querySelector('[data-src-line="2"]')!.textContent).toContain('title: Fixture guide');
  });

  it('renders mermaid as a placeholder with line numbers', () => {
    const m = root.querySelector('div.md-mermaid') as HTMLElement;
    expect(m.dataset.srcStart).toBe('23');
    expect(m.dataset.srcEnd).toBe('26');
    expect(m.querySelector('[data-src-line="25"]')!.textContent).toContain('A --> B');
  });

  it('maps code lines inside a fence', () => {
    const pre = root.querySelector('pre[data-src-start="28"]')!;
    expect(pre.querySelector('[data-src-line="29"]')!.textContent).toContain('const answer = 42;');
  });

  it('wraps block HTML with line numbers', () => {
    const div = root.querySelector('div.md-html') as HTMLElement;
    expect(div.dataset.srcStart).toBe('32');
    expect(div.querySelector('details')).not.toBeNull();
  });

  it('lists blocks with kinds', () => {
    expect(blocks).toContainEqual({ start: 5, end: 5, kind: 'heading' });
    expect(blocks).toContainEqual({ start: 7, end: 9, kind: 'paragraph' });
    expect(blocks).toContainEqual({ start: 19, end: 19, kind: 'tableRow' });
    expect(blocks).toContainEqual({ start: 23, end: 26, kind: 'mermaid' });
    expect(blocks).toContainEqual({ start: 1, end: 3, kind: 'frontmatter' });
  });

  it('gives the same line numbers for CRLF sources', () => {
    const crlf = renderMarkdown(SOURCE.replace(/\n/g, '\r\n'));
    expect(crlf.blocks).toEqual(blocks);
    expect(crlf.html).toBe(html);
  });

  it('sanitizes dangerous HTML', () => {
    const out = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n').html;
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
  });

  describe('code line numbers in containers', () => {
    const line = (src: string, n: number) => dom(renderMarkdown(src).html).querySelector(`[data-src-line="${n}"]`)?.textContent ?? null;

    it('maps a fence inside a blockquote', () => {
      expect(line('> ```js\n> const a = 1;\n> ```\n', 2)).toContain('const a = 1;');
    });

    it('maps a fence inside a list item', () => {
      expect(line('- item\n\n  ```\n  first\n  second\n  ```\n', 4)).toContain('first');
      expect(line('- item\n\n  ```\n  first\n  second\n  ```\n', 5)).toContain('second');
    });

    it('maps Mermaid inside a list item', () => {
      const root = dom(renderMarkdown('- item\n\n  ```mermaid\n  graph TD\n  A --> B\n  ```\n').html);
      expect(root.querySelector('.md-mermaid [data-src-line="5"]')?.textContent).toContain('A --> B');
    });

    it('maps Mermaid inside a blockquote', () => {
      const root = dom(renderMarkdown('> ```mermaid\n> graph TD\n> A --> B\n> ```\n').html);
      expect(root.querySelector('.md-mermaid [data-src-line="3"]')?.textContent).toContain('A --> B');
    });

    it('maps indented code from its first line', () => {
      expect(line('para\n\n    indented\n    more\n', 3)).toContain('indented');
    });
  });
});
