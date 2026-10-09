import type { Mermaid } from 'mermaid';

// Mermaid ships as separate extension files (web_accessible_resources) and is imported only when a diagram renders.
export async function loadMermaidModule(): Promise<Mermaid> {
  const url = chrome.runtime.getURL('mermaid/mermaid.esm.min.mjs');
  const mod = await import(/* @vite-ignore */ url);
  return mod.default as Mermaid;
}
