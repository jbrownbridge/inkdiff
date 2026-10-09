import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { buildExpected, realGh } from '../e2e/lib/expected';
import { scrubDocument } from '../e2e/lib/scrub';

const USAGE = 'Usage: npm run fixtures:classic -- --pr <PR URL> [--path <file>] [--out <dir>]\n  e.g. --pr https://github.com/rust-lang/rfcs/pull/3982';

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

let expected: ReturnType<typeof buildExpected>;
try {
  expected = buildExpected(realGh, prArg, arg('--path'));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const outDir = arg('--out') ?? `tests/fixtures/github-classic/pr-${expected.pr}`;

// Logged out: no cookies are sent.
const res = await fetch(expected.pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/154' } });
if (!res.ok) fail(`GET ${expected.pageUrl} returned ${res.status}`);
const doc = new JSDOM(await res.text()).window.document;
const html = scrubDocument('', doc);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'files-page.html'), html);
writeFileSync(join(outDir, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`Wrote ${outDir}/files-page.html and expected.json`);
