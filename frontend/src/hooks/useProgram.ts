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
  const { publicKey } = useWallet();
  const managedSession = useManagedAuthSession();
  const wallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || 'DEV_WALLET';

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
    setError(null);
    try {
      const position = typeof side === 'boolean' ? (side ? 'YES' : 'NO') : side;
      return await apiFetch(`/api/markets/${marketId}/trades`, {
        method: 'POST',
        body: JSON.stringify({ wallet, amount, position, tradeType, limitPrice }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to execute trade');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const executeLynxOrder = useCallback(async (side: 'BUY' | 'SELL', amount: number, price: number) => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          wallet,
          pair: 'LYNX/SOL',
          side,
          amount,
          price,
          currency: 'LYNX',
        }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to place LYNX order');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

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
      setError(err.message || 'Failed to fetch duels');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Example: Create a new 1v1 Duel
  const createDuel = useCallback(async (duelParams: any) => {
    setIsLoading(true);
    try {
      return await apiFetch('/api/duels', {
        method: 'POST',
        body: JSON.stringify({ wallet, ...duelParams }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create duel');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  // Fetch user portfolio
  const fetchPortfolio = useCallback(async (): Promise<Portfolio> => {
    setIsLoading(true);
    try {
      return await apiFetch<Portfolio>(`/api/portfolio?wallet=${encodeURIComponent(wallet)}`);
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
  }, [wallet]);

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

  // Example: Cast a vote on a DAO proposal
  const castVote = useCallback(async (proposalId: string, voteType: 'yes' | 'no') => {
    setIsLoading(true);
    try {
      return await apiFetch(`/api/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ wallet, voteType }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to vote');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  // Example: Stake LYNX tokens
  const stakeLynx = useCallback(async (amount: number) => {
    setIsLoading(true);
    try {
      return await apiFetch<Portfolio>('/api/staking/stake', {
        method: 'POST',
        body: JSON.stringify({ wallet, amount }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to stake');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const fetchTransactions = useCallback(async () => {
    try {
      return await apiFetch('/api/transactions');
    } catch (err: any) {
      console.error('Failed to fetch transactions', err);
      return [];
    }
  }, []);

  // Example: Claim rewards
  const claimRewards = useCallback(async () => {
    setIsLoading(true);
    try {
      return await apiFetch<{ claimed: number; portfolio: Portfolio }>('/api/staking/claim', {
        method: 'POST',
        body: JSON.stringify({ wallet }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to claim rewards');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  // Example: Accept a duel
  const acceptDuel = useCallback(async (duelId: string, position?: string) => {
    setIsLoading(true);
    try {
      return await apiFetch(`/api/duels/${duelId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ wallet, side: position }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to accept duel');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  // Example: Unstake LYNX tokens
  const unstakeLynx = useCallback(async (amount: number) => {
    setIsLoading(true);
    try {
      return await apiFetch<Portfolio>('/api/staking/unstake', {
        method: 'POST',
        body: JSON.stringify({ wallet, amount }),
      });
    } catch (err: any) {
      setError(err.message || 'Failed to unstake');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  // Fetch positions for the current wallet
  const fetchPositions = useCallback(async () => {
    try {
      return await apiFetch<any[]>(`/api/positions?wallet=${encodeURIComponent(wallet)}`);
    } catch (err: any) {
      console.error('Failed to fetch positions', err);
      return [];
    }
  }, [wallet]);

  // Claim a winning position payout
  const claimPosition = useCallback(async (positionId: string) => {
    setIsLoading(true);
    try {
      return await apiFetch<{ payout: number; currency: string; portfolio: Portfolio }>(
        `/api/positions/${positionId}/claim`,
        { method: 'POST', body: JSON.stringify({ wallet }) }
      );
    } catch (err: any) {
      setError(err.message || 'Failed to claim position');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  // Cancel an open order and get refunded
  const cancelOrder = useCallback(async (orderId: string) => {
    setIsLoading(true);
    try {
      return await apiFetch<{ cancelled: string; portfolio: Portfolio }>(
        `/api/orders/${orderId}?wallet=${encodeURIComponent(wallet)}`,
        { method: 'DELETE' }
      );
    } catch (err: any) {
      setError(err.message || 'Failed to cancel order');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  return {
    isLoading,
    error,
    fetchMarkets,
    executeTrade,
    executeLynxOrder,
    fetchOrderBook,
    fetchDuels,
    createDuel,
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
    claimRewards,
    claimPosition,
    cancelOrder,
  };
}
