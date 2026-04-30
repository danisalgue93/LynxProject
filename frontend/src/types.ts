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
  currency: 'SOL' | 'LYNX';
  oracleId: string;
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
  status: MarketStatus;
  positionA: Position;
  positionB: Position;
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
