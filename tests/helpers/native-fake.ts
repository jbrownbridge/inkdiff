import type { MdFile } from '../../src/github/types';

export interface FakeOptions {
  /** Overrides the form heading (to simulate a form for other lines). */
  heading?: string;
  /** Inject the form after this many ms instead of synchronously. */
  delayMs?: number;
  /** Render the Add comment button only on hover (default) or never. */
  noAddButton?: boolean;
  /** What a submit with text does after `postDelayMs` (default 30): remove the form ('ok', default) or show an error ('fail'). */
  post?: 'ok' | 'fail';
  postDelayMs?: number;
}

export interface FakePage {
  file: MdFile;
  /** What GitHub's fake handlers saw, in order. */
  events: string[];
}

function rowHtml(n: number): string {
  const key = `b:${n}-l:${n}-r:${n}`;
  return `<tr class="diff-line-row">
    <td class="new-diff-line-number" data-diff-side="left" data-diff-line-key="${key}" data-line-number="${n}">${n}</td>
    <td class="new-diff-line-number" data-diff-side="right" data-diff-line-key="${key}" data-line-number="${n}">${n}</td>
    <td class="diff-text-cell" data-diff-side="right" data-diff-line-key="${key}" data-line-number="${n}"><code class="diff-text"><div class="diff-text-inner">line ${n}</div></code></td>
  </tr>`;
}

const lineOf = (el: Element) => Number(el.closest('tr')!.querySelector('[data-line-number]')!.getAttribute('data-line-number'));

/**
 * A new-experience file region whose rows behave like live GitHub: a mouseover on a row's code cell
 * (not the row alone) renders an "Add comment" button, clicking it injects GitHub's inline comment form, and Cancel closes the
 * form only while its box sits under its original parent. Comment / Start a review / Ctrl+Enter
 * act only while the box is home: empty text shows a validation error (the button is never
 * disabled); otherwise the clicked button is disabled while "posting", then the form goes away
 * ('ok') or shows an error and stays ('fail').
 *
 * Not modelled: React's root event delegation. Real GitHub handles these clicks in a listener at
 * its React root during the bubble phase; this fake listens on the buttons themselves. Both run
 * after the host's capture-phase listener, which is the ordering the panel relies on.
 */
export function fakeNewPage(lines: number[], o: FakeOptions = {}): FakePage {
  document.body.innerHTML = `<div role="region" id="diff-x"><table data-diff-anchor="diff-x"><tbody>${lines.map(rowHtml).join('')}</tbody></table></div>`;
  const container = document.querySelector<HTMLElement>('#diff-x')!;
  const table = container.querySelector('table')!;
  const events: string[] = [];
  let anchor: number | null = null;
  let range: [number, number] | null = null;

  for (const type of ['pointerover', 'mouseover', 'mouseenter', 'mousemove']) {
    table.addEventListener(type, (e) => {
      const tr = (e.target as Element).closest('tr.diff-line-row');
      if (!tr) return;
      const cell = tr.querySelector('td.diff-text-cell')!;
      const onCell = e.target === cell;
      events.push(`${type}:${onCell ? 'cell' : 'row'}:${lineOf(tr)}`);
      // Live GitHub renders the button only when the code cell itself is hovered.
      if (type !== 'mouseover' || !onCell) return;
      if (o.noAddButton || cell.querySelector('button[aria-label="Add comment"]')) return;
      cell.insertAdjacentHTML('beforeend', '<button aria-label="Add comment">+</button>');
    });
  }

  table.addEventListener('click', (e) => {
    const target = e.target as Element;
    const num = target.closest('td.new-diff-line-number[data-diff-side="right"]');
    if (num) {
      const n = lineOf(num);
      const me = e as MouseEvent;
      events.push(`number:${n}${me.shiftKey ? ':shift' : ''}`);
      if (me.shiftKey && anchor !== null) range = [Math.min(anchor, n), Math.max(anchor, n)];
      else { anchor = n; range = [n, n]; }
      return;
    }
    const add = target.closest('button[aria-label="Add comment"]');
    if (add) {
      const end = lineOf(add);
      const start = range && range[1] === end ? range[0] : end;
      events.push(`add:${end}`);
      const inject = () => injectForm(add.closest('td')!, start, end);
      if (o.delayMs) setTimeout(inject, o.delayMs);
      else inject();
    }
  });

  function injectForm(cell: Element, start: number, end: number) {
    const heading = o.heading ?? (start === end ? `Add a comment on  line R${end}` : `Add a comment on  lines R${start} to R${end}`);
    const markers = document.createElement('div');
    markers.setAttribute('data-inline-markers', '');
    markers.innerHTML = `<div class="InlineMarkers-module__markersWrapper__x"><div class="border rounded-2"><div data-marker-id="new-comment">
      <h4>${heading}</h4><textarea placeholder="Leave a comment"></textarea>
      <div><button type="button">Cancel</button><button type="button"><span>Comment</span></button><button type="button">Start a review</button><button type="button">Preview</button></div>
    </div></div></div>`;
    cell.append(markers);
    const wrapper = markers.firstElementChild!;
    const box = wrapper.firstElementChild!;
    const textarea = box.querySelector('textarea')!;
    textarea.addEventListener('input', () => events.push(`input:${textarea.value}`));
    const submit = (b: HTMLButtonElement) => {
      if (!textarea.value.trim()) {
        box.querySelector('.fake-error')?.remove();
        box.insertAdjacentHTML('beforeend', '<p class="fake-error">Comment cannot be blank</p>');
        return;
      }
      b.disabled = true;
      setTimeout(() => {
        if (o.post === 'fail') {
          b.disabled = false;
          box.insertAdjacentHTML('beforeend', '<p class="fake-error">Could not post</p>');
        } else markers.remove();
      }, o.postDelayMs ?? 30);
    };
    const comment = [...box.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Comment')!;
    textarea.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      const home = box.parentElement === wrapper;
      events.push(`submit-key:${home ? 'home' : 'moved'}`);
      if (home) submit(comment);
    });
    for (const b of box.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        const label = b.textContent!.trim();
        const home = box.parentElement === wrapper;
        events.push(`${label}:${home ? 'home' : 'moved'}`);
        if (!home) return;
        if (label === 'Cancel') markers.remove();
        if (label === 'Comment' || label === 'Start a review') submit(b);
      });
    }
  }

  return { file: { path: 'docs/a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'a'.repeat(40), container }, events };
}
