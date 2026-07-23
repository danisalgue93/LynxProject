/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum MarketStatus {
  OPEN = 'OPEN',
  ACTIVE = 'ACTIVE',
  CUT_OFF = 'CUT_OFF',
  RESOLVED = 'RESOLVED',
  EXPIRED = 'EXPIRED',
}

export enum DuelStatus {
  OPEN = 'OPEN',
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}

export enum Position {
  YES = 'YES',
  NO = 'NO',
  A = 'A',
  B = 'B',
  DRAW = 'DRAW',
}

export interface Market {
  id: string;
  title: string;
  description: string;
  category: string;
  imageUrl?: string;
  status: MarketStatus;
  poolAmount: number;
  yesAmount: number;
  noAmount: number;
  drawAmount?: number;
  isTernary?: boolean;
  currency: 'SOL' | 'LYNX';
  oracleId: string;
  onChainMarket?: string;
  onChainSignature?: string;
  createdAt: number;
  cutoffAt: number;
  resolvedAt?: number;
  result?: Position;
}

export interface Duel {
  id: string;
  parentMarketId: string;
  creator: string;
  rival?: string;
  amount: number;
  currency: 'SOL' | 'LYNX';
  burnedAmount?: number;  // Total LYNX burned across both sides (backend-computed)
  status: DuelStatus;
  positionA: Position;
  positionB: Position;
  isTernary?: boolean;
  createdAt: number;
  acceptedAt?: number;
  resolvedAt?: number;
  winner?: string;
  // Present when the duel lives on-chain (indexed from the Duel account). These
  // let accept/cancel build the real Anchor transaction against the right
  // accounts. Absent for legacy off-chain duels.
  onChainDuel?: string;   // Duel account pubkey
  onChainMarket?: string; // parent Market account pubkey
  duelType?: 'OneVOne' | 'OneVOneVProtocol';
}

export interface Order {
  id: string;
  marketId: string;
  owner: string;
  side: 'BUY' | 'SELL';
  position: Position;
  amount: number; // number of tokens
  price: number; // SOL per token
  createdAt: number;
  // Presentes solo para ordenes limite de mercados de prediccion on-chain
  // (ver backend/src/chain.ts). Ausentes para el orderbook LYNX/SOL, que
  // sigue siendo off-chain por ahora.
  onChain?: boolean;
  onChainOrderPubkey?: string;
  onChainMarket?: string;
  currency?: 'SOL' | 'LYNX';
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'passed' | 'rejected' | 'pending';
  votesYes: number;
  votesNo: number;
  endTime: string;
  category: 'protocol' | 'markets' | 'fees' | 'community';
  author: string;
}

/** One OHLC candle as served by GET /api/chart/klines. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Shape of GET /api/daostats. */
export interface DaoStats {
  activeVoters: number;
  totalLynxStaked: number;
  activeDiscussions: number;
}

/** An open position row inside Portfolio.holdings. */
export interface PortfolioHolding {
  marketId: string;
  position: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  currency?: 'SOL' | 'LYNX';
}

/** A claimable/settled payment row inside Portfolio.payments. */
export interface PortfolioPayment {
  title: string;
  amount: number;
  date: string | number;
  token?: 'SOL' | 'LYNX' | string;
}

export interface Portfolio {
  walletAddress?: string;
  solBalance: number;
  lynxBalance: number;
  stakedLynx?: number;
  totalVolume?: number;
  winRate?: number;
  totalProfit?: number;
  feeShare?: number;
  payments?: PortfolioPayment[];
  holdings?: PortfolioHolding[];
  history?: Array<Record<string, unknown>>;
  approvedAt?: number;
  connectedWallets?: string[];
}

export interface UserWallet {
  address: string;
  solBalance: number;
  lynxBalance: number;
  holdings: {
    marketId: string;
    position: Position;
    amount: number;
  }[];
}
