export type MarketStatus = 'OPEN' | 'ACTIVE' | 'CUT_OFF' | 'RESOLVED' | 'EXPIRED';
export type Currency = 'SOL' | 'LYNX';
export type Position = 'YES' | 'NO' | 'A' | 'B' | 'DRAW';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'OPEN' | 'PARTIAL_FILLED' | 'FILLED' | 'CANCELLED';
export type DuelStatus = 'OPEN' | 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
export type ProposalStatus = 'active' | 'passed' | 'rejected' | 'pending';

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
  burnedAmount: number;
  isTernary?: boolean;
  currency: Currency;
  oracleId: string;
  oracleMode: string;
  onChainMarket?: string;
  createdAt: number;
  cutoffAt: number;
  resolveAt?: number;
  oracleDeadline?: number;
  resolvedAt?: number;
  result?: Position;
}

export interface UserPosition {
  id: string;
  marketId: string;
  wallet: string;
  position: Position;
  amount: number;
  entryPrice: number;
  currency: Currency;
  claimed: boolean;
  createdAt: number;
}

export interface WalletState {
  wallet: string;
  solBalance: number;
  lynxBalance: number;
  stakedLynx: number;
  rewardsSol: number;
  totalVolume: number;
  wins: number;
  losses: number;
}

export interface Order {
  id: string;
  marketId?: string;
  pair: string;
  owner: string;
  side: OrderSide;
  position?: Position;
  amount: number;
  remaining: number;
  price: number;
  currency: Currency;
  status: OrderStatus;
  createdAt: number;
  lockedCurrency?: Currency;
  lockedAmount?: number;
  spentAmount?: number;
}

export interface Trade {
  id: string;
  marketId?: string;
  pair: string;
  maker?: string;
  taker: string;
  side: OrderSide;
  position?: Position;
  amount: number;
  price: number;
  feeAmount: number;
  currency: Currency;
  createdAt: number;
}

export interface Duel {
  id: string;
  parentMarketId: string;
  creator: string;
  rival?: string;
  amount: number;
  currency: Currency;
  status: DuelStatus;
  positionA: Position;
  positionB?: Position;
  isTernary?: boolean;
  type: '1v1' | '1v1vP';
  protocolSide?: Position;
  createdAt: number;
  acceptedAt?: number;
  resolvedAt?: number;
  winner?: string;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  status: ProposalStatus;
  votesYes: number;
  votesNo: number;
  endTime: string;
  category: 'protocol' | 'markets' | 'fees' | 'community';
  author: string;
  voters?: Record<string, 'yes' | 'no'>;
}

export interface Notification {
  id: string;
  type: 'tournament_entry' | 'tournament_ended' | 'claimable' | 'system_info' | 'trade' | 'market_resolved';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
