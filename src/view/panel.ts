import { getProviders, type DraftContext } from '../core/comment-draft';
import { anchorThreads, type DiffInfo, type LineRange } from '../core/diff-map';
import type { Hunk } from '../core/hunks';
import { rangeToLines } from '../core/selection';
import type { HostedBox, NativeForm, ThreadInfo } from '../github/types';
import type { Block } from '../render/render';
import { findBlockEl, inOwnUi, insertAtLine, insertRemoved, insertUnseenLines, isAllChanged, markChanged } from './blocks';
import { createCommentForm } from './comment-form';
import { button, div } from './dom';
import { createGutter, type GutterHandle } from './gutter';
import { NOOP_HUNKS, setupHunks, threadLines, warnNoHunks, type HunksHandle } from './hunks-view';
import { setupMermaid } from './mermaid';
import { renderPostingThread, renderThread } from './threads';

export interface PanelCallbacks {
  revealLine(line: number): void;
  /** Open GitHub's own comment form for hosting; absent or null → our replica form. */
  openNativeForm?(lines: LineRange): Promise<NativeForm | null>;
  /** GitHub's own element for a posted thread, to show instead of our card; absent or null → our card. */
  hostThread?(threadId: string): HostedBox | null;
}

export interface PanelOptions {
  html: string;
  blocks: Block[];
  diff: DiffInfo;
  threads: ThreadInfo[];
  context: Omit<DraftContext, 'lines' | 'selectedText'>;
  autoMermaid: boolean;
  /** Number of source lines; used to detect an all-new file. */
  lineCount?: number;
  callbacks: PanelCallbacks;
  doc?: Document;
  storage?: Storage;
  /** GitHub's hunk headers for this file. Default []. */
  hunks?: Hunk[];
  /** Collapse blocks outside GitHub's hunks. Default false (whole file). */
  showOnlyChanged?: boolean;
  /** When non-null the panel is read-only: no `+`, selection button or composer; the note shows in the toolbar. */
  readOnlyNote?: string | null;
  /** The viewer's avatar for the comment form header. */
  avatarUrl?: string | null;
  /** The viewer's login, for a comment shown while it posts. */
  viewerLogin?: string | null;
  /** When set, the toolbar offers "View source" (for files GitHub has no rich toggle for). */
  onViewSource?: () => void;
}

export interface PanelHandle {
  el: HTMLElement;
  gutter: GutterHandle;
  setThreads(threads: ThreadInfo[]): void;
  /** Open a thread, scroll it into view and flash it; false when it is not shown. */
  revealThread(threadId: string): boolean;
  setDisabled(message: string | null): void;
  destroy(): void;
}

/** Characters that reorder text on screen (GitHub warns about them too). */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

/** How long a click waits to tell a single click from a double click. */
const DOUBLE_CLICK_MS = 250;
/** The longest a posted comment's stand-in card waits for GitHub's thread. */
const POSTING_MAX_MS = 30_000;

