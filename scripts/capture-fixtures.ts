import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExpected, realGh, type Expected } from '../e2e/lib/expected';
import { ensureLoggedIn } from '../e2e/lib/login';
import { scrubDocument } from '../e2e/lib/scrub';

const USAGE = 'Usage: npm run fixtures:capture -- --pr <PR URL> [--path <file>] [--out <dir>]\n  e.g. --pr https://github.com/rust-lang/rfcs/pull/4008';

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`);
  return value;
}

const prArg = arg('--pr');
if (!prArg) fail('Missing required --pr <PR URL>');
const outDir = arg('--out') ?? 'tests/fixtures/github';
const PROFILE = '.auth/profile';

let expected: Expected;
try {
  expected = buildExpected(realGh, prArg, arg('--path'));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const { pageUrl, path } = expected;

await ensureLoggedIn(PROFILE);
const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'chromium', headless: true });
let html: string;
try {
  const page = await ctx.newPage();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  const login = (await page.locator('meta[name="user-login"]').getAttribute('content')) ?? '';
  if (!login) throw new Error('Not logged in. Run the capture again and log in when the window opens.');
  await page.getByText(path).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  html = await page.evaluate(scrubDocument, login);
} finally {
  await ctx.close();
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'files-page.html'), html);
writeFileSync(join(outDir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`Wrote ${outDir}/files-page.html and expected.json`);
