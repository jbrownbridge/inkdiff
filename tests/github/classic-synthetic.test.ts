import { findMarkdownFiles, pageLooksSupported, readDiff, readHunks, readThreads } from '../../src/github/classic/read';

const SHA = 'c'.repeat(40);
const num = (side: 'L' | 'R', n: number, cls = 'blob-num-context') => `<td id="diff-h${side}${n}" data-line-number="${n}" class="blob-num ${cls}"></td>`;
const code = (cls: string, text: string) => `<td class="blob-code ${cls}"><span class="blob-code-inner">${text}</span></td>`;
const ctx = (l: number, r: number, t: string) => `<tr>${num('L', l)}${num('R', r)}${code('blob-code-context', t)}</tr>`;
const add = (r: number, t: string) => `<tr><td class="blob-num blob-num-addition empty-cell"></td>${num('R', r, 'blob-num-addition')}${code('blob-code-addition', t)}</tr>`;
const del = (l: number, t: string) => `<tr>${num('L', l, 'blob-num-deletion')}<td class="blob-num blob-num-deletion empty-cell"></td>${code('blob-code-deletion', t)}</tr>`;
const hunk = (t: string) => `<tr class="js-expandable-line"><td class="blob-num blob-num-expandable" colspan="2"></td><td class="blob-code blob-code-inner blob-code-hunk">${t}</td></tr>`;
const thread = (id: string, inner: string, resolved = false) =>
  `<tr class="inline-comments"><td><turbo-frame id="review-thread-or-comment-id-${id}"><review-thread-collapsible data-resolved="${resolved}">${inner}<a class="author">alice</a><div class="js-comment-body"><p>hi</p></div></review-thread-collapsible></turbo-frame></td></tr>`;

function page(rows: string, extra = ''): Document {
  return new DOMParser().parseFromString(`<html><body>
    <form class="js-prose-diff-toggle-form" action="/o/r/diffs/0?sha1=${'a'.repeat(40)}&amp;sha2=${SHA}"></form>
    <div class="file" data-tagsearch-path="docs/a.md" data-file-deleted="false">
      <button aria-label="Display the source diff"></button><button aria-label="Display the rich diff"></button>
      <table class="diff-table"><tbody>${rows}</tbody></table>
    </div>${extra}</body></html>`, 'text/html');
}
const url = new URL('https://github.com/o/r/pull/9/files');

