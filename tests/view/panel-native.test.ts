import { readFileSync } from 'node:fs';
import { clearProviders, registerBuiltInProviders } from '../../src/core/comment-draft';
import { openNativeForm } from '../../src/github/native-form';
import type { NativeForm } from '../../src/github/types';
import { renderMarkdown } from '../../src/render/render';
import { createPanel, type PanelCallbacks } from '../../src/view/panel';
import { fakeNewPage, type FakeOptions } from '../helpers/native-fake';

vi.mock('../../src/view/mermaid-loader', () => ({ loadMermaidModule: async () => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) }) }));

const SOURCE = readFileSync('e2e/fixture-repo/head/docs/guide.md', 'utf8');

function setup(native?: PanelCallbacks['openNativeForm'], fake: FakeOptions = {}) {
  clearProviders();
  registerBuiltInProviders();
  sessionStorage.clear();
  const page = fakeNewPage(Array.from({ length: 40 }, (_, i) => i + 1), fake);
  const r = renderMarkdown(SOURCE);
  const callbacks: PanelCallbacks = { revealLine: vi.fn(),
    openNativeForm: native === undefined ? (lines) => openNativeForm(page.file, lines) : native,
  };
  const panel = createPanel({
    html: r.html, blocks: r.blocks,
    diff: { changedLines: [9], removed: [], rightLineText: new Map() },
    threads: [],
    context: { repo: 'o/r', pr: 1, path: 'docs/guide.md', headSha: 'abc', source: SOURCE },
    autoMermaid: false, callbacks, lineCount: r.lines.length,
  });
  const table = page.file.container.querySelector('table')!;
  table.before(panel.el);
  const body = panel.el.querySelector<HTMLElement>('.mdr-body')!;
  const open = (sel: string) => {
    body.querySelector(sel)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    panel.el.querySelector<HTMLButtonElement>('.mdr-add')!.click();
  };
  return { ...page, panel, body, table, open };
}

