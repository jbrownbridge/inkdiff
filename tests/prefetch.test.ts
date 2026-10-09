import { createPrefetcher, type PrefetchScheduler } from '../src/core/prefetch';

const ref = (path: string) => ({ repo: 'o/r', sha: 's', path });

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { p, open };
}

describe('createPrefetcher', () => {
  it('waits for page load, then fetches one file at a time in idle time at low priority', async () => {
    const load = gate();
    const idles: (() => void)[] = [];
    const scheduler: PrefetchScheduler = { afterLoad: () => load.p, idle: () => new Promise((r) => idles.push(r)) };
    const inFlight: (() => void)[] = [];
    const get = vi.fn<(ref: unknown, low: boolean) => Promise<void>>(() => new Promise<void>((r) => inFlight.push(r)));
    const prefetch = createPrefetcher(get, scheduler);
    prefetch([ref('a.md'), ref('b.md'), ref('a.md')]);
    await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
    load.open();
    await vi.waitFor(() => expect(idles).toHaveLength(1));
    expect(get).not.toHaveBeenCalled();
    idles[0]();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith(ref('a.md'), true);
    await new Promise((r) => setTimeout(r, 5));
    expect(idles).toHaveLength(1); // b waits for a to finish
    inFlight[0]();
    await vi.waitFor(() => expect(idles).toHaveLength(2));
    idles[1]();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get.mock.calls[1][0]).toEqual(ref('b.md'));
  });

  it('keeps going after a failure and ignores repeats', async () => {
    const scheduler: PrefetchScheduler = { afterLoad: async () => {}, idle: async () => {} };
    const get = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    const prefetch = createPrefetcher(get, scheduler);
    prefetch([ref('a.md'), ref('b.md')]);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    prefetch([ref('a.md')]);
    await new Promise((r) => setTimeout(r, 5));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('runs a few at a time when asked', async () => {
    const scheduler: PrefetchScheduler = { afterLoad: async () => {}, idle: async () => {} };
    const inFlight: (() => void)[] = [];
    const get = vi.fn(() => new Promise<void>((r) => inFlight.push(r)));
    createPrefetcher(get, scheduler, 3)([ref('a.md'), ref('b.md'), ref('c.md'), ref('d.md')]);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    inFlight[0]();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(4));
  });

  it('stops for the page at a rate-limit or forbidden answer', async () => {
    const scheduler: PrefetchScheduler = { afterLoad: async () => {}, idle: async () => {} };
    const get = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(Object.assign(new Error('HTTP 429'), { status: 429 })).mockResolvedValue('ok');
    const prefetch = createPrefetcher(get, scheduler);
    prefetch([ref('a.md'), ref('b.md'), ref('c.md'), ref('d.md')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(get).toHaveBeenCalledTimes(2);
    prefetch([ref('e.md')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
