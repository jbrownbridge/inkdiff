export interface RenderContext {
  repo: string;
  headSha: string;
  /** Repository path of the Markdown file; relative URLs resolve against its directory. */
  path: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BASE = 'https://repo.invalid/';

/** github.com paths that serve file or attachment content; any other github.com URL is a page. */
const GITHUB_CONTENT_PATH = /^\/(user-attachments\/|[^/]+\/[^/]+\/(raw|assets)\/)/;

/** GitHub's content hosts, and github.com only on content paths (never pages such as /logout). */
function isGitHubImage(u: URL): boolean {
  const host = u.hostname;
  if (host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com')) return true;
  if (host !== 'github.com') return false;
  return GITHUB_CONTENT_PATH.test(u.pathname) || (/^\/[^/]+\/[^/]+\/blob\//.test(u.pathname) && u.searchParams.get('raw') === 'true');
}

/** Repo-relative URL resolved against the file's directory; null for absolute, protocol-relative, or #anchor URLs. */
function resolveInRepo(url: string, ctx: RenderContext, kind: 'blob' | 'raw'): string | null {
  if (!url || url.startsWith('#') || url.startsWith('//') || SCHEME.test(url)) return null;
  const u = new URL(url, BASE + ctx.path);
  return `https://github.com/${ctx.repo}/${kind}/${ctx.headSha}/${u.pathname.slice(1)}${u.search}${u.hash}`;
}

/** Absolute http(s) URL whose host may be loaded without asking; otherwise null. */
function parseHttp(url: string): URL | null {
  try {
    const u = new URL(url, 'https://github.com/');
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

function imageAllowed(url: string): boolean {
  const u = parseHttp(url);
  return u !== null && isGitHubImage(u);
}

function imageLink(img: Element, src: string): Element {
  const doc = img.ownerDocument;
  const alt = img.getAttribute('alt')?.trim();
  const u = parseHttp(src);
  const label = `Image: ${alt || u?.hostname || 'external'}`;
  if (!u) {
    const span = doc.createElement('span');
    span.textContent = label;
    return span;
  }
  const a = doc.createElement('a');
  a.setAttribute('href', u.href);
  a.setAttribute('rel', 'noopener noreferrer');
  a.setAttribute('target', '_blank');
  a.textContent = label;
  return a;
}

/**
 * Point relative links and images at the PR head commit, add rel to links, and keep images from
 * hosts other than GitHub from loading (they become links). Runs on sanitized output.
 */
export function rewriteUrls(root: DocumentFragment, ctx?: RenderContext): void {
  for (const el of root.querySelectorAll('[srcset], [background]')) {
    el.removeAttribute('srcset');
    el.removeAttribute('background');
  }
  for (const a of root.querySelectorAll('a[href], area[href]')) {
    const href = a.getAttribute('href') ?? '';
    const resolved = ctx ? resolveInRepo(href, ctx, 'blob') : null;
    if (resolved) a.setAttribute('href', resolved);
    a.setAttribute('rel', 'noopener noreferrer');
  }
  for (const img of root.querySelectorAll('img')) {
    const raw = img.getAttribute('src') ?? '';
    const src = (ctx ? resolveInRepo(raw, ctx, 'raw') : null) ?? raw;
    if (!src) continue;
    if (imageAllowed(src)) img.setAttribute('src', src);
    else img.replaceWith(imageLink(img, src));
  }
  // Other media may only load from GitHub hosts (inline SVG is removed by the sanitizer).
  for (const el of root.querySelectorAll('[src], [poster], image[href], use[href]')) {
    if (el.tagName === 'IMG') continue;
    for (const name of ['src', 'poster', 'href']) {
      if (el.tagName.toLowerCase() === 'a' && name === 'href') continue;
      const v = el.getAttribute(name);
      if (v === null) continue;
      const resolved = (ctx ? resolveInRepo(v, ctx, 'raw') : null) ?? v;
      if (imageAllowed(resolved)) el.setAttribute(name, resolved);
      else el.removeAttribute(name);
    }
  }
}
