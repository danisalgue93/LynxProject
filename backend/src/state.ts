import {
  EVENT_PROTOCOL_FEE,
  GLOBAL_TRADE_FEE,
  LYNX_EMISSION_PER_SOL,
  LYNX_EVENT_BURN,
  LYNX_INITIAL_SALE_SHARE,
  LYNX_PARTICIPANT_SHARE,
  LYNX_TREASURY_SHARE,
  STAKER_REWARD_FEE,
  TREASURY_EVENT_FEE,
  TREASURY_WALLET,
  assertPositiveAmount,
  roundAmount
} from './economy.js';
import type {
  Candle,
  Currency,
  Duel,
  Market,
  Notification,
  Order,
  OrderSide,
  Position,
  Proposal,
  Trade,
  UserPosition,
  WalletState
} from './types.js';

const STARTING_SOL = 100;
const STARTING_LYNX = 10000;

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function nowMs() {
  return Date.now();
}

function normalizePosition(position: Position, ternary?: boolean): Position {
  if (!ternary && position === 'A') return 'YES';
  if (!ternary && position === 'B') return 'NO';
  return position;
}

function opposingPosition(position: Position, ternary?: boolean): Position {
  if (ternary) {
    if (position === 'A' || position === 'YES') return 'B';
    if (position === 'B' || position === 'NO') return 'A';
    return 'YES';
  }
  return position === 'YES' || position === 'A' ? 'NO' : 'YES';
}

export class LynxState {
  markets = new Map<string, Market>();
  positions = new Map<string, UserPosition>();
  wallets = new Map<string, WalletState>();
  orders = new Map<string, Order>();
  trades = new Map<string, Trade>();
  duels = new Map<string, Duel>();
  proposals = new Map<string, Proposal>();
  notifications = new Map<string, Notification[]>();
  treasury = {
    sol: 0,
    lynx: 0,
    lynxForInitialSale: 0,
    lynxBurned: 0,
    protocolDuelSol: 0
  };

  constructor() {
    this.seed();
  }

  seed() {
    this.markets.clear();
    this.positions.clear();
    this.wallets.clear();
    this.orders.clear();
    this.trades.clear();
    this.duels.clear();
    this.proposals.clear();
    this.notifications.clear();
    this.treasury = { sol: 0, lynx: 0, lynxForInitialSale: 0, lynxBurned: 0, protocolDuelSol: 0 };

    const now = nowMs();
    const cutoffAt = now + 1000 * 60 * 60 * 24;
    const resolveAt = now + 1000 * 60 * 60 * 30;
    const oracleDeadline = resolveAt + 1000 * 60 * 60;

    this.addMarket({
      id: 'market-sol-btc-100k',
      title: 'Will BTC close above 100k this month?',
      description: 'Binary SOL prediction market resolved by oracle, with manual admin fallback after 1 hour.',
      category: 'Crypto',
      status: 'OPEN',
      poolAmount: 0,
      yesAmount: 0,
      noAmount: 0,
      burnedAmount: 0,
      currency: 'SOL',
      oracleId: 'switchboard:btc-month-close',
      oracleMode: 'SWITCHBOARD',
      createdAt: now,
      cutoffAt,
      resolveAt,
      oracleDeadline
    });

    this.addMarket({
      id: 'market-lynx-special',
      title: 'Will LYNX weekly volume exceed 10k SOL?',
      description: 'Special LYNX-denominated market. 15% of all LYNX staked here is burned.',
      category: 'Lynx',
      status: 'OPEN',
      poolAmount: 0,
      yesAmount: 0,
      noAmount: 0,
      burnedAmount: 0,
      currency: 'LYNX',
      oracleId: 'switchboard:lynx-weekly-volume',
      oracleMode: 'SWITCHBOARD',
      createdAt: now,
      cutoffAt,
      resolveAt,
      oracleDeadline
    });

    this.addMarket({
      id: 'market-1v1vp-final',
      title: 'Champions final: Team A, Team B or draw?',
      description: 'Ternary SOL market used by 1v1vP duels.',
      category: 'Sports',
      status: 'OPEN',
      poolAmount: 0,
      yesAmount: 0,
      noAmount: 0,
      drawAmount: 0,
      burnedAmount: 0,
      currency: 'SOL',
      isTernary: true,
      oracleId: 'switchboard:football-final',
      oracleMode: 'SWITCHBOARD',
      createdAt: now,
      cutoffAt,
      resolveAt,
      oracleDeadline
    });

    this.proposals.set('LDAO-1', {
      id: 'LDAO-1',
      title: 'Use 20% of treasury fees for first liquidity campaign',
      description: 'Bootstrap the LYNX/SOL book after the first event closes and LYNX is minted.',
      status: 'active',
      votesYes: 0,
      votesNo: 0,
      endTime: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
      category: 'protocol',
      author: 'LYNX Core'
    });

    this.seedLynxBook();
  }

