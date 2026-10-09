import type { ElementContent, Root } from 'hast';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import type { RenderResult } from './render';
import { rehypePrivateAttrs, sanitize } from './sanitize';

/**
 * A .mmd file as one Mermaid block, the same markup a Mermaid fence renders to, with code lines
 * numbered from 1 (there are no fence lines). The source only ever becomes text nodes, and the
 * markup goes through the same private-attribute and sanitize path as Markdown.
 */
export function renderMermaidFile(source: string): RenderResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const code = lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const n = code.length;
  const spans: ElementContent[] = code.map((text, i) => ({
    type: 'element',
    tagName: 'span',
    properties: { dataSrcLine: i + 1 },
    children: [{ type: 'text', value: i < n - 1 ? `${text}\n` : text }],
  }));
  const tree: Root = {
    type: 'root',
    children: [{
      type: 'element',
      tagName: 'div',
      properties: { className: ['md-mermaid'], dataSrcStart: 1, dataSrcEnd: n },
      children: [{ type: 'element', tagName: 'pre', properties: {}, children: [{ type: 'element', tagName: 'code', properties: {}, children: spans }] }],
    }],
  };
  const processor = unified().use(rehypePrivateAttrs).use(rehypeStringify);
  const html = processor.stringify(processor.runSync(tree));
  return { html: sanitize(html), blocks: [{ start: 1, end: n, kind: 'mermaid' }], lines };
}
