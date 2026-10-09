import type { LineRange } from '../core/diff-map';

export interface GutterHandle {
  el: HTMLElement;
  layout(): void;
  setSelected(range: LineRange | null): void;
  cells(): HTMLElement[];
  /**
   * The shown cell for a hovered element: a gutter cell itself, a code line, an own-text line of a
   * non-leaf block, else the leaf block holding it. Null when that cell is hidden or there is none.
   */
  cellAt(target: Element): HTMLElement | null;
  /** The source lines a cell covers. */
  cellLines(cell: HTMLElement): LineRange;
  /** The cell covering `line` (the innermost when several do), shown or not; null when none does. */
  cellForLine(line: number): HTMLElement | null;
  /** The shown cell at height `y` (px from `el`'s top) in the last layout, gaps included; null outside. */
  cellAtY(y: number): HTMLElement | null;
  /** The block a comment on this cell belongs to (a code line's pre or Mermaid block, a line's own block). */
  cellAnchor(cell: HTMLElement): HTMLElement;
  /** The cell's top relative to `el`'s top, from the measured layout of its targets; null when hidden. */
  cellTop(cell: HTMLElement, el: HTMLElement): number | null;
}

const EN_DASH = '–';
const targets = new WeakMap<HTMLElement, HTMLElement[]>();

interface Target { els: HTMLElement[]; start: number; end: number }

/** False inside collapsed or hidden content, and for Mermaid source lines hidden behind a rendered diagram. */
export function isShown(el: Element): boolean {
  if (el.closest('.mdr-collapsed, [hidden]')) return false;
  const mermaid = el.closest('.md-mermaid.mdr-mermaid-rendered');
  return !(mermaid && !mermaid.classList.contains('mdr-mermaid-show-source') && el.closest('pre'));
}

function collectTargets(body: HTMLElement): Target[] {
  const out: Target[] = [];
  const all = body.querySelectorAll<HTMLElement>('[data-src-start], pre [data-src-line]');
  for (const el of all) {
    if (el.hasAttribute('data-src-line')) {
      const n = Number(el.dataset.srcLine);
      out.push({ els: [el], start: n, end: n });
      continue;
    }
    if (el.tagName === 'PRE' || el.closest('pre')) continue;
    if (el.querySelector('[data-src-start]')) {
      // A non-leaf block (an item holding a nested list or code): one cell per run of consecutive
      // lines of its own text, covering every inline span stamped with them. Lines wrap in the
      // rendered view, so a cell per line would overlap its neighbours.
      const byLine = new Map<number, HTMLElement[]>();
      for (const span of el.querySelectorAll<HTMLElement>('span[data-src-line]')) {
        if (span.parentElement?.closest('[data-src-start]') !== el || span.closest('pre')) continue;
        const n = Number(span.dataset.srcLine);
        const group = byLine.get(n);
        if (group) group.push(span);
        else byLine.set(n, [span]);
      }
      let run: Target | null = null;
      for (const n of [...byLine.keys()].sort((a, b) => a - b)) {
        if (run && n === run.end + 1) { run.els.push(...byLine.get(n)!); run.end = n; continue; }
        run = { els: [...byLine.get(n)!], start: n, end: n };
        out.push(run);
      }
      continue;
    }
    out.push({ els: [el], start: Number(el.dataset.srcStart), end: Number(el.dataset.srcEnd) });
  }
  return out;
}

/** Union of the targets' rects (min top, max bottom); null when any is hidden. */
function measure(els: HTMLElement[]): { top: number; bottom: number } | null {
  let top = Infinity;
  let bottom = -Infinity;
  for (const target of els) {
    // A Mermaid container's range cell only belongs next to the rendered diagram; its source lines have their own cells.
    const diagramHidden =
      target.classList.contains('md-mermaid') &&
      !(target.classList.contains('mdr-mermaid-rendered') && !target.classList.contains('mdr-mermaid-show-source'));
    if (diagramHidden || !isShown(target)) return null;
    const r = target.getBoundingClientRect();
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.top + r.height);
  }
  return Number.isFinite(top) ? { top, bottom } : null;
}

