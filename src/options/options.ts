import { loadSettings, saveSettings, type Settings, type SyncArea } from '../settings/settings';

export async function initOptions(doc: Document, area: SyncArea): Promise<void> {
  const settings = await loadSettings(area);
  const status = doc.getElementById('status');
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const box = doc.getElementById(key) as HTMLInputElement | null;
    if (!box) continue;
    box.checked = settings[key];
    box.addEventListener('change', () => {
      void saveSettings({ [key]: box.checked }, area).then(() => {
        if (status) status.textContent = 'Saved';
      });
    });
  }
}

if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
  void initOptions(document, chrome.storage.sync as unknown as SyncArea);
}
