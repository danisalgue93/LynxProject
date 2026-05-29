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
  status: DuelStatus;
  positionA: Position;
  positionB: Position;
  isTernary?: boolean;
  createdAt: number;
  acceptedAt?: number;
  resolvedAt?: number;
  winner?: string;
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

export interface Portfolio {
  walletAddress?: string;
  solBalance: number;
  lynxBalance: number;
  stakedLynx?: number;
  totalVolume?: number;
  winRate?: number;
  totalProfit?: number;
  feeShare?: number;
  payments?: Array<Record<string, unknown>>;
  holdings?: Array<Record<string, unknown>>;
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
