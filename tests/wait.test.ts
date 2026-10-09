import { TimeoutError, waitFor } from '../src/core/wait';

describe('waitFor', () => {
  it('resolves when the DOM changes so the probe passes', async () => {
    const p = waitFor(() => document.querySelector('#late'), 1000, document.body);
    const el = document.createElement('div');
    el.id = 'late';
    document.body.append(el);
    await expect(p).resolves.toBe(el);
  });

  it('rejects after the timeout', async () => {
    await expect(waitFor(() => null, 20, document.body)).rejects.toBeInstanceOf(TimeoutError);
  });
});
