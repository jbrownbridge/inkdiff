import DOMPurify from 'dompurify';
import type { Element, ElementContent, Root } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * Attributes we generate (positions, classes, ids, data-*) travel through the sanitizer under a
 * per-load random attribute prefix that author HTML cannot know. Everything else is author input:
 * its data-*, style, and our md-/mdr- classes are stripped.
 */
function randomTag(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `x${a[0].toString(36)}${a[1].toString(36)}`;
}

const PRIVATE = `data-${randomTag()}-`;

/** Classes allowed on author HTML. */
const AUTHOR_CLASS = /^(language-[\w-]+|task-list-item|contains-task-list|footnotes)$/;
/** Classes allowed on elements we generate. */
const OWN_CLASS = /^(mdr?-[\w-]+|language-[\w-]+|task-list-item|contains-task-list|footnotes|sr-only)$/;

const filterClasses = (value: string, allowed: RegExp) => value.split(/\s+/).filter((c) => allowed.test(c)).join(' ');

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A task-list checkbox becomes inert text so form controls can be forbidden outright. */
function taskBox(node: Element): ElementContent {
  const checked = node.properties.checked === true;
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['mdr-task'], role: 'img', ariaLabel: checked ? 'done' : 'not done' },
    children: [{ type: 'text', value: checked ? '☑' : '☐' }],
  };
}

/**
 * Tags that swallow the rest of the document as text or inert content (and are removed by the
 * sanitizer anyway): in author HTML they show as text, so later blocks still render.
 */
const SWALLOWING = /<(?=\/?(?:textarea|title|xmp|plaintext|noscript|noembed|noframes|iframe|style|script|template|select|option)\b)/gi;

/** Make author HTML unable to swallow what follows it: those tags as text, comments closed. */
export function neutralizeRaw(value: string): string {
  const out = value.replace(SWALLOWING, '&lt;');
  return out.lastIndexOf('<!--') > out.lastIndexOf('-->') ? `${out} -->` : out;
}

/** Rehype step (last before stringify): move our own class/id/data-* onto private attribute names. */
export const rehypePrivateAttrs: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'raw', (node: { value: string }) => { node.value = neutralizeRaw(node.value); });
  visit(tree, 'element', (node: Element, index, parent) => {
    if (node.tagName === 'input' && node.properties.type === 'checkbox' && parent && index !== undefined) {
      parent.children[index] = taskBox(node);
      node = parent.children[index] as Element;
    }
    const props = node.properties;
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (key === 'className') {
        if (Array.isArray(value) && value.length) props[`${PRIVATE}class`] = value.join(' ');
        delete props[key];
      } else if (key === 'id') {
        props[`${PRIVATE}id`] = value;
        delete props[key];
      } else if (/^data[A-Z]/.test(key)) {
        props[`${PRIVATE}${kebab(key.slice(4)).slice(1)}`] = value;
        delete props[key];
      }
    }
  });
};

const purify = DOMPurify(window);
purify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName.startsWith(PRIVATE)) {
    data.forceKeepAttr = true;
  } else if (data.attrName === 'class') {
    data.attrValue = filterClasses(data.attrValue, AUTHOR_CLASS);
    if (!data.attrValue) data.keepAttr = false;
  }
});

const CONFIG = {
  // Media, canvas, template and datalist never show their content; bdo reorders text; fieldset can
  // disable controls placed inside it.
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'dialog', 'image', 'feimage', 'use', 'foreignobject',
    'audio', 'video', 'canvas', 'template', 'datalist', 'bdo', 'fieldset',
    // Like GitHub's own sanitizer: no inline SVG or MathML (both can draw text invisibly: zero
    // size, phantom, white, clipped), and no progress/meter (their content never shows). Text stays.
    'svg', 'math', 'progress', 'meter'],
  // Author content may not hide itself (hidden, font color/size), point a label at a page control
  // (for, form), or reorder its own text (the rendered view replaces the source diff).
  FORBID_ATTR: ['style', 'hidden', 'for', 'form', 'color', 'size', 'face'],
  SANITIZE_NAMED_PROPS: true,
  ALLOW_DATA_ATTR: false,
};

