/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  },
});
