/** Calls `onChange` (debounced) when GitHub's DOM under `container` changes, ignoring our own panel. */
export function observeContainer(container: HTMLElement, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inPanel = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('.mdr-panel') != null;
  const observer = new MutationObserver((records) => {
    const relevant = records.some((r) => !inPanel(r.target) && ![...r.addedNodes, ...r.removedNodes].every(inPanel));
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 200);
  });
  observer.observe(container, { childList: true, subtree: true });
  return () => { observer.disconnect(); clearTimeout(timer); };
}
