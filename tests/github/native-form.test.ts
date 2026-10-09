import { openNativeForm } from '../../src/github/native-form';
import { fakeNewPage } from '../helpers/native-fake';

const marker = () => document.querySelector('[data-marker-id="new-comment"]');

describe('openNativeForm', () => {
  it('hovers the row, clicks Add comment, and returns the form box', async () => {
    const { file, events } = fakeNewPage([1, 2, 3, 4]);
    const form = await openNativeForm(file, { start: 3, end: 3 });
    expect(form).not.toBeNull();
    expect(form!.box.classList.contains('border')).toBe(true);
    expect(form!.box.querySelector('textarea')).not.toBeNull();
    expect(events).toEqual([
      'number:3',
      'pointerover:row:3', 'mouseover:row:3', 'mouseenter:row:3', 'mousemove:row:3',
      'pointerover:cell:3', 'mouseover:cell:3', 'mousemove:cell:3', 'add:3',
    ]);
  });

  it('selects a range with a click and a shift-click on the right line numbers', async () => {
    const { file, events } = fakeNewPage([1, 2, 3, 4, 5, 6, 7]);
    const form = await openNativeForm(file, { start: 3, end: 6 });
    expect(form!.box.querySelector('h4')!.textContent).toBe('Add a comment on  lines R3 to R6');
    expect(events.filter((e) => e.startsWith('number') || e.startsWith('add'))).toEqual(['number:3', 'number:6:shift', 'add:6']);
  });

  it('returns null when a line is outside the diff', async () => {
    const { file, events } = fakeNewPage([1, 2, 3]);
    expect(await openNativeForm(file, { start: 9, end: 9 })).toBeNull();
    expect(events).toEqual([]);
  });

  it('clamps the range to lines that have a right-side diff row', async () => {
    const { file, events } = fakeNewPage([435, 436, 437, 438, 439]);
    const form = await openNativeForm(file, { start: 433, end: 438 });
    expect(form!.box.querySelector('h4')!.textContent).toBe('Add a comment on  lines R435 to R438');
    expect(events.filter((e) => e.startsWith('number') || e.startsWith('add'))).toEqual(['number:435', 'number:438:shift', 'add:438']);
  });

  it('clamps the end too, down to a single line', async () => {
    const { file } = fakeNewPage([1, 2, 3]);
    const form = await openNativeForm(file, { start: 3, end: 6 });
    expect(form!.box.querySelector('h4')!.textContent).toBe('Add a comment on  line R3');
  });

  it('returns null when no line of the range is in the diff', async () => {
    const { file, events } = fakeNewPage([1, 2, 10]);
    expect(await openNativeForm(file, { start: 4, end: 8 })).toBeNull();
    expect(events).toEqual([]);
  });

  it('cancels and returns null when the form is for other lines', async () => {
    const { file, events } = fakeNewPage([1, 2, 3, 30], { heading: 'Add a comment on  line R30' });
    expect(await openNativeForm(file, { start: 3, end: 3 })).toBeNull();
    expect(events).toContain('Cancel:home');
    expect(marker()).toBeNull();
  });

  it('waits for a form GitHub renders later', async () => {
    const { file } = fakeNewPage([1, 2, 3], { delayMs: 20 });
    const form = await openNativeForm(file, { start: 2, end: 2 });
    expect(form!.box.querySelector('h4')!.textContent).toContain('R2');
  });

  it('gives up when no Add comment button appears', async () => {
    vi.useFakeTimers();
    try {
      const { file } = fakeNewPage([1, 2, 3], { noAddButton: true });
      const p = openNativeForm(file, { start: 2, end: 2 });
      await vi.advanceTimersByTimeAsync(3500);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses a form GitHub already has open for the same lines', async () => {
    const { file, events } = fakeNewPage([1, 2, 3]);
    const first = await openNativeForm(file, { start: 2, end: 2 });
    events.length = 0;
    const again = await openNativeForm(file, { start: 2, end: 2 });
    expect(again!.box).toBe(first!.box);
    expect(events).toEqual([]);
  });

  it('restore() puts the box back where GitHub rendered it', async () => {
    const { file } = fakeNewPage([1, 2, 3]);
    const form = (await openNativeForm(file, { start: 2, end: 2 }))!;
    const parent = form.box.parentElement!;
    const elsewhere = document.createElement('div');
    file.container.append(elsewhere);
    elsewhere.append(form.box);
    form.restore();
    expect(form.box.parentElement).toBe(parent);
    form.restore();
    expect(form.box.parentElement).toBe(parent);
    parent.remove();
    elsewhere.append(form.box);
    form.restore();
    expect(form.box.parentElement).toBe(elsewhere);
  });

  it('serializes concurrent opens so one never cancels the other\'s form', async () => {
    const { file, events } = fakeNewPage([1, 2, 3, 4]);
    const [a, b] = await Promise.all([openNativeForm(file, { start: 2, end: 2 }), openNativeForm(file, { start: 3, end: 3 })]);
    expect(a!.box.querySelector('h4')!.textContent).toBe('Add a comment on  line R2');
    expect(b!.box.querySelector('h4')!.textContent).toBe('Add a comment on  line R3');
    expect(a!.box.isConnected && b!.box.isConnected).toBe(true);
    expect(events.some((e) => e.startsWith('Cancel'))).toBe(false);
  });
});

describe('NativeForm handle', () => {
  async function opened(o: Parameters<typeof fakeNewPage>[1] = {}) {
    const page = fakeNewPage([1, 2, 3], o);
    const form = (await openNativeForm(page.file, { start: 2, end: 2 }))!;
    const btn = (label: string) => [...form.box.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)!;
    return { ...page, form, btn, ta: form.box.querySelector('textarea')! };
  }
  /** An event as the host's capture listener sees it: target set, not yet handled by GitHub. */
  const eventOn = (target: Element, e: Event) => { Object.defineProperty(e, 'target', { value: target }); return e; };

  it('fills the textarea so React sees an input event, and focuses it', async () => {
    const { form, ta, events } = await opened();
    form.fill('hello');
    expect(ta.value).toBe('hello');
    expect(events).toContain('input:hello');
    form.focus();
    expect(document.activeElement).toBe(ta);
  });

  it('classifies GitHub\'s buttons and keys', async () => {
    const { form, btn, ta } = await opened();
    const clickOn = (el: Element) => eventOn(el, new MouseEvent('click', { bubbles: true }));
    expect(form.actionOf(clickOn(btn('Cancel')))).toBe('cancel');
    expect(form.actionOf(clickOn(btn('Comment').querySelector('span')!))).toBe('submit');
    expect(form.actionOf(clickOn(btn('Start a review')))).toBe('submit');
    expect(form.actionOf(clickOn(btn('Preview')))).toBeNull();
    expect(form.actionOf(clickOn(document.body))).toBeNull();
    btn('Comment').disabled = true;
    expect(form.actionOf(clickOn(btn('Comment')))).toBeNull();
    btn('Start a review').setAttribute('aria-disabled', 'true');
    expect(form.actionOf(clickOn(btn('Start a review')))).toBeNull();
    const key = (init: KeyboardEventInit) => eventOn(ta, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    expect(form.actionOf(key({ key: 'Enter', ctrlKey: true }))).toBe('submit');
    expect(form.actionOf(key({ key: 'Enter', metaKey: true }))).toBe('submit');
    expect(form.actionOf(key({ key: 'Enter' }))).toBeNull();
    expect(form.actionOf(key({ key: 'Escape' }))).toBe('cancel');
    const prevented = key({ key: 'Escape' });
    prevented.preventDefault();
    expect(form.actionOf(prevented)).toBeNull();
    form.box.insertAdjacentHTML('beforeend', '<ul role="listbox"><li>@octocat</li></ul>');
    expect(form.actionOf(key({ key: 'Escape' }))).toBeNull();
  });

  it('watch() reports when GitHub unmounts the form', async () => {
    const { form } = await opened();
    const gone = vi.fn();
    const stop = form.watch(gone);
    form.box.querySelector('textarea')!.remove();
    await vi.waitFor(() => expect(gone).toHaveBeenCalledTimes(1));
    stop();
  });

  it('settle() is "gone" when the post succeeds', async () => {
    const { form, btn, ta } = await opened();
    ta.value = 'x';
    btn('Comment').click();
    expect(await form.settle()).toBe('gone');
  });

  it('settle() is "kept" when the post fails, once the button is no longer busy', async () => {
    const { form, btn, ta } = await opened({ post: 'fail' });
    ta.value = 'x';
    expect(form.actionOf(eventOn(btn('Comment'), new MouseEvent('click', { bubbles: true })))).toBe('submit');
    btn('Comment').click();
    const t0 = Date.now();
    expect(await form.settle()).toBe('kept');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(form.box.querySelector('.fake-error')).not.toBeNull();
  });

  it('settle() is "kept" after a short wait when GitHub rejects an empty comment', async () => {
    vi.useFakeTimers();
    try {
      const { form, btn } = await opened();
      btn('Comment').click();
      let result: string | null = null;
      void form.settle().then((r) => { result = r; });
      await vi.advanceTimersByTimeAsync(1000);
      expect(result).toBeNull();
      await vi.advanceTimersByTimeAsync(1500);
      expect(result).toBe('kept');
    } finally {
      vi.useRealTimers();
    }
  });
});
