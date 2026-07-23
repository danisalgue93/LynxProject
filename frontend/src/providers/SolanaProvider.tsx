import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
// Standalone per-wallet adapter packages instead of @solana/wallet-adapter-wallets:
// only Phantom + Solflare are used, but the kitchen-sink package pulls in dozens
// of other wallets (Keystone, Particle, WalletConnect/Reown…) whose transitive
// deps accounted for most of the npm-audit high/moderate advisories and bloated
// the bundle (audit frontend-2).
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';

export function SolanaProvider({ children }: { children: React.ReactNode }) {
  const configuredNetwork = import.meta.env.VITE_SOLANA_NETWORK || 'mainnet-beta';
  const network = configuredNetwork === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : configuredNetwork === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;
  
  const endpoint = useMemo(
    () => import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(network),
    [network]
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
