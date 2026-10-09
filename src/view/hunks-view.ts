// "Show changes only": blocks outside GitHub's hunks collapse into gap rows with expanders.
import { anchorThreads } from '../core/diff-map';
import { expandersFor, findGaps, headerAtStart, headerForGap, initialShown, leafRanges, revealIndexes, type Expander, type Hunk } from '../core/hunks';
import type { ThreadInfo } from '../github/types';
import type { Block } from '../render/render';
import { afterOwnUi, blockIndex, rowAnchor } from './blocks';
import { button, div } from './dom';

const EXPAND_LABEL: Record<Expander, [string, string]> = { up: ['⇡', 'Expand up'], down: ['⇣', 'Expand down'], all: ['↕', 'Expand all'] };

export interface HunksHandle {
  /** Show the leaves holding these lines (blocks with a review thread are always visible). */
  force(lines: number[]): void;
}

/** One line per anchored thread: the leaf of its anchor block that holds its last line, else the block's last leaf. */
export function threadLines(blocks: Block[], threads: ThreadInfo[]): number[] {
  const leaves = leafRanges(blocks);
  const anchors = anchorThreads(blocks, threads);
  return threads.flatMap((t) => {
    const b = anchors.get(t.id);
    if (!b) return [];
    const inner = leaves.filter((l) => b.start <= l.start && l.end <= b.end);
    const hit = inner.find((l) => l.start <= t.endLine && t.endLine <= l.end) ?? inner[inner.length - 1];
    return [hit ? hit.start : b.start];
  });
}

/** A gap row that is valid where it goes: an item in a list, a row in a table, else a div. */
function hunkRow(doc: Document, parent: Element | null): { row: HTMLElement; content: HTMLElement } {
  const tag = parent?.tagName;
  if (tag === 'UL' || tag === 'OL') {
    const row = doc.createElement('li');
    row.className = 'mdr-hunk';
    row.setAttribute('role', 'presentation');
    return { row, content: row };
  }
  if (tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT' || tag === 'TABLE') {
    const row = doc.createElement('tr');
    row.className = 'mdr-hunk';
    const td = doc.createElement('td');
    td.colSpan = 99;
    td.className = 'mdr-hunk-cell';
    row.append(td);
    return { row, content: td };
  }
  const row = div(doc, 'mdr-hunk');
  return { row, content: row };
}

export const NOOP_HUNKS: HunksHandle = { force() {} };

/** Documents that already logged the missing-hunks warning (one per page). */
const warnedNoHunks = new WeakSet<Document>();

export function warnNoHunks(doc: Document): void {
  if (warnedNoHunks.has(doc)) return;
  warnedNoHunks.add(doc);
  console.warn('[Inkdiff] hunk headers not found; showing the whole file.');
}

function headerSpan(doc: Document, text: string): HTMLElement {
  const h = doc.createElement('span');
  h.className = 'mdr-hunk-header';
  h.textContent = text;
  return h;
}

