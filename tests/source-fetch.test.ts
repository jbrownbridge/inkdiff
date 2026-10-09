import { MEMORY_ENTRIES, cachedSource, createSourceFetcher, directRawUrl, fetchSource, isSafeRef, MAX_SOURCE_BYTES, rawUrl, removeLegacyCopies, SourceError } from '../src/core/source-fetch';

const ref = { repo: 'o/r', sha: 'abc123', path: 'docs/guide.md' };

function respond(body: string | Uint8Array | ArrayBuffer, init: ResponseInit = {}) {
  // Convert Uint8Array to ArrayBuffer for jsdom compatibility
  const bodyToUse = body instanceof Uint8Array ? body.buffer : body;
  return vi.fn(async () => new Response(bodyToUse as BodyInit, init));
}

describe('rawUrl', () => {
  it('builds a github.com raw URL', () => {
    expect(rawUrl(ref)).toBe('https://github.com/o/r/raw/abc123/docs/guide.md');
  });

  it('encodes each path segment', () => {
    expect(rawUrl({ ...ref, path: 'docs/my file#1/é.md' })).toBe('https://github.com/o/r/raw/abc123/docs/my%20file%231/%C3%A9.md');
  });
});

describe('fetchSource', () => {
  it('returns the text and sends same-origin credentials', async () => {
    const f = respond('# Hi\n', { status: 200 });
    expect(await fetchSource(ref, f)).toBe('# Hi\n');
    expect(f).toHaveBeenCalledWith(rawUrl(ref), { credentials: 'same-origin', signal: expect.any(AbortSignal) });
  });

  it('reports not-found', async () => {
    await expect(fetchSource(ref, respond('', { status: 404 }))).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('reports other HTTP errors', async () => {
    await expect(fetchSource(ref, respond('', { status: 500 }))).rejects.toMatchObject({ reason: 'http', status: 500 });
  });

  it('reports network errors', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(fetchSource(ref, f)).rejects.toBeInstanceOf(SourceError);
    await expect(fetchSource(ref, f)).rejects.toMatchObject({ reason: 'network' });
  });

  it('rejects files larger than 1 MB', async () => {
    const big = new Uint8Array(MAX_SOURCE_BYTES + 1).buffer;
    await expect(fetchSource(ref, respond(big, { status: 200 }))).rejects.toMatchObject({ reason: 'too-large' });
  });
});

describe('isSafeRef (security review)', () => {
  it('accepts plain file refs and rejects anything that could name another URL', () => {
    expect(isSafeRef(ref)).toBe(true);
    for (const path of ['../../x/y/raw/s/z.md', 'a/./b.md', 'a//b.md', '/a.md', 'a/..']) expect(isSafeRef({ ...ref, path }), path).toBe(false);
    expect(isSafeRef({ ...ref, repo: 'o/r/x' })).toBe(false);
    for (const repo of ['../..', 'x/..', './r']) expect(isSafeRef({ ...ref, repo }), repo).toBe(false);
    expect(isSafeRef({ ...ref, sha: '../main' })).toBe(false);
  });

  it('never fetches an unsafe ref', async () => {
    const f = respond('x');
    await expect(fetchSource({ ...ref, path: '../../settings' }, f)).rejects.toMatchObject({ reason: 'not-found' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('fetch priority', () => {
  it('asks for low network priority when prefetching', async () => {
    const f = respond('x');
    await fetchSource(ref, f, { low: true });
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ priority: 'low', credentials: 'same-origin' });
    await fetchSource(ref, f);
    expect((f.mock.calls[1] as unknown[])[1]).not.toHaveProperty('priority');
  });
});

describe('cachedSource', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it('fetches a file once per commit, sharing one request', async () => {
    const get = vi.fn(async () => 'text');
    const fetchCached = cachedSource(get);
    expect(await Promise.all([fetchCached(ref), fetchCached(ref)])).toEqual(['text', 'text']);
    expect(await fetchCached(ref)).toBe('text');
    expect(get).toHaveBeenCalledTimes(1);
    await fetchCached({ ...ref, sha: 'def' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('never copies a source into the page\'s storage (other scripts on github.com could read it)', async () => {
    await cachedSource(async () => 'private source')(ref);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('retries after a failure', async () => {
    const get = vi.fn().mockRejectedValueOnce(new SourceError('network', 'x')).mockResolvedValueOnce('ok');
    const fetchCached = cachedSource(get);
    await expect(fetchCached(ref)).rejects.toThrow(SourceError);
    expect(await fetchCached(ref)).toBe('ok');
  });
});

describe('removeLegacyCopies', () => {
  it('removes sources and drafts earlier builds left in session storage, and nothing else', () => {
    sessionStorage.clear();
    sessionStorage.setItem('mdr-src:o/r@s:a.md', 'secret');
    sessionStorage.setItem('mdr:draft:o/r#1:a.md:1-1', 'draft');
    sessionStorage.setItem('github-own-key', 'keep');
    removeLegacyCopies(sessionStorage);
    expect(Object.keys(sessionStorage)).toEqual(['github-own-key']);
  });
});

describe('createSourceFetcher (fastest safe route)', () => {
  const memory = () => { const s = new Set<string>(); return { has: (r: string) => s.has(r), add: (r: string) => { s.add(r); }, s }; };

  it('fetches a public repo straight from the raw host, without cookies or Referer', async () => {
    const f = vi.fn(async () => new Response('# Hi'));
    const m = memory();
    expect(await createSourceFetcher(f, m)(ref)).toBe('# Hi');
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown[])[0]).toBe('https://raw.githubusercontent.com/o/r/abc123/docs/guide.md');
    expect((f.mock.calls[0] as unknown[])[1]).toEqual({ credentials: 'omit', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal) });
    expect(m.s.size).toBe(0);
  });

  it('falls back to the github.com route with the session for a private repo, and remembers it', async () => {
    const f = vi.fn(async (url: string) => (url.startsWith('https://raw.githubusercontent.com/') ? new Response('', { status: 404 }) : new Response('private')));
    const m = memory();
    const get = createSourceFetcher(f as unknown as typeof fetch, m);
    expect(await get(ref)).toBe('private');
    expect(f.mock.calls.map((c) => c[0])).toEqual([directRawUrl(ref), rawUrl(ref)]);
    expect((f.mock.calls[1] as unknown[])[1]).toEqual({ credentials: 'same-origin', signal: expect.any(AbortSignal) });
    expect(m.has('o/r')).toBe(true);
    f.mockClear();
    await get({ ...ref, path: 'other.md' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(rawUrl({ ...ref, path: 'other.md' }));
  });

  it('does not mark a public repo private when the raw host is merely offline or slow', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const m = memory();
    await expect(createSourceFetcher(f as unknown as typeof fetch, m)(ref)).rejects.toMatchObject({ reason: 'network' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(m.s.size).toBe(0);
  });

  it('does not retry a file that is too large', async () => {
    const f = vi.fn(async () => new Response('x', { headers: { 'content-length': String(MAX_SOURCE_BYTES + 1) } }));
    await expect(createSourceFetcher(f, memory())(ref)).rejects.toMatchObject({ reason: 'too-large' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('fetch timeout', () => {
  it('gives up on a request that hangs', async () => {
    const hang = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))));
    await expect(fetchSource(ref, hang as unknown as typeof fetch, { timeoutMs: 10 })).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('memory cache bound', () => {
  it('keeps at most MEMORY_ENTRIES sources, dropping the least recently used', async () => {
    const get = vi.fn(async (r: { path: string }) => r.path);
    const cached = cachedSource(get);
    for (let i = 0; i <= MEMORY_ENTRIES; i++) await cached({ ...ref, path: `f${i}.md` });
    get.mockClear();
    await cached({ ...ref, path: `f${MEMORY_ENTRIES}.md` });
    expect(get).not.toHaveBeenCalled();
    await cached({ ...ref, path: 'f0.md' });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
