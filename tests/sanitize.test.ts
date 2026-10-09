import { renderMarkdown } from '../src/render/render';

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('renderMarkdown sanitizer', () => {
  it('never applies author <style>; shows it as text instead', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('<style>body{display:none}</style>\n\n# After\n').html;
    expect(el.querySelector('style')).toBeNull();
    expect(el.textContent).toContain('<style>body{display:none}');
    expect(el.querySelector('h1')).not.toBeNull();
  });

  it('author tags that would swallow the rest of the file show as text; later blocks render', () => {
    for (const tag of ['textarea', 'template', 'noscript', 'select', 'title', 'xmp', 'plaintext', 'iframe', 'script']) {
      const el = document.createElement('div');
      el.innerHTML = renderMarkdown(`x </p><${tag}> y\n\n# After\n\n<!-- unclosed\n`).html;
      expect(el.querySelector('h1'), tag).not.toBeNull();
      expect(el.querySelector(tag), tag).toBeNull();
    }
  });

  it('drops style attributes', () => {
    const root = dom(renderMarkdown('<div style="position:fixed;inset:0;z-index:99999">x</div>\n').html);
    expect(root.innerHTML).not.toContain('position:fixed');
    expect(root.querySelector('[style]')).toBeNull();
    expect(root.textContent).toContain('x');
  });

  it('drops forms and form controls', () => {
    const out = renderMarkdown('<form action="/logout" method="post"><button>go</button></form>\n').html;
    expect(out).not.toMatch(/<form|<button|<input|action=/);
  });

  it('strips author classes, ids, and spoofed position attributes', () => {
    const root = dom(renderMarkdown('<p class="btn btn-primary" id="x" data-src-start="1" data-src-end="999">spoof</p>\n').html);
    const p = [...root.querySelectorAll('p')].find((e) => e.textContent?.includes('spoof'))!;
    expect(p.getAttribute('class')).toBeNull();
    expect(p.id).not.toBe('x');
    expect(p.hasAttribute('data-src-start')).toBe(false);
    expect(p.hasAttribute('data-src-end')).toBe(false);
    expect(root.innerHTML).not.toContain('999');
    // the wrapper we stamp ourselves keeps its real position
    const wrap = root.querySelector('div.md-html') as HTMLElement;
    expect(wrap.dataset.srcStart).toBe('1');
    expect(wrap.dataset.srcEnd).toBe('1');
  });

  it('strips author data-mdr-* and our own md-/mdr- classes on author HTML', () => {
    const root = dom(renderMarkdown('<div class="md-mermaid mdr-thread" data-mdr-lines="9">a</div>\n').html);
    expect(root.querySelector('[data-mdr-lines]')).toBeNull();
    expect(root.querySelector('.md-mermaid')).toBeNull();
    expect(root.querySelector('.mdr-thread')).toBeNull();
  });

  it('keeps our own classes and code language classes', () => {
    const root = dom(renderMarkdown('```js\nx\n```\n\n- [ ] task\n').html);
    expect(root.querySelector('code.language-js')).not.toBeNull();
    expect(root.querySelector('li.task-list-item')).not.toBeNull();
    expect(root.querySelector('ul.contains-task-list')).not.toBeNull();
  });

  it('renders task checkboxes as inert markers', () => {
    const root = dom(renderMarkdown('- [x] done\n- [ ] todo\n').html);
    expect(root.querySelector('input')).toBeNull();
    expect([...root.querySelectorAll('.mdr-task')].map((e) => e.textContent)).toEqual(['\u2611', '\u2610']);
  });

  it('keeps footnote ids and links consistent', () => {
    const root = dom(renderMarkdown('Text[^1]\n\n[^1]: note\n').html);
    const ref = root.querySelector('sup a') as HTMLAnchorElement;
    expect(root.querySelector(ref.getAttribute('href')!)).not.toBeNull();
  });
});

describe('SVG off-GitHub loads', () => {
  const CTX = { repo: 'o/r', headSha: 'a'.repeat(40), path: 'README.md' };
  const hostile = [
    '<svg><image xlink:href="https://evil.example/x.png"/></svg>',
    '<svg><image href="https://evil.example/x.png"/></svg>',
    '<svg><filter id="f"><feImage href="https://evil.example/f.png"/></filter></svg>',
    '<svg><filter id="f"><feImage xlink:href="https://evil.example/f.png"/></filter></svg>',
    '<svg><use xlink:href="https://evil.example/s.svg#a"/></svg>',
    '<svg><rect filter="url(https://evil.example/f.svg#x)" fill="url(https://evil.example/g.svg#y)"/></svg>',
  ];
  for (const html of hostile) {
    it(`blocks ${html}`, () => {
      expect(renderMarkdown(html + '\n', CTX).html).not.toContain('evil.example');
    });
  }

  it('drops <dialog>', () => {
    expect(renderMarkdown('<dialog open>x</dialog>\n').html).not.toContain('<dialog');
  });

  const escaped = [
    ['fill', '\\75rl(https://evil.example/x#a)'],
    ['mask', '\\55RL(https://evil.example/x#a)'],
    ['fill', 'u\\rl(https://evil.example/x#a)'],
    ['clip-path', 'ur\\l(https://evil.example/x#a)'],
    ['cursor', '\\75rl(https://evil.example/x.png),auto'],
    ['fill', 'URL(https://evil.example/a)'],
    ['fill', 'url ( https://evil.example/a )'],
    ['fill', "url('#g2')"],
    ['fill', 'url(#grad)'],
    ['mask', "image-set('https://evil.example/x.png' 1x)"],
    ['mask', "-webkit-image-set('https://evil.example/x.png' 1x)"],
    ['mask', "image-set('https://evil.example/x.png' type('image/png'))"],
    ['fill', "cross-fade(url(https://evil.example/x.png), red, 50%)"],
    ['fill', "cross-fade('https://evil.example/x.png', red)"],
  ];
  for (const [attr, value] of escaped) {
    it(`drops ${attr}="${value}" from svg elements`, () => {
      const out = renderMarkdown(`<svg ${attr}="${value}"><rect ${attr}="${value}"/></svg>\n`, CTX).html;
      expect(out).not.toContain('evil.example');
      expect(out).not.toContain(`${attr}=`);
    });
  }

  it('removes inline SVG, MathML, progress and meter like GitHub, keeping their text visible', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('Text <math><mi mathsize="0">S1</mi><mphantom><mi>S2</mi></mphantom></math> <progress>S3</progress> <meter>S4</meter>\n\n<svg width="1" height="1">\n<text y="15">S5</text>\n</svg>\n').html;
    expect(el.querySelector('svg, math, progress, meter, mphantom')).toBeNull();
    for (const t of ['S1', 'S2', 'S3', 'S4', 'S5']) expect(el.textContent).toContain(t);
  });

  it('keeps our GFM footnotes section, but not an author section around later blocks', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('Note[^1].\n\nx </p><section aria-hidden="true" role="button"> y\n\n# After\n\n[^1]: The note.\n').html;
    expect(el.querySelector('section[data-footnotes] > ol > li')).not.toBeNull();
    expect(el.querySelector('section:not([data-footnotes]) [data-src-start]')).toBeNull();
  });

  it('still loads GitHub-hosted images', () => {
    const out = renderMarkdown('<img src="https://user-images.githubusercontent.com/x.png">\n', CTX).html;
    expect(out).toContain('src="https://user-images.githubusercontent.com/x.png"');
  });
});
