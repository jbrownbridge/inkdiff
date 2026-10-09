import { hostThread } from '../../src/github/hosted-thread';
import { threadMarkers } from '../../src/github/read';
import type { MdFile } from '../../src/github/types';

function page() {
  document.body.innerHTML = `<div role="region" id="diff-x"><table data-diff-anchor="diff-x"><tbody>
    <tr class="diff-line-row"><td class="diff-text-cell" data-diff-side="right" data-diff-line-key="b:3-l:3-r:3"><div class="wrap">
      <div data-marker-id="9"><h2>Comment on line R3</h2><p>x</p></div><i class="after"></i>
    </div></td></tr></tbody></table><div class="away"></div></div>`;
  const container = document.querySelector<HTMLElement>('#diff-x')!;
  const file: MdFile = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'abc', container };
  return { file, wrap: document.querySelector('.wrap')!, away: document.querySelector('.away')! };
}

describe('hostThread', () => {
  it('marks GitHub\'s thread element and puts it back on restore', () => {
    const { file, wrap, away } = page();
    const h = hostThread(file, '9')!;
    expect(h.box.getAttribute('data-mdr-hosted')).toBe('');
    away.append(h.box);
    expect(hostThread(file, '9')!.box).toBe(h.box);
    h.restore();
    expect(h.box.parentElement).toBe(wrap);
    expect(h.box.nextElementSibling!.className).toBe('after');
    expect(h.box.hasAttribute('data-mdr-hosted')).toBe(false);
  });

  it('gives null for an unknown or left-side thread', () => {
    const { file } = page();
    expect(hostThread(file, '1')).toBeNull();
  });

  it('treats a hosted thread as gone once GitHub removes its home (a delete)', () => {
    const { file, away } = page();
    const h = hostThread(file, '9')!;
    away.append(h.box);
    expect(threadMarkers(file).map((m) => m.id)).toEqual(['9']);
    // React unmounts the thread by removing an ancestor in the diff, not our moved element.
    document.querySelector('tr')!.remove();
    expect(h.box.isConnected).toBe(true);
    expect(threadMarkers(file)).toEqual([]);
    expect(hostThread(file, '9')).toBeNull();
  });

  it('keeps a removed-line thread\'s place after it moves', () => {
    document.body.innerHTML = `<div role="region" id="diff-x"><table data-diff-anchor="diff-x"><tbody>
      <tr class="diff-line-row"><td data-diff-side="left" data-line-number="4"></td><td class="diff-text-cell" data-diff-side="left" data-line-number="4" data-diff-line-key="b:4-l:4-r:3"><code class="diff-text deletion"></code>
        <div class="wrap"><div data-marker-id="7"><h2>Comment on line L4</h2></div></div></td></tr>
      <tr class="diff-line-row"><td data-diff-side="left" data-line-number="5"></td><td class="diff-text-cell" data-diff-side="right" data-line-number="4" data-diff-line-key="b:4-l:5-r:4"><code class="diff-text"></code></td></tr>
    </tbody></table><div class="away"></div></div>`;
    const container = document.querySelector<HTMLElement>('#diff-x')!;
    const file: MdFile = { path: 'a.md', kind: 'markdown', repo: 'o/r', pr: 1, headSha: 'abc', container };
    expect(threadMarkers(file).map((m) => m.id)).toEqual(['7']);
    const h = hostThread(file, '7')!;
    document.querySelector('.away')!.append(h.box);
    expect(threadMarkers(file).map((m) => m.id)).toEqual(['7']);
  });
});
