import { featuresOff, isDisabled, KILLSWITCH_URL, refreshKillswitch, type LocalArea } from '../src/core/killswitch';

const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

function area(): LocalArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return { data, get: async (k) => (k in data ? { [k]: data[k] } : {}), set: async (items) => { Object.assign(data, items); } };
}

describe('kill switch', () => {
  it('is off until the list names this version', async () => {
    const a = area();
    expect(await isDisabled('1.0.0', a)).toBe(false);
    const f = json({ disabled: ['1.0.0', 7] });
    await refreshKillswitch(a, f, 1000);
    expect(f).toHaveBeenCalledWith(KILLSWITCH_URL, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(await isDisabled('1.0.0', a)).toBe(true);
    expect(await isDisabled('1.0.1', a)).toBe(false);
  });

  it('asks at most once a day', async () => {
    const a = area();
    const f = json({ disabled: [] });
    await refreshKillswitch(a, f, 1000);
    await refreshKillswitch(a, f, 1000 + 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    await refreshKillswitch(a, f, 1000 + 25 * 3600_000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('stays on when the request fails, the answer is bad, or storage throws', async () => {
    const a = area();
    await refreshKillswitch(a, vi.fn(async () => { throw new TypeError('offline'); }));
    await refreshKillswitch(a, json({}, 404));
    await refreshKillswitch(a, vi.fn(async () => new Response('not json')));
    expect(await isDisabled('1.0.0', a)).toBe(false);
    a.data.killswitch = 'bad';
    expect(await isDisabled('1.0.0', a)).toBe(false);
    const broken: LocalArea = { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } };
    expect(await isDisabled('1.0.0', broken)).toBe(false);
    await expect(refreshKillswitch(broken, json({ disabled: ['1.0.0'] }))).resolves.toBeUndefined();
  });

  it('keeps nothing in the page\'s storage (pages could switch the extension off)', async () => {
    localStorage.clear();
    await refreshKillswitch(area(), json({ disabled: ['1.0.0'] }));
    expect(localStorage.length).toBe(0);
  });

  it('switches single features off, for every version or one', async () => {
    const a = area();
    await refreshKillswitch(a, json({ disabled: [], off: ['early-hide', '1.0.0:host-threads', '0.9.0:native-form', 3] }));
    expect([...await featuresOff('1.0.0', a)].sort()).toEqual(['early-hide', 'host-threads']);
    expect([...await featuresOff('1.0.1', a)]).toEqual(['early-hide']);
    expect(await isDisabled('1.0.0', a)).toBe(false);
  });
});
