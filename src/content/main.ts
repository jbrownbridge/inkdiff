import './content.css';
import { registerBuiltInProviders } from '../core/comment-draft';
import { featuresOff, isDisabled, refreshKillswitch, type LocalArea } from '../core/killswitch';
import { browserScheduler, createPrefetcher } from '../core/prefetch';
import { sessionForViewer, sessionRepoMemory, sessionSourceStore, type SessionArea } from '../core/session-cache';
import { cachedSource, createSourceFetcher, removeLegacyCopies } from '../core/source-fetch';
import { createGitHubAdapter } from '../github/adapter';
import { viewerLogin } from '../github/read';
import { createClassicAdapter } from '../github/classic/adapter';
import { PRE_CLASS, rememberEarly } from '../page/early';
import { loadSettingsOrDefault } from '../settings/settings';
import { FileController } from './controller';
import { renderFile } from './render-cache';
import { startRouter } from './router';

registerBuiltInProviders();
/** Prefetch requests in flight at once (low priority, after load). */
const PREFETCH_PARALLEL = 3;
/** Larger prefetched sources are fetched but not parsed ahead (parsing ~200 KB takes ~50 ms). */
const PRERENDER_MAX_CHARS = 200_000;
// Earlier builds cached sources and drafts in github.com's session storage: remove those copies.
removeLegacyCopies((() => { try { return sessionStorage; } catch { return null; } })());
// Reloads read sources from chrome.storage.session (extension-only memory), not the network.
const sessionArea = (() => {
  try {
    const area = chrome.storage.session as unknown as SessionArea | undefined;
    return area ? sessionForViewer(area, viewerLogin(document)) : null;
  } catch { return null; }
})();
const session = sessionArea ? sessionSourceStore(sessionArea) : undefined;
const repos = sessionRepoMemory(sessionArea);
const fetchFastest = createSourceFetcher((input, init) => fetch(input, init), repos.memory);
const source = cachedSource(async (ref, opts) => { await repos.ready; return fetchFastest(ref, opts); }, session);
// Fetch, then parse, each file ahead of time: a file is ready before it scrolls into view.
const scheduler = browserScheduler(window);
const prefetch = createPrefetcher(async (ref, low) => {
  const text = await source(ref, { low });
  await scheduler.idle();
  // A very large file parses in one long task: leave it for when the reader opens it.
  if (text.length <= PRERENDER_MAX_CHARS) renderFile(ref, text);
}, scheduler, PREFETCH_PARALLEL);

const storage = (() => { try { return localStorage; } catch { return null; } })();
// Earlier builds kept the kill-switch answer in github.com's local storage, where pages could change it.
try { storage?.removeItem('inkdiff-killswitch'); } catch { /* storage blocked */ }
const version = chrome.runtime.getManifest().version;
const local = (() => { try { return chrome.storage.local as unknown as LocalArea; } catch { return null; } })();
// Check the kill switch for next time, when the page is idle.
void scheduler.afterLoad().then(() => scheduler.idle()).then(() => refreshKillswitch(local));

void Promise.all([isDisabled(version, local), featuresOff(version, local), loadSettingsOrDefault()]).then(([disabled, off, settings]) => {
  if (disabled) {
    // Switched off remotely: GitHub's own diff shows (undo page.js's early hide) and nothing else runs.
    document.documentElement.classList.remove(PRE_CLASS);
    console.info(`[Inkdiff] v${version} is switched off (see killswitch.json); GitHub's own view is shown.`);
    return;
  }
  // Next page load: hide Markdown source diffs from the first paint (src/page/early.ts).
  const early = settings.renderedByDefault && !off.has('early-hide');
  rememberEarly(early, storage);
  if (!early) document.documentElement.classList.remove(PRE_CLASS);
  // A feature switched off remotely falls back: threads as our own cards, the fallback form.
  const github = createGitHubAdapter();
  if (off.has('host-threads')) github.hostThread = undefined;
  if (off.has('native-form')) github.openNativeForm = undefined;
  startRouter({
    doc: document,
    adapters: [github, createClassicAdapter()],
    prefetch,
    makeController: (file, adapter) => new FileController(file, { adapter, fetchSource: (ref) => source(ref), settings, doc: document }),
  });
}).catch((e: unknown) => {
  // Whatever went wrong, GitHub's own diff must show: undo page.js's early hide.
  document.documentElement.classList.remove(PRE_CLASS);
  console.warn('[Inkdiff] could not start; GitHub\'s own view is shown.', e);
});
