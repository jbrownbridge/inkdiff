import { getProviders, type DraftContext } from '../core/comment-draft';
import type { LineRange } from '../core/diff-map';
import { formatText, type FormatKind } from '../core/format';
import { renderMarkdown } from '../render/render';
import { button, div } from './dom';
import { draftKey, draftStore, loadDraft, saveDraft } from './drafts';
import { ICONS } from './icons';

export interface CommentFormOptions {
  doc: Document;
  context: DraftContext;
  revealLine(line: number): void;
  onClose(): void;
  storage?: Storage;
  avatarUrl?: string | null;
}

export function headerText(lines: LineRange): string {
  return lines.start === lines.end ? `Add a comment on line R${lines.start}` : `Add a comment on lines R${lines.start} to R${lines.end}`;
}

/** Rendered HTML without the source-line stamps, so the preview is never mistaken for a source block. */
function previewHtml(doc: Document, text: string): string {
  const t = doc.createElement('template');
  t.innerHTML = renderMarkdown(text).html;
  t.content.querySelectorAll('[data-src-start]').forEach((n) => { n.removeAttribute('data-src-start'); n.removeAttribute('data-src-end'); });
  t.content.querySelectorAll('span[data-src-line]').forEach((n) => n.replaceWith(...n.childNodes));
  return t.innerHTML;
}

/** Toolbar groups, separated by thin dividers like GitHub's markdown toolbar. */
const TOOL_GROUPS: Array<Array<{ kind: FormatKind; label: string }>> = [
  [
    { kind: 'heading', label: 'Heading' },
    { kind: 'bold', label: 'Bold' },
    { kind: 'italic', label: 'Italic' },
    { kind: 'quote', label: 'Quote' },
    { kind: 'code', label: 'Code' },
    { kind: 'link', label: 'Link' },
  ],
  [
    { kind: 'ul', label: 'Bulleted list' },
    { kind: 'ol', label: 'Numbered list' },
    { kind: 'task', label: 'Task list' },
  ],
  [
    { kind: 'mention', label: 'Mention' },
    { kind: 'reference', label: 'Reference' },
  ],
];

let formSeq = 0;

export function createCommentForm(o: CommentFormOptions): HTMLElement {
  const { doc, context } = o;
  const storage = o.storage ?? draftStore;
  const key = draftKey(context);
  const { start } = context.lines;

  const root = div(doc, 'mdr-comment-form');
  root.dataset.lines = `${context.lines.start}-${context.lines.end}`;

  const header = div(doc, 'mdr-cf-header');
  if (o.avatarUrl) {
    const img = doc.createElement('img');
    img.className = 'mdr-cf-avatar';
    img.src = o.avatarUrl;
    img.alt = '';
    header.append(img);
  }
  header.append(doc.createTextNode(headerText(context.lines)));

  const idBase = `mdr-cf-${++formSeq}`;
  const ta = doc.createElement('textarea');
  ta.className = 'mdr-textarea';
  ta.id = `${idBase}-write`;
  ta.rows = 5;
  ta.placeholder = 'Leave a comment';
  ta.value = loadDraft(storage, key) ?? '';
  const persist = () => saveDraft(storage, key, ta.value);
  ta.addEventListener('input', persist);

  const preview = div(doc, 'mdr-cf-preview markdown-body');
  preview.id = `${idBase}-preview`;
  preview.hidden = true;

  const tabnav = div(doc, 'mdr-cf-tabnav');
  tabnav.setAttribute('role', 'tablist');
  const tabBtns = new Map<string, HTMLButtonElement>();
  function showTab(tab: 'write' | 'preview') {
    const previewing = tab === 'preview';
    for (const [name, b] of tabBtns) b.setAttribute('aria-selected', String(name === tab));
    ta.hidden = previewing;
    preview.hidden = !previewing;
    toolbar.hidden = previewing;
    if (previewing) {
      if (ta.value.trim()) preview.innerHTML = previewHtml(doc, ta.value);
      else preview.textContent = 'Nothing to preview';
    } else ta.focus();
  }
  for (const [tab, text, panel] of [['write', 'Write', ta], ['preview', 'Preview', preview]] as const) {
    const b = button(doc, 'mdr-cf-tab', text);
    b.dataset.tab = tab;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', panel.id);
    b.setAttribute('aria-selected', String(tab === 'write'));
    b.addEventListener('click', () => showTab(tab));
    tabBtns.set(tab, b);
    tabnav.append(b);
  }

  const toolbar = div(doc, 'mdr-cf-toolbar');
  const groups: HTMLElement[] = [];
  for (const tools of TOOL_GROUPS) {
    const group = div(doc, 'mdr-cf-group');
    for (const t of tools) {
      const b = button(doc, 'mdr-cf-tool', '');
      b.dataset.kind = t.kind;
      b.setAttribute('aria-label', t.label);
      b.title = t.label;
      b.innerHTML = ICONS[t.kind];
      b.addEventListener('click', () => {
        const e = formatText(ta.value, ta.selectionStart, ta.selectionEnd, t.kind);
        ta.value = e.value;
        ta.setSelectionRange(e.start, e.end);
        persist();
        ta.focus();
      });
      group.append(b);
    }
    groups.push(group);
  }
  const providers = div(doc, 'mdr-cf-group');
  for (const p of getProviders()) {
    const b = button(doc, 'mdr-provider', p.label);
    b.dataset.provider = p.id;
    b.addEventListener('click', async () => {
      ta.value = await p.draft(context);
      persist();
      ta.focus();
    });
    providers.append(b);
  }
  if (providers.childElementCount) groups.push(providers);
  groups.forEach((g, i) => {
    if (i > 0) { const d = div(doc, 'mdr-cf-divider'); d.setAttribute('aria-hidden', 'true'); toolbar.append(d); }
    toolbar.append(g);
  });
  tabnav.append(toolbar);

  const editor = div(doc, 'mdr-cf-body');
  editor.append(ta, preview);
  const box = div(doc, 'mdr-cf-box');
  box.append(tabnav, editor);

  const copy = button(doc, 'mdr-copy mdr-primary', 'Copy and open source view');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); } catch { /* clipboard blocked */ }
    o.revealLine(start);
  });

  const cancel = button(doc, 'mdr-cancel', 'Cancel');
  cancel.addEventListener('click', () => o.onClose());
  const actions = div(doc, 'mdr-actions');
  const note = div(doc, 'mdr-note', "GitHub's comment form could not be opened here (GitHub takes comments only on lines in the diff). Copy your comment and paste it in the source view.");
  actions.append(note, cancel, copy);
  root.append(header, box, actions);
  return root;
}
