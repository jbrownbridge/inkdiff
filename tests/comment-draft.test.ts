import {
  clearProviders, getProviders, quoteProvider, registerBuiltInProviders, suggestProvider, type DraftContext,
} from '../src/core/comment-draft';

const base: DraftContext = {
  repo: 'o/r', pr: 1, path: 'docs/guide.md', headSha: 'abc',
  lines: { start: 2, end: 3 },
  source: 'line one\nline two\nline three\nline four\n',
};

describe('providers', () => {
  beforeEach(() => clearProviders());

  it('registers quote then suggest', () => {
    registerBuiltInProviders();
    expect(getProviders().map((p) => p.id)).toEqual(['quote', 'suggest']);
  });

  it('quotes the selected text', async () => {
    expect(await quoteProvider.draft({ ...base, selectedText: 'two\nline' })).toBe('> two\n> line\n\n');
  });

  it('quotes the source lines when nothing is selected', async () => {
    expect(await quoteProvider.draft(base)).toBe('> line two\n> line three\n\n');
  });

  it('suggests the current source of the lines', async () => {
    expect(await suggestProvider.draft(base)).toBe('```suggestion\nline two\nline three\n```\n');
  });

  it('uses a longer fence when the source holds backticks', async () => {
    const ctx = { ...base, source: 'a\n```js\nx\n```\n', lines: { start: 2, end: 4 } };
    expect(await suggestProvider.draft(ctx)).toBe('````suggestion\n```js\nx\n```\n````\n');
  });

  it('handles CRLF sources', async () => {
    const ctx = { ...base, source: base.source.replace(/\n/g, '\r\n') };
    expect(await suggestProvider.draft(ctx)).toBe('```suggestion\nline two\nline three\n```\n');
  });
});
