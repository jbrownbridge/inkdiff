import type { LineRange } from '../core/diff-map';
import { waitFor } from '../core/wait';
import { findRightLineRow } from './read';
import { S } from './selectors';
import type { MdFile, NativeAction, NativeForm } from './types';

/** Total time to wait for GitHub to render the Add comment button and then the form. */
const WAIT_MS = 3000;
/** After a submit: how long GitHub gets to remove the form before we call it kept (unless still busy). */
const SETTLE_MS = 2000;
/** After a submit: the longest we wait for a busy submit button. */
const SETTLE_MAX_MS = 20_000;
/** Hover events on the row, then on its right code cell: live GitHub needs the cell hovered. */
const ROW_EVENTS = ['pointerover', 'mouseover', 'mouseenter', 'mousemove'] as const;
const CELL_EVENTS = ['pointerover', 'mouseover', 'mousemove'] as const;

function dispatchHover(el: Element, types: readonly string[]): void {
  const Pointer = el.ownerDocument.defaultView?.PointerEvent;
  for (const type of types) {
    const init = { bubbles: true, cancelable: true };
    el.dispatchEvent(type === 'pointerover' && Pointer ? new Pointer(type, init) : new MouseEvent(type, init));
  }
}

function hover(row: HTMLElement): void {
  dispatchHover(row, ROW_EVENTS);
  const cell = row.querySelector(S.rightCodeCell);
  if (cell) dispatchHover(cell, CELL_EVENTS);
}

function clickCell(cell: Element, shiftKey: boolean): void {
  for (const type of ['mousedown', 'mouseup', 'click'])
    cell.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, shiftKey }));
}

/** Open inline comment forms in this file (a marker with a textarea). */
function openForms(file: MdFile): HTMLElement[] {
  return [...file.container.querySelectorAll<HTMLElement>(S.newCommentMarker)].filter((m) => m.querySelector(S.newCommentTextarea));
}

/** Whether the form's heading names exactly these right-side lines. */
function headingMatches(marker: Element, lines: LineRange): boolean {
  const text = marker.querySelector(S.newCommentHeading)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const want = lines.start === lines.end ? `line R${lines.start}` : `lines R${lines.start} to R${lines.end}`;
  return new RegExp(`\\b${want}(?!\\d)`).test(text);
}

function cancelButton(marker: Element): HTMLButtonElement | null {
  return [...marker.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === S.newCommentCancel) ?? null;
}

const label = (b: Element) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const inactive = (b: HTMLButtonElement) => b.disabled || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('aria-busy') === 'true';

/** Set a React-controlled textarea's value so React's onChange sees it. */
function setReactValue(ta: HTMLTextAreaElement, text: string): void {
  const proto = ta.ownerDocument.defaultView?.HTMLTextAreaElement.prototype ?? HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function hold(file: MdFile, marker: HTMLElement): NativeForm | null {
  const box = marker.parentElement;
  const parent = box?.parentElement;
  if (!box || !parent) return null;
  const home: HTMLElement = box;
  const next = box.nextSibling;
  const textarea = () => marker.querySelector<HTMLTextAreaElement>(S.newCommentTextarea);
  const buttons = () => [...box.querySelectorAll<HTMLButtonElement>('button')];
  const alive = () => marker.isConnected && box.contains(marker) && parent.isConnected && textarea() !== null;
  /** The button a submit was sent with: busy while GitHub posts. */
  let sentWith: HTMLButtonElement | null = null;
  const primary = () => {
    for (const want of S.newCommentSubmitLabels) {
      const b = buttons().find((x) => label(x) === want);
      if (b) return b;
    }
    return null;
  };

  /** Observe the file (GitHub's side) and the box (wherever it is) for removals and button state. */
  function observe(cb: () => void, attributes: boolean): () => void {
    const mo = new MutationObserver(cb);
    const opts: MutationObserverInit = attributes
      ? { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-busy'] }
      : { childList: true, subtree: true };
    mo.observe(file.container, opts);
    if (!file.container.contains(box)) mo.observe(home, opts);
    return () => mo.disconnect();
  }

  return {
    box,
    restore() {
      if (box.parentElement === parent || !parent.isConnected) return;
      parent.insertBefore(box, next?.parentNode === parent ? next : null);
    },
    text() {
      return textarea()?.value ?? '';
    },
    fill(text) {
      const ta = textarea();
      if (ta) setReactValue(ta, text);
    },
    focus() {
      textarea()?.focus();
    },
    actionOf(e): NativeAction | null {
      const t = e.target;
      const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
      if (!el || !box.contains(el)) return null;
      if (e.type === 'click') {
        const b = el.closest('button');
        if (!b || !box.contains(b) || inactive(b)) return null;
        const text = label(b);
        if (text === S.newCommentCancel) return 'cancel';
        if ((S.newCommentSubmitLabels as readonly string[]).includes(text)) { sentWith = b; return 'submit'; }
        return null;
      }
      if (e.type === 'keydown' && e instanceof KeyboardEvent) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && el.closest('textarea')) { sentWith = primary(); return 'submit'; }
        if (e.key === 'Escape' && !e.defaultPrevented && !box.querySelector(S.suggester)) return 'cancel';
      }
      return null;
    },
    watch(onGone) {
      let stopped = false;
      const stop = observe(() => {
        if (stopped || alive()) return;
        stopped = true;
        stop();
        onGone();
      }, false);
      return () => { stopped = true; stop(); };
    },
    settle() {
      return new Promise((resolve) => {
        let seenBusy = false;
        let waited = false;
        const busy = () => sentWith !== null && inactive(sentWith);
        const check = () => {
          if (!alive()) return finish('gone');
          if (busy()) seenBusy = true;
          else if (seenBusy || waited) finish('kept');
        };
        const stop = observe(check, true);
        const short = setTimeout(() => { waited = true; check(); }, SETTLE_MS);
        const long = setTimeout(() => finish(alive() ? 'kept' : 'gone'), SETTLE_MAX_MS);
        let done = false;
        function finish(r: 'gone' | 'kept') {
          if (done) return;
          done = true;
          stop();
          clearTimeout(short);
          clearTimeout(long);
          sentWith = null;
          resolve(r);
        }
        check();
      });
    },
  };
}

