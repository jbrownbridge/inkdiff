import { setupMermaid } from '../../src/view/mermaid';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn<(id: string, code: string) => Promise<{ svg: string }>>(async () => ({ svg: '<svg id="ok"></svg>' })) }));
vi.mock('../../src/view/mermaid-loader', () => ({ loadMermaidModule: vi.fn(async () => mermaid) }));

function host(code = 'graph TD\n  A --> B\n'): HTMLElement {
  const body = document.createElement('div');
  body.innerHTML = '<div class="md-mermaid"><pre><code></code></pre></div>';
  body.querySelector('code')!.textContent = code;
  document.body.replaceChildren(body);
  return body;
}

describe('setupMermaid', () => {
  it('renders on click with strict security', async () => {
    const body = host();
    setupMermaid(body, false);
    expect(mermaid.render).not.toHaveBeenCalled();
    body.querySelector<HTMLButtonElement>('.mdr-mermaid-render')!.click();
    await vi.waitFor(() => expect(body.querySelector('svg#ok')).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, secure: expect.arrayContaining(['themeCSS', 'themeVariables']) }));
  });

  it('hides the source once rendered and offers a Show source toggle', async () => {
    const body = host();
    setupMermaid(body, true);
    const m = body.querySelector<HTMLElement>('.md-mermaid')!;
    await vi.waitFor(() => expect(m.classList.contains('mdr-mermaid-rendered')).toBe(true));
    const toggle = m.querySelector<HTMLButtonElement>('.mdr-mermaid-source')!;
    expect(toggle.textContent).toBe('Show source');
    expect(m.classList.contains('mdr-mermaid-show-source')).toBe(false);
    toggle.click();
    expect(m.classList.contains('mdr-mermaid-show-source')).toBe(true);
    expect(toggle.textContent).toBe('Hide source');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders at once when auto is on', async () => {
    const body = host();
    setupMermaid(body, true);
    await vi.waitFor(() => expect(body.querySelector('svg#ok')).not.toBeNull());
  });

  it('shows an error when the Mermaid module fails to load', async () => {
    vi.resetModules(); // drop the cached Mermaid promise from earlier tests
    const fresh = await import('../../src/view/mermaid');
    const freshLoader = await import('../../src/view/mermaid-loader');
    vi.mocked(freshLoader.loadMermaidModule).mockRejectedValueOnce(new Error('blocked'));
    const body = host();
    fresh.setupMermaid(body, true);
    await vi.waitFor(() => expect(body.querySelector('.mdr-error')).not.toBeNull());
    expect(body.querySelector('.mdr-error')!.textContent).toMatch(/^Could not render diagram:/);
  });

  it('leaves no Mermaid error graphic on the page when a diagram fails', async () => {
    const body = host();
    mermaid.render.mockImplementationOnce(async (id: string) => {
      // What Mermaid does on a parse error: temporary elements on <body>, then a throw.
      const tmp = document.createElement('div');
      tmp.id = `d${id}`;
      tmp.innerHTML = `<svg id="${id}"><text>Syntax error in text</text></svg>`;
      document.body.append(tmp);
      throw new Error('Parse error on line 2');
    });
    setupMermaid(body, true);
    await vi.waitFor(() => expect(body.querySelector('.mdr-error')?.textContent).toContain('Parse error on line 2'));
    expect(document.body.textContent).not.toContain('Syntax error in text');
  });

  it('sanitizes Mermaid\'s SVG before inserting it', async () => {
    const body = host();
    mermaid.render.mockImplementationOnce(async () => ({ svg: '<svg id="d"><style>.n{fill:red}</style><g><a href="javascript:alert(1)"><text>x</text></a><foreignObject><div><span>label</span><img src=x onerror="alert(1)"></div></foreignObject><script>alert(1)</script></g></svg>' }));
    setupMermaid(body, true);
    await vi.waitFor(() => expect(body.querySelector('.mdr-mermaid-svg svg')).not.toBeNull());
    const out = body.querySelector('.mdr-mermaid-svg')!;
    expect(out.querySelector('script, a, [onerror]')).toBeNull();
    expect(out.innerHTML).not.toContain('javascript:');
    expect(out.querySelector('style')!.textContent).toBe('.n{fill:red}');
    expect(out.textContent).toContain('label');
  });

  it('drops CSS in a diagram that could paint over the page or load URLs', async () => {
    const body = host();
    mermaid.render.mockImplementationOnce(async () => ({ svg: '<svg id="d"><style>#d .evil>*{position:fixed!important;z-index:9999;background:url(https://github.com/logout)}@import "x.css";</style><g class="evil" style="position: fixed; inset: 0; fill: red"><text>x</text></g></svg>' }));
    setupMermaid(body, true);
    await vi.waitFor(() => expect(body.querySelector('.mdr-mermaid-svg svg')).not.toBeNull());
    const out = body.querySelector('.mdr-mermaid-svg')!;
    const css = out.querySelector('style')!.textContent!;
    expect(css).not.toMatch(/(^|[^-])\b(position|z-index)\s*:|[^-]url\(|@import/);
    const style = out.querySelector('g')!.getAttribute('style')!;
    expect(style).not.toMatch(/(^|[^-])\b(position|inset)\s*:/);
    expect(style).toContain('fill: red');
  });

  it('does not render a diagram whose styles could load URLs, however they are spelled', async () => {
    const { diagramLoadsResources } = await import('../../src/view/mermaid-sanitize');
    for (const code of [
      'stateDiagram-v2\n[*] --> S\nclassDef x fill:url(https://host/a)\nclass S x',
      'classDiagram\nclass A\nstyle A fill:u\\rl(https://host/a)',
      'flowchart LR\nA["<span style=\'background:&#117;rl(https://h/x)\'>X</span>"]',
      'flowchart LR\nA["<span style=\'background:image-set(&quot;https://h/x&quot; 1x)\'>X</span>"]',
      'graph TD\nA["<span style=\'--a:&quot;/*&quot;;background:url(http://host/x.png)\'>X</span>"]-->B',
      'graph TD\nA["<img src=\'/any/github/path\'>"]-->B',
      'flowchart TD\nA@{ img: "/settings/sessions?track=1", label: "x" }',
      'sequenceDiagram\nparticipant Alice\nproperties Alice: {"icon": "https://attacker.example/t.png"}\nAlice->>Alice: hi',
      'sequenceDiagram\nparticipant Alice\n  Properties   Alice : {"icon": "/any/path?x"}',
      'sequenceDiagram\nparticipant Alice\ndetails Alice: user-content-x\nAlice->>Alice: hi',
      // Round 6: statements split with ";", CR line ends, escaped and quoted keys, YAML tags.
      'sequenceDiagram\nparticipant Alice\nAlice->>Alice: hi; properties Alice: {"\\u0069con": "http://h/x.png"}',
      'sequenceDiagram\rparticipant Alice\rproperties Alice: {"icon": "http://h/x.png"}',
      'sequenceDiagram\nparticipant Alice; details Alice: user-content-x\nAlice->>Alice: hi',
      "graph TD\nA@{ 'img': 'http://h/x.png' }",
      'graph TD\nA@{ !!str img: "http://h/x.png" }',
      'graph TD\nA@{ "im\\x67": "http://h/x.png" }',
      'graph TD\nA@{ label: "}", img: "http://h/x.png" }',
      'graph TD\nA@{ shape: image, url: "http://h/x.png" }',
      'graph TD\nA["<picture><source srcset=\'/x\'></picture>"]-->B',
      'graph TD\nA["<table background=\'/x\'></table>"]-->B',
      'graph TD\nA["<img\tsrc=/x>"]-->B',
      'graph TD\nA["![x](/settings)"]-->B',
      'flowchart LR\nclassDef c fill:\\75 rl(https://h)\nA:::c',
      'flowchart LR\nA["#117;rl(x)"]',
    ]) expect(diagramLoadsResources(code), code).toBe(true);
    for (const code of ['flowchart LR\nA[Start] --> B{Is it?}', 'pie title Pets\n"Dogs" : 386', 'flowchart LR\nclassDef c fill:#f9f,stroke:#333\nA:::c',
      'flowchart LR\nA[src=foo] --> B[data= value]', 'flowchart LR\nA["Hello ![world]"]', 'flowchart LR\nA["line one<br>line two"]',
      'graph TD\nA@{ icon: "fa:user", form: "square", label: "x" }', 'sequenceDiagram\nparticipant A@{ "type": "boundary" }\nA->>A: x'])
      expect(diagramLoadsResources(code), code).toBe(false);
    const body = host('stateDiagram-v2\n[*] --> S\nclassDef x fill:url(https://host/a)\nclass S x');
    mermaid.render.mockClear();
    setupMermaid(body, true);
    await vi.waitFor(() => expect(body.querySelector('.mdr-error')).not.toBeNull());
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
