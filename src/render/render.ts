import type { Element } from 'hast';
import type { Code, Html, Yaml } from 'mdast';
import { defaultHandlers, type Handler, type State } from 'mdast-util-to-hast';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { rehypePrivateAttrs, sanitize } from './sanitize';
import { rehypeSourcePos } from './sourcepos';
import { rewriteUrls, type RenderContext } from './urls';

export type { RenderContext } from './urls';

export interface Block {
  start: number;
  end: number;
  kind: string;
}

export interface RenderResult {
  html: string;
  blocks: Block[];
  lines: string[];
}

function codeBlock(className: string, value: string): Element {
  return {
    type: 'element',
    tagName: 'pre',
    properties: className ? { className: [className] } : {},
    children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: `${value}\n` }] }],
  };
}

/** Source line of the first code line: fenced blocks span more lines than their value holds. */
function firstCodeLine(node: Code): number | undefined {
  const pos = node.position;
  if (!pos) return undefined;
  const valueLines = node.value === '' ? 0 : node.value.split('\n').length;
  return pos.end.line - pos.start.line + 1 > valueLines ? pos.start.line + 1 : pos.start.line;
}

const code: Handler = (state: State, node: Code) => {
  const first = firstCodeLine(node);
  if (node.lang !== 'mermaid') {
    const pre = defaultHandlers.code(state, node) as Element;
    pre.data = { ...pre.data, firstCodeLine: first };
    return pre;
  }
  const inner = codeBlock('', node.value);
  inner.data = { firstCodeLine: first };
  const el: Element = { type: 'element', tagName: 'div', properties: { className: ['md-mermaid'] }, children: [inner] };
  state.patch(node, el);
  return el;
};

const yaml: Handler = (state: State, node: Yaml) => {
  const el = codeBlock('md-frontmatter', node.value);
  state.patch(node, el);
  if (node.position) el.data = { firstCodeLine: node.position.start.line + 1 };
  return el;
};

/**
 * The text of each HTML comment, shown (only where the diff changed it, see content.css) so a
 * change the rendered view would hide, such as instructions in a comment, stays visible.
 */
function commentNotes(value: string, tagName: 'div' | 'span'): Element[] {
  if (!/<[!?]/.test(value)) return [];
  // The browser's own parser decides what is a comment: <!-- -->, and also <?…>, <!…> and CDATA.
  const tpl = document.createElement('template');
  tpl.innerHTML = value;
  const found: string[] = [];
  const walk = (root: Node) => {
    // Chrome parses <?…?> as a processing instruction, other parsers as a comment: take both.
    const it = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_ELEMENT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      if (n.nodeType === Node.COMMENT_NODE) found.push((n as Comment).data);
      else if (n.nodeType === Node.PROCESSING_INSTRUCTION_NODE) found.push(`${(n as ProcessingInstruction).target} ${(n as ProcessingInstruction).data}`);
      else if (n instanceof HTMLTemplateElement) walk(n.content);
    }
  };
  walk(tpl.content);
  return found.map((text) => ({
    type: 'element',
    tagName,
    properties: { className: ['mdr-unseen'], title: 'Hidden in the rendered view (HTML comment)' },
    children: [{ type: 'text', value: text.trim() || '(empty comment)' }],
  }));
}

const html: Handler = (state: State, node: Html, parent) => {
  // Inline HTML (in a paragraph, heading or table cell) stays inline: no block of its own.
  if (parent && (parent.type === 'paragraph' || parent.type === 'heading' || parent.type === 'tableCell')) return [{ type: 'raw', value: node.value }, ...commentNotes(node.value, 'span')];
  const el: Element = { type: 'element', tagName: 'div', properties: { className: ['md-html'] }, children: [{ type: 'raw', value: node.value }, ...commentNotes(node.value, 'div')] };
  state.patch(node, el);
  return el;
};

/** `ctx` lets relative links and images resolve against the PR head commit. */
export function renderMarkdown(source: string, ctx?: RenderContext): RenderResult {
  const text = source.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks: Block[] = [];
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkRehype, { allowDangerousHtml: true, handlers: { code, yaml, html } })
    .use(rehypeSourcePos, { blocks })
    .use(rehypePrivateAttrs)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .processSync(text);
  return { html: sanitize(String(file), (root) => rewriteUrls(root, ctx)), blocks, lines };
}
