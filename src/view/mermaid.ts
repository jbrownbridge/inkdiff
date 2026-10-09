import type { Mermaid } from 'mermaid';
import { button, div, message } from './dom';
import { loadMermaidModule } from './mermaid-loader';
import { diagramLoadsResources, MERMAID_SECURE_KEYS, sanitizeMermaidSvg } from './mermaid-sanitize';

let ready: Promise<Mermaid> | null = null;
let seq = 0;

function load(): Promise<Mermaid> {
  ready ??= loadMermaidModule().then((m) => {
    // suppressErrorRendering: on a parse error Mermaid otherwise draws its "Syntax error" bomb
    // graphic in a temporary element at the end of the page and leaves it there.
    m.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, secure: MERMAID_SECURE_KEYS });
    return m;
  });
  ready.catch(() => { ready = null; });
  return ready;
}

/** The source <pre> is hidden by CSS once the diagram renders; this button shows it again. */
function sourceToggle(host: HTMLElement): HTMLButtonElement {
  const b = button(host.ownerDocument, 'mdr-mermaid-source', 'Show source');
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', () => {
    const shown = host.classList.toggle('mdr-mermaid-show-source');
    b.textContent = shown ? 'Hide source' : 'Show source';
    b.setAttribute('aria-expanded', String(shown));
  });
  return b;
}

/** Mermaid renders in temporary elements (`#<id>`, `#d<id>`) on <body>; a failed render can leave them. */
function removeLeftovers(doc: Document, id: string): void {
  for (const leftover of [doc.getElementById(id), doc.getElementById(`d${id}`)]) leftover?.remove();
}

async function renderDiagram(host: HTMLElement): Promise<void> {
  const code = host.querySelector('code')?.textContent ?? '';
  if (diagramLoadsResources(code, host.ownerDocument)) {
    host.append(div(host.ownerDocument, 'mdr-error', 'Diagram not rendered: its styles could load files from other sites (url(), image-set() or @import). The source is shown instead.'));
    return;
  }
  const id = `mdr-mermaid-${++seq}`;
  try {
    const mermaid = await load();
    const { svg } = await mermaid.render(id, code);
    const out = div(host.ownerDocument, 'mdr-mermaid-svg');
    out.innerHTML = sanitizeMermaidSvg(svg, host.ownerDocument.defaultView as Window & typeof globalThis);
    host.append(out);
    host.classList.add('mdr-mermaid-rendered');
    host.prepend(sourceToggle(host));
  } catch (e) {
    removeLeftovers(host.ownerDocument, id);
    host.append(div(host.ownerDocument, 'mdr-error', `Could not render diagram: ${message(e)}`));
  }
}

export function setupMermaid(body: HTMLElement, auto: boolean): void {
  body.querySelectorAll<HTMLElement>('.md-mermaid').forEach((host) => {
    if (auto) { void renderDiagram(host); return; }
    const b = button(host.ownerDocument, 'mdr-mermaid-render', 'Render diagram');
    b.addEventListener('click', () => { b.remove(); void renderDiagram(host); });
    host.prepend(b);
  });
}
