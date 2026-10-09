import { HOSTED_ATTR, installHostedPatch } from '../src/page/hosted-patch';

describe('installHostedPatch', () => {
  installHostedPatch(window);
  installHostedPatch(window); // idempotent

  function moved() {
    const home = document.createElement('div');
    const away = document.createElement('div');
    const box = document.createElement('div');
    const sibling = document.createElement('span');
    home.append(sibling);
    away.append(box);
    document.body.replaceChildren(home, away);
    return { home, away, box, sibling };
  }

  it('removes a hosted element from where it is now', () => {
    const { home, away, box } = moved();
    box.setAttribute(HOSTED_ATTR, '');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(home.removeChild(box)).toBe(box);
    expect(debug).toHaveBeenCalledWith('[Inkdiff] hosted patch: removeChild of a moved element', box);
    debug.mockRestore();
    expect(away.contains(box)).toBe(false);
  });

  it('appends when inserting before a hosted element that moved', () => {
    const { home, box } = moved();
    box.setAttribute(HOSTED_ATTR, '');
    const n = document.createElement('i');
    home.insertBefore(n, box);
    expect(home.lastChild).toBe(n);
  });

  it('leaves other elements alone', () => {
    const { home, box } = moved();
    expect(() => home.removeChild(box)).toThrow();
    expect(() => home.insertBefore(document.createElement('i'), box)).toThrow();
    const s = home.firstChild!;
    expect(home.removeChild(s)).toBe(s);
  });
});
