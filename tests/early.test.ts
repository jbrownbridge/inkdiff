import { EARLY_KEY, markEarly, PRE_CLASS, rememberEarly } from '../src/page/early';

describe('early hide', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove(PRE_CLASS); });

  it('marks <html> unless rendered-by-default was turned off (on by default)', () => {
    markEarly(document, localStorage);
    expect(document.documentElement.classList.contains(PRE_CLASS)).toBe(true);
    document.documentElement.classList.remove(PRE_CLASS);
    rememberEarly(false, localStorage);
    expect(localStorage.getItem(EARLY_KEY)).toBe('0');
    markEarly(document, localStorage);
    expect(document.documentElement.classList.contains(PRE_CLASS)).toBe(false);
  });

  it('does nothing when storage throws', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(() => { rememberEarly(true, broken); markEarly(document, broken); }).not.toThrow();
    expect(document.documentElement.classList.contains(PRE_CLASS)).toBe(false);
  });
});