const host = (body: HTMLElement) => body.querySelector<HTMLElement>('.mdr-native-host');
const boxButton = (box: Element, label: string) => [...box.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)!;
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('panel hosting GitHub\'s comment form', () => {
  it('moves GitHub\'s form box after the block, with our tools above it, and keeps the highlight', async () => {
    const { panel, body, table, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)?.querySelector('[data-marker-id="new-comment"]')).toBeTruthy());
    const h = host(body)!;
    expect(h.previousElementSibling!.classList.contains('mdr-native-tools')).toBe(true);
    expect(h.previousElementSibling!.previousElementSibling!.tagName).toBe('H1');
    expect(h.querySelector('h4')!.textContent).toBe('Add a comment on  line R5');
    expect(table.querySelector('[data-marker-id="new-comment"]')).toBeNull();
    expect(body.querySelector('.mdr-comment-form')).toBeNull();
    expect(body.querySelector('h1')!.classList.contains('mdr-selected')).toBe(true);
    expect(panel.el.querySelector('.mdr-gutter-selected')).not.toBeNull();
    expect(document.activeElement).toBe(h.querySelector('textarea'));
  });

  it('fills GitHub\'s textarea from a provider through an input event', async () => {
    const { body, events, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    const quote = body.querySelector<HTMLButtonElement>('.mdr-native-tools [data-provider="quote"]')!;
    quote.click();
    await vi.waitFor(() => expect(events).toContain('input:> # Fixture guide\n\n'));
    expect(host(body)!.querySelector('textarea')!.value).toBe('> # Fixture guide\n\n');
  });

  it('puts the box back before GitHub handles Cancel, so the form closes', async () => {
    const { panel, body, events, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    click(boxButton(host(body)!, 'Cancel'));
    expect(events).toContain('Cancel:home');
    expect(document.querySelector('[data-marker-id="new-comment"]')).toBeNull();
    expect(host(body)).toBeNull();
    expect(body.querySelector('.mdr-native-tools')).toBeNull();
    expect(body.querySelector('.mdr-selected')).toBeNull();
    expect(panel.el.querySelector('.mdr-gutter-selected')).toBeNull();
  });

  it('puts the box back before GitHub handles Comment and shows Posting… until the form goes', async () => {
    const { panel, body, table, events, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    host(body)!.querySelector('textarea')!.value = 'Nice';
    click(boxButton(host(body)!, 'Comment').querySelector('span')!);
    expect(events).toContain('Comment:home');
    expect(table.querySelector('[data-marker-id="new-comment"]')).not.toBeNull();
    expect(host(body)).toBeNull();
    const card = body.querySelector<HTMLElement>('.mdr-thread-posting')!;
    expect(card.querySelector('.mdr-label-posting')!.textContent).toBe('Posting…');
    expect(card.querySelector('.mdr-comment-body')!.textContent).toBe('Nice');
    await vi.waitFor(() => expect(document.querySelector('[data-marker-id="new-comment"]')).toBeNull());
    expect(host(body)).toBeNull();
    expect(body.querySelector('.mdr-selected')).toBeNull();
    expect(panel.el.querySelector('.mdr-gutter-selected')).toBeNull();
    // The card holds the place until GitHub's thread arrives, which then takes exactly its spot.
    expect(card.isConnected).toBe(true);
    const before = card.previousElementSibling;
    panel.setThreads([{ id: 'n1', startLine: 5, endLine: 5, resolved: false, comments: [{ author: 'me', bodyHtml: '<p>Nice</p>' }] }]);
    expect(card.isConnected).toBe(false);
    expect(before!.nextElementSibling!.getAttribute('data-thread-id')).toBe('n1');
  });

  it('hosts the same form again with GitHub\'s error when the post fails', async () => {
    const { body, events, open } = setup(undefined, { post: 'fail' });
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    const box = host(body)!.firstElementChild!;
    host(body)!.querySelector('textarea')!.value = 'Nice';
    click(boxButton(box, 'Start a review'));
    expect(events).toContain('Start a review:home');
    expect(host(body)).toBeNull();
    await vi.waitFor(() => expect(host(body)?.firstElementChild).toBe(box));
    expect(box.querySelector('.fake-error')!.textContent).toBe('Could not post');
    expect(box.querySelector('textarea')!.value).toBe('Nice');
    expect(body.querySelector('.mdr-thread-posting')).toBeNull();
    expect(body.querySelector('h1')!.classList.contains('mdr-selected')).toBe(true);
    expect(body.querySelectorAll('.mdr-native-tools')).toHaveLength(1);
  });

  it('hosts the form again after GitHub rejects an empty comment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { body, open } = setup();
      open('h1');
      await vi.waitFor(() => expect(host(body)).not.toBeNull());
      const box = host(body)!.firstElementChild!;
      click(boxButton(box, 'Comment'));
      expect(body.querySelector('.mdr-thread-posting')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(2100);
      expect(host(body)?.firstElementChild).toBe(box);
      expect(box.querySelector('.fake-error')!.textContent).toBe('Comment cannot be blank');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats Ctrl+Enter in the textarea as a submit', async () => {
    const { body, events, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    const ta = host(body)!.querySelector('textarea')!;
    ta.value = 'Nice';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(events).toContain('submit-key:home');
    expect(body.querySelector('.mdr-thread-posting')!.textContent).toContain('Nice');
    await vi.waitFor(() => expect(document.querySelector('[data-marker-id="new-comment"]')).toBeNull());
  });

  it('keeps the form hosted when a closer button is disabled', async () => {
    const { body, events, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    const comment = boxButton(host(body)!, 'Comment');
    comment.setAttribute('aria-disabled', 'true');
    click(comment);
    expect(events).toContain('Comment:moved');
    expect(host(body)).not.toBeNull();
    expect(body.querySelector('.mdr-thread-posting')).toBeNull();
  });

  it('tears down the host when GitHub unmounts the form while hosted', async () => {
    const { body, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    host(body)!.querySelector('[data-marker-id="new-comment"]')!.remove();
    await vi.waitFor(() => expect(host(body)).toBeNull());
    expect(body.querySelector('.mdr-native-tools')).toBeNull();
    expect(body.querySelector('.mdr-selected')).toBeNull();
  });

  it('keeps the form hosted for other buttons', async () => {
    const { body, events, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    click(boxButton(host(body)!, 'Preview'));
    expect(events).toContain('Preview:moved');
    expect(host(body)!.querySelector('[data-marker-id="new-comment"]')).not.toBeNull();
  });

  it('ignores Escape while a suggestion list is open', async () => {
    const { body, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    host(body)!.firstElementChild!.insertAdjacentHTML('beforeend', '<ul role="listbox"><li>@octocat</li></ul>');
    host(body)!.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host(body)).not.toBeNull();
  });

  it('shows a note while GitHub\'s form is opening', async () => {
    let resolve!: (f: NativeForm | null) => void;
    const { body, open } = setup(() => new Promise((r) => { resolve = r; }));
    open('h1');
    const note = body.querySelector('.mdr-native-pending')!;
    expect(note.textContent).toBe('Opening GitHub\'s comment form…');
    expect(note.previousElementSibling!.tagName).toBe('H1');
    resolve(null);
    await vi.waitFor(() => expect(body.querySelector('.mdr-comment-form')).not.toBeNull());
    expect(body.querySelector('.mdr-native-pending')).toBeNull();
  });

  it('puts the box back on Escape', async () => {
    const { body, table, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    host(body)!.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(table.querySelector('[data-marker-id="new-comment"]')).not.toBeNull();
    expect(host(body)).toBeNull();
  });

  it('puts the box back when the panel is destroyed or disabled', async () => {
    const first = setup();
    first.open('h1');
    await vi.waitFor(() => expect(host(first.body)).not.toBeNull());
    first.panel.destroy();
    expect(first.table.querySelector('[data-marker-id="new-comment"]')).not.toBeNull();

    const second = setup();
    second.open('h1');
    await vi.waitFor(() => expect(host(second.body)).not.toBeNull());
    second.panel.setDisabled('File changed. Reload to comment.');
    expect(second.table.querySelector('[data-marker-id="new-comment"]')).not.toBeNull();
    expect(host(second.body)).toBeNull();
  });

  it('puts the first box back when another form opens', async () => {
    const { body, table, open } = setup();
    open('h1');
    await vi.waitFor(() => expect(host(body)).not.toBeNull());
    open('p[data-src-start="7"]');
    await vi.waitFor(() => expect(host(body)?.querySelector('h4')!.textContent).toBe('Add a comment on  lines R7 to R9'));
    expect(table.querySelectorAll('[data-marker-id="new-comment"]')).toHaveLength(1);
    expect(body.querySelectorAll('.mdr-native-host')).toHaveLength(1);
  });

  it('falls back to our own form when GitHub\'s cannot be opened', async () => {
    const { body, open } = setup(async () => null);
    open('h1');
    await vi.waitFor(() => expect(body.querySelector('.mdr-comment-form')).not.toBeNull());
    expect(host(body)).toBeNull();
    expect(body.querySelector('h1')!.classList.contains('mdr-selected')).toBe(true);
  });

  it('ignores a form that arrives after the panel was destroyed', async () => {
    let resolve!: (f: NativeForm | null) => void;
    const { panel, body, open } = setup(() => new Promise((r) => { resolve = r; }));
    open('h1');
    const box = document.createElement('div');
    const home = document.createElement('div');
    home.append(box);
    const restore = vi.fn();
    panel.destroy();
    resolve({ box, restore } as unknown as NativeForm);
    await new Promise((r) => setTimeout(r, 0));
    expect(box.parentElement).toBe(home);
    expect(host(body)).toBeNull();
  });
});
