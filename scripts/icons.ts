// Renders assets/icon.svg to the PNG sizes the manifest and the store need: npm run icons
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('assets/icon.svg', 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    // Chrome Web Store: the 128px icon is 96px of artwork with 16px of clear padding.
    const art = size === 128 ? 96 : size;
    const pad = (size - art) / 2;
    await page.setContent(`<html><body style="margin:0;background:transparent;padding:${pad}px">${svg.replace('<svg ', `<svg width="${art}" height="${art}" style="display:block" `)}</body></html>`);
    await page.screenshot({ path: `public/icons/${size}.png`, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('Wrote public/icons/{16,32,48,128}.png');
