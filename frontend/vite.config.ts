/// <reference types="vitest" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      nodePolyfills({
        include: ['buffer', 'crypto', 'stream', 'util'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      })
    ],
    define: {
      // GEMINI_API_KEY intentionally NOT included here.
      // Embedding API keys in the client bundle exposes them in public JS.
      // If you need Gemini, proxy calls through the backend (frontend/server.ts).
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'whatwg-fetch': path.resolve(__dirname, './empty-module.js'),
        'node-fetch': path.resolve(__dirname, './empty-module.js'),
        'cross-fetch': path.resolve(__dirname, './empty-module.js')
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/__tests__/setup.ts'],
    },
  };
});
