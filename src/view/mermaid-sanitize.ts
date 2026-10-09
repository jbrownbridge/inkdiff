import DOMPurify from 'dompurify';

/**
 * Mermaid's SVG goes through DOMPurify too, so a Mermaid bug is not enough for markup injection:
 * SVG and the HTML labels Mermaid puts in foreignObject stay; scripts, links, external references
 * and animation (which can change attributes after sanitizing) go.
 */
export const MERMAID_PURIFY = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['foreignObject', 'style'],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
  FORBID_TAGS: ['a', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'image', 'use', 'feImage', 'animate', 'animateMotion', 'animateTransform', 'set',
    'img', 'picture', 'source', 'video', 'audio', 'track', 'table', 'link', 'meta', 'base'],
  FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset', 'background', 'poster', 'data'],
};

/**
 * A diagram's classDef/style statements reach Mermaid's CSS. Make the declarations that could
 * escape the diagram invalid (the browser then drops them): positioning that paints over the page,
 * and url()/@import, which would load from github.com with the user's cookies.
 */
export function neuterCss(css: string): string {
  return css
    .replace(/\b(position|z-index|inset)(\s*:)/gi, 'x-$1$2')
    // url(#id) points inside the diagram (arrowheads, gradients): safe, and needed.
    .replace(/\burl\s*\((?!\s*['"]?#)/gi, 'x-url(')
    .replace(/@import/gi, '@x-import');
}

let purify: ReturnType<typeof DOMPurify> | null = null;

export function sanitizeMermaidSvg(svg: string, win: Window & typeof globalThis = window): string {
  if (!purify) {
    purify = DOMPurify(win);
    purify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName === 'style') data.attrValue = neuterCss(data.attrValue);
    });
    purify.addHook('afterSanitizeElements', (node) => {
      if (node.nodeName.toLowerCase() === 'style' && node.textContent) node.textContent = neuterCss(node.textContent);
    });
  }
  return purify.sanitize(svg, MERMAID_PURIFY) as unknown as string;
}

/**
 * Mermaid config keys a diagram's %%{init}%% directive may not change: the defaults, plus the
 * ones that inject CSS (themeCSS can load url() resources) or fonts.
 */
export const MERMAID_SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily'];

const codePoint = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/**
 * Whether a diagram's source could make the browser load something: CSS (url(), image-set(),
 * @import), HTML in labels (<img>, <picture>, <video>, src=, srcset=, background=, ...), or an
 * image node shape (`A@{ img: "…" }`), or a sequence participant's properties/details icon:
 * Mermaid fetches those itself.
 * Mermaid builds its SVG in the page before our sanitizer sees it, so such a diagram would load
 * them at once: it is not rendered. HTML entities, Mermaid's #nnn; entities and CSS escapes are
 * decoded first, and whitespace removed. Comments are not stripped: a "/*" inside a CSS string
 * would hide what follows it from the check, and a diagram needs no comments in its styles.
 */
export function diagramLoadsResources(code: string, doc: Document = document): boolean {
  const ta = doc.createElement('textarea');
  ta.innerHTML = code;
  const s = ta.value
    .replace(/#(\d{1,7});/g, (_, n: string) => codePoint(Number(n)))
    // JSON/YAML escapes (\x67, \u0067, \U00000067), then CSS escapes (\67 ).
    .replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})|\\U([0-9a-f]{8})/gi, (_, x?: string, u?: string, w?: string) => codePoint(parseInt(x ?? u ?? w ?? '', 16)))
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/\\/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  // The two places Mermaid 12 fetches while rendering, closed whatever the syntax (statements can
  // be split with ";", keys quoted, tagged or escaped): sequence participant properties/details
  // (an icon URL), and node metadata naming an image (the image shape).
  if (s.includes('sequencediagram') && /properties|details/.test(s)) return true;
  if (s.includes('@{') && /img|image/.test(s)) return true;
  return /url\(|image-set\(|image\(|cross-fade\(|element\(|src\(|@import|@font-face|<(img|image|picture|source|video|audio|input|iframe|object|embed|track|use|feimage|table|link|meta|base)\b|<[^>]*(src|srcset|background|poster|href|data)=|!\[[^\]]*\]\(/.test(s);
}
