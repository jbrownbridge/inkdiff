import { readFileSync } from 'node:fs';

describe('release docs', () => {
  it('README states the permission promise first', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('Reads github.com only. No servers. No tracking.');
  });
  it('is Apache-2.0 licensed, with a NOTICE', () => {
    expect(readFileSync('LICENSE', 'utf8')).toContain('Apache License\n                           Version 2.0, January 2004');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).license).toBe('Apache-2.0');
    expect(readFileSync('NOTICE', 'utf8')).toContain('Copyright 2026 Jason Brownbridge');
  });
});
