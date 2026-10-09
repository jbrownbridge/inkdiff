import { verifySource } from '../core/diff-map';
import { SourceError, type SourceRef } from '../core/source-fetch';
import type { GitHubAdapter, MdFile, ThreadInfo } from '../github/types';
import { SOURCE_CLASS } from '../page/early';
import type { Settings } from '../settings/settings';
import { button, div } from '../view/dom';
import { createPanel, type PanelHandle } from '../view/panel';
import { renderFile } from './render-cache';

export interface ControllerDeps {
  adapter: GitHubAdapter;
  fetchSource(ref: SourceRef): Promise<string>;
  settings: Settings;
  doc: Document;
  whenVisible?(el: HTMLElement, cb: () => void): () => void;
}

function observeVisible(el: HTMLElement, cb: () => void): () => void {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); cb(); }
  }, { rootMargin: '300% 0px' });
  io.observe(el);
  return () => io.disconnect();
}

/** .mmd files whose source the reviewer chose with View source: they stay closed until reload. */
const sourceChosen = new Set<string>();
const fileId = (f: MdFile) => `${f.repo}#${f.pr}@${f.headSha}:${f.path}`;

function threadKey(threads: ThreadInfo[]): string {
  return JSON.stringify(threads.map((t) => [t.id, t.startLine, t.endLine, t.resolved, t.comments.map((c) => [c.author, c.bodyHtml, c.avatarUrl ?? null, c.createdAt ?? null, c.pending ?? false])]));
}

export class FileController {
  private panel: PanelHandle | null = null;
  private opening = false;
  private gen = 0;
  private shown: HTMLElement | null = null;
  private lastThreads = '';
  private bypass = false;
  /** Set once Inkdiff cannot show this file (threads unreadable, no source): GitHub's toggles work as usual. */
  private gitHubOnly = false;
  /** The current open came from GitHub's rich-diff button. */
  private fromRich = false;
  private stopVisible: (() => void) | null = null;
  private stopWaiting: (() => void) | null = null;
  private stopWatch: (() => void) | null = null;
  /** A thread to scroll to once the panel opens (from a source-diff "View rendered"). */
  private revealId: string | null = null;

  constructor(readonly file: MdFile, private readonly deps: ControllerDeps) {}

  private ref(): SourceRef {
    return { repo: this.file.repo, sha: this.file.headSha, path: this.file.path };
  }

  private get isMermaid(): boolean {
    return this.file.kind === 'mermaid';
  }

  attach(): void {
    const { adapter, settings } = this.deps;
    // One capture listener on the file: GitHub may re-render its toggle buttons at any time.
    this.file.container.addEventListener('click', this.onToggle, true);
    this.decorateMarkers();
    // One watcher per file: it decorates GitHub's threads and, while the panel is open, syncs them.
    this.stopWatch ??= adapter.observe(this.file, () => { this.recover(); this.decorateMarkers(); this.syncThreads(); });
    const auto = this.isMermaid ? !sourceChosen.has(fileId(this.file)) : settings.renderedByDefault;
    // Not opening by itself: GitHub's source diff shows (the early hide must not keep it hidden).
    this.file.container.classList.toggle(SOURCE_CLASS, !auto);
    if (auto) {
      const visible = this.deps.whenVisible ?? observeVisible;
      const stop = visible(this.file.container, () => this.openWhenReady());
      this.stopVisible = () => { stop(); this.stopWaiting?.(); this.stopWaiting = null; };
    }
  }

  /**
   * GitHub collapses a file by removing its diff body, and the rendered view with it; expanding
   * draws a new body. Forget the removed view, and open again once the new body is there.
   */
  private recover(): void {
    if (!this.shown || this.shown.isConnected) return;
    const reopen = this.panel !== null || this.opening;
    this.gen++;
    this.opening = false;
    this.panel?.destroy();
    this.panel = null;
    this.shown = null;
    if (reopen) this.openWhenReady();
  }

  /** Open now, or as soon as GitHub renders the diff body (it may load lazily). */
  private openWhenReady(): void {
    const { adapter } = this.deps;
    if (adapter.diffBody(this.file)) { void this.open(); return; }
    this.stopWaiting?.();
    const observer = new MutationObserver(() => {
      if (!adapter.diffBody(this.file)) return;
      observer.disconnect();
      this.stopWaiting = null;
      void this.open();
    });
    observer.observe(this.file.container, { childList: true, subtree: true });
    this.stopWaiting = () => observer.disconnect();
  }

