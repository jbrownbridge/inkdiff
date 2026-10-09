import { cpSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Mermaid ships as separate extension files, loaded on demand (see src/view/mermaid-loader.ts).
function copyMermaid(): Plugin {
  return {
    name: 'copy-mermaid',
    apply: 'build',
    closeBundle() {
      const src = 'node_modules/mermaid/dist';
      cpSync(`${src}/mermaid.esm.min.mjs`, 'dist/mermaid/mermaid.esm.min.mjs');
      cpSync(`${src}/chunks/mermaid.esm.min`, 'dist/mermaid/chunks/mermaid.esm.min', {
        recursive: true,
        filter: (file) => !file.endsWith('.map'),
      });
    },
  };
}

export default defineConfig({
  plugins: [copyMermaid()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/content/main.ts',
      formats: ['iife'],
      name: 'inkdiff',
      fileName: () => 'content.js',
      cssFileName: 'content',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