describe('classic adapter', () => {
  it('recognises the classic page only', () => {
    expect(pageLooksSupported(page(''))).toBe(true);
    expect(pageLooksSupported(page('', '<div role="region" id="diff-x"></div>'))).toBe(false);
  });

  it('finds Markdown files with the head SHA from the toggle form', () => {
    expect(findMarkdownFiles(page(''), url)).toMatchObject([{ path: 'docs/a.md', repo: 'o/r', pr: 9, headSha: SHA }]);
    expect(findMarkdownFiles(page(''), new URL('https://github.com/o/r/pull/9/files/abc'))).toEqual([]);
  });

  it('finds .mmd files as Mermaid', () => {
    const kinds = (path: string) => {
      const doc = page('');
      doc.querySelector('.file')!.setAttribute('data-tagsearch-path', path);
      return findMarkdownFiles(doc, url).map((f) => [f.path, f.kind]);
    };
    expect(kinds('docs/a.markdown')).toEqual([['docs/a.markdown', 'markdown']]);
    expect(kinds('chart.mmd')).toEqual([['chart.mmd', 'mermaid']]);
    expect(kinds('chart.Mmd')).toEqual([['chart.Mmd', 'mermaid']]);
    expect(kinds('chart.txt')).toEqual([]);
  });

  it('reads rows, hunks, and removed lines', () => {
    const doc = page(hunk('@@ -1,3 +1,3 @@ Title') + ctx(1, 1, 'a') + del(2, 'b') + add(2, 'c') + ctx(3, 3, 'd'));
    const [f] = findMarkdownFiles(doc, url);
    const d = readDiff(f);
    expect(d.changedLines).toEqual([2]);
    expect([...d.rightLineText.keys()]).toEqual([1, 2, 3]);
    expect(readHunks(f)).toEqual([{ header: '@@ -1,3 +1,3 @@ Title', start: 1 }]);
  });

  it('reads split-view rows from the R cell (Review Focus 5)', () => {
    const split = `<tr>${num('L', 4)}${code('blob-code-context', 'old')}${num('R', 6)}${code('blob-code-context', 'new')}</tr>`;
    const [f] = findMarkdownFiles(page(split), url);
    expect([...readDiff(f).rightLineText]).toEqual([[6, 'new']]);
  });

  it('reads threads: multi-line, single-line from the row above, left-start mapping, resolved', () => {
    const multi = '<div>Comment on lines <span class="js-multi-line-preview-start">+2</span> to <span class="js-multi-line-preview-end">+3</span></div>';
    const fromLeft = '<div>Comment on lines <span class="js-multi-line-preview-start">-2</span> to <span class="js-multi-line-preview-end">+3</span></div>';
    const leftOnly = '<div>Comment on lines <span class="js-multi-line-preview-start">-2</span> to <span class="js-multi-line-preview-end">-2</span></div>';
    const doc = page(ctx(1, 1, 'a') + del(2, 'b') + add(2, 'c') + thread('11', multi) + ctx(3, 3, 'd') + thread('12', '', true) + thread('13', fromLeft) + thread('14', leftOnly));
    const [f] = findMarkdownFiles(doc, url);
    expect(readThreads(f).map(({ id, startLine, endLine, resolved }) => ({ id, startLine, endLine, resolved }))).toEqual([
      { id: '11', startLine: 2, endLine: 3, resolved: false },
      { id: '12', startLine: 3, endLine: 3, resolved: true },
      { id: '13', startLine: 2, endLine: 3, resolved: false },
    ]);
    expect(readThreads(f)[0].comments).toEqual([{ author: 'alice', bodyHtml: '<p>hi</p>' }]);
  });

  it('drops a single-line thread in the left half of a split-view comment row', () => {
    const splitRow = (l: number, r: number, t: string) => `<tr>${num('L', l)}${code('blob-code-context', t)}${num('R', r)}${code('blob-code-context', t)}</tr>`;
    const frame = (id: string) => `<turbo-frame id="review-thread-or-comment-id-${id}"><review-thread-collapsible data-resolved="false"><a class="author">alice</a><div class="js-comment-body"><p>hi</p></div></review-thread-collapsible></turbo-frame>`;
    const comments = (left: string, right: string) =>
      `<tr class="inline-comments"><td class="empty-cell"></td><td class="line-comments">${left}</td><td class="empty-cell"></td><td class="line-comments">${right}</td></tr>`;
    const doc = page(splitRow(1, 1, 'a') + comments(frame('21'), frame('22')) + splitRow(2, 2, 'b') + comments(frame('23'), ''));
    const [f] = findMarkdownFiles(doc, url);
    expect(readThreads(f).map(({ id, startLine, endLine }) => ({ id, startLine, endLine }))).toEqual([{ id: '22', startLine: 1, endLine: 1 }]);
  });

  it('ignores diff-like rows inside a comment (suggested change)', () => {
    const suggestion = `<table class="suggested-change"><tbody>${del(2, 'old')}${add(9, 'new')}${hunk('@@ -9 +9 @@ fake')}</tbody></table>`;
    const comment = `<tr class="inline-comments"><td><turbo-frame id="review-thread-or-comment-id-31"><review-thread-collapsible data-resolved="false"><a class="author">alice</a><div class="js-comment-body">${suggestion}</div></review-thread-collapsible></turbo-frame></td></tr>`;
    const doc = page(hunk('@@ -1,2 +1,2 @@') + ctx(1, 1, 'a') + comment + ctx(2, 2, 'b'));
    const [f] = findMarkdownFiles(doc, url);
    const d = readDiff(f);
    expect(d.changedLines).toEqual([]);
    expect(d.removed).toEqual([]);
    expect([...d.rightLineText.keys()]).toEqual([1, 2]);
    expect(readHunks(f)).toEqual([{ header: '@@ -1,2 +1,2 @@', start: 1 }]);
    expect(readThreads(f).map((t) => [t.id, t.startLine])).toEqual([['31', 1]]);
  });

  it('maps a left start past a comment row holding a suggested change', () => {
    const suggestion = `<table class="suggested-change"><tbody>${add(9, 'new')}</tbody></table>`;
    const comment = `<tr class="inline-comments"><td><turbo-frame id="review-thread-or-comment-id-41"><review-thread-collapsible data-resolved="false"><a class="author">alice</a><div class="js-comment-body">${suggestion}</div></review-thread-collapsible></turbo-frame></td></tr>`;
    const fromLeft = '<div>Comment on lines <span class="js-multi-line-preview-start">-2</span> to <span class="js-multi-line-preview-end">+3</span></div>';
    const doc = page(ctx(1, 1, 'a') + del(2, 'b') + comment + add(2, 'c') + ctx(3, 3, 'd') + thread('42', fromLeft));
    const [f] = findMarkdownFiles(doc, url);
    expect(readThreads(f).find((t) => t.id === '42')).toMatchObject({ startLine: 2, endLine: 3 });
  });
});