  detach(): void {
    this.file.container.removeEventListener('click', this.onToggle, true);
    this.stopWatch?.();
    this.stopWatch = null;
    this.file.container.querySelectorAll('.mdr-to-rendered').forEach((b) => b.remove());
    this.stopVisible?.();
    this.stopWaiting?.();
    this.stopWaiting = null;
    this.close();
  }

  isOpen(): boolean {
    return this.panel !== null;
  }

  private onToggle = (e: Event) => {
    const { adapter } = this.deps;
    const target = e.target instanceof Node ? e.target : null;
    if (!target) return;
    // GitHub has no rich diff for .mmd: nothing to intercept, and the file always opens rendered.
    if (!this.isMermaid && adapter.richToggle(this.file)?.contains(target)) this.onRich(e);
    else if (adapter.sourceToggle(this.file)?.contains(target)) this.onSource();
  };

  /** A "View rendered" button on each posted thread in GitHub's source diff (kept across re-renders). */
  private decorateMarkers(): void {
    const { adapter, doc } = this.deps;
    for (const { id, el } of adapter.threadMarkers?.(this.file) ?? []) {
      if ([...el.children].some((c) => c.classList.contains('mdr-to-rendered'))) continue;
      const go = button(doc, 'mdr-to-rendered', 'View rendered', 'Show this thread in the rendered Markdown view');
      go.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showThread(id);
      });
      el.append(go);
    }
  }

  /** Open the rendered view (if needed) and scroll to a thread. */
  showThread(id: string): void {
    if (this.panel) { this.panel.revealThread(id); return; }
    this.revealId = id;
    this.openWhenReady();
  }

  private onRich = (e: Event) => {
    if (this.bypass || this.gitHubOnly) return;
    this.fromRich = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    // The diff body may not be loaded yet; open() needs it as the host.
    this.openWhenReady();
  };

  /** The .mmd panel's View source: GitHub's diff, and no reopening until reload. */
  private viewSource = () => {
    sourceChosen.add(fileId(this.file));
    this.onSource();
  };

  private onSource = () => {
    this.stopVisible?.();
    this.stopVisible = null;
    this.stopWaiting?.();
    this.stopWaiting = null;
    this.close();
  };

  async open(): Promise<void> {
    if (this.panel || this.opening) return;
    const { adapter, doc } = this.deps;
    const host = adapter.diffBody(this.file);
    if (!host) return;
    this.opening = true;
    this.file.container.classList.remove(SOURCE_CLASS);
    // A box from an earlier failed open goes before the new attempt shows.
    this.shown?.remove();
    this.shown = null;
    const gen = ++this.gen;
    const loading = div(doc, 'mdr-panel mdr-loading', 'Loading rendered view…');
    this.shown = loading;
    host.before(loading);
    // Hide the source diff now: showing it and then swapping makes the page jump.
    host.classList.add('mdr-hidden');
    const stale = () => gen !== this.gen;
    try {
      if (adapter.threadsReadable && !adapter.threadsReadable(this.file)) {
        // Comments would vanish from the rendered view: GitHub's own view is the safe one.
        warnOnce(`[Inkdiff] v${extensionVersion()}: cannot read GitHub's review threads on this page; showing GitHub's own view.`);
        this.handBack();
        return;
      }
      const source = await this.deps.fetchSource(this.ref());
      if (stale()) return;
      const rendered = renderFile(this.ref(), source);
      const diff = adapter.readDiff(this.file);
      const threads = adapter.readThreads(this.file);
      this.lastThreads = threadKey(threads);
      const panel = createPanel({
        html: rendered.html,
        blocks: rendered.blocks,
        lineCount: rendered.lines.length > 0 && rendered.lines[rendered.lines.length - 1] === '' ? rendered.lines.length - 1 : rendered.lines.length,
        diff,
        threads,
        context: { repo: this.file.repo, pr: this.file.pr, path: this.file.path, headSha: this.file.headSha, source },
        autoMermaid: this.isMermaid || this.deps.settings.autoRenderMermaid,
        hunks: adapter.readHunks(this.file),
        showOnlyChanged: this.deps.settings.showOnlyChanged,
        readOnlyNote: adapter.readOnlyNote,
        avatarUrl: adapter.viewerAvatar(doc),
        viewerLogin: adapter.viewerLogin?.(doc) ?? null,
        onViewSource: this.isMermaid ? this.viewSource : undefined,
        doc,
        callbacks: {
          revealLine: (line) => { this.close(); adapter.revealSourceLine(this.file, line); },
          openNativeForm: adapter.openNativeForm ? (lines) => adapter.openNativeForm!(this.file, lines) : undefined,
          hostThread: adapter.hostThread ? (id) => adapter.hostThread!(this.file, id) : undefined,
        },
      });
      this.panel = panel;
      loading.replaceWith(panel.el);
      this.shown = panel.el;
      host.classList.add('mdr-hidden');
      // No diff rows (a rename, an empty file, a diff GitHub left collapsed): GitHub takes no line comments here.
      if (diff.rightLineText.size === 0) panel.setDisabled('No changed lines in this diff to comment on.');
      else if (!verifySource(rendered.lines, diff.rightLineText)) panel.setDisabled('File changed. Reload to comment.');
      if (this.revealId) { panel.revealThread(this.revealId); this.revealId = null; }
    } catch (e) {
      if (stale()) return;
      if (!(e instanceof SourceError)) console.warn('[Inkdiff] failed to open rendered view', e);
      if (e instanceof SourceError && e.reason === 'not-found') {
        // No such file at the head commit (deleted, or not readable): leave GitHub's own view.
        this.handBack();
        return;
      }
      this.panel?.destroy();
      this.panel = null;
      host.classList.remove('mdr-hidden');
      this.file.container.classList.add(SOURCE_CLASS);
      const box = this.loadError(e);
      (this.shown ?? loading).replaceWith(box);
      this.shown = box;
    } finally {
      if (!stale()) this.opening = false;
    }
  }

  /** Give the file back to GitHub for good; if its rich-diff button asked, show GitHub's rich diff. */
  private handBack(): void {
    this.gitHubOnly = true;
    const rich = this.fromRich;
    this.close();
    if (!rich) return;
    // Next task: the click that asked may still be dispatching (a nested click() on it is ignored).
    setTimeout(() => {
      this.bypass = true;
      try { this.deps.adapter.richToggle(this.file)?.click(); } finally { this.bypass = false; }
    }, 0);
  }

  close(): void {
    this.fromRich = false;
    this.file.container.classList.add(SOURCE_CLASS);
    this.gen++;
    this.opening = false;
    this.panel?.destroy();
    this.panel = null;
    this.shown?.remove();
    this.shown = null;
    this.deps.adapter.diffBody(this.file)?.classList.remove('mdr-hidden');
  }

  private syncThreads(): void {
    if (!this.panel) return;
    const threads = this.deps.adapter.readThreads(this.file);
    const key = threadKey(threads);
    // Same threads: still sync when GitHub hosts any, as React may have replaced an element we host.
    if (key === this.lastThreads && !this.deps.adapter.hostThread) return;
    this.lastThreads = key;
    this.panel.setThreads(threads);
  }

  private loadError(e: unknown): HTMLElement {
    const { doc, adapter } = this.deps;
    const tooLarge = e instanceof SourceError && e.reason === 'too-large';
    const box = div(doc, 'mdr-panel mdr-load-error', tooLarge ? 'This file is larger than 1 MB.' : 'Could not load the rendered view.');
    if (this.isMermaid) {
      // No rich diff for .mmd: the way out is GitHub's source diff, which close() already shows.
      const source = button(doc, 'mdr-secondary', 'Show source diff');
      source.addEventListener('click', () => { box.remove(); if (this.shown === box) this.shown = null; this.viewSource(); });
      box.append(source);
      return box;
    }
    const fallback = button(doc, 'mdr-secondary', 'Show GitHub rich diff');
    fallback.addEventListener('click', () => {
      box.remove();
      this.bypass = true;
      try { adapter.richToggle(this.file)?.click(); } finally { this.bypass = false; }
    });
    box.append(fallback);
    return box;
  }
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

function extensionVersion(): string {
  try { return chrome.runtime.getManifest().version; } catch { return '?'; }
}
