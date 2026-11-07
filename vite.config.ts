import { configDefaults, defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `import bytes from './file.mp3?bytes'` gives the file's size on disk, so the
 * Sound strip's download sizes are derived from the committed files rather
 * than written by hand. Runs before Vite's asset handling, which would
 * otherwise answer with the file's URL.
 */
export function fileBytes(): Plugin {
  return {
    name: 'file-bytes',
    enforce: 'pre',
    load(id) {
      const [file, query] = id.split('?');
      if (query !== 'bytes') return null;
      return `export default ${statSync(file).size};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), fileBytes()],
  build: {
    // A Tone's samples are always fetched through their own hashed URL, which
    // Vercel caches as immutable (vercel.json), never inlined into a script as a
    // data URL, however small.
    assetsInlineLimit: (file) => (file.endsWith('.mp3') ? false : undefined),
  },
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    // perf/.out/ holds the performance workbench's base checkout; .claude/ holds
    // local agent worktrees. Neither is this checkout's suite.
    exclude: [...configDefaults.exclude, 'perf/.out/**', '.claude/**'],
  },
});
