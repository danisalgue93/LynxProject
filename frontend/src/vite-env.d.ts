/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOLANA_NETWORK?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_LYNX_PROGRAM_ID?: string;
  readonly VITE_MAGIC_PUBLISHABLE_KEY?: string;
  readonly VITE_MOONPAY_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
