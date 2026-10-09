import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', environmentOptions: { jsdom: { url: 'https://github.com/' } }, globals: true, include: ['tests/**/*.test.ts'] },
});
