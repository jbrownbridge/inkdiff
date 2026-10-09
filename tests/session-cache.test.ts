import { sessionForViewer, sessionRepoMemory, sessionSourceStore, type SessionArea } from '../src/core/session-cache';
import { cachedSource } from '../src/core/source-fetch';

function area(): SessionArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => { Object.assign(data, items); },
    remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
    clear: async () => { for (const k of Object.keys(data)) delete data[k]; },
    getKeys: async () => Object.keys(data),
  };
}
const ref = { repo: 'o/r', sha: 'abc', path: 'a.md' };

describe('session source store', () => {
  it('serves a reload without a fetch, and never uses the page\'s storage', async () => {
    sessionStorage.clear();
    localStorage.clear();
    const a = area();
    const get = vi.fn(async () => 'text');
    expect(await cachedSource(get, sessionSourceStore(a))(ref)).toBe('text');
    await new Promise((r) => setTimeout(r, 0));
    const again = vi.fn(async () => 'other');
    expect(await cachedSource(again, sessionSourceStore(a))(ref)).toBe('text');
    expect(again).not.toHaveBeenCalled();
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });

  it('drops the oldest entries past the budget', async () => {
    const a = area();
    const store = sessionSourceStore(a, 10);
    await store.set('one', 'aaaa');
    await store.set('two', 'bbbb');
    await store.set('three', 'cccc');
    expect(await store.get('one')).toBeNull();
    expect(await store.get('two')).toBe('bbbb');
    expect(await store.get('three')).toBe('cccc');
    await store.set('huge', 'x'.repeat(11));
    expect(await store.get('huge')).toBeNull();
  });

  it('falls back to fetching when session storage is closed or fails', async () => {
    const closed: SessionArea = { get: async () => { throw new Error('Access to storage is not allowed from this context.'); }, set: async () => { throw new Error('x'); }, remove: async () => {} };
    const get = vi.fn(async () => 'text');
    expect(await cachedSource(get, sessionSourceStore(closed))(ref)).toBe('text');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('session repo memory', () => {
  it('remembers repos that need the session route across pages', async () => {
    const a = area();
    const first = sessionRepoMemory(a);
    await first.ready;
    first.memory.add('o/private');
    await new Promise((r) => setTimeout(r, 0));
    const next = sessionRepoMemory(a);
    await next.ready;
    expect(next.memory.has('o/private')).toBe(true);
    expect(next.memory.has('o/public')).toBe(false);
  });
});

describe('session tied to the signed-in account', () => {
  it('keeps sources for the same account and drops them when the account changes or signs out', async () => {
    const a = area();
    await sessionSourceStore(sessionForViewer(a, 'alice')).set('k', 'private text');
    expect(await sessionSourceStore(sessionForViewer(a, 'alice')).get('k')).toBe('private text');
    expect(await sessionSourceStore(sessionForViewer(a, 'bob')).get('k')).toBeNull();
    await sessionSourceStore(sessionForViewer(a, 'bob')).set('k', 'bob text');
    expect(await sessionSourceStore(sessionForViewer(a, null)).get('k')).toBeNull();
  });
});

describe('session store quota (UTF-8 bytes, other tabs)', () => {
  it('counts UTF-8 bytes, not characters', async () => {
    const a = area();
    const store = sessionSourceStore(a, 12);
    await store.set('cjk', '漢字漢字'); // 4 chars, 12 bytes
    await store.set('more', 'x');
    expect(await store.get('cjk')).toBeNull();
    expect(await store.get('more')).toBe('x');
  });

  it('recovers from a quota error: drops the oldest half and sources no index lists, then writes', async () => {
    const a = area();
    const store = sessionSourceStore(a, 1000);
    for (const k of ['a', 'b', 'c', 'd']) await store.set(k, k.repeat(10));
    a.data['src:orphan'] = 'lost by another tab';
    const set = a.set;
    let fail = true;
    a.set = async (items) => { if (fail) { fail = false; throw new Error('QUOTA_BYTES quota exceeded'); } return set(items); };
    await store.set('e', 'eeee');
    expect(await store.get('e')).toBe('eeee');
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
    expect(await store.get('d')).toBe('dddddddddd');
    expect('src:orphan' in a.data).toBe(false);
  });
});
