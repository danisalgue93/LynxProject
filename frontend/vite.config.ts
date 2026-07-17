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
        // Only 'buffer' is strictly required by @solana/web3.js in the browser.
        // Including crypto/stream/util adds ~200KB to the bundle unnecessarily.
        include: ['buffer'],
        globals: {
          Buffer: true,
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
      hmr: true,
      port: 5173,
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          // Without explicit chunking, the Solana SDK ended up inlined into every
          // lazy chunk that touches it: CreateDuelModal alone shipped 743 kB
          // because importing useProgram drags in web3.js + the wallet adapters.
          // Splitting the heavy, rarely-changing vendors into their own chunks
          // means each is downloaded and cached once, instead of being duplicated
          // across route bundles and re-downloaded whenever app code changes.
          manualChunks: {
            'vendor-solana': ['@solana/web3.js', '@solana/spl-token'],
            'vendor-wallet': [
              '@solana/wallet-adapter-base',
              '@solana/wallet-adapter-react',
              '@solana/wallet-adapter-react-ui',
              '@solana/wallet-adapter-wallets',
            ],
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-charts': ['recharts'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/__tests__/setup.ts'],
    },
  };
});
