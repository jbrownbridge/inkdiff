import type { Element, ElementContent, Root, Text } from 'hast';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import type { Block } from './render';

const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tr', 'hr', 'div']);

function classes(node: Element): string[] {
  const c = node.properties.className;
  return Array.isArray(c) ? c.map(String) : [];
}

function blockKind(node: Element): string {
  const tag = node.tagName;
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'li') return 'listItem';
  if (tag === 'tr') return 'tableRow';
  if (tag === 'hr') return 'thematicBreak';
  if (tag === 'pre') return classes(node).includes('md-frontmatter') ? 'frontmatter' : 'code';
  if (tag === 'div') return classes(node).includes('md-mermaid') ? 'mermaid' : 'html';
  return tag;
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function lineSpans(text: string, firstLine: number): ElementContent[] {
  const parts = text.split('\n');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((value, i) => ({
    type: 'element',
    tagName: 'span',
    properties: { dataSrcLine: firstLine + i },
    children: [{ type: 'text', value: i < parts.length - 1 ? `${value}\n` : value }],
  }));
}

declare module 'hast' {
  interface ElementData {
    /** Source line of the first code line, set by the code/yaml handlers. */
    firstCodeLine?: number;
  }
}

function wrapCodeLines(pre: Element, start: number): void {
  const first = pre.data?.firstCodeLine ?? start;
  const code = pre.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code') ?? pre;
  code.children = lineSpans(code.children.map(textOf).join(''), first);
}

export const rehypeSourcePos: Plugin<[{ blocks: Block[] }], Root> = ({ blocks }) => (tree) => {
  visit(tree, 'element', (node: Element) => {
    const pos = node.position;
    if (!pos || !BLOCK_TAGS.has(node.tagName)) return;
    const start = pos.start.line;
    const end = pos.end.line;
    node.properties.dataSrcStart = start;
    node.properties.dataSrcEnd = end;
    blocks.push({ start, end, kind: blockKind(node) });
    if (node.tagName === 'pre') {
      wrapCodeLines(node, start);
      return SKIP;
    }
    if (classes(node).includes('md-mermaid')) {
      const pre = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'pre');
      if (pre) wrapCodeLines(pre, start);
      return SKIP;
    }
    return undefined;
  });

  visit(tree, 'text', (node: Text, index, parent) => {
    if (!node.position || !parent || index === undefined) return undefined;
    const spans = lineSpans(node.value, node.position.start.line);
    parent.children.splice(index, 1, ...spans);
    return [SKIP, index + spans.length];
  });
};
