import { defineConfig } from 'vite';

// The background service worker: tiny, no CSS, no public files.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/background/main.ts', formats: ['iife'], name: 'inkdiffBackground', fileName: () => 'background.js' },
  },
});