export function createPanel(o: PanelOptions): PanelHandle {
  const doc = o.doc ?? document;
  const el = div(doc, 'mdr-panel');
  const banner = div(doc, 'mdr-banner');
  banner.hidden = true;
  const body = div(doc, 'markdown-body mdr-body');
  body.innerHTML = o.html;
  const toolbar = div(doc, 'mdr-toolbar');
  toolbar.hidden = true;
  const readOnly = o.readOnlyNote != null;
  if (readOnly) {
    const note = doc.createElement('span');
    note.className = 'mdr-readonly';
    note.textContent = o.readOnlyNote!;
    toolbar.append(note);
    toolbar.hidden = false;
  }
  if (o.onViewSource) {
    const viewSource = button(doc, 'mdr-view-source', 'View source');
    viewSource.addEventListener('click', () => o.onViewSource!());
    toolbar.append(viewSource);
    toolbar.hidden = false;
  }
  const wrap = div(doc, 'mdr-wrap');
  el.append(banner, toolbar, wrap);

  const allChanged = isAllChanged(o.diff.changedLines, o.lineCount);
  if (!allChanged) markChanged(body, o.diff.changedLines);
  // A new file: every hidden part is new, so all of it shows (content.css).
  body.classList.toggle('mdr-all-changed', allChanged);
  const sourceLines = o.context.source.replace(/\r\n?/g, '\n').split('\n');
  const changedForUnseen = allChanged ? sourceLines.map((_, i) => i + 1) : o.diff.changedLines;
  insertUnseenLines(doc, body, o.blocks, changedForUnseen, sourceLines);
  if (BIDI.test(o.context.source)) {
    const warn = div(doc, 'mdr-bidi', 'This file contains bidirectional Unicode text, which can make text show in a different order than it is read. Check the source view.');
    warn.setAttribute('role', 'note');
    el.insertBefore(warn, wrap);
  }
  for (const run of o.diff.removed) insertRemoved(doc, body, run, o.callbacks.revealLine);
  setupMermaid(body, o.autoMermaid);

  const gutter = createGutter(doc, body, new Set(allChanged ? [] : o.diff.changedLines));
  wrap.append(gutter.el, body);
  let layoutQueued = false;
  const relayout = () => {
    if (layoutQueued || !body.isConnected) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; gutter.layout(); });
  };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null;
  resizeObserver?.observe(body);

  let disabled = false;
  const offsetTop = (target: HTMLElement) => target.getBoundingClientRect().top - el.getBoundingClientRect().top;

  const add = button(doc, 'mdr-add', '+', 'Comment on these lines');
  add.hidden = true;
  /** The gutter cell the `+` stands for: its range and anchor are exactly that cell's. */
  let hovered: HTMLElement | null = null;
  const setHovered = (cell: HTMLElement | null) => {
    hovered?.classList.remove('mdr-gutter-hover');
    hovered = cell;
    cell?.classList.add('mdr-gutter-hover');
  };
  const hideAdd = () => { setHovered(null); add.hidden = true; };
  /**
   * The `+` follows the line under the pointer anywhere on that line's row: its text, a list
   * number, the gaps, the gutter, the space to the right, the `+` itself. It hides only over our
   * own controls (hunk expand bars, threads, forms), so it never covers one.
   */
  const onHover = (e: Event) => {
    if (readOnly || disabled) return;
    const target = e.target as Element;
    if (target === add || add.contains(target)) return;
    if (inOwnUi(target)) { hideAdd(); return; }
    const y = e instanceof MouseEvent ? e.clientY - gutter.el.getBoundingClientRect().top : NaN;
    const direct = body.contains(target) || gutter.el.contains(target) ? gutter.cellAt(target) : null;
    const cell = direct ?? (Number.isFinite(y) ? gutter.cellAtY(y) : null);
    const top = cell ? gutter.cellTop(cell, el) : null;
    if (!cell || top === null) { hideAdd(); return; }
    setHovered(cell);
    if (drag) { drag.to = cell; gutter.setSelected(dragRange(drag)); }
    add.hidden = false;
    add.style.top = `${top}px`;
    const { start, end } = gutter.cellLines(cell);
    add.setAttribute('aria-label', start === end ? `Comment on line ${start}` : `Comment on lines ${start} to ${end}`);
  };
  // mouseover reacts at once; mousemove (one update per frame) follows the pointer inside one element.
  let moveFrame = 0;
  let lastMove: MouseEvent | null = null;
  const onMove = (e: MouseEvent) => {
    lastMove = e;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => { moveFrame = 0; if (lastMove) onHover(lastMove); });
  };
  wrap.addEventListener('mouseover', onHover);
  wrap.addEventListener('mousemove', onMove);
  el.addEventListener('mouseleave', () => { if (!drag) hideAdd(); });

  /**
   * A plain click on a line's content comments on it, like pressing the `+`: not on links, buttons,
   * inputs or other controls, not after a drag or a text selection, not while a comment is open,
   * and not on a double click (which selects a word).
   */
  const INTERACTIVE = 'a, button, input, textarea, select, label, summary, video, audio, [role="button"], [tabindex], [contenteditable]';
  let pressAt: { x: number; y: number } | null = null;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  body.addEventListener('mousedown', (e) => { pressAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
  body.addEventListener('click', (e) => {
    clearTimeout(clickTimer);
    const target = e.target as Element;
    const moved = !pressAt || Math.abs(e.clientX - pressAt.x) > 4 || Math.abs(e.clientY - pressAt.y) > 4;
    if (readOnly || disabled || e.button !== 0 || e.detail > 1 || moved || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (inOwnUi(target) || target.closest(INTERACTIVE) || composer || native || nativeNote) return;
    if (!(doc.getSelection()?.isCollapsed ?? true)) return;
    const cell = hovered;
    if (!cell) return;
    // Wait out a double click; a selection made meanwhile also cancels.
    clickTimer = setTimeout(() => {
      if (hovered !== cell || composer || native || nativeNote || !(doc.getSelection()?.isCollapsed ?? true)) return;
      openComposer(gutter.cellAnchor(cell), gutter.cellLines(cell));
    }, DOUBLE_CLICK_MS);
  });
  body.addEventListener('dblclick', () => clearTimeout(clickTimer));

  /**
   * A press on a line number or the `+` starts a range; moving over other lines grows it, and the
   * release opens the composer for it. With Shift, the press grows the open comment's range instead.
   */
  let drag: { from: HTMLElement; to: HTMLElement; base: LineRange | null } | null = null;
  function dragRange(d: { from: HTMLElement; to: HTMLElement; base: LineRange | null }): LineRange {
    const ranges = [gutter.cellLines(d.from), gutter.cellLines(d.to), ...(d.base ? [d.base] : [])];
    return { start: Math.min(...ranges.map((r) => r.start)), end: Math.max(...ranges.map((r) => r.end)) };
  }
  function startDrag(cell: HTMLElement | null, e: MouseEvent) {
    if (readOnly || disabled || !cell || e.button !== 0) return;
    // No text selection while dragging over the gutter and body.
    e.preventDefault();
    drag = { from: cell, to: cell, base: e.shiftKey ? openLines : null };
    gutter.setSelected(dragRange(drag));
    doc.addEventListener('mouseup', endDrag, { once: true });
  }
  function endDrag() {
    const d = drag;
    drag = null;
    if (!d || destroyed) return;
    const range = dragRange(d);
    // The composer goes after the lowest line of the range.
    const last = gutter.cellLines(d.to).end >= gutter.cellLines(d.from).end ? d.to : d.from;
    const anchor = d.base && d.base.end > gutter.cellLines(last).end && openAnchor ? openAnchor : gutter.cellAnchor(last);
    openComposer(anchor, range);
  }
  gutter.el.addEventListener('mousedown', (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.mdr-gutter-cell') : null;
    startDrag(target && gutter.cellAt(target), e);
  });
  add.addEventListener('mousedown', (e) => startDrag(hovered, e));
  // Keyboard activation (a mouse press already opened the composer on release).
  add.addEventListener('click', (e) => { if (e.detail === 0 && hovered) openComposer(gutter.cellAnchor(hovered), gutter.cellLines(hovered)); });

  const select = button(doc, 'mdr-select', 'Comment', 'Comment on selection');
  select.hidden = true;
  let pending: { lines: LineRange; text: string; anchor: HTMLElement } | null = null;
  body.addEventListener('mouseup', () => {
    select.hidden = true;
    pending = null;
    const sel = doc.getSelection();
    if (readOnly || disabled || !sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (inOwnUi(r.startContainer) || inOwnUi(r.endContainer)) return;
    const lines = rangeToLines(r, body);
    const endEl = r.endContainer.nodeType === Node.ELEMENT_NODE ? (r.endContainer as Element) : r.endContainer.parentElement;
    const anchor = endEl?.closest<HTMLElement>('[data-src-start]');
    if (!lines || !anchor) return;
    pending = { lines, text: r.toString(), anchor };
    select.hidden = false;
    select.style.top = `${offsetTop(anchor) + anchor.offsetHeight}px`;
  });
  select.addEventListener('click', () => {
    if (pending) openComposer(pending.anchor, pending.lines, pending.text);
    select.hidden = true;
  });
  el.append(add, select);

  let composer: HTMLElement | null = null;
  /** Our UI around GitHub's form: hosting it, waiting for it, or waiting for its post to settle. */
  let native: { form: NativeForm; host: HTMLElement; tools: HTMLElement; stopWatch: () => void } | null = null;
  let nativeNote: HTMLElement | null = null;
  /** Bumped on every open/close, so a native form that arrives late is ignored. */
  let composeSeq = 0;
  let destroyed = false;
  function clearSelection() {
    gutter.setSelected(null);
    body.querySelectorAll('.mdr-selected').forEach((n) => n.classList.remove('mdr-selected'));
  }
  function highlight(lines: LineRange) {
    clearSelection();
    gutter.setSelected(lines);
    for (const n of body.querySelectorAll<HTMLElement>('[data-src-start]')) {
      if (n.querySelector('[data-src-start]')) continue;
      if (Number(n.dataset.srcStart) <= lines.end && lines.start <= Number(n.dataset.srcEnd)) n.classList.add('mdr-selected');
    }
  }
  /** The range and anchor of the open composer, for Shift-click to grow. */
  let openLines: LineRange | null = null;
  let openAnchor: HTMLElement | null = null;
  function closeComposer() {
    openLines = null;
    openAnchor = null;
    composeSeq++;
    composer?.remove();
    composer = null;
    unhostNative();
    nativeNote?.remove();
    nativeNote = null;
    clearSelection();
  }
  /** Put GitHub's box back (before anything else; GitHub keeps its own draft) and drop our host. */
  function unhostNative() {
    if (!native) return;
    native.stopWatch();
    native.form.restore();
    native.host.remove();
    native.tools.remove();
    native = null;
  }
  function showNote(className: string, text: string, place: { anchor: HTMLElement; line: number } | HTMLElement) {
    nativeNote?.remove();
    nativeNote = div(doc, className, text);
    if (place instanceof HTMLElement) place.before(nativeNote);
    else insertAtLine(place.anchor, place.line, nativeNote);
  }
  function openComposer(anchor: HTMLElement, lines: LineRange, selectedText?: string) {
    if (readOnly) return;
    closeComposer();
    openLines = lines;
    openAnchor = anchor;
    const context: DraftContext = { ...o.context, lines, selectedText };
    const opener = o.callbacks.openNativeForm;
    if (!opener) { openReplica(anchor, lines, context); return; }
    const seq = composeSeq;
    highlight(lines);
    showNote('mdr-native-pending', "Opening GitHub's comment form…", { anchor, line: lines.end });
    relayout();
    void opener(lines).catch((e: unknown) => { console.warn("[Inkdiff] could not open GitHub's comment form", e); return null; }).then((form) => {
      if (seq !== composeSeq || destroyed || disabled) return;
      nativeNote?.remove();
      nativeNote = null;
      if (form) hostNative(anchor, lines, context, form);
      else openReplica(anchor, lines, context);
    });
  }
  function hostNative(anchor: HTMLElement, lines: LineRange, context: DraftContext, form: NativeForm, before?: HTMLElement) {
    const tools = div(doc, 'mdr-native-tools');
    for (const p of getProviders()) {
      const b = button(doc, 'mdr-provider', p.label);
      b.dataset.provider = p.id;
      b.addEventListener('click', async () => {
        form.fill(await p.draft(context));
        form.focus();
      });
      tools.append(b);
    }
    const host = div(doc, 'mdr-native-host');
    // Capture phase: runs before GitHub's handlers, which need the box back where GitHub rendered it.
    const onEvent = (e: Event) => {
      const action = form.actionOf(e);
      if (action === 'cancel') { closeComposer(); relayout(); }
      else if (action === 'submit') submitted(anchor, lines, context, form);
    };
    host.addEventListener('click', onEvent, true);
    host.addEventListener('keydown', onEvent, true);
    if (before) { before.before(tools); before.remove(); }
    else insertAtLine(anchor, lines.end, tools);
    tools.after(host);
    host.append(form.box);
    const stopWatch = form.watch(() => { if (native?.form === form) { closeComposer(); relayout(); } });
    native = { form, host, tools, stopWatch };
    highlight(lines);
    form.focus();
    relayout();
  }
  /** A comment GitHub is posting: our stand-in card, replaced in place by the real thread. */
  let posting: { lines: LineRange; node: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  function clearPosting() {
    if (!posting) return;
    clearTimeout(posting.timer);
    posting.node.remove();
    posting = null;
  }
  /**
   * GitHub is handling a submit: show the comment at once, as it will look, until GitHub's form
   * goes (posted: the real thread replaces the card) or stays (an error: host the form again).
   */
  function submitted(anchor: HTMLElement, lines: LineRange, context: DraftContext, form: NativeForm) {
    clearPosting();
    const card = renderPostingThread(doc, lines, { author: o.viewerLogin ?? 'You', avatarUrl: o.avatarUrl, text: form.text() });
    native?.tools.before(card);
    unhostNative();
    posting = { lines, node: card, timer: setTimeout(() => { if (posting?.node === card) { clearPosting(); relayout(); } }, POSTING_MAX_MS) };
    const seq = composeSeq;
    relayout();
    void form.settle().then((result) => {
      if (seq !== composeSeq || destroyed || disabled) return;
      if (result === 'kept') {
        // Not posted: the form comes back where the card is.
        if (posting?.node === card) { clearTimeout(posting.timer); posting = null; }
        if (card.isConnected) hostNative(anchor, lines, context, form, card);
        else hostNative(anchor, lines, context, form);
        return;
      }
      closeComposer();
      relayout();
    });
  }
  function openReplica(anchor: HTMLElement, lines: LineRange, context: DraftContext) {
    const c = createCommentForm({
      doc,
      context,
      revealLine: o.callbacks.revealLine,
      onClose: () => { closeComposer(); relayout(); },
      storage: o.storage,
      avatarUrl: o.avatarUrl,
    });
    insertAtLine(anchor, lines.end, c);
    composer = c;
    highlight(lines);
    c.querySelector('textarea')?.focus();
    relayout();
  }

  /** Each shown thread: GitHub's own element when it can be hosted, else our card. */
  const shownThreads = new Map<string, { node: HTMLElement; key: string; hosted: HostedBox | null }>();
  let hunksView: HunksHandle = NOOP_HUNKS;
  /** Where a thread goes: under its last line, exactly where its comment form was. */
  function threadAnchor(t: ThreadInfo, anchors: Map<string, Block | null>): HTMLElement | null {
    const cell = gutter.cellForLine(t.endLine);
    if (cell) return gutter.cellAnchor(cell);
    const block = anchors.get(t.id);
    return block ? findBlockEl(body, block) : null;
  }
  function dropThread(id: string) {
    const s = shownThreads.get(id);
    if (!s) return;
    // GitHub's element goes home first: once our wrapper is gone it is detached and cannot.
    s.hosted?.restore();
    s.node.remove();
    shownThreads.delete(id);
  }
  /**
   * Show threads without moving the ones already shown: GitHub's hosted element stays put (its
   * open editors keep focus and text), and a card is redrawn only when its thread changed.
   */
  function setThreads(threads: ThreadInfo[]) {
    hunksView.force(threadLines(o.blocks, threads));
    const anchors = anchorThreads(o.blocks, threads);
    const ids = new Set(threads.map((t) => t.id));
    for (const id of [...shownThreads.keys()]) if (!ids.has(id)) dropThread(id);
    for (const t of threads) {
      const key = JSON.stringify(t);
      const was = shownThreads.get(t.id);
      const hosted = o.callbacks.hostThread?.(t.id) ?? null;
      if (was && hosted && was.hosted?.box === hosted.box && was.node.contains(hosted.box)) continue;
      if (was && !hosted && !was.hosted && was.key === key) continue;
      let node: HTMLElement;
      if (hosted) {
        node = div(doc, 'mdr-gh-thread');
        node.append(hosted.box);
      } else {
        node = renderThread(doc, t, o.callbacks);
      }
      node.dataset.threadId = t.id;
      if (was) {
        if (was.hosted && was.hosted.box !== hosted?.box) was.hosted.restore();
        was.node.replaceWith(node);
      } else if (posting && posting.lines.start === t.startLine && posting.lines.end === t.endLine) {
        posting.node.replaceWith(node);
        clearPosting();
      } else {
        const anchor = threadAnchor(t, anchors);
        if (anchor) insertAtLine(anchor, t.endLine, node);
        else body.prepend(node);
      }
      shownThreads.set(t.id, { node, key, hosted });
    }
    relayout();
  }
  setThreads(o.threads);
  if (o.showOnlyChanged && !allChanged && o.diff.rightLineText.size > 0) {
    // rows but no hunk headers means we cannot tell hunks apart; show everything.
    if ((o.hunks ?? []).length === 0) warnNoHunks(doc);
    else hunksView = setupHunks(doc, body, toolbar, o.blocks, new Set(o.diff.rightLineText.keys()), threadLines(o.blocks, o.threads), o.hunks ?? [], relayout);
  }
  relayout();

  return {
    el,
    gutter,
    setThreads,
    revealThread(id) {
      const t = shownThreads.get(id)?.node;
      if (!t) return false;
      if (t instanceof HTMLDetailsElement) t.open = true;
      t.scrollIntoView({ block: 'center' });
      t.classList.remove('mdr-flash');
      void t.offsetWidth; // restart the animation
      t.classList.add('mdr-flash');
      relayout();
      return true;
    },
    setDisabled(msg) {
      disabled = msg !== null;
      banner.hidden = !disabled;
      banner.textContent = msg ?? '';
      el.classList.toggle('mdr-disabled', disabled);
      if (disabled) { add.hidden = true; select.hidden = true; setHovered(null); closeComposer(); relayout(); }
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener('mouseup', endDrag);
      clearTimeout(clickTimer);
      cancelAnimationFrame(moveFrame);
      closeComposer();
      clearPosting();
      // GitHub's threads go back into its diff before our panel goes.
      for (const id of [...shownThreads.keys()]) dropThread(id);
      resizeObserver?.disconnect();
      el.remove();
    },
  };
}
