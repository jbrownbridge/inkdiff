import { chromium } from '@playwright/test';

export async function ensureLoggedIn(profileDir: string): Promise<void> {
  const ctx = await chromium.launchPersistentContext(profileDir, { channel: 'chromium', headless: false });
  try {
    const page = await ctx.newPage();
    await page.goto('https://github.com/');
    const current = await page.locator('meta[name="user-login"]').getAttribute('content').catch(() => null);
    if (current) return;
    await page.goto('https://github.com/login');
    console.log('Log in to GitHub in the open window. Waiting up to 5 minutes…');
    await page.waitForFunction(() => !!document.querySelector('meta[name="user-login"]')?.getAttribute('content'), null, { timeout: 300_000 });
  } finally {
    await ctx.close();
  }
}