/** Restore our private attributes to their real names. */
function restore(root: DocumentFragment): void {
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (!attr.name.startsWith(PRIVATE)) continue;
      const name = attr.name.slice(PRIVATE.length);
      el.removeAttribute(attr.name);
      if (name === 'class') {
        const cls = filterClasses(attr.value, OWN_CLASS);
        if (cls) el.setAttribute('class', cls);
      } else if (name === 'id') {
        el.setAttribute('id', attr.value);
      } else {
        el.setAttribute(`data-${name}`, attr.value);
      }
    }
  }
}

/**
 * Author HTML can wrap later blocks: an unclosed `<a>` is reopened by the parser, and inline HTML
 * such as `</p><label>` closes our paragraph and opens an element around everything after it.
 * Comment forms and threads go among those blocks, so a wrapper could turn clicks inside GitHub's
 * comment box into link or label clicks, or disable it (`<fieldset disabled>`). Rendered blocks
 * carry data-src-start; any other element holding one is unwrapped, except table parts.
 */
const STRUCTURAL = new Set(['THEAD', 'TBODY', 'TFOOT', 'TD', 'TH']);

function unwrapBlockWrappers(root: DocumentFragment, attr = 'data-src-start'): void {
  // Our footnotes section (GFM) holds blocks by design; an author's <section> does not.
  const footnotes = attr.replace(/src-start$/, 'footnotes');
  for (const el of [...root.querySelectorAll('*')].reverse()) {
    if (el.hasAttribute(attr) || STRUCTURAL.has(el.tagName)) continue;
    if (el.tagName === 'SECTION' && el.hasAttribute(footnotes)) continue;
    if (el.tagName === 'OL' && el.parentElement?.tagName === 'SECTION' && el.parentElement.hasAttribute(footnotes)) continue;
    if (el.querySelector(`[${attr}]`)) el.replaceWith(...el.childNodes);
  }
}

/**
 * The same, before sanitizing: a forbidden wrapper (`<audio>`, `<template>`) would otherwise be
 * removed together with every block after it.
 */
function unwrapBeforeSanitize(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  unwrapBlockWrappers(tpl.content, `${PRIVATE}src-start`);
  // Removed elements whose text must stay visible: flatten them to their text first.
  for (const el of tpl.content.querySelectorAll('math, svg, progress, meter')) {
    el.replaceWith(tpl.ownerDocument.createTextNode(el.textContent ?? ''));
  }
  return tpl.innerHTML;
}

/** Sanitize rendered HTML; `post` may rewrite the sanitized tree before it is serialized. */
export function sanitize(html: string, post?: (root: DocumentFragment) => void): string {
  const frag = purify.sanitize(unwrapBeforeSanitize(html), { ...CONFIG, RETURN_DOM_FRAGMENT: true });
  restore(frag);
  unwrapBlockWrappers(frag);
  post?.(frag);
  const box = frag.ownerDocument.createElement('div');
  box.append(frag);
  return box.innerHTML;
}

/** Classes GitHub puts in rendered comments (syntax highlighting, mentions, references, tasks). */
const COMMENT_CLASS = /^(pl-[\w-]+|highlight(-source-[\w-]+)?|user-mention|team-mention|issue-link|commit-link|email-[\w-]+|blob-[\w-]+|task-list-item(-checkbox)?|contains-task-list|anchor|octicon(-[\w-]+)?|markdown-[\w-]+)$/;

const commentPurify = DOMPurify(window);
commentPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'class') {
    data.attrValue = filterClasses(data.attrValue, COMMENT_CLASS);
    if (!data.attrValue) data.keepAttr = false;
  }
});
commentPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) node.setAttribute('rel', 'noopener noreferrer');
});

/**
 * A review comment's HTML (GitHub's own rendering, read from the page) gets the same strict rules
 * as rendered Markdown: no style, forms, data-* or unprefixed ids, only known classes.
 */
export function sanitizeComment(html: string): string {
  return commentPurify.sanitize(html, CONFIG) as unknown as string;
}