/** Binary search: the last index in [0, n) where `ok` holds, for `ok` true then false; -1 if none. */
function lastAtOrBefore(n: number, ok: (i: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function createGutter(doc: Document, body: HTMLElement, changed: Set<number>): GutterHandle {
  const el = doc.createElement('div');
  el.className = 'mdr-gutter';
  el.setAttribute('aria-hidden', 'true');
  const list: HTMLElement[] = [];
  /** Every target element → its cell, so a hovered node resolves by walking up to the first target. */
  const cellOf = new Map<Element, HTMLElement>();
  for (const t of collectTargets(body)) {
    const cell = doc.createElement('div');
    cell.className = 'mdr-gutter-cell';
    cell.dataset.label = t.start === t.end ? String(t.start) : `${t.start}${EN_DASH}${t.end}`;
    cell.dataset.start = String(t.start);
    cell.dataset.end = String(t.end);
    for (let n = t.start; n <= t.end; n++) if (changed.has(n)) { cell.classList.add('mdr-gutter-add'); break; }
    targets.set(cell, t.els);
    for (const target of t.els) cellOf.set(target, cell);
    list.push(cell);
    el.append(cell);
  }

  /** Shown cells by top, from the last layout (px from `el`'s top). */
  let laid: { cell: HTMLElement; top: number; bottom: number }[] = [];

  /**
   * Cells form one continuous strip like GitHub's number column: each shown cell runs from its
   * target's top to the next shown cell's top (across block margins), never past a hunk row; the
   * last one ends at its target's bottom.
   */
  function layout() {
    // Read every position first, then write: interleaving would force a reflow per cell.
    const top = body.getBoundingClientRect().top;
    const rects = list.map((cell) => measure(targets.get(cell)!));
    const breaks = [...body.querySelectorAll<HTMLElement>('.mdr-hunk')].filter((h) => isShown(h)).map((h) => h.getBoundingClientRect().top);
    let next: number | null = null;
    const bottoms: number[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (!r) continue;
      let bottom = next !== null && next > r.top ? next : r.bottom;
      for (const b of breaks) if (b > r.top && b < bottom) bottom = Math.max(b, r.top);
      bottoms[i] = bottom;
      next = r.top;
    }
    laid = [];
    list.forEach((cell, i) => {
      const r = rects[i];
      cell.hidden = r === null;
      if (!r) return;
      cell.style.top = `${Math.round(r.top - top)}px`;
      cell.style.height = `${Math.round(bottoms[i]) - Math.round(r.top)}px`;
      laid.push({ cell, top: r.top - top, bottom: bottoms[i] - top });
    });
    laid.sort((a, b) => a.top - b.top);
  }

  function setSelected(range: LineRange | null) {
    for (const cell of list) {
      const on = range !== null && Number(cell.dataset.start) <= range.end && range.start <= Number(cell.dataset.end);
      cell.classList.toggle('mdr-gutter-selected', on);
    }
  }

  function cellAt(target: Element): HTMLElement | null {
    let cell: HTMLElement | undefined;
    if (el.contains(target)) cell = target.closest<HTMLElement>('.mdr-gutter-cell') ?? undefined;
    else for (let n: Element | null = target; n && !cell && body.contains(n); n = n.parentElement) cell = cellOf.get(n);
    return cell && measure(targets.get(cell)!) ? cell : null;
  }

  const cellLines = (cell: HTMLElement): LineRange => ({ start: Number(cell.dataset.start), end: Number(cell.dataset.end) });

  function cellAnchor(cell: HTMLElement): HTMLElement {
    const first = targets.get(cell)![0];
    return first.hasAttribute('data-src-start') ? first : first.parentElement!.closest<HTMLElement>('[data-src-start]')!;
  }

  function cellTop(cell: HTMLElement, from: HTMLElement): number | null {
    const r = measure(targets.get(cell)!);
    return r ? r.top - from.getBoundingClientRect().top : null;
  }

  // Cells sorted by start, with the largest end so far: a binary search finds the last cell that
  // starts at or before a line, then steps back only while an earlier cell can still reach it.
  const byStart = list.map((cell) => ({ cell, start: Number(cell.dataset.start), end: Number(cell.dataset.end) })).sort((a, b) => a.start - b.start || b.end - a.end);
  const maxEnd: number[] = [];
  byStart.forEach((c, i) => { maxEnd[i] = Math.max(c.end, i > 0 ? maxEnd[i - 1] : -Infinity); });
  function cellForLine(line: number): HTMLElement | null {
    let i = lastAtOrBefore(byStart.length, (k) => byStart[k].start <= line);
    for (; i >= 0 && maxEnd[i] >= line; i--) if (byStart[i].end >= line) return byStart[i].cell;
    return null;
  }

  function cellAtY(y: number): HTMLElement | null {
    const i = lastAtOrBefore(laid.length, (k) => laid[k].top <= y);
    return i >= 0 && y < laid[i].bottom ? laid[i].cell : null;
  }

  return { el, layout, setSelected, cells: () => list, cellAt, cellLines, cellForLine, cellAtY, cellAnchor, cellTop };
}
