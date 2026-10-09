export interface Settings {
  renderedByDefault: boolean;
  autoRenderMermaid: boolean;
  showOnlyChanged: boolean;
}

export const DEFAULT_SETTINGS: Settings = { renderedByDefault: true, autoRenderMermaid: false, showOnlyChanged: true };

export interface SyncArea {
  get(keys: Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function chromeArea(): SyncArea {
  return chrome.storage.sync as unknown as SyncArea;
}

export async function loadSettings(area: SyncArea = chromeArea()): Promise<Settings> {
  const stored = await area.get({ ...DEFAULT_SETTINGS });
  return {
    renderedByDefault: stored.renderedByDefault !== false,
    autoRenderMermaid: stored.autoRenderMermaid === true,
    showOnlyChanged: stored.showOnlyChanged !== false,
  };
}

export async function saveSettings(patch: Partial<Settings>, area: SyncArea = chromeArea()): Promise<void> {
  await area.set({ ...patch });
}

/** Stored settings, or the defaults when storage is unavailable or fails. */
export async function loadSettingsOrDefault(area?: SyncArea): Promise<Settings> {
  try {
    return await loadSettings(area ?? chromeArea());
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
