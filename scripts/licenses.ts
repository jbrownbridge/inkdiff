// Writes dist/THIRD_PARTY_LICENSES.txt (and copies LICENSE and NOTICE into dist/): the license of every production dependency bundled into
// the extension (from package-lock.json, dev-only packages skipped). Run by `npm run package`.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface LockEntry { version?: string; license?: string; dev?: boolean; devOptional?: boolean; optional?: boolean }
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockEntry> };

const parts: string[] = ['Inkdiff bundles the following open-source packages.\n'];
const missing: string[] = [];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path.startsWith('node_modules/') || entry.dev || entry.devOptional) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const files = existsSync(path) ? readdirSync(path) : [];
  const file = files.find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  // The lockfile can omit the license; the package's own package.json (license or licenses[]) has it.
  const pkg = existsSync(join(path, 'package.json')) ? JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as { license?: unknown; licenses?: { type?: string }[] } : {};
  let license = entry.license ?? (typeof pkg.license === 'string' ? pkg.license : pkg.licenses?.map((l) => l.type).join(' OR ')) ?? 'unknown';
  // No license file: use the README's License section, which holds the copyright line.
  const readme = files.find((f) => /^readme(\.|$)/i.test(f));
  const fromReadme = readme ? readFileSync(join(path, readme), 'utf8').match(/\n#*\s*licen[cs]e\s*\n[=-]*\s*\n([\s\S]{0,1500}?)(\n#|\n\S+\n[=-]{3,}|$)/i)?.[1]?.trim() : undefined;
  const text = file ? readFileSync(join(path, file), 'utf8').trim() : fromReadme ?? '';
  if (license === 'unknown' && /^the mit license/i.test(text)) license = 'MIT';
  // Apache-2.0 section 4(d): a package's NOTICE file travels with it.
  const noticeFile = files.find((f) => /^notice(\.|$)/i.test(f));
  const notice = noticeFile ? `\n\n--- NOTICE ---\n${readFileSync(join(path, noticeFile), 'utf8').trim()}` : '';
  if (!text) missing.push(`${name} (${license})`);
  const label = license.startsWith('(') ? license : `(${license})`;
  parts.push(`${'='.repeat(72)}\n${name} ${entry.version ?? ''} ${label}\n${'='.repeat(72)}\n${text || `License: ${license} (no license text in the package)`}${notice}\n`);
}
writeFileSync('dist/THIRD_PARTY_LICENSES.txt', parts.join('\n'));
// Inkdiff's own license and notice ship in the package too (Apache-2.0, section 4).
copyFileSync('LICENSE', 'dist/LICENSE');
copyFileSync('NOTICE', 'dist/NOTICE');
console.log(`Wrote dist/THIRD_PARTY_LICENSES.txt (${parts.length - 1} packages${missing.length ? `; no license file: ${missing.join(', ')}` : ''})`);