export function setupHunks(doc: Document, body: HTMLElement, toolbar: HTMLElement, blocks: Block[], visible: Set<number>, forced: number[], hunks: Hunk[], relayout: () => void): HunksHandle {
  const leaves = leafRanges(blocks);
  const index = blockIndex(body);
  const leafEls = leaves.map((l) => index.get(`${l.start}:${l.end}`) ?? null);
  const leafSet = new Set(leafEls.filter((el): el is HTMLElement => el !== null));
  const initial = initialShown(leaves, visible, []);
  const shown = initialShown(leaves, visible, forced);
  if (shown.every(Boolean)) return NOOP_HUNKS;
  let whole = false;
  /** List items we numbered, so whole-file mode can clear exactly those. */
  const numbered = new Set<HTMLLIElement>();

  function renumber() {
    numbered.forEach((li) => li.removeAttribute('value'));
    numbered.clear();
    if (whole) return;
    // A collapsed item (display:none) stops the list counter and a gap row (an li) advances it:
    // pin each visible item's own number.
    for (const ol of body.querySelectorAll<HTMLOListElement>('ol')) {
      const lis = [...ol.children].filter((c): c is HTMLLIElement => c instanceof HTMLLIElement);
      const items = lis.filter((li) => !li.classList.contains('mdr-hunk'));
      if (items.length === lis.length && !items.some((li) => li.classList.contains('mdr-collapsed'))) continue;
      const first = ol.hasAttribute('start') ? ol.start : 1;
      items.forEach((li, i) => {
        if (li.classList.contains('mdr-collapsed')) return;
        li.value = first + i;
        numbered.add(li);
      });
    }
  }

  function apply() {
    body.querySelectorAll('.mdr-hunk').forEach((n) => n.remove());
    body.querySelectorAll('.mdr-collapsed').forEach((n) => n.classList.remove('mdr-collapsed'));
    if (whole) { renumber(); relayout(); return; }
    leafEls.forEach((el, i) => { if (el && !shown[i]) el.classList.add('mdr-collapsed'); });
    // A container collapses when every leaf inside it did. Children come after their parent in
    // document order, so one pass in reverse sums each container's leaves before it is reached.
    const inside = new Map<HTMLElement, { leaves: number; collapsed: number }>();
    const blocks = [...body.querySelectorAll<HTMLElement>('[data-src-start]')];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const el = blocks[i];
      const sum = inside.get(el) ?? { leaves: 0, collapsed: 0 };
      if (sum.leaves && sum.leaves === sum.collapsed) el.classList.add('mdr-collapsed');
      const parent = el.parentElement?.closest<HTMLElement>('[data-src-start]');
      if (!parent || !body.contains(parent)) continue;
      const up = inside.get(parent) ?? { leaves: 0, collapsed: 0 };
      if (leafSet.has(el)) { up.leaves++; if (el.classList.contains('mdr-collapsed')) up.collapsed++; }
      up.leaves += sum.leaves;
      up.collapsed += sum.collapsed;
      inside.set(parent, up);
    }
    const startHeader = headerAtStart(leaves, shown, hunks);
    const firstEl = rowAnchor(leafEls[0]);
    if (startHeader && firstEl) {
      const { row, content } = hunkRow(doc, firstEl.parentElement);
      content.append(headerSpan(doc, startHeader));
      firstEl.before(row);
    }
    for (const gap of findGaps(shown)) {
      const next = shown.findIndex((s, i) => s && i > gap.to);
      let prev = -1;
      for (let i = gap.from - 1; i >= 0; i--) if (shown[i]) { prev = i; break; }
      const nextEl = next >= 0 ? rowAnchor(leafEls[next]) : null;
      const prevEl = !nextEl && prev >= 0 ? rowAnchor(leafEls[prev]) : null;
      const { row, content } = hunkRow(doc, (nextEl ?? prevEl)?.parentElement ?? null);
      for (const dir of expandersFor(leaves, gap, leaves.length)) {
        const [glyph, name] = EXPAND_LABEL[dir];
        const b = button(doc, 'mdr-expand', glyph, name);
        b.dataset.dir = dir;
        b.setAttribute('aria-label', name);
        b.addEventListener('click', () => { for (const i of revealIndexes(leaves, gap, dir)) shown[i] = true; apply(); });
        content.append(b);
      }
      const header = headerForGap(leaves, shown, gap, hunks, initial);
      if (header) content.append(headerSpan(doc, header));
      if (nextEl) nextEl.before(row);
      else if (prevEl) afterOwnUi(prevEl).after(row);
      else body.append(row);
    }
    renumber();
    relayout();
  }

  const toggle = button(doc, 'mdr-whole-file', 'Show whole file');
  toggle.addEventListener('click', () => { whole = !whole; toggle.textContent = whole ? 'Show changes only' : 'Show whole file'; apply(); });
  toolbar.append(toggle);
  toolbar.hidden = false;
  apply();

  return {
    force(lines) {
      let changed = false;
      leaves.forEach((l, i) => {
        if (!shown[i] && lines.some((n) => l.start <= n && n <= l.end)) { shown[i] = true; changed = true; }
      });
      if (changed) apply();
    },
  };
}
