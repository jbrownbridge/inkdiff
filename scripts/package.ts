// Writes inkdiff-<version>.zip from dist/, reproducibly: sorted entries, fixed timestamps, no
// extra file attributes, so the same commit always gives the same bytes (and the same attestation).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as { version: string };
const out = resolve(`inkdiff-${version}.zip`);
rmSync(out, { force: true });

const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative('dist', p));
  }
})('dist');

const fixed = new Date('1980-01-01T00:00:00Z');
for (const f of files) utimesSync(join('dist', f), fixed, fixed);
execFileSync('zip', ['-X', '-D', '-q', out, ...files], { cwd: 'dist', stdio: 'inherit', env: { ...process.env, TZ: 'UTC' } });
console.log(`Wrote ${out} (${files.length} files)`);
