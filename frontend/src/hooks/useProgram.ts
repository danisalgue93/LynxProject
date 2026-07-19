import { useState, useCallback, useRef } from 'react';
import { Market, Duel, Proposal, Portfolio, Position } from '../types';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { apiFetch } from '../lib/api';
import { getManagedWalletAddress, useManagedAuthSession } from '../lib/auth';
import { useSolanaTransaction } from './useSolanaTransaction';
import {
  buildBuyPositionSolTx,
  buildBuyPositionLynxTx,
  buildCreateLimitOrderSolTx,
  buildCreateLimitOrderLynxTx,
  buildCancelLimitOrderSolTx,
  buildCancelLimitOrderLynxTx,
  buildClaimMarketSolTx,
  buildClaimMarketLynxTx,
  buildPlaceSpotOrderBuyTx,
  buildPlaceSpotOrderSellTx,
  buildCancelSpotOrderBuyTx,
  buildCancelSpotOrderSellTx,
  buildStakeLynxTx,
  buildUnstakeLynxTx,
  buildClaimStakingRewardsTx,
  readStakePosition,
  readLynxBalance,
  type OnChainOutcome,
  type StakeInfo,
} from '../lib/lynxProgram';

/**
 * Web3 Program Integration Hook Structure
 *
 * Para MERCADOS DE PREDICCION, este hook ahora firma y envia transacciones
 * reales contra el programa Anchor (ver ../lib/lynxProgram.ts) cuando el
 * mercado tiene un `onChainMarket` asociado — el dinero nunca pasa por un
 * balance interno del backend. El backend solo indexa el estado on-chain
 * para que la UI cargue rapido (ver backend/src/chain.ts).
 *
 * El trading de LYNX/SOL (par spot), duelos, staking y DAO siguen usando el
 * flujo off-chain existente por ahora; esa migracion queda para una fase
 * posterior (ver LAUNCH_DECISIONS.md, "phase 5").
 */

function toOnChainOutcome(position: string): OnChainOutcome {
  if (position === 'YES' || position === 'A') return 'Yes';
  if (position === 'NO' || position === 'B') return 'No';
  if (position === 'DRAW') return 'Draw';
  throw new Error(`Posicion "${position}" no soportada on-chain.`);
}

export interface CreateDuelParams {
  marketId: string;
  side: Position;
  amount: number;
  currency: 'SOL' | 'LYNX';
  type?: string;
}

export interface CreateMarketParams {
  title: string;
  description?: string;
  category?: string;
  oracleId?: string;
  cutoffAt?: number;
  resolvedAt?: number;
  isTernary?: boolean;
  currency?: 'SOL' | 'LYNX';
}

export interface OrderBookEntry {
  id: string;
  marketId: string;
  owner: string;
  side: 'BUY' | 'SELL';
  position: Position;
  amount: number;
  price: number;
  createdAt: number;
  onChain?: boolean;
  onChainOrderPubkey?: string;
  onChainMarket?: string;
  currency?: 'SOL' | 'LYNX';
}

export interface PositionEntry {
  id: string;
  marketId: string;
  position: Position;
  amount: number;
  avgPrice: number;
  currency: 'SOL' | 'LYNX';
  outcome?: string;
  onChainMarket?: string;
  estimatedPayout?: number;
  status?: string;
}

// Helper to manage loading state with unique operation IDs via a Set
function useOpTracker() {
  const pendingOpsRef = useRef(new Set<string>());
  const isLoading = pendingOpsRef.current.size > 0;

  const startOp = useCallback((opId: string) => {
    pendingOpsRef.current.add(opId);
  }, []);

  const endOp = useCallback((opId: string) => {
    pendingOpsRef.current.delete(opId);
  }, []);

  return { isLoading, startOp, endOp };
}

