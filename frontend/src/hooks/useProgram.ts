import { useState, useCallback } from 'react';
import { Market, Duel, Proposal, Portfolio } from '../types';
import { useWallet } from '@solana/wallet-adapter-react';
import { apiFetch } from '../lib/api';
import { getManagedWalletAddress, useManagedAuthSession } from '../lib/auth';

/**
 * Web3 Program Integration Hook Structure
 * 
 * This hook is structured to be the primary interface with your Solana/Anchor smart contracts.
 * Replace the placeholder implementations below with your actual RPC calls.
 * 
 * Recommended Stack:
 * - @solana/web3.js
 * - @project-serum/anchor (or @coral-xyz/anchor)
 * - @solana/wallet-adapter-react
 */

export function useProgram() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { publicKey, signMessage } = useWallet();
  const managedSession = useManagedAuthSession();
  const wallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || '';

  const requireWallet = useCallback(() => {
    if (!wallet) {
      throw new Error('Connect or create an account before using this action.');
    }
    return wallet;
  }, [wallet]);

  const signAction = useCallback(async (action: string, payload: Record<string, unknown>) => {
    if (!publicKey || !signMessage) {
      throw new Error('Connect a Solana wallet to sign this action.');
    }
    const signatureMessage = JSON.stringify({
      app: 'LYNX',
      action,
      wallet: publicKey.toBase58(),
      payload,
      issuedAt: new Date().toISOString()
    });
    const bytes = await signMessage(new TextEncoder().encode(signatureMessage));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return {
      signature: window.btoa(binary),
      signatureMessage,
      signer: publicKey.toBase58()
    };
  }, [publicKey, signMessage]);

  const approveWallet = useCallback(async () => {
    const currentWallet = requireWallet();
    const signed = await signAction('APPROVE_INTERNAL_LEDGER', { wallet: currentWallet });
    return await apiFetch('/api/ledger/approve', {
      method: 'POST',
      body: JSON.stringify({
        wallet: currentWallet,
        externalWallet: publicKey?.toBase58(),
        ...signed
      }),
    });
  }, [publicKey, requireWallet, signAction]);

  const ensureApproved = useCallback(async () => {
    const currentWallet = requireWallet();
    const portfolio = await apiFetch<Portfolio>(`/api/portfolio?wallet=${encodeURIComponent(currentWallet)}`);
    // Managed wallets (created for email accounts) are approved server-side
    const isManaged = currentWallet.startsWith('MAGIC:');
    if (!portfolio.approvedAt) {
      if (isManaged) {
        // If a managed wallet was not approved, surface a friendly error so
        // the user can re-check email verification or contact support.
        throw new Error('Account not approved yet. Verify your email or contact support.');
      } else {
        await approveWallet();
      }
    }
    return currentWallet;
  }, [approveWallet, requireWallet]);

  // Fetch all active markets from the backend indexer
  const fetchMarkets = useCallback(async (): Promise<Market[]> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiFetch<Market[]>('/api/markets');
    } catch (err: any) {
      console.error('Error fetching markets:', err);
      setError(err.message || 'Failed to fetch markets');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Example: Place a limit order or swap on a market
  const executeTrade = useCallback(async (
    marketId: string,
    amount: number,
    side: boolean | string,
    tradeType: 'limit' | 'swap' | 'market',
    limitPrice?: number
  ) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      const position = typeof side === 'boolean' ? (side ? 'YES' : 'NO') : side;
      return await apiFetch(`/api/markets/${marketId}/trades`, {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, amount, position, tradeType, limitPrice }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const executeLynxOrder = useCallback(async (side: 'BUY' | 'SELL', amount: number, price: number) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, pair: 'LYNX/SOL', side, amount, price, currency: 'LYNX' }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const fetchOrderBook = useCallback(async (pair = 'LYNX/SOL', marketId?: string) => {
    const params = new URLSearchParams({ pair });
    if (marketId) params.set('marketId', marketId);
    return await apiFetch<any>(`/api/orderbook?${params.toString()}`);
  }, []);

  // Fetch duels from backend
  const fetchDuels = useCallback(async (): Promise<Duel[]> => {
    setIsLoading(true);
    try {
      return await apiFetch<Duel[]>('/api/duels');
    } catch (err: any) {
      console.error('Failed to fetch duels', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createDuel = useCallback(async (duelParams: any) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch('/api/duels', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, ...duelParams }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const createMarket = useCallback(async (marketParams: any) => {
    setIsLoading(true);
    try {
      const signed = await signAction('CREATE_MARKET', marketParams);
      return await apiFetch('/api/markets', {
        method: 'POST',
        body: JSON.stringify({ ...marketParams, ...signed }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [signAction]);

  // Fetch user portfolio
  const fetchPortfolio = useCallback(async (): Promise<Portfolio> => {
    setIsLoading(true);
    try {
      const currentWallet = requireWallet();
      return await apiFetch<Portfolio>(`/api/portfolio?wallet=${encodeURIComponent(currentWallet)}`);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch portfolio');
      return {
        solBalance: 0,
        lynxBalance: 0,
        totalVolume: 0,
        winRate: 0,
        holdings: [],
        history: []
      };
    } finally {
      setIsLoading(false);
    }
  }, [requireWallet]);

  // Fetch DAO proposals
  const fetchProposals = useCallback(async (): Promise<Proposal[]> => {
    setIsLoading(true);
    try {
      return await apiFetch<Proposal[]>('/api/proposals');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch proposals');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createProposal = useCallback(async (input: { title: string; description?: string; category?: string; author?: string }) => {
    setIsLoading(true);
    try {
      return await apiFetch('/api/proposals', {
        method: 'POST',
        body: JSON.stringify(input)
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create proposal');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch DAO Stats
  const fetchDaoStats = useCallback(async (): Promise<any> => {
    setIsLoading(true);
    try {
       return await apiFetch('/api/daostats');
    } catch (err: any) {
       setError(err.message || 'Failed to fetch DAO stats');
       return null;
    } finally {
       setIsLoading(false);
    }
  }, []);

  const castVote = useCallback(async (proposalId: string, voteType: 'yes' | 'no') => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch(`/api/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, voteType }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const stakeLynx = useCallback(async (amount: number) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch<Portfolio>('/api/staking/stake', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, amount }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const unstakeLynx = useCallback(async (amount: number) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch<Portfolio>('/api/staking/unstake', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, amount }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const claimRewards = useCallback(async () => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch<{ claimed: number; portfolio: Portfolio }>('/api/staking/claim', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const acceptDuel = useCallback(async (duelId: string, position?: string) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch(`/api/duels/${duelId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, side: position }),
      });
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const depositSol = useCallback(async (amount: number, onChainSignature?: string) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      const result = await apiFetch<{ portfolio: Portfolio }>('/api/ledger/deposit', {
        method: 'POST',
        body: JSON.stringify({
          wallet: currentWallet,
          currency: 'SOL',
          amount,
          provider: 'EXTERNAL_WALLET',
          signature: onChainSignature,
        }),
      });
      return result.portfolio;
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const withdrawSol = useCallback(async (amount: number) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      const result = await apiFetch<{ portfolio: Portfolio }>('/api/ledger/withdraw', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, currency: 'SOL', amount }),
      });
      return result.portfolio;
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const claimPosition = useCallback(async (positionId: string) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch<{ payout: number; currency: string; portfolio: Portfolio }>(
        `/api/positions/${positionId}/claim`,
        { method: 'POST', body: JSON.stringify({ wallet: currentWallet }) }
      );
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  // Cancel an open order — wallet goes in body (H-02 fix applied server-side)
  const cancelOrder = useCallback(async (orderId: string) => {
    setIsLoading(true);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch<{ cancelled: string; portfolio: Portfolio }>(
        `/api/orders/${orderId}`,
        { method: 'DELETE', body: JSON.stringify({ wallet: currentWallet }) }
      );
    } catch (err: any) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensureApproved]);

  const fetchTransactions = useCallback(async () => {
    try {
      return await apiFetch('/api/transactions');
    } catch (err: any) {
      console.error('Failed to fetch transactions', err);
      return [];
    }
  }, []);

  // Fetch positions for the current wallet
  const fetchPositions = useCallback(async () => {
    try {
      const currentWallet = requireWallet();
      return await apiFetch<any[]>(`/api/positions?wallet=${encodeURIComponent(currentWallet)}`);
    } catch (err: any) {
      console.error('Failed to fetch positions', err);
      return [];
    }
  }, [requireWallet]);

  return {
    isLoading,
    error,
    fetchMarkets,
    executeTrade,
    executeLynxOrder,
    approveWallet,
    fetchOrderBook,
    fetchDuels,
    createDuel,
    createMarket,
    acceptDuel,
    fetchPortfolio,
    fetchPositions,
    fetchProposals,
    fetchDaoStats,
    castVote,
    createProposal,
    stakeLynx,
    fetchTransactions,
    unstakeLynx,
    depositSol,
    withdrawSol,
    claimRewards,
    claimPosition,
    cancelOrder,
  };
}