/**
 * The part of `lines` GitHub can comment on: from the first to the last line with a right-side diff
 * row (a shown block can reach beyond the diff). Null when none of its lines is in the diff.
 */
function clampToDiff(file: MdFile, lines: LineRange): LineRange | null {
  let start = lines.start;
  while (start <= lines.end && !findRightLineRow(file, start)) start++;
  if (start > lines.end) return null;
  let end = lines.end;
  while (end > start && !findRightLineRow(file, end)) end--;
  return { start, end };
}

/**
 * Opens GitHub's own inline comment form for `lines` (right side) in the hidden source diff, the
 * way a reviewer would: select the range on the line numbers, hover the last row, click its Add
 * comment button. Never clicks Comment / Start a review. The range is clamped to its lines in
 * the diff; null when none is in it, GitHub does not respond in time, or the form it opens is for other lines (that one is cancelled).
 */
export function openNativeForm(file: MdFile, wanted: LineRange): Promise<NativeForm | null> {
  // One open at a time: a second open's new form would otherwise look like the first's (and be cancelled).
  const run = queue.then(() => openNow(file, wanted));
  queue = run.catch((e: unknown) => { console.warn("[Inkdiff] opening GitHub's comment form failed", e); return null; });
  return run;
}

let queue: Promise<unknown> = Promise.resolve();

async function openNow(file: MdFile, wanted: LineRange): Promise<NativeForm | null> {
  const lines = clampToDiff(file, wanted);
  if (!lines) return null;
  const existing = openForms(file).find((m) => headingMatches(m, lines));
  if (existing) return hold(file, existing);

  const endRow = findRightLineRow(file, lines.end);
  const startRow = lines.start < lines.end ? findRightLineRow(file, lines.start) : endRow;
  if (!endRow || !startRow) return null;
  if (lines.start < lines.end) {
    const from = startRow.querySelector(S.rightNumberCell);
    const to = endRow.querySelector(S.rightNumberCell);
    if (!from || !to) return null;
    clickCell(from, false);
    clickCell(to, true);
  } else {
    // A plain click on the line's number resets any earlier range selection.
    const cell = endRow.querySelector(S.rightNumberCell);
    if (cell) clickCell(cell, false);
  }

  const deadline = Date.now() + WAIT_MS;
  const left = () => Math.max(0, deadline - Date.now());
  const before = new Set(openForms(file));
  hover(endRow);
  let marker: HTMLElement;
  try {
    const add = await waitFor(() => endRow.querySelector<HTMLButtonElement>(S.addCommentButton), left(), file.container);
    add.click();
    marker = await waitFor(() => openForms(file).find((m) => !before.has(m)), left(), file.container);
  } catch (e) {
    // Selectors that stop matching show up here first: say so, then fall back.
    console.warn("[Inkdiff] GitHub's comment form did not open", e);
    return null;
  }
  if (!headingMatches(marker, lines)) {
    cancelButton(marker)?.click();
    return null;
  }
  return hold(file, marker);
}
