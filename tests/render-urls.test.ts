import { renderMarkdown } from '../src/render/render';

const CTX = { repo: 'o/r', headSha: 'a'.repeat(40), path: 'docs/guide/intro.md' };
const SHA = CTX.headSha;

function dom(src: string, ctx: typeof CTX | undefined = CTX): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = renderMarkdown(src, ctx).html;
  return el;
}

describe('renderMarkdown URL rewriting', () => {
  it('rewrites relative images to raw URLs at the head commit', () => {
    expect(dom('![d](img/a.png)\n').querySelector('img')!.getAttribute('src')).toBe(`https://github.com/o/r/raw/${SHA}/docs/guide/img/a.png`);
    expect(dom('![d](../../top.png)\n').querySelector('img')!.getAttribute('src')).toBe(`https://github.com/o/r/raw/${SHA}/top.png`);
    expect(dom('<img src="./b.png" alt="b">\n').querySelector('img')!.getAttribute('src')).toBe(`https://github.com/o/r/raw/${SHA}/docs/guide/b.png`);
  });

  it('rewrites relative links to blob URLs and resolves ../', () => {
    const a = dom('[x](../other.md#part)\n').querySelector('a')!;
    expect(a.getAttribute('href')).toBe(`https://github.com/o/r/blob/${SHA}/docs/other.md#part`);
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(dom('[x](/README.md)\n').querySelector('a')!.getAttribute('href')).toBe(`https://github.com/o/r/blob/${SHA}/README.md`);
  });

  it('keeps anchors and absolute links', () => {
    expect(dom('[x](#section)\n').querySelector('a')!.getAttribute('href')).toBe('#section');
    const a = dom('[x](https://example.com/p)\n').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/p');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps images hosted on GitHub', () => {
    for (const src of [
      'https://github.com/o/r/raw/main/a.png',
      'https://user-images.githubusercontent.com/1/a.png',
      'https://camo.githubusercontent.com/abc',
      'https://raw.githubusercontent.com/o/r/main/a.png',
    ]) expect(dom(`![d](${src})\n`).querySelector('img')!.getAttribute('src')).toBe(src);
  });

  it('replaces off-GitHub images with a link that does not auto-load', () => {
    const root = dom('![a chart](https://tracker.example.com/pixel.png)\n');
    expect(root.querySelector('img')).toBeNull();
    const a = root.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://tracker.example.com/pixel.png');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.textContent).toBe('Image: a chart');
  });

  it('labels an off-GitHub image without alt by its host', () => {
    const root = dom('<img src="https://evil.example.net/x.gif">\n');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('a')!.textContent).toBe('Image: evil.example.net');
  });

  it('drops srcset so it cannot load off-GitHub images', () => {
    const root = dom('<img src="https://github.com/o/r/raw/main/a.png" srcset="https://evil.example.net/x.png 2x">\n');
    expect(root.querySelector('img')!.hasAttribute('srcset')).toBe(false);
  });

  it('still gates image hosts without a context', () => {
    const root = dom('![a](https://evil.example.net/x.gif)\n', undefined);
    expect(root.querySelector('img')).toBeNull();
  });
});

describe('security review regressions', () => {
  it('gives <area> links rel and repo resolution like <a>', () => {
    const area = dom('<map name="m"><area shape="rect" coords="0,0,1,1" href="other.md"></map>\n').querySelector('area')!;
    expect(area.getAttribute('rel')).toBe('noopener noreferrer');
    expect(area.getAttribute('href')).toBe(`https://github.com/o/r/blob/${SHA}/docs/guide/other.md`);
  });

  it('loads images from github.com only on file and attachment paths', () => {
    const src = (md: string) => dom(md).querySelector('img')?.getAttribute('src') ?? null;
    expect(src('![x](https://github.com/logout)\n')).toBeNull();
    expect(src('![x](https://github.com/settings/profile)\n')).toBeNull();
    expect(src('![x](https://github.com/user-attachments/assets/abc)\n')).toBe('https://github.com/user-attachments/assets/abc');
    expect(src('![x](https://github.com/o/r/raw/main/a.png)\n')).toBe('https://github.com/o/r/raw/main/a.png');
    expect(src('![x](https://github.com/o/r/blob/main/a.png?raw=true)\n')).toBe('https://github.com/o/r/blob/main/a.png?raw=true');
    expect(src('![x](https://user-images.githubusercontent.com/1/a.png)\n')).toBe('https://user-images.githubusercontent.com/1/a.png');
  });

  it('an unclosed link never wraps later blocks (where comment forms and threads go)', () => {
    for (const src of [
      '- <a href="https://evil.example/">Click\n- two\n\n# After\n\nPara\n',
      '<a href="https://evil.example/">\n\n# After\n\nPara\n',
      'Text <a href="x">open\n\n# After\n',
      'Text <b>bold <a href="x">open\n\n> quote\n',
    ]) {
      const root = dom(src);
      expect(root.querySelector(':is(a, b) [data-src-start]'), src).toBeNull();
      expect(root.querySelector('h1, blockquote'), src).not.toBeNull();
      // Stable when parsed again (the page parses this string once more).
      const again = document.createElement('div');
      again.innerHTML = root.innerHTML;
      expect(again.querySelector(':is(a, b) [data-src-start]'), src).toBeNull();
    }
  });

  it('keeps ordinary links and their text', () => {
    const a = dom('See [the guide](guide.md) and <a href="https://example.com">this</a>.\n').querySelectorAll('a');
    expect([...a].map((n) => n.textContent)).toEqual(['the guide', 'this']);
  });

  it('no author element can wrap later blocks (label, details, fieldset, map, ruby, math, audio)', () => {
    for (const open of ['<template>', '<noscript>', '<select>', '<textarea>', '<label for="approve">', '<label>', '<details open><summary>s</summary>', '<fieldset disabled>', '<map name="m">', '<audio>', '<ruby>', '<math><mi>', '<span>', '<div>']) {
      const src = `x </p>${open} y\n\n# After\n\n- item\n`;
      const root = dom(src);
      const wrappers = [...root.querySelectorAll('[data-src-start]')].filter((b) => {
        for (let p = b.parentElement; p && p !== root; p = p.parentElement) if (!p.hasAttribute('data-src-start') && !/^(THEAD|TBODY|TFOOT|TD|TH|SECTION)$/.test(p.tagName)) return true;
        return false;
      });
      expect(wrappers, open).toEqual([]);
      expect(root.querySelector('h1'), open).not.toBeNull();
    }
  });

  it('drops attributes and elements that hide or redirect author content', () => {
    const root = dom('<label for="approve">a</label> <font color="#fff" size="1">w</font> <bdo dir="rtl">b</bdo> <audio>c</audio> <video>v</video> <template>t</template>\n');
    expect(root.querySelector('[for], [color], [size], bdo, audio, video, template')).toBeNull();
  });

  it('keeps inline HTML in a table cell inline (no block inside the cell)', () => {
    const root = dom('| a | b |\n|---|---|\n| <b>x</b> | y |\n');
    expect(root.querySelector('td [data-src-start]')).toBeNull();
    expect(root.querySelector('td b')!.textContent).toBe('x');
  });
});
