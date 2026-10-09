import { readFileSync } from 'node:fs';
import { rangeToLines } from '../src/core/selection';
import { renderMarkdown } from '../src/render/render';

const SOURCE = readFileSync('e2e/fixture-repo/head/docs/guide.md', 'utf8');

function mount(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(SOURCE).html;
  document.body.replaceChildren(root);
  return root;
}

function lineText(root: Element, line: number): Text {
  return root.querySelector(`[data-src-line="${line}"]`)!.firstChild as Text;
}

describe('rangeToLines', () => {
  it('maps a selection inside one line of a paragraph', () => {
    const root = mount();
    const t = lineText(root, 8);
    const r = document.createRange();
    r.setStart(t, 3);
    r.setEnd(t, 12);
    expect(rangeToLines(r, root)).toEqual({ start: 8, end: 8 });
  });

  it('maps a selection across lines', () => {
    const root = mount();
    const r = document.createRange();
    r.setStart(lineText(root, 7), 0);
    r.setEnd(lineText(root, 9), 5);
    expect(rangeToLines(r, root)).toEqual({ start: 7, end: 9 });
  });

  it('maps a triple-click selection that ends at offset 0 of the next block', () => {
    const root = mount();
    const r = document.createRange();
    r.setStart(lineText(root, 7), 0);
    r.setEnd(root.querySelector('ul')!, 0);
    expect(rangeToLines(r, root)).toEqual({ start: 7, end: 9 });
  });

  it('returns null for a collapsed range', () => {
    const root = mount();
    const r = document.createRange();
    r.setStart(lineText(root, 8), 2);
    expect(rangeToLines(r, root)).toBeNull();
  });

  it('returns null when the range leaves the root', () => {
    const root = mount();
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);
    const r = document.createRange();
    r.setStart(lineText(root, 8), 0);
    r.setEnd(outside.firstChild!, 3);
    expect(rangeToLines(r, root)).toBeNull();
  });
});
