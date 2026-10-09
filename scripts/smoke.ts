// Live smoke test of the logged-in "Files changed" page with the built extension (read-only: it
// clicks nothing that posts). Usage: npm run smoke -- <PR changes URL>
// Needs `npm run build` first and a logged-in profile in .auth/profile (see e2e/lib/login.ts).
import { chromium, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const url = process.argv[2];
if (!url) { console.error('Usage: npm run smoke -- https://github.com/<owner>/<repo>/pull/<n>/changes'); process.exit(1); }
const ext = resolve('dist');

/** Loads the page; reports whether a Markdown source diff ever painted with no rendered view in its file. */
async function load(page: Page) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
  // A string, not a function: tsx would add helpers the page does not have.
  const flashed = (await page.evaluate(`new Promise((done) => {
    const start = performance.now();
    let flashed = false;
    const md = 'table[data-diff-anchor]:is([aria-label$=".md" i], [aria-label$=".mmd" i])';
    const tick = () => {
      for (const t of document.querySelectorAll(md)) {
        const region = t.closest('[role="region"]');
        if (t.offsetParent !== null && !region?.classList.contains('mdr-src') && !region?.querySelector('.mdr-panel')) flashed = true;
      }
      if (document.querySelector('.mdr-panel .mdr-body')) return done({ flashed, panelMs: Math.round(performance.now() - start) });
      if (performance.now() - start > 30000) return done({ flashed, panelMs: null });
      requestAnimationFrame(tick);
    };
    tick();
  })`)) as { flashed: boolean; panelMs: number | null };
  return { ...flashed, totalMs: Date.now() - t0 };
}

const ctx = await chromium.launchPersistentContext('.auth/profile', {
  channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const first = await load(page);
  const second = await load(page); // early hide and source cache now primed
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    panels: document.querySelectorAll('.mdr-panel .mdr-body').length,
    gutterCells: document.querySelectorAll('.mdr-gutter-cell').length,
    githubThreads: document.querySelectorAll('.mdr-panel [data-marker-id]:not([data-marker-id="new-comment"])').length,
    leftInDiff: [...document.querySelectorAll('table[data-diff-anchor] [data-marker-id]:not([data-marker-id="new-comment"])')]
      .filter((m) => m.closest('[role="region"]')?.querySelector('.mdr-panel')).length,
    fallbackCards: document.querySelectorAll('.mdr-panel .mdr-thread').length,
  }));
  const report = { first, second, ...state, errors };
  console.log(JSON.stringify(report, null, 2));
  const ok = state.panels > 0 && state.gutterCells > 0 && !second.flashed && second.panelMs !== null && errors.length === 0;
  if (!ok) { console.error('SMOKE FAILED'); process.exitCode = 1; }
} finally {
  await ctx.close();
}
