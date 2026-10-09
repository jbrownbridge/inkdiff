import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'https://github.com/mermaid-js/mermaid/pull/8250/files';
const ext = resolve('dist');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Logged out: classic page. Open the first Markdown file's rich view (a local UI action; nothing is posted).
  await page.locator('.file[data-tagsearch-path$=".md"] button[aria-label="Display the rich diff"]').first().click();
  const panel = page.locator('.mdr-panel .mdr-body').first();
  await panel.waitFor({ timeout: 30_000 });
  const cells = await page.locator('.mdr-gutter-cell').count();
  const note = await page.locator('.mdr-readonly').first().textContent();
  console.log(JSON.stringify({ ok: true, gutterCells: cells, readOnlyNote: note }));
} finally {
  await ctx.close();
}