  addMarket(market: Market) {
    this.markets.set(market.id, market);
  }

  getWallet(wallet: string) {
    const key = wallet || 'DEV_WALLET';
    let state = this.wallets.get(key);
    if (!state) {
      state = {
        wallet: key,
        solBalance: STARTING_SOL,
        lynxBalance: STARTING_LYNX,
        stakedLynx: 0,
        rewardsSol: 0,
        totalVolume: 0,
        wins: 0,
        losses: 0
      };
      this.wallets.set(key, state);
    }
    return state;
  }

  listMarkets() {
    return [...this.markets.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  getMarket(id: string) {
    const market = this.markets.get(id);
    if (!market) throw new Error('Market not found');
    return market;
  }

  listDuels(parentMarketId?: string) {
    return [...this.duels.values()]
      .filter((duel) => !parentMarketId || duel.parentMarketId === parentMarketId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listProposals() {
    return [...this.proposals.values()];
  }

  getDaoStats() {
    const wallets = [...this.wallets.values()];
    return {
      activeVoters: wallets.filter((wallet) => wallet.stakedLynx > 0).length,
      totalLynxStaked: roundAmount(wallets.reduce((sum, wallet) => sum + wallet.stakedLynx, 0)),
      activeDiscussions: this.listProposals().filter((proposal) => proposal.status === 'active').length
    };
  }

  getPortfolio(walletAddress: string) {
    const wallet = this.getWallet(walletAddress);
    const holdings = [...this.positions.values()]
      .filter((position) => position.wallet === wallet.wallet && !position.claimed)
      .map((position) => {
        const market = this.markets.get(position.marketId);
        return {
          marketId: position.marketId,
          position: position.position,
          amount: position.amount,
          entryPrice: position.entryPrice,
          currentPrice: this.estimatePositionPrice(position.marketId, position.position),
          currency: position.currency,
          title: market?.title
        };
      });

    const payments = wallet.rewardsSol > 0
      ? [{
          title: 'Protocol staking rewards',
          date: new Date().toISOString().slice(0, 10),
          amount: roundAmount(wallet.rewardsSol),
          token: 'SOL'
        }]
      : [];

    return {
      walletAddress: wallet.wallet,
      solBalance: roundAmount(wallet.solBalance),
      lynxBalance: roundAmount(wallet.lynxBalance),
      stakedLynx: roundAmount(wallet.stakedLynx),
      totalVolume: roundAmount(wallet.totalVolume),
      winRate: wallet.wins + wallet.losses === 0 ? 0 : roundAmount((wallet.wins / (wallet.wins + wallet.losses)) * 100),
      totalProfit: roundAmount(wallet.rewardsSol),
      feeShare: this.getDaoStats().totalLynxStaked > 0 ? roundAmount((wallet.stakedLynx / this.getDaoStats().totalLynxStaked) * 100) : 0,
      payments,
      holdings,
      history: [...this.trades.values()].filter((trade) => trade.taker === wallet.wallet || trade.maker === wallet.wallet)
    };
  }

  executePredictionTrade(input: {
    wallet: string;
    marketId: string;
    amount: number;
    position: Position;
    tradeType: 'limit' | 'swap' | 'market';
    limitPrice?: number;
  }) {
    assertPositiveAmount(input.amount);
    const market = this.getMarket(input.marketId);
    const wallet = this.getWallet(input.wallet);
    const position = normalizePosition(input.position, market.isTernary);

    if (market.status !== 'OPEN' && market.status !== 'ACTIVE') throw new Error('Market is not open');
    if (Date.now() >= market.cutoffAt) throw new Error('Market cutoff has passed');

    if (input.tradeType === 'limit') {
      return this.placeOrder({
        wallet: input.wallet,
        marketId: market.id,
        pair: market.id,
        side: position === 'NO' || position === 'B' ? 'SELL' : 'BUY',
        position,
        amount: input.amount,
        price: input.limitPrice ?? this.estimatePositionPrice(market.id, position),
        currency: market.currency
      });
    }

    this.debit(wallet, market.currency, input.amount);
    const burn = market.currency === 'LYNX' ? roundAmount(input.amount * LYNX_EVENT_BURN) : 0;
    if (burn > 0) {
      market.burnedAmount = roundAmount(market.burnedAmount + burn);
      this.treasury.lynxBurned = roundAmount(this.treasury.lynxBurned + burn);
    }

    const creditedToPool = input.amount;
    market.status = 'ACTIVE';
    market.poolAmount = roundAmount(market.poolAmount + creditedToPool);
    if (position === 'YES' || position === 'A') market.yesAmount = roundAmount(market.yesAmount + creditedToPool);
    if (position === 'NO' || position === 'B') market.noAmount = roundAmount(market.noAmount + creditedToPool);
    if (position === 'DRAW') market.drawAmount = roundAmount((market.drawAmount ?? 0) + creditedToPool);

    wallet.totalVolume = roundAmount(wallet.totalVolume + input.amount);

    const userPosition: UserPosition = {
      id: id('pos'),
      marketId: market.id,
      wallet: wallet.wallet,
      position,
      amount: input.amount,
      entryPrice: this.estimatePositionPrice(market.id, position),
      currency: market.currency,
      claimed: false,
      createdAt: nowMs()
    };
    this.positions.set(userPosition.id, userPosition);

    const trade: Trade = {
      id: id('trade'),
      marketId: market.id,
      pair: market.id,
      taker: wallet.wallet,
      side: position === 'NO' || position === 'B' ? 'SELL' : 'BUY',
      position,
      amount: input.amount,
      price: userPosition.entryPrice,
      feeAmount: 0,
      currency: market.currency,
      createdAt: nowMs()
    };
    this.trades.set(trade.id, trade);

    return { trade, position: userPosition, market };
  }

  placeOrder(input: {
    wallet: string;
    marketId?: string;
    pair: string;
    side: OrderSide;
    position?: Position;
    amount: number;
    price: number;
    currency: Currency;
  }) {
    assertPositiveAmount(input.amount);
    assertPositiveAmount(input.price);

    const wallet = this.getWallet(input.wallet);
    const notional = roundAmount(input.amount * input.price);
    const fee = roundAmount(notional * GLOBAL_TRADE_FEE);

    if (input.pair === 'LYNX/SOL') {
      if (input.side === 'BUY') this.debit(wallet, 'SOL', roundAmount(notional + fee));
      else this.debit(wallet, 'LYNX', input.amount);
    }

    const order: Order = {
      id: id('order'),
      marketId: input.marketId,
      pair: input.pair,
      owner: wallet.wallet,
      side: input.side,
      position: input.position,
      amount: input.amount,
      remaining: input.amount,
      price: input.price,
      currency: input.currency,
      status: 'OPEN',
      createdAt: nowMs()
    };
    this.orders.set(order.id, order);

    if (input.pair === 'LYNX/SOL') {
      this.matchLynxOrder(order);
      this.treasury.sol = roundAmount(this.treasury.sol + fee);
    }

    return { order, orderbook: this.getOrderBook(input.pair, input.marketId) };
  }

  createDuel(input: {
    wallet: string;
    marketId: string;
    side: Position;
    amount: number;
    type?: '1v1' | '1v1vP';
  }) {
    assertPositiveAmount(input.amount);
    const market = this.getMarket(input.marketId);
    const wallet = this.getWallet(input.wallet);
    const positionA = normalizePosition(input.side, market.isTernary);

    if (market.currency === 'LYNX') {
      throw new Error('1v1vP and duels are SOL-only in the current Lynx economy');
    }

    this.debit(wallet, 'SOL', input.amount);
    const type = input.type ?? (market.isTernary ? '1v1vP' : '1v1');
    const duel: Duel = {
      id: id('duel'),
      parentMarketId: market.id,
      creator: wallet.wallet,
      amount: input.amount,
      currency: market.currency,
      status: type === '1v1vP' ? 'ACTIVE' : 'OPEN',
      positionA,
      positionB: type === '1v1vP' ? opposingPosition(positionA, market.isTernary) : undefined,
      isTernary: market.isTernary,
      type,
      protocolSide: type === '1v1vP' ? opposingPosition(positionA, market.isTernary) : undefined,
      rival: type === '1v1vP' ? TREASURY_WALLET : undefined,
      createdAt: nowMs(),
      acceptedAt: type === '1v1vP' ? nowMs() : undefined
    };
    this.duels.set(duel.id, duel);
    return duel;
  }

  acceptDuel(input: { wallet: string; duelId: string; side?: Position }) {
    const duel = this.duels.get(input.duelId);
    if (!duel) throw new Error('Duel not found');
    if (duel.status !== 'OPEN') throw new Error('Duel is not open');
    const wallet = this.getWallet(input.wallet);
    this.debit(wallet, duel.currency, duel.amount);
    duel.rival = wallet.wallet;
    duel.positionB = normalizePosition(input.side ?? opposingPosition(duel.positionA, duel.isTernary), duel.isTernary);
    if (duel.positionB === duel.positionA) throw new Error('Rival must choose a different side');
    duel.status = 'ACTIVE';
    duel.acceptedAt = nowMs();
    return duel;
  }

  resolveMarket(input: { marketId: string; result: Position; source?: 'oracle' | 'manual' }) {
    const market = this.getMarket(input.marketId);
    if (market.status === 'RESOLVED') throw new Error('Market already resolved');
    const result = normalizePosition(input.result, market.isTernary);
    market.status = 'RESOLVED';
    market.result = result;
    market.resolvedAt = nowMs();

    if (market.currency === 'SOL') {
      const protocolFee = roundAmount(market.poolAmount * EVENT_PROTOCOL_FEE);
      const stakerFee = roundAmount(market.poolAmount * STAKER_REWARD_FEE);
      const treasuryFee = roundAmount(market.poolAmount * TREASURY_EVENT_FEE);
      this.treasury.sol = roundAmount(this.treasury.sol + treasuryFee + (protocolFee - stakerFee - treasuryFee));
      this.distributeStakingRewards(stakerFee);
      this.mintLynxForSolvedSolMarket(market);
    }

    this.resolveDuelsForMarket(market);
    this.notifyParticipants(market);
    return market;
  }

  stake(walletAddress: string, amount: number) {
    assertPositiveAmount(amount);
    const wallet = this.getWallet(walletAddress);
    this.debit(wallet, 'LYNX', amount);
    wallet.stakedLynx = roundAmount(wallet.stakedLynx + amount);
    return this.getPortfolio(wallet.wallet);
  }

  unstake(walletAddress: string, amount: number) {
    assertPositiveAmount(amount);
    const wallet = this.getWallet(walletAddress);
    if (wallet.stakedLynx < amount) throw new Error('Insufficient staked LYNX');
    wallet.stakedLynx = roundAmount(wallet.stakedLynx - amount);
    wallet.lynxBalance = roundAmount(wallet.lynxBalance + amount);
    return this.getPortfolio(wallet.wallet);
  }

  claimRewards(walletAddress: string) {
    const wallet = this.getWallet(walletAddress);
    const rewards = wallet.rewardsSol;
    wallet.rewardsSol = 0;
    wallet.solBalance = roundAmount(wallet.solBalance + rewards);
    return { claimed: roundAmount(rewards), portfolio: this.getPortfolio(wallet.wallet) };
  }

  castVote(input: { wallet: string; proposalId: string; voteType: 'yes' | 'no' }) {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal) throw new Error('Proposal not found');
    if (proposal.status !== 'active') throw new Error('Proposal is not active');
    const wallet = this.getWallet(input.wallet);
    const weight = Math.max(wallet.stakedLynx, 1);
    if (input.voteType === 'yes') proposal.votesYes = roundAmount(proposal.votesYes + weight);
    else proposal.votesNo = roundAmount(proposal.votesNo + weight);
    return proposal;
  }

  getOrderBook(pair = 'LYNX/SOL', marketId?: string) {
    const open = [...this.orders.values()].filter((order) =>
      order.status !== 'FILLED' &&
      order.status !== 'CANCELLED' &&
      order.remaining > 0 &&
      order.pair === pair &&
      (!marketId || order.marketId === marketId)
    );
    const bids = open
      .filter((order) => order.side === 'BUY')
      .sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);
    const asks = open
      .filter((order) => order.side === 'SELL')
      .sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
    const recentTrades = [...this.trades.values()]
      .filter((trade) => trade.pair === pair && (!marketId || trade.marketId === marketId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
    return { pair, marketId, bids, asks, recentTrades };
  }

  klines(symbol = 'LYNX', interval = '1d', limit = 100): Candle[] {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const ms = interval === '15m'
      ? 15 * 60 * 1000
      : interval === '1h'
        ? 60 * 60 * 1000
        : interval === '4h'
          ? 4 * 60 * 60 * 1000
          : interval === '1w'
            ? 7 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

    const trades = [...this.trades.values()]
      .filter((trade) => symbol.toUpperCase() === 'LYNX' ? trade.pair === 'LYNX/SOL' : trade.pair.includes(symbol.toUpperCase()))
      .sort((a, b) => a.createdAt - b.createdAt);

    if (trades.length === 0) return this.syntheticCandles(symbol, ms, safeLimit);

    const buckets = new Map<number, Trade[]>();
    const end = Math.ceil(Date.now() / ms) * ms;
    const start = end - safeLimit * ms;
    for (const trade of trades) {
      if (trade.createdAt < start) continue;
      const bucket = Math.floor(trade.createdAt / ms) * ms;
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), trade]);
    }

    const candles: Candle[] = [];
    let lastClose = trades[0]?.price ?? 0.004;
    for (let time = start; time < end; time += ms) {
      const bucketTrades = buckets.get(time) ?? [];
      if (bucketTrades.length === 0) {
        candles.push({ time, open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0 });
        continue;
      }
      const prices = bucketTrades.map((trade) => trade.price);
      const open = bucketTrades[0].price;
      const close = bucketTrades[bucketTrades.length - 1].price;
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      const volume = bucketTrades.reduce((sum, trade) => sum + trade.amount, 0);
      candles.push({ time, open, high, low, close, volume });
      lastClose = close;
    }
    return candles;
  }

  listNotifications(walletAddress: string) {
    return this.notifications.get(walletAddress) ?? [];
  }

  markNotificationsRead(walletAddress: string) {
    const notifications = this.listNotifications(walletAddress).map((notification) => ({ ...notification, read: true }));
    this.notifications.set(walletAddress, notifications);
    return notifications;
  }

  private debit(wallet: WalletState, currency: Currency, amount: number) {
    if (currency === 'SOL') {
      if (wallet.solBalance < amount) throw new Error('Insufficient SOL balance');
      wallet.solBalance = roundAmount(wallet.solBalance - amount);
    } else {
      if (wallet.lynxBalance < amount) throw new Error('Insufficient LYNX balance');
      wallet.lynxBalance = roundAmount(wallet.lynxBalance - amount);
    }
  }

  private credit(wallet: WalletState, currency: Currency, amount: number) {
    if (currency === 'SOL') wallet.solBalance = roundAmount(wallet.solBalance + amount);
    else wallet.lynxBalance = roundAmount(wallet.lynxBalance + amount);
  }

  private matchLynxOrder(order: Order) {
    const opposite = [...this.orders.values()]
      .filter((candidate) =>
        candidate.id !== order.id &&
        candidate.pair === 'LYNX/SOL' &&
        candidate.side !== order.side &&
        candidate.status !== 'FILLED' &&
        candidate.status !== 'CANCELLED' &&
        candidate.remaining > 0
      )
      .filter((candidate) => order.side === 'BUY' ? candidate.price <= order.price : candidate.price >= order.price)
      .sort((a, b) => order.side === 'BUY' ? a.price - b.price : b.price - a.price);

    for (const maker of opposite) {
      if (order.remaining <= 0) break;
      const amount = Math.min(order.remaining, maker.remaining);
      const price = maker.price;
      const notional = roundAmount(amount * price);
      const buyer = this.getWallet(order.side === 'BUY' ? order.owner : maker.owner);
      const seller = this.getWallet(order.side === 'SELL' ? order.owner : maker.owner);
      this.credit(buyer, 'LYNX', amount);
      this.credit(seller, 'SOL', notional);
      order.remaining = roundAmount(order.remaining - amount);
      maker.remaining = roundAmount(maker.remaining - amount);
      order.status = order.remaining === 0 ? 'FILLED' : 'PARTIAL_FILLED';
      maker.status = maker.remaining === 0 ? 'FILLED' : 'PARTIAL_FILLED';
      const tradeId = id('trade');
      this.trades.set(tradeId, {
        id: tradeId,
        pair: 'LYNX/SOL',
        maker: maker.owner,
        taker: order.owner,
        side: order.side,
        amount,
        price,
        feeAmount: roundAmount(notional * GLOBAL_TRADE_FEE),
        currency: 'SOL',
        createdAt: nowMs()
      });
    }
  }

  private estimatePositionPrice(marketId: string, position: Position) {
    const market = this.getMarket(marketId);
    if (market.poolAmount === 0) return market.isTernary ? 0.333 : 0.5;
    const sideAmount = position === 'YES' || position === 'A'
      ? market.yesAmount
      : position === 'NO' || position === 'B'
        ? market.noAmount
        : market.drawAmount ?? 0;
    return roundAmount(Math.max(0.01, Math.min(0.99, sideAmount / market.poolAmount)));
  }

  private distributeStakingRewards(amount: number) {
    const stakers = [...this.wallets.values()].filter((wallet) => wallet.stakedLynx > 0);
    const totalStaked = stakers.reduce((sum, wallet) => sum + wallet.stakedLynx, 0);
    if (totalStaked <= 0) {
      this.treasury.sol = roundAmount(this.treasury.sol + amount);
      return;
    }
    for (const wallet of stakers) {
      const share = amount * (wallet.stakedLynx / totalStaked);
      wallet.rewardsSol = roundAmount(wallet.rewardsSol + share);
      this.pushNotification(wallet.wallet, {
        type: 'claimable',
        title: 'SOL staking rewards available',
        message: `You earned ${roundAmount(share)} SOL from protocol event fees.`
      });
    }
  }

  private mintLynxForSolvedSolMarket(market: Market) {
    if (market.currency !== 'SOL' || market.poolAmount <= 0) return;
    const totalEmission = roundAmount(market.poolAmount * LYNX_EMISSION_PER_SOL);
    const participantEmission = roundAmount(totalEmission * LYNX_PARTICIPANT_SHARE);
    const treasuryEmission = roundAmount(totalEmission * LYNX_TREASURY_SHARE);
    const initialSaleEmission = roundAmount(totalEmission * LYNX_INITIAL_SALE_SHARE);

    const participantPositions = [...this.positions.values()].filter((position) => position.marketId === market.id);
    const participantTotal = participantPositions.reduce((sum, position) => sum + position.amount, 0);
    for (const position of participantPositions) {
      const wallet = this.getWallet(position.wallet);
      const minted = participantTotal > 0 ? participantEmission * (position.amount / participantTotal) : 0;
      wallet.lynxBalance = roundAmount(wallet.lynxBalance + minted);
      this.pushNotification(wallet.wallet, {
        type: 'claimable',
        title: 'LYNX emission received',
        message: `${roundAmount(minted)} LYNX were minted from ${market.title}.`
      });
    }

    this.treasury.lynx = roundAmount(this.treasury.lynx + treasuryEmission);
    this.treasury.lynxForInitialSale = roundAmount(this.treasury.lynxForInitialSale + initialSaleEmission);

    if (initialSaleEmission > 0) {
      this.orders.set(id('order'), {
        id: id('order'),
        pair: 'LYNX/SOL',
        owner: TREASURY_WALLET,
        side: 'SELL',
        amount: initialSaleEmission,
        remaining: initialSaleEmission,
        price: 0.004,
        currency: 'LYNX',
        status: 'OPEN',
        createdAt: nowMs()
      });
    }
  }

  private resolveDuelsForMarket(market: Market) {
    const duels = [...this.duels.values()].filter((duel) => duel.parentMarketId === market.id && duel.status === 'ACTIVE');
    for (const duel of duels) {
      duel.status = 'RESOLVED';
      duel.resolvedAt = nowMs();
      const result = market.result;
      const creatorWins = result === duel.positionA || (result === 'YES' && duel.positionA === 'A') || (result === 'NO' && duel.positionA === 'B');
      const rivalWins = result === duel.positionB || (result === 'YES' && duel.positionB === 'A') || (result === 'NO' && duel.positionB === 'B');

      if (duel.type === '1v1vP') {
        if (creatorWins) {
          const wallet = this.getWallet(duel.creator);
          this.credit(wallet, 'SOL', roundAmount(duel.amount * 1.95));
          duel.winner = duel.creator;
        } else {
          this.treasury.protocolDuelSol = roundAmount(this.treasury.protocolDuelSol + duel.amount);
          duel.winner = TREASURY_WALLET;
        }
        continue;
      }

      if (creatorWins && !rivalWins) {
        const wallet = this.getWallet(duel.creator);
        this.credit(wallet, duel.currency, roundAmount(duel.amount * 1.95));
        duel.winner = duel.creator;
      } else if (rivalWins && duel.rival) {
        const wallet = this.getWallet(duel.rival);
        this.credit(wallet, duel.currency, roundAmount(duel.amount * 1.95));
        duel.winner = duel.rival;
      } else {
        this.treasury.sol = roundAmount(this.treasury.sol + duel.amount * 2);
        duel.winner = TREASURY_WALLET;
      }
    }
  }

  private notifyParticipants(market: Market) {
    const wallets = new Set(
      [...this.positions.values()]
        .filter((position) => position.marketId === market.id)
        .map((position) => position.wallet)
    );
    for (const wallet of wallets) {
      this.pushNotification(wallet, {
        type: 'market_resolved',
        title: 'Market resolved',
        message: `${market.title} resolved as ${market.result}.`
      });
    }
  }

  private pushNotification(wallet: string, partial: Omit<Notification, 'id' | 'timestamp' | 'read'>) {
    const notification: Notification = {
      id: id('note'),
      timestamp: nowMs(),
      read: false,
      ...partial
    };
    this.notifications.set(wallet, [notification, ...(this.notifications.get(wallet) ?? [])]);
  }

  private seedLynxBook() {
    const levels = [
      ['BUY', 0.0050, 8250],
      ['BUY', 0.0049, 16500],
      ['BUY', 0.0048, 24750],
      ['SELL', 0.0051, 12500],
      ['SELL', 0.0052, 25000],
      ['SELL', 0.0053, 37500]
    ] as const;
    for (const [side, price, amount] of levels) {
      this.orders.set(id('order'), {
        id: id('order'),
        pair: 'LYNX/SOL',
        owner: TREASURY_WALLET,
        side,
        amount,
        remaining: amount,
        price,
        currency: 'LYNX',
        status: 'OPEN',
        createdAt: nowMs()
      });
    }
  }

  private syntheticCandles(symbol: string, ms: number, limit: number): Candle[] {
    const basePrice = symbol.toUpperCase() === 'SOL' ? 145 : 0.004;
    const end = Math.ceil(Date.now() / ms) * ms;
    const candles: Candle[] = [];
    let current = basePrice;
    for (let i = limit - 1; i >= 0; i--) {
      const time = end - i * ms;
      const drift = Math.sin(i / 6) * current * 0.006;
      const open = current;
      const close = Math.max(0.000001, current + drift + (Math.random() - 0.47) * current * 0.018);
      const high = Math.max(open, close) + current * 0.01;
      const low = Math.max(0.000001, Math.min(open, close) - current * 0.01);
      const volume = symbol.toUpperCase() === 'SOL' ? 1000 + i * 3 : 50000 + i * 250;
      candles.push({ time, open, high, low, close, volume });
      current = close;
    }
    return candles;
  }
}
