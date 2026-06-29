/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Backend
  readonly VITE_API_URL?: string;

  // Solana
  readonly VITE_SOLANA_NETWORK?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_TREASURY_WALLET?: string;
  readonly VITE_PROGRAM_ID?: string;
  readonly VITE_LYNX_MINT?: string;

  // Auth
  readonly VITE_MAGIC_PUBLISHABLE_KEY?: string;

  // Payments
  readonly VITE_MOONPAY_API_KEY?: string;

  // Monitoring
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
