import { clearProviders, registerBuiltInProviders, type DraftContext } from '../../src/core/comment-draft';
import { createCommentForm, headerText } from '../../src/view/comment-form';
import { draftKey } from '../../src/view/drafts';

const context: DraftContext = {
  repo: 'o/r', pr: 1, path: 'docs/guide.md', headSha: 'abc',
  lines: { start: 2, end: 2 }, source: 'a\nline two\nc\n', selectedText: 'two',
};

function make({ revealLine = vi.fn(), avatarUrl = null as string | null, lines = context.lines } = {}) {
  clearProviders();
  registerBuiltInProviders();
  const onClose = vi.fn();
  const el = createCommentForm({ doc: document, context: { ...context, lines }, avatarUrl, revealLine, onClose, storage: sessionStorage });
  document.body.replaceChildren(el);
  const ta = el.querySelector('textarea')!;
  const textOf = (sel: string) => el.querySelector(sel)?.textContent;
  const btn = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === text)!;
  return { el, ta, btn, textOf, revealLine, onClose };
}

describe('createCommentForm', () => {
  beforeEach(() => sessionStorage.clear());

  it('fills the body from a provider', async () => {
    const { ta, btn } = make();
    btn('Suggest').click();
    await vi.waitFor(() => expect(ta.value).toBe('```suggestion\nline two\n```\n'));
    btn('Quote').click();
    await vi.waitFor(() => expect(ta.value).toBe('> two\n\n'));
  });

  it('saves and restores a draft', () => {
    const first = make();
    first.ta.value = 'draft text';
    first.ta.dispatchEvent(new Event('input'));
    expect(sessionStorage.getItem(draftKey(context))).toBe('draft text');
    const second = make();
    expect(second.ta.value).toBe('draft text');
  });

  it('offers copy-to-source as the primary action (our own posting is not built)', async () => {
    const { el, ta, btn, revealLine } = make();
    expect(btn('Comment')).toBeUndefined();
    expect(btn('Start a review')).toBeUndefined();
    const copy = btn('Copy and open source view');
    expect(copy.hidden).toBe(false);
    expect(copy.classList.contains('mdr-primary')).toBe(true);
    expect(el.querySelector('.mdr-note')!.textContent).toBe(
      "GitHub's comment form could not be opened here (GitHub takes comments only on lines in the diff). Copy your comment and paste it in the source view.",
    );
    ta.value = 'text';
    copy.click();
    await vi.waitFor(() => expect(revealLine).toHaveBeenCalledWith(2));
  });

  it('shows the GitHub-style header for one line and for a range', () => {
    expect(make().textOf('.mdr-cf-header')).toBe('Add a comment on line R2');
    expect(make({ lines: { start: 125, end: 129 } }).textOf('.mdr-cf-header')).toBe('Add a comment on lines R125 to R129');
    expect(headerText({ start: 7, end: 7 })).toBe('Add a comment on line R7');
  });

  it('renders the avatar only when a url is given', () => {
    expect(make().el.querySelector('img.mdr-cf-avatar')).toBeNull();
    expect(make({ avatarUrl: 'https://avatars.example/u.png' }).el.querySelector('img.mdr-cf-avatar')).not.toBeNull();
  });

  it('previews markdown and hides the textarea on the Preview tab', () => {
    const { el, ta } = make();
    const preview = el.querySelector<HTMLElement>('.mdr-cf-preview')!;
    expect(preview.hidden).toBe(true);
    ta.value = '**b**';
    el.querySelector<HTMLElement>('[data-tab="preview"]')!.click();
    expect(preview.innerHTML).toContain('<strong>b</strong>');
    expect(ta.hidden).toBe(true);
    expect(el.querySelector('[data-tab="preview"]')!.getAttribute('aria-selected')).toBe('true');
    el.querySelector<HTMLElement>('[data-tab="write"]')!.click();
    expect(ta.hidden).toBe(false);
    expect(preview.hidden).toBe(true);
    ta.value = '';
    el.querySelector<HTMLElement>('[data-tab="preview"]')!.click();
    expect(preview.textContent).toBe('Nothing to preview');
  });

  it('has one toolbar button per format kind; Bold wraps the selection', () => {
    const { el, ta } = make();
    expect(el.querySelectorAll('.mdr-cf-tool')).toHaveLength(11);
    expect(el.querySelector('.mdr-cf-tool svg')).not.toBeNull();
    ta.value = 'a word';
    ta.setSelectionRange(2, 6);
    el.querySelector<HTMLElement>('.mdr-cf-tool[data-kind="bold"]')!.click();
    expect(ta.value).toBe('a **word**');
    expect(ta.selectionStart).toBe(4);
    expect(sessionStorage.getItem(draftKey(context))).toBe('a **word**');
  });

  it('puts Write/Preview tabs and the toolbar in one bordered box with the editor', () => {
    const { el, ta } = make();
    const box = el.querySelector('.mdr-cf-box')!;
    const nav = box.querySelector('.mdr-cf-tabnav')!;
    expect(nav.getAttribute('role')).toBe('tablist');
    const tabs = [...nav.querySelectorAll<HTMLElement>('.mdr-cf-tab')];
    expect(tabs.map((t) => [t.textContent, t.getAttribute('role'), t.getAttribute('aria-selected')])).toEqual([
      ['Write', 'tab', 'true'], ['Preview', 'tab', 'false'],
    ]);
    const preview = el.querySelector<HTMLElement>('.mdr-cf-preview')!;
    expect(tabs.map((t) => el.querySelector(`#${t.getAttribute('aria-controls')}`))).toEqual([ta, preview]);
    expect(nav.querySelector('.mdr-cf-toolbar')).not.toBeNull();
    const body = box.querySelector('.mdr-cf-body')!;
    expect(body.contains(ta) && body.contains(preview)).toBe(true);
    expect(box.children[0]).toBe(nav);
    expect(box.children[1]).toBe(body);
  });

  it('groups the toolbar with dividers: format | lists | mention, reference | providers', () => {
    const { el } = make();
    const groups = [...el.querySelectorAll('.mdr-cf-toolbar > .mdr-cf-group')].map((g) =>
      [...g.querySelectorAll<HTMLElement>('button')].map((b) => b.dataset.kind ?? b.textContent));
    expect(groups).toEqual([
      ['heading', 'bold', 'italic', 'quote', 'code', 'link'], ['ul', 'ol', 'task'], ['mention', 'reference'], ['Quote', 'Suggest'],
    ]);
    expect(el.querySelectorAll('.mdr-cf-toolbar > .mdr-cf-divider')).toHaveLength(3);
  });

  it('keeps the note left of the footer buttons', () => {
    const { el } = make();
    expect([...el.querySelector('.mdr-actions')!.children].map((c) => c.className)).toEqual(['mdr-note', 'mdr-cancel', 'mdr-copy mdr-primary']);
    expect(el.lastElementChild!.classList.contains('mdr-actions')).toBe(true);
  });

  it('has placeholder and Cancel closes', () => {
    const { ta, btn, onClose } = make();
    expect(ta.placeholder).toBe('Leave a comment');
    btn('Cancel').click();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('draft storage', () => {
  it('keeps drafts in extension memory, never in the page\'s storage', async () => {
    const { draftStore, saveDraft, loadDraft } = await import('../../src/view/drafts');
    sessionStorage.clear();
    localStorage.clear();
    saveDraft(draftStore, 'k', 'private draft');
    expect(loadDraft(draftStore, 'k')).toBe('private draft');
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });
});
