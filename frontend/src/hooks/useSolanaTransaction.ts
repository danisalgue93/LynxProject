/**
 * useSolanaTransaction
 *
 * Sends real on-chain transactions on devnet (or mainnet-beta) and registers
 * them with the Lynx backend so they appear in the explorer.
 *
 * Currently used for:
 *   - depositSol: sends a SOL transfer from user wallet → treasury, then
 *     notifies the backend with the confirmed signature.
 *
 * IMPORTANT: You must have VITE_SOLANA_NETWORK=devnet and
 * VITE_TREASURY_WALLET set in your .env for this to work.
 */

import { useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { apiFetch, API_BASE_URL } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { getTxExplorerUrl } from '../lib/explorer';

const TREASURY_WALLET = import.meta.env.VITE_TREASURY_WALLET || '';

const SOLANA_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK as string) || 'devnet';

/**
 * Sends a SOL transfer on-chain, waits for confirmation, then registers
 * the signature with the backend.
 *
 * Returns { signature, explorerUrl }.
 */
export function useSolanaTransaction() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { addToast } = useToast();

  /**
   * Transfer `amount` SOL from the connected wallet to the treasury.
   * Used for real deposits.
   */
  const sendSolTransfer = useCallback(
    async (amount: number, memo?: string): Promise<string> => {
      if (!publicKey) {
        throw new Error('Connect a Solana wallet to send transactions.');
      }
      if (!TREASURY_WALLET) {
        throw new Error(
          'VITE_TREASURY_WALLET is not set. Add it to your .env file.'
        );
      }

      const lamports = Math.round(amount * LAMPORTS_PER_SOL);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(TREASURY_WALLET),
          lamports,
        })
      );

      // Get a recent blockhash
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      // Send and confirm
      const signature = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      // Register with Lynx backend so it appears in the explorer link UI
      const explorerUrl = getTxExplorerUrl(signature, SOLANA_NETWORK);
      try {
        await apiFetch('/api/transactions', {
          method: 'POST',
          body: JSON.stringify({
            signature,
            wallet: publicKey.toBase58(),
            intent: { action: 'deposit_sol', amount, memo },
          }),
        });
        addToast({
          type: 'success',
          message: `Deposited ${amount} SOL on-chain`,
          url: explorerUrl,
          duration: 12000,
        });
      } catch (e) {
        // Backend registration failure is non-critical — tx is already confirmed
        console.warn('Failed to register tx with backend:', e);
      }

      return signature;
    },
    [publicKey, connection, sendTransaction, addToast]
  );

  /**
   * Check the devnet SOL balance of the connected wallet.
   * Useful to verify airdrop worked before testing.
   */
  const getDevnetBalance = useCallback(async (): Promise<number> => {
    if (!publicKey) return 0;
    const lamports = await connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }, [publicKey, connection]);

  /**
   * Request a devnet airdrop of 2 SOL for testing.
   * Only works on devnet.
   */
  const requestDevnetAirdrop = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error('Connect a wallet first.');
    if (SOLANA_NETWORK !== 'devnet') {
      throw new Error('Airdrop is only available on devnet.');
    }
    const signature = await connection.requestAirdrop(
      publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    addToast({
      type: 'success',
      message: '2 devnet SOL airdropped to your wallet!',
      url: getTxExplorerUrl(signature, SOLANA_NETWORK),
      duration: 10000,
    });
    return signature;
  }, [publicKey, connection, addToast]);

  return { sendSolTransfer, getDevnetBalance, requestDevnetAirdrop };
}
