import { defineConfig } from 'vite';

// The page-world script: tiny, no CSS, no public files.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/page/main.ts', formats: ['iife'], name: 'inkdiffPage', fileName: () => 'page.js' },
  },
});