export function useProgram() {
  const { isLoading, startOp, endOp } = useOpTracker();
  const [error, setError] = useState<string | null>(null);
  const { publicKey, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const managedSession = useManagedAuthSession();
  const { sendSolTransfer } = useSolanaTransaction();
  const wallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || '';

  const requireWallet = useCallback(() => {
    if (!wallet) {
      throw new Error('Connect or create an account before using this action.');
    }
    return wallet;
  }, [wallet]);

  // Firma y envia una transaccion ya construida con la wallet conectada.
  // Requiere una wallet EXTERNA de verdad (Phantom, Solflare, etc.): las
  // cuentas gestionadas por email ('MAGIC:...') no pueden firmar
  // transacciones on-chain arbitrarias, solo mensajes off-chain para el
  // login. Para esas cuentas, las acciones on-chain deben ofrecer conectar
  // una wallet externa primero.
  const signAndSendOnChain = useCallback(
    async (tx: import('@solana/web3.js').Transaction): Promise<string> => {
      if (!publicKey || !sendTransaction) {
        throw new Error('Connect a Solana wallet (Phantom, Solflare, etc.) to do this on-chain.');
      }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signature = await sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: 'confirmed' });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      // Avisa al backend (best-effort) para que el indexador refresque rapido
      // en vez de esperar al proximo poll periodico. Un fallo aqui no revierte
      // ni afecta la transaccion, que ya esta confirmada on-chain.
      apiFetch('/api/onchain/sync', { method: 'POST', body: JSON.stringify({ signature }) }).catch(() => {});
      return signature;
    },
    [publicKey, sendTransaction, connection]
  );

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
    const opId = `fetchMarkets-${Date.now()}`;
    startOp(opId);
    setError(null);
    try {
      const response = await apiFetch<{ data: Market[]; total: number; limit: number; offset: number }>('/api/markets?limit=200');
      return response.data;
    } catch (err: any) {
      console.error('Error fetching markets:', err);
      setError(err.message || 'Failed to fetch markets');
      return [];
    } finally {
      endOp(opId);
    }
  }, [startOp, endOp]);

  // Compra a mercado o crea una orden limite. Si `market.onChainMarket` esta
  // presente, esto firma y envia una transaccion real contra el programa
  // Anchor con la wallet del usuario (ver ../lib/lynxProgram.ts) — el dinero
  // nunca pasa por el backend. Si no (mercado legacy sin respaldo on-chain),
  // cae al flujo off-chain custodial anterior.
  const executeTrade = useCallback(async (
    market: Market | string,
    amount: number,
    side: boolean | string,
    tradeType: 'limit' | 'swap' | 'market',
    limitPrice?: number
  ) => {
    const opId = `executeTrade-${Date.now()}`;
    startOp(opId);
    try {
      const position = typeof side === 'boolean' ? (side ? 'YES' : 'NO') : side;
      const marketObj = typeof market === 'string' ? null : market;

      if (marketObj?.onChainMarket) {
        if (!publicKey) {
          throw new Error('Connect a Solana wallet (Phantom, Solflare, etc.) to trade on-chain markets.');
        }
        const outcome = toOnChainOutcome(position);
        const marketPubkey = new PublicKey(marketObj.onChainMarket);

        if (tradeType === 'limit') {
          if (!limitPrice || limitPrice <= 0) {
            throw new Error('Enter a valid limit price.');
          }
          // Expira en 30 dias si el mercado no cierra antes.
          const expiresTs = Math.min(
            Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            Math.floor(marketObj.cutoffAt / 1000)
          );
          if (marketObj.currency === 'LYNX') {
            const { tx } = await buildCreateLimitOrderLynxTx({
              connection, owner: publicKey, market: marketPubkey, outcome,
              amountLynx: amount, limitProbability: limitPrice, expiresTs,
            });
            const signature = await signAndSendOnChain(tx);
            return { signature, onChain: true };
          }
          const { tx } = await buildCreateLimitOrderSolTx({
            owner: publicKey, market: marketPubkey, outcome,
            amountSol: amount, limitProbability: limitPrice, expiresTs,
          });
          const signature = await signAndSendOnChain(tx);
          return { signature, onChain: true };
        }

        // Compra a mercado (precio actual del pool)
        if (marketObj.currency === 'LYNX') {
          const tx = await buildBuyPositionLynxTx({ connection, buyer: publicKey, market: marketPubkey, outcome, amountLynx: amount });
          const signature = await signAndSendOnChain(tx);
          return { signature, onChain: true };
        }
        const tx = await buildBuyPositionSolTx({ buyer: publicKey, market: marketPubkey, outcome, amountSol: amount });
        const signature = await signAndSendOnChain(tx);
        return { signature, onChain: true };
      }

      // Fallback legacy: mercado sin respaldo on-chain (transicion).
      const currentWallet = await ensureApproved();
      const marketId = typeof market === 'string' ? market : market.id;
      return await apiFetch(`/api/markets/${marketId}/trades`, {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, amount, position, tradeType, limitPrice }),
      });
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, publicKey, connection, signAndSendOnChain, startOp, endOp]);

  // Coloca una orden en el libro LYNX/SOL on-chain (ver ../lib/lynxProgram.ts).
  const executeLynxOrder = useCallback(async (side: 'BUY' | 'SELL', amount: number, price?: number, tradeType: 'limit' | 'market' = 'limit') => {
    const opId = `executeLynxOrder-${Date.now()}`;
    startOp(opId);
    try {
      if (!publicKey) {
        throw new Error('Connect a Solana wallet (Phantom, Solflare, etc.) to trade LYNX/SOL on-chain.');
      }
      if (!price || price <= 0) {
        throw new Error(tradeType === 'market'
          ? 'Enter your maximum acceptable slippage price for this market order.'
          : 'Enter a valid price.');
      }
      // Expira en 30 dias.
      const expiresTs = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      if (side === 'BUY') {
        const { tx } = await buildPlaceSpotOrderBuyTx({ owner: publicKey, amountLynx: amount, priceSolPerLynx: price, expiresTs });
        const signature = await signAndSendOnChain(tx);
        return { signature, onChain: true };
      }
      const { tx } = await buildPlaceSpotOrderSellTx({ connection, owner: publicKey, amountLynx: amount, priceSolPerLynx: price, expiresTs });
      const signature = await signAndSendOnChain(tx);
      return { signature, onChain: true };
    } finally {
      endOp(opId);
    }
  }, [publicKey, connection, signAndSendOnChain, startOp, endOp]);

  const fetchOrderBook = useCallback(async (pair = 'LYNX/SOL', marketId?: string) => {
    const params = new URLSearchParams({ pair });
    if (marketId) params.set('marketId', marketId);
    return await apiFetch<OrderBookEntry[]>(`/api/orderbook?${params.toString()}`);
  }, []);

  // Fetch duels from backend
  const fetchDuels = useCallback(async (): Promise<Duel[]> => {
    const opId = `fetchDuels-${Date.now()}`;
    startOp(opId);
    try {
      const response = await apiFetch<{ data: Duel[]; total: number; limit: number; offset: number }>('/api/duels?limit=200');
      return response.data;
    } catch (err: any) {
      console.error('Failed to fetch duels', err);
      return [];
    } finally {
      endOp(opId);
    }
  }, [startOp, endOp]);

  const createDuel = useCallback(async (duelParams: CreateDuelParams) => {
    const opId = `createDuel-${Date.now()}`;
    startOp(opId);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch('/api/duels', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, ...duelParams }),
      });
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, startOp, endOp]);

  const createMarket = useCallback(async (marketParams: CreateMarketParams) => {
    const opId = `createMarket-${Date.now()}`;
    startOp(opId);
    try {
      const signed = await signAction('CREATE_MARKET', marketParams as unknown as Record<string, unknown>);
      return await apiFetch('/api/markets', {
        method: 'POST',
        body: JSON.stringify({ ...marketParams, ...signed }),
      });
    } finally {
      endOp(opId);
    }
  }, [signAction, startOp, endOp]);

  // Fetch user portfolio
  const fetchPortfolio = useCallback(async (): Promise<Portfolio> => {
    const opId = `fetchPortfolio-${Date.now()}`;
    startOp(opId);
    setError(null);
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
      endOp(opId);
    }
  }, [requireWallet, startOp, endOp]);

  // Fetch DAO proposals
  const fetchProposals = useCallback(async (): Promise<Proposal[]> => {
    const opId = `fetchProposals-${Date.now()}`;
    startOp(opId);
    try {
      return await apiFetch<Proposal[]>('/api/proposals');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch proposals');
      return [];
    } finally {
      endOp(opId);
    }
  }, [startOp, endOp]);

  const createProposal = useCallback(async (input: { title: string; description?: string; category?: string; author?: string }) => {
    const opId = `createProposal-${Date.now()}`;
    startOp(opId);
    try {
      return await apiFetch('/api/proposals', {
        method: 'POST',
        body: JSON.stringify(input)
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create proposal');
      throw err;
    } finally {
      endOp(opId);
    }
  }, [startOp, endOp]);

  // Fetch DAO Stats
  const fetchDaoStats = useCallback(async (): Promise<any> => {
    const opId = `fetchDaoStats-${Date.now()}`;
    startOp(opId);
    try {
       return await apiFetch('/api/daostats');
    } catch (err: any) {
       setError(err.message || 'Failed to fetch DAO stats');
       return null;
    } finally {
       endOp(opId);
    }
  }, [startOp, endOp]);

  const castVote = useCallback(async (proposalId: string, voteType: 'yes' | 'no') => {
    const opId = `castVote-${Date.now()}`;
    startOp(opId);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch(`/api/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, voteType }),
      });
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, startOp, endOp]);

  // Staking is on-chain (phase 5): stake/unstake/claim build and sign real Anchor
  // transactions against the user's own LYNX, and the staked balance / pending
  // rewards are read from the on-chain StakePosition — never from an off-chain
  // backend balance. Needs a connected Solana wallet.
  const stakeLynx = useCallback(async (amount: number) => {
    const opId = `stakeLynx-${Date.now()}`;
    startOp(opId);
    try {
      if (!publicKey) throw new Error('Connect a Solana wallet to stake LYNX on-chain.');
      const tx = await buildStakeLynxTx({ connection, owner: publicKey, amountLynx: amount });
      const signature = await signAndSendOnChain(tx);
      return { signature, onChain: true as const };
    } finally {
      endOp(opId);
    }
  }, [publicKey, connection, signAndSendOnChain, startOp, endOp]);

  const unstakeLynx = useCallback(async (amount: number) => {
    const opId = `unstakeLynx-${Date.now()}`;
    startOp(opId);
    try {
      if (!publicKey) throw new Error('Connect a Solana wallet to unstake LYNX on-chain.');
      const tx = await buildUnstakeLynxTx({ connection, owner: publicKey, amountLynx: amount });
      const signature = await signAndSendOnChain(tx);
      return { signature, onChain: true as const };
    } finally {
      endOp(opId);
    }
  }, [publicKey, connection, signAndSendOnChain, startOp, endOp]);

  const claimRewards = useCallback(async () => {
    const opId = `claimRewards-${Date.now()}`;
    startOp(opId);
    try {
      if (!publicKey) throw new Error('Connect a Solana wallet to claim staking rewards on-chain.');
      const tx = buildClaimStakingRewardsTx({ owner: publicKey });
      const signature = await signAndSendOnChain(tx);
      return { signature, onChain: true as const };
    } finally {
      endOp(opId);
    }
  }, [publicKey, signAndSendOnChain, startOp, endOp]);

  // On-chain reads for the staking UI (the backend indexer will also expose
  // these, but reading the PDA directly keeps the UI correct without waiting on
  // an indexer round-trip). Return null / 0 when there is no connected wallet.
  const fetchStakeInfo = useCallback(async (): Promise<StakeInfo | null> => {
    if (!publicKey) return null;
    return readStakePosition(connection, publicKey);
  }, [publicKey, connection]);

  const fetchLynxBalance = useCallback(async (): Promise<number> => {
    if (!publicKey) return 0;
    return readLynxBalance(connection, publicKey);
  }, [publicKey, connection]);

  const acceptDuel = useCallback(async (duelId: string, position?: string) => {
    const opId = `acceptDuel-${Date.now()}`;
    startOp(opId);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch(`/api/duels/${duelId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, side: position }),
      });
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, startOp, endOp]);

  const cancelDuel = useCallback(async (duelId: string) => {
    const opId = `cancelDuel-${Date.now()}`;
    startOp(opId);
    try {
      const currentWallet = await ensureApproved();
      return await apiFetch(`/api/duels/${duelId}`, {
        method: 'DELETE',
        body: JSON.stringify({ wallet: currentWallet }),
      });
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, startOp, endOp]);


  const depositSol = useCallback(async (amount: number, onChainSignature?: string) => {
    const opId = `depositSol-${Date.now()}`;
    startOp(opId);
    try {
      const currentWallet = await ensureApproved();
      // If no signature was supplied by the caller and this is an external wallet,
      // execute the real on-chain SOL transfer first and obtain the confirmed signature.
      let signature = onChainSignature;
      if (!signature && publicKey) {
        signature = await sendSolTransfer(amount);
      }
      const result = await apiFetch<{ portfolio: Portfolio }>('/api/ledger/deposit', {
        method: 'POST',
        body: JSON.stringify({
          wallet: currentWallet,
          currency: 'SOL',
          amount,
          provider: 'EXTERNAL_WALLET',
          signature,
        }),
      });
      return result.portfolio;
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, publicKey, sendSolTransfer, startOp, endOp]);

  const withdrawSol = useCallback(async (amount: number) => {
    const opId = `withdrawSol-${Date.now()}`;
    startOp(opId);
    try {
      const currentWallet = await ensureApproved();
      const result = await apiFetch<{ portfolio: Portfolio }>('/api/ledger/withdraw', {
        method: 'POST',
        body: JSON.stringify({ wallet: currentWallet, currency: 'SOL', amount }),
      });
      return result.portfolio;
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, startOp, endOp]);

  // `pos` es el objeto devuelto por fetchPositions(). Si trae onChainMarket,
  // esto firma y envia claim_market_sol/claim_market_lynx directamente; si
  // no, cae al endpoint legacy /api/positions/:id/claim.
  const claimPosition = useCallback(async (pos: PositionEntry | string) => {
    const opId = `claimPosition-${Date.now()}`;
    startOp(opId);
    try {
      if (pos && typeof pos === 'object' && pos.onChainMarket) {
        if (!publicKey) {
          throw new Error('Connect a Solana wallet (Phantom, Solflare, etc.) to claim this on-chain payout.');
        }
        const outcome = toOnChainOutcome(pos.position);
        const marketPubkey = new PublicKey(pos.onChainMarket);
        const tx = pos.currency === 'LYNX'
          ? await buildClaimMarketLynxTx({ connection, claimant: publicKey, market: marketPubkey, outcome })
          : buildClaimMarketSolTx({ claimant: publicKey, market: marketPubkey, outcome });
        const signature = await signAndSendOnChain(tx);
        // Estimacion solo para el toast/UI inmediata; el indexador refresca
        // el monto exacto poco despues via /api/onchain/sync.
        const estimatedPayout = typeof pos.estimatedPayout === 'number' ? pos.estimatedPayout : undefined;
        return { payout: estimatedPayout ?? 0, currency: pos.currency ?? 'SOL', signature, onChain: true };
      }

      const positionId = typeof pos === 'string' ? pos : pos?.id;
      const currentWallet = await ensureApproved();
      return await apiFetch<{ payout: number; currency: string; portfolio: Portfolio }>(
        `/api/positions/${positionId}/claim`,
        { method: 'POST', body: JSON.stringify({ wallet: currentWallet }) }
      );
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, publicKey, connection, signAndSendOnChain, startOp, endOp]);

  // Cancel an open order. `order` es el objeto devuelto por fetchOrderBook();
  // si trae onChain=true esto firma y envia cancel_prediction_limit_order_*
  // directamente. Las ordenes del par LYNX/SOL (off-chain por ahora) siguen
  // el flujo legacy DELETE /api/orders/:id.
  const cancelOrder = useCallback(async (order: OrderBookEntry | string) => {
    const opId = `cancelOrder-${Date.now()}`;
    startOp(opId);
    try {
      if (order && typeof order === 'object' && order.onChain && order.onChainOrderPubkey) {
        if (!publicKey) {
          throw new Error('Connect a Solana wallet (Phantom, Solflare, etc.) to cancel this on-chain order.');
        }
        const orderPubkey = new PublicKey(order.onChainOrderPubkey);
        const orderOwner = new PublicKey(order.owner);

        if (order.onChainMarket) {
          // Orden limite de un mercado de prediccion
          const marketPubkey = new PublicKey(order.onChainMarket);
          const tx = order.currency === 'LYNX'
            ? await buildCancelLimitOrderLynxTx({ connection, signer: publicKey, market: marketPubkey, order: orderPubkey, orderOwner })
            : buildCancelLimitOrderSolTx({ signer: publicKey, market: marketPubkey, order: orderPubkey, orderOwner });
          const signature = await signAndSendOnChain(tx);
          return { cancelled: order.id, signature, onChain: true };
        }

        // Orden del libro spot LYNX/SOL
        const tx = order.side === 'BUY'
          ? buildCancelSpotOrderBuyTx({ signer: publicKey, order: orderPubkey, orderOwner })
          : await buildCancelSpotOrderSellTx({ connection, signer: publicKey, order: orderPubkey, orderOwner });
        const signature = await signAndSendOnChain(tx);
        return { cancelled: order.id, signature, onChain: true };
      }

      const orderId = typeof order === 'string' ? order : order?.id;
      const currentWallet = await ensureApproved();
      return await apiFetch<{ cancelled: string; portfolio: Portfolio }>(
        `/api/orders/${orderId}`,
        { method: 'DELETE', body: JSON.stringify({ wallet: currentWallet }) }
      );
    } finally {
      endOp(opId);
    }
  }, [ensureApproved, publicKey, connection, signAndSendOnChain, startOp, endOp]);

  const fetchTransactions = useCallback(async () => {
    try {
      const currentWallet = requireWallet();
      return await apiFetch(`/api/transactions?wallet=${encodeURIComponent(currentWallet)}`);
    } catch (err: any) {
      console.error('Failed to fetch transactions', err);
      return [];
    }
  }, [requireWallet]);

  // Fetch positions for the current wallet
  const fetchPositions = useCallback(async () => {
    try {
      const currentWallet = requireWallet();
      return await apiFetch<PositionEntry[]>(`/api/positions?wallet=${encodeURIComponent(currentWallet)}`);
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
    cancelDuel,
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
    fetchStakeInfo,
    fetchLynxBalance,
    claimPosition,
    cancelOrder,
  };
}