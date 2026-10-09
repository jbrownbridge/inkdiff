import manifest from '../public/manifest.json';

describe('manifest', () => {
  it('asks only for github.com and storage', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(['https://github.com/*']);
    expect(manifest.permissions).toEqual(['storage']);
    // The only background work: open chrome.storage.session to content scripts (src/background).
    expect(manifest.background).toEqual({ service_worker: 'background.js' });
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    expect(manifest.web_accessible_resources).toEqual([
      { resources: ['mermaid/*'], matches: ['https://github.com/*'], use_dynamic_url: false },
    ]);
  });

  it('injects the content script on github.com only', () => {
    expect(manifest.content_scripts).toEqual([
      { matches: ['https://github.com/*'], js: ['page.js'], run_at: 'document_start', world: 'MAIN' },
      { matches: ['https://github.com/*'], js: ['content.js'], css: ['content.css'], run_at: 'document_end' },
    ]);
  });
});
