import { renderMermaidFile } from '../src/render/mermaid-file';

const dom = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

describe('renderMermaidFile', () => {
  it('renders the whole file as one Mermaid block with code lines from 1', () => {
    const r = renderMermaidFile('graph TD\n  A --> B\n  B --> C\n');
    const root = dom(r.html);
    expect(root.children).toHaveLength(1);
    const host = root.querySelector<HTMLElement>('div.md-mermaid')!;
    expect(host.dataset.srcStart).toBe('1');
    expect(host.dataset.srcEnd).toBe('3');
    const spans = [...host.querySelectorAll<HTMLElement>('pre > code > span[data-src-line]')];
    expect(spans.map((s) => s.dataset.srcLine)).toEqual(['1', '2', '3']);
    expect(host.querySelector('code')!.textContent).toBe('graph TD\n  A --> B\n  B --> C');
    expect(r.blocks).toEqual([{ start: 1, end: 3, kind: 'mermaid' }]);
    expect(r.lines).toEqual(['graph TD', '  A --> B', '  B --> C', '']);
  });

  it('keeps markup in the source as text', () => {
    const r = renderMermaidFile('graph TD\nA-->B<script>alert(1)</script>\nC["<img src=x onerror=alert(1)>"]');
    const root = dom(r.html);
    expect(root.querySelector('script, img')).toBeNull();
    expect(root.querySelector('[data-src-line="2"]')!.textContent).toBe('A-->B<script>alert(1)</script>\n');
    expect(root.querySelector('[data-src-line="3"]')!.textContent).toBe('C["<img src=x onerror=alert(1)>"]');
    expect(r.blocks).toEqual([{ start: 1, end: 3, kind: 'mermaid' }]);
  });

  it('normalises CRLF line endings', () => {
    const r = renderMermaidFile('graph TD\r\nA-->B\r\n');
    expect(r.lines).toEqual(['graph TD', 'A-->B', '']);
    expect(dom(r.html).querySelectorAll('[data-src-line]')).toHaveLength(2);
  });
});
