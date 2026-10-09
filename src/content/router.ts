import type { SourceRef } from '../core/source-fetch';
import type { GitHubAdapter, MdFile } from '../github/types';
import { FILE_REGION, SOURCE_CLASS } from '../page/early';

export function parseFilesPage(url: URL): { repo: string; pr: number } | null {
  if (url.hostname !== 'github.com') return null;
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(files|changes)(\/|$)/);
  return m ? { repo: `${m[1]}/${m[2]}`, pr: Number(m[3]) } : null;
}

interface Lifecycle { attach(): void; detach(): void }

export interface RouterDeps {
  doc: Document;
  /** In order of preference; the first whose `pageLooksSupported` is true drives the page. */
  adapters: GitHubAdapter[];
  makeController(file: MdFile, adapter: GitHubAdapter): Lifecycle;
  warn?(msg: string): void;
  healthDelayMs?: number;
  /** Fetch these files' sources ahead of time (once per page). */
  prefetch?(refs: SourceRef[]): void;
}

/** GitHub's soft-navigation events after which the page shows new content. */
const NAV_DONE = ['turbo:render', 'turbo:load', 'soft-nav:end', 'soft-nav:react-done', 'soft-nav:payload'];

function version(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}

/** Controllers are reused only for the same container showing the same file at the same commit. */
const fileKey = (f: MdFile) => `${f.repo}#${f.pr}@${f.headSha}:${f.path}`;

export function startRouter(deps: RouterDeps): () => void {
  const { doc, adapters } = deps;
  const pick = () => adapters.findIndex((a) => a.pageLooksSupported(doc));
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const controllers = new Map<HTMLElement, { key: string; c: Lifecycle }>();
  let lastUrl = '';
  let warned = false;
  let healthTimer: ReturnType<typeof setTimeout> | undefined;

  const detachAll = () => { for (const { c } of controllers.values()) c.detach(); controllers.clear(); };

  const scan = () => {
    const url = new URL(doc.location.href);
    const page = parseFilesPage(url);
    if (url.href !== lastUrl) {
      lastUrl = url.href;
      for (const a of adapters) a.forgetPageData?.(doc);
      clearTimeout(healthTimer);
      if (page) {
        healthTimer = setTimeout(() => {
          if (!warned && pick() < 0) {
            warned = true;
            warn(`[Inkdiff] v${version()}: GitHub page structure not recognised; the extension stays idle on this page.`);
          }
        }, deps.healthDelayMs ?? 5000);
      }
    }
    if (!page) { detachAll(); releaseUnclaimed(); return; }
    const index = pick();
    if (index < 0) { detachAll(); releaseUnclaimed(); return; }
    const adapter = adapters[index];
    // After a soft navigation the page may still hold another page's data: fetch the PR's, then scan again.
    adapter.loadPageData?.(doc, url).then((fresh) => { if (fresh && !stopped) scanSoon(); }, () => {});
    if (deps.prefetch && adapter.markdownRefs && prefetchedFor !== url.href) {
      const refs = adapter.markdownRefs(doc, url);
      if (refs.length) { prefetchedFor = url.href; deps.prefetch(refs); }
    }
    const seen = new Set<HTMLElement>();
    for (const file of adapter.findMarkdownFiles(doc, url)) {
      seen.add(file.container);
      const key = `${index}|${fileKey(file)}`;
      const current = controllers.get(file.container);
      if (current?.key === key) continue;
      current?.c.detach();
      const c = deps.makeController(file, adapter);
      controllers.set(file.container, { key, c });
      c.attach();
    }
    for (const [el, { c }] of controllers) if (!seen.has(el)) { c.detach(); controllers.delete(el); }
    releaseUnclaimed();
  };

  /** A file region no controller took (another file type, a commit range): its source diff shows. */
  function releaseUnclaimed() {
    for (const el of doc.querySelectorAll<HTMLElement>(FILE_REGION)) if (!controllers.has(el)) el.classList.add(SOURCE_CLASS);
  }
  let prefetchedFor = '';

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 150); };
  /** Scan on the next frame: GitHub just drew a file (selector observer) or finished a navigation. */
  let frame = 0;
  const scanSoon = () => {
    if (frame) return;
    const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView) ?? ((cb: () => void) => setTimeout(cb, 0) as unknown as number);
    frame = raf(() => { frame = 0; clearTimeout(timer); scan(); });
  };
  const onAnimation = (e: Event) => { if ((e as AnimationEvent).animationName === 'mdr-seen') scanSoon(); };
  // The MutationObserver stays as the fallback for anything the selector observer misses.
  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('animationstart', onAnimation, true);
  for (const type of NAV_DONE) doc.addEventListener(type, scanSoon);
  doc.defaultView?.addEventListener('popstate', schedule);
  scan();

  return () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(timer);
    clearTimeout(healthTimer);
    doc.removeEventListener('animationstart', onAnimation, true);
    for (const type of NAV_DONE) doc.removeEventListener(type, scanSoon);
    doc.defaultView?.removeEventListener('popstate', schedule);
    detachAll();
  };
}
