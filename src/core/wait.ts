export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`No response from GitHub after ${ms / 1000} seconds`);
    this.name = 'TimeoutError';
  }
}

export function waitFor<T>(probe: () => T | null | undefined | false, ms: number, root: Node = document): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const first = probe();
    if (first) { resolve(first); return; }
    const observer = new MutationObserver(() => {
      const value = probe();
      if (value) { observer.disconnect(); clearTimeout(timer); resolve(value); }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new TimeoutError(ms)); }, ms);
  });
}
