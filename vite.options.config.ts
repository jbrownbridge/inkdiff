import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  root: resolve(here, 'src/options'),
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: false,
    rollupOptions: { input: resolve(here, 'src/options/options.html') },
  },
});
