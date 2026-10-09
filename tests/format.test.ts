import { formatText } from '../src/core/format';

describe('formatText', () => {
  it('wraps a selection in bold and keeps it selected', () => {
    expect(formatText('a word here', 2, 6, 'bold')).toEqual({ value: 'a **word** here', start: 4, end: 8 });
  });
  it('inserts italic markers with the caret between them', () => {
    expect(formatText('ab', 1, 1, 'italic')).toEqual({ value: 'a__b', start: 2, end: 2 });
  });
  it('turns a multi-line selection into a fenced code block', () => {
    expect(formatText('x\ny', 0, 3, 'code').value).toBe('```\nx\ny\n```');
  });
  it('selects the url placeholder of a new link', () => {
    const e = formatText('see docs', 4, 8, 'link');
    expect(e.value).toBe('see [docs](url)');
    expect(e.value.slice(e.start, e.end)).toBe('url');
  });
  it('prefixes every touched line', () => {
    expect(formatText('one\ntwo', 1, 5, 'quote').value).toBe('> one\n> two');
    expect(formatText('one\ntwo', 0, 7, 'ol').value).toBe('1. one\n2. two');
    expect(formatText('x', 0, 0, 'task').value).toBe('- [ ] x');
  });
  it('inserts mention and reference markers at the caret', () => {
    expect(formatText('hi ', 3, 3, 'mention')).toEqual({ value: 'hi @', start: 4, end: 4 });
    expect(formatText('', 0, 0, 'reference').value).toBe('#');
  });
});
