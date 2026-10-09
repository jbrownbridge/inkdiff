import { readFileSync } from 'node:fs';
import { initOptions } from '../src/options/options';
import { DEFAULT_SETTINGS, loadSettings, loadSettingsOrDefault, saveSettings, type SyncArea } from '../src/settings/settings';

function fakeArea(initial: Record<string, unknown> = {}): SyncArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    async get(defaults) { return { ...defaults, ...data }; },
    async set(items) { Object.assign(data, items); },
  };
}

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings(fakeArea())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ renderedByDefault: true, autoRenderMermaid: false, showOnlyChanged: true });
  });

  it('saves a partial patch', async () => {
    const area = fakeArea();
    await saveSettings({ renderedByDefault: true }, area);
    expect(await loadSettings(area)).toEqual({ renderedByDefault: true, autoRenderMermaid: false, showOnlyChanged: true });
  });
});

describe('showOnlyChanged', () => {
  it('defaults to true', async () => {
    expect(DEFAULT_SETTINGS.showOnlyChanged).toBe(true);
    expect((await loadSettings(fakeArea())).showOnlyChanged).toBe(true);
  });
  it('loads a stored false as false', async () => {
    expect((await loadSettings(fakeArea({ showOnlyChanged: false }))).showOnlyChanged).toBe(false);
  });
});

describe('loadSettingsOrDefault', () => {
  it('falls back to defaults when storage fails', async () => {
    const area: SyncArea = { get: async () => { throw new Error('no storage'); }, set: async () => {} };
    expect(await loadSettingsOrDefault(area)).toEqual(DEFAULT_SETTINGS);
  });
  it('falls back to defaults when chrome storage is unavailable', async () => {
    expect(await loadSettingsOrDefault()).toEqual(DEFAULT_SETTINGS);
  });
  it('returns stored settings', async () => {
    expect(await loadSettingsOrDefault(fakeArea({ autoRenderMermaid: true }))).toEqual({ renderedByDefault: true, autoRenderMermaid: true, showOnlyChanged: true });
  });
});

describe('options page', () => {
  it('shows stored values and saves changes', async () => {
    const html = readFileSync('src/options/options.html', 'utf8');
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '');
    const area = fakeArea({ autoRenderMermaid: true });
    await initOptions(document, area);
    const rendered = document.getElementById('renderedByDefault') as HTMLInputElement;
    const mermaid = document.getElementById('autoRenderMermaid') as HTMLInputElement;
    expect(rendered.checked).toBe(true);
    expect(mermaid.checked).toBe(true);
    expect((document.getElementById('showOnlyChanged') as HTMLInputElement).checked).toBe(true);
    rendered.click();
    await vi.waitFor(() => {
      expect(area.data.renderedByDefault).toBe(false);
      expect(document.getElementById('status')!.textContent).toBe('Saved');
    });
  });
});
