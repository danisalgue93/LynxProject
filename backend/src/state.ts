import {
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
  LedgerEntry,
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

const STARTING_SOL = 0;
const STARTING_LYNX = 0;

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function nowMs() {
  return Date.now();
}

function normalizePosition(position: Position, ternary?: boolean): Position {
  if (ternary && position === 'YES') return 'A';
  if (ternary && position === 'NO') return 'B';
  if (!ternary && position === 'A') return 'YES';
  if (!ternary && position === 'B') return 'NO';
  return position;
}

function assertPositionAllowed(position: Position, ternary?: boolean) {
  if (!ternary && position === 'DRAW') {
    throw new Error('DRAW is only available for ternary markets');
  }
}

function assertMarketAcceptsEntries(market: Market) {
  if (market.status !== 'OPEN' && market.status !== 'ACTIVE') throw new Error('Market is not open');
  if (Date.now() >= market.cutoffAt) throw new Error('Market cutoff has passed');
}

function opposingPosition(position: Position, ternary?: boolean): Position {
  const normalized = normalizePosition(position, ternary);
  if (ternary) {
    if (normalized === 'A') return 'B';
    if (normalized === 'B') return 'A';
    throw new Error('DRAW has no single opposing position in a ternary market');
  }
  return normalized === 'YES' ? 'NO' : 'YES';
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
  transactions = new Map<string, { signature: string; wallet?: string; intent?: any; timestamp: number }>();
  ledger = new Map<string, LedgerEntry>();
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
    this.transactions.clear();
    this.ledger.clear();
    this.treasury = { sol: 0, lynx: 0, lynxForInitialSale: 0, lynxBurned: 0, protocolDuelSol: 0 };

    if (process.env.LYNX_SEED_DEMO_DATA !== 'true') {
      return;
    }

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
      author: 'LYNX Core',
      voters: {}
    });

    this.seedLynxBook();
  }

  addMarket(market: Market) {
    this.markets.set(market.id, market);
  }

  isWalletApproved(walletAddress: string) {
    return Boolean(this.wallets.get(walletAddress)?.approvedAt);
  }

  approveWallet(walletAddress: string, externalWallet?: string) {
    const wallet = this.getWallet(walletAddress);
    wallet.approvedAt = nowMs();
    wallet.approvalNonce = id('approve');
    if (externalWallet) {
      wallet.connectedWallets = Array.from(new Set([...(wallet.connectedWallets ?? []), externalWallet]));
    }
    const ledgerEntry = this.addLedgerEntry({
      wallet: wallet.wallet,
      type: 'APPROVE',
      status: 'COMPLETED',
      reference: wallet.approvalNonce,
      metadata: { externalWallet }
    });
    return { approved: true, approvalNonce: wallet.approvalNonce, wallet: this.getPortfolio(wallet.wallet), ledgerEntry };
  }

  deposit(input: { wallet: string; currency: Currency; amount: number; provider?: 'CARD' | 'EXTERNAL_WALLET' | 'INTERNAL'; reference?: string }) {
    assertPositiveAmount(input.amount);
    const wallet = this.getWallet(input.wallet);
    this.credit(wallet, input.currency, input.amount);
    const ledgerEntry = this.addLedgerEntry({
      wallet: wallet.wallet,
      type: 'DEPOSIT',
      currency: input.currency,
      amount: roundAmount(input.amount),
      provider: input.provider ?? 'INTERNAL',
      status: 'COMPLETED',
      reference: input.reference
    });
    return { portfolio: this.getPortfolio(wallet.wallet), ledgerEntry };
  }

  withdraw(input: { wallet: string; currency: Currency; amount: number; reference?: string }) {
    assertPositiveAmount(input.amount);
    const wallet = this.getWallet(input.wallet);
    this.debit(wallet, input.currency, input.amount);
    const ledgerEntry = this.addLedgerEntry({
      wallet: wallet.wallet,
      type: 'WITHDRAWAL',
      currency: input.currency,
      amount: roundAmount(input.amount),
      status: 'COMPLETED',
      reference: input.reference
    });
    return { portfolio: this.getPortfolio(wallet.wallet), ledgerEntry };
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
        losses: 0,
        connectedWallets: []
      };
      this.wallets.set(key, state);
    }
    return state;
  }

  /**
   * Reconciles in-memory statuses against real wall-clock time.
   * Called on startup (after loading from DB) and can be called anytime.
   * - Markets with cutoffAt in the past and status OPEN/ACTIVE → CUT_OFF
   * - Proposals with endTime in the past and status active → passed or rejected
   */
  reconcileStatuses() {
    const now = nowMs();
    for (const market of this.markets.values()) {
      if ((market.status === 'OPEN' || market.status === 'ACTIVE') && now >= market.cutoffAt) {
        market.status = 'CUT_OFF';
      }
    }
    for (const proposal of this.proposals.values()) {
      if (proposal.status === 'active' && new Date(proposal.endTime).getTime() <= now) {
        proposal.status = proposal.votesYes > proposal.votesNo ? 'passed' : 'rejected';
      }
    }
  }

  listMarkets(includeFinished = false) {
    const now = nowMs();
    return [...this.markets.values()]
      .filter(m => {
        if (includeFinished) return true;
        if (m.status === 'RESOLVED' || m.status === 'CUT_OFF' || m.status === 'EXPIRED') return false;
        // Belt-and-suspenders: also exclude by timestamp even if status wasn't updated
        if (now >= m.cutoffAt) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getMarket(id: string) {
    const market = this.markets.get(id);
    if (!market) throw new Error('Market not found');
    return market;
  }

  cutOffMarket(marketId: string, force = false) {
    const market = this.getMarket(marketId);
    if (market.status === 'RESOLVED') throw new Error('Market already resolved');
    if (market.status === 'CUT_OFF') return market;
    if (!force && Date.now() < market.cutoffAt) throw new Error('Cutoff time has not been reached');
    market.status = 'CUT_OFF';
    return market;
  }

  listDuels(parentMarketId?: string, includeFinished = false) {
    const now = nowMs();
    return [...this.duels.values()]
      .filter((duel) => !parentMarketId || duel.parentMarketId === parentMarketId)
      .filter((duel) => {
        if (includeFinished) return true;
        if (duel.status === 'RESOLVED' || duel.status === 'CANCELLED') return false;
        const market = this.markets.get(duel.parentMarketId);
        if (!market) return false;
        if (market.status === 'RESOLVED' || market.status === 'CUT_OFF' || market.status === 'EXPIRED') return false;
        return now < market.cutoffAt;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listProposals() {
    const now = nowMs();
    return [...this.proposals.values()].map(p => {
      // Auto-close proposals whose endTime has passed
      if (p.status === 'active' && new Date(p.endTime).getTime() <= now) {
        p.status = p.votesYes > p.votesNo ? 'passed' : 'rejected';
      }
      return p;
    });
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
      approvedAt: wallet.approvedAt,
      connectedWallets: wallet.connectedWallets ?? [],
      totalVolume: roundAmount(wallet.totalVolume),
      winRate: wallet.wins + wallet.losses === 0 ? 0 : roundAmount((wallet.wins / (wallet.wins + wallet.losses)) * 100),
      totalProfit: roundAmount(wallet.rewardsSol),
      feeShare: (() => { const s = this.getDaoStats(); return s.totalLynxStaked > 0 ? roundAmount((wallet.stakedLynx / s.totalLynxStaked) * 100) : 0; })(),
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
    assertPositionAllowed(position, market.isTernary);
    assertMarketAcceptsEntries(market);

    if (input.tradeType === 'limit') {
      return this.placeOrder({
        wallet: wallet.wallet,
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

    const creditedToPool = roundAmount(input.amount - burn);
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
      amount: creditedToPool,
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
    const market = input.marketId ? this.getMarket(input.marketId) : undefined;
    const isLynxSolPair = input.pair === 'LYNX/SOL';
    let position = input.position;
    let lockedCurrency: Currency | undefined;
    let lockedAmount: number | undefined;

    if (isLynxSolPair) {
      const notional = roundAmount(input.amount * input.price);
      const fee = roundAmount(notional * GLOBAL_TRADE_FEE);
      if (input.side === 'BUY') {
        lockedCurrency = 'SOL';
        lockedAmount = roundAmount(notional + fee);
      } else {
        lockedCurrency = 'LYNX';
        lockedAmount = input.amount;
      }
      this.debit(wallet, lockedCurrency, lockedAmount);
    } else {
      if (!market) throw new Error('Market is required for prediction orders');
      if (input.pair !== market.id) throw new Error('Order pair must match market');
      if (input.currency !== market.currency) throw new Error('Invalid currency for market');
      if (!position) throw new Error('Position is required for prediction orders');
      position = normalizePosition(position, market.isTernary);
      assertPositionAllowed(position, market.isTernary);
      assertMarketAcceptsEntries(market);
      lockedCurrency = market.currency;
      lockedAmount = input.amount;
      this.debit(wallet, lockedCurrency, lockedAmount);
    }

    const order: Order = {
      id: id('order'),
      marketId: input.marketId,
      pair: input.pair,
      owner: wallet.wallet,
      side: input.side,
      position,
      amount: input.amount,
      remaining: input.amount,
      price: input.price,
      currency: input.currency,
      status: 'OPEN',
      createdAt: nowMs(),
      lockedCurrency,
      lockedAmount,
      spentAmount: 0
    };
    this.orders.set(order.id, order);

    if (input.pair === 'LYNX/SOL') {
      this.matchLynxOrder(order);
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
    assertPositionAllowed(positionA, market.isTernary);
    assertMarketAcceptsEntries(market);

    const type = input.type ?? (market.isTernary ? '1v1vP' : '1v1');
    if (market.currency === 'LYNX' && type === '1v1vP') {
      throw new Error('1v1vP is SOL-only; use 1v1 for LYNX markets');
    }
    if (type === '1v1' && market.isTernary) throw new Error('1v1 duels require a binary market');
    if (type === '1v1vP' && !market.isTernary) throw new Error('1v1vP duels require a ternary market');
    const protocolWallet = type === '1v1vP' ? this.getWallet(TREASURY_WALLET) : undefined;
    if (market.currency === 'SOL' && wallet.solBalance < input.amount) throw new Error('Insufficient SOL balance');
    if (market.currency === 'LYNX' && wallet.lynxBalance < input.amount) throw new Error('Insufficient LYNX balance');
    if (protocolWallet && protocolWallet.solBalance < input.amount) throw new Error('Insufficient protocol SOL balance');

    this.debit(wallet, market.currency, input.amount);
    if (type === '1v1vP') {
      this.debit(protocolWallet!, 'SOL', input.amount);
    }
    const burnedAmount = market.currency === 'LYNX' ? roundAmount(input.amount * LYNX_EVENT_BURN) : 0;
    const netAmount = roundAmount(input.amount - burnedAmount);
    if (burnedAmount > 0) {
      market.burnedAmount = roundAmount(market.burnedAmount + burnedAmount);
      this.treasury.lynxBurned = roundAmount(this.treasury.lynxBurned + burnedAmount);
      this.addLedgerEntry({
        wallet: wallet.wallet,
        type: 'BURN',
        currency: 'LYNX',
        amount: burnedAmount,
        status: 'COMPLETED',
        metadata: { marketId: market.id, mode: 'duel:create' }
      });
    }
    const duel: Duel = {
      id: id('duel'),
      parentMarketId: market.id,
      creator: wallet.wallet,
      amount: netAmount,
      grossAmount: input.amount,
      burnedAmount,
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
    if (wallet.wallet === duel.creator) throw new Error('Creator cannot accept their own duel');
    const market = this.getMarket(duel.parentMarketId);
    // A duel can be accepted as long as the market has not been fully resolved yet.
    // assertMarketAcceptsEntries is intentionally NOT used here: it blocks the moment
    // the market cutoff passes, but a duel can legitimately still be OPEN and waiting.
    if (market.status === 'RESOLVED') throw new Error('The market for this duel has already been resolved');
    const positionB = normalizePosition(input.side ?? opposingPosition(duel.positionA, duel.isTernary), duel.isTernary);
    assertPositionAllowed(positionB, duel.isTernary);
    if (positionB === duel.positionA) throw new Error('Rival must choose a different side');
    const grossAmount = duel.grossAmount ?? duel.amount;
    this.debit(wallet, duel.currency, grossAmount);
    if (duel.currency === 'LYNX') {
      const burn = roundAmount(grossAmount * LYNX_EVENT_BURN);
      duel.burnedAmount = roundAmount((duel.burnedAmount ?? 0) + burn);
      market.burnedAmount = roundAmount(market.burnedAmount + burn);
      this.treasury.lynxBurned = roundAmount(this.treasury.lynxBurned + burn);
      this.addLedgerEntry({
        wallet: wallet.wallet,
        type: 'BURN',
        currency: 'LYNX',
        amount: burn,
        status: 'COMPLETED',
        metadata: { marketId: market.id, mode: 'duel:accept' }
      });
    }
    duel.rival = wallet.wallet;
    duel.positionB = positionB;
    duel.status = 'ACTIVE';
    duel.acceptedAt = nowMs();
    return duel;
  }

  cancelDuel(input: { wallet: string; duelId: string }) {
    const duel = this.duels.get(input.duelId);
    if (!duel) throw new Error('Duel not found');
    if (duel.status !== 'OPEN') throw new Error('Only OPEN duels can be cancelled');
    if (duel.creator !== input.wallet) throw new Error('Only the creator can cancel their duel');
    // Refund the gross amount the creator deposited (the burn is forfeit — consistent with LYNX burn semantics)
    const refundAmount = duel.grossAmount ?? duel.amount;
    const wallet = this.getWallet(input.wallet);
    if (duel.currency === 'SOL') {
      wallet.solBalance = roundAmount(wallet.solBalance + refundAmount);
    } else {
      wallet.lynxBalance = roundAmount(wallet.lynxBalance + refundAmount);
    }
    this.addLedgerEntry({
      wallet: input.wallet,
      type: 'REFUND',
      currency: duel.currency,
      amount: refundAmount,
      status: 'COMPLETED',
      metadata: { duelId: duel.id, mode: 'duel:cancel' }
    });
    duel.status = 'CANCELLED';
    return { duel, portfolio: this.getPortfolio(input.wallet) };
  }

  resolveMarket(input: { marketId: string; result: Position; source?: 'oracle' | 'manual' }) {
    const market = this.getMarket(input.marketId);
    if (market.status === 'RESOLVED') throw new Error('Market already resolved');
    const result = normalizePosition(input.result, market.isTernary);
    assertPositionAllowed(result, market.isTernary);
    market.status = 'RESOLVED';
    market.result = result;
    market.resolvedAt = nowMs();

    if (market.currency === 'SOL') {
      // Total protocol take on resolution is STAKER_REWARD_FEE + TREASURY_EVENT_FEE
      // (10%), matching exactly what claimPosition() deducts from the pool.
      // A separate EVENT_PROTOCOL_FEE was previously computed here too, but it
      // was never credited anywhere — dead code left over from an earlier
      // refactor. Removed: crediting it would mint SOL out of thin air, since
      // claimPosition only ever deducts the staker+treasury 10%, not 20%.
      const stakerFee = roundAmount(market.poolAmount * STAKER_REWARD_FEE);
      const treasuryFee = roundAmount(market.poolAmount * TREASURY_EVENT_FEE);
      this.treasury.sol = roundAmount(this.treasury.sol + treasuryFee);
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
    proposal.voters ??= {};
    if (proposal.voters[wallet.wallet]) throw new Error('Wallet already voted on this proposal');
    if (wallet.stakedLynx === 0) throw new Error('Requires a staked LYNX balance to vote');
    const weight = wallet.stakedLynx;
    if (input.voteType === 'yes') proposal.votesYes = roundAmount(proposal.votesYes + weight);
    else proposal.votesNo = roundAmount(proposal.votesNo + weight);
    proposal.voters[wallet.wallet] = input.voteType;
    return proposal;
  }

  createProposal(input: { title: string; description?: string; category?: string; author?: string }) {
    const now = nowMs();
    const proposal = {
      id: `LDAO-${Date.now().toString(36)}`,
      title: input.title,
      description: input.description || '',
      status: 'active' as const,
      votesYes: 0,
      votesNo: 0,
      endTime: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
      category: input.category || 'community',
      author: input.author || 'Anonymous',
      voters: {}
    };
    this.proposals.set(proposal.id, proposal as Proposal);
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

  klines(symbol = 'LYNX', interval = '1d', limit = 100, marketId?: string): Candle[] {
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
      .filter((trade) => marketId
        ? trade.marketId === marketId
        : symbol.toUpperCase() === 'LYNX'
          ? trade.pair === 'LYNX/SOL'
          : trade.pair.includes(symbol.toUpperCase()))
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

  listTransactions() {
    return [...this.transactions.values()].sort((a, b) => b.timestamp - a.timestamp);
  }

  listLedger(walletAddress: string) {
    return [...this.ledger.values()]
      .filter((entry) => entry.wallet === walletAddress)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  addTransaction(tx: { signature: string; wallet?: string; intent?: any }) {
    if (this.transactions.has(tx.signature)) return;
    const ts = Date.now();
    this.transactions.set(tx.signature, { signature: tx.signature, wallet: tx.wallet, intent: tx.intent, timestamp: ts });
  }

  hasTransaction(signature: string) {
    return this.transactions.has(signature);
  }

  getUserPositions(marketId: string) {
    return [...this.positions.values()].filter(p => p.marketId === marketId);
  }

  markNotificationsRead(walletAddress: string, notificationId?: string) {
    const notifications = this.listNotifications(walletAddress).map((notification) => ({
      ...notification,
      read: notificationId ? notification.read || notification.id === notificationId : true
    }));
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

  private consumeLockedAmount(order: Order, amount: number) {
    if (order.lockedAmount === undefined) return;
    order.spentAmount = roundAmount((order.spentAmount ?? 0) + amount);
    if (order.spentAmount > roundAmount(order.lockedAmount + 0.000000001)) {
      throw new Error('Order locked amount exceeded');
    }
  }

  private releaseUnusedLock(order: Order) {
    if (order.lockedAmount === undefined || !order.lockedCurrency) return;
    const refund = roundAmount(order.lockedAmount - (order.spentAmount ?? 0));
    if (refund > 0) {
      this.credit(this.getWallet(order.owner), order.lockedCurrency, refund);
    }
    order.lockedAmount = order.spentAmount ?? order.lockedAmount;
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
      const fee = roundAmount(notional * GLOBAL_TRADE_FEE);
      const buyerOrder = order.side === 'BUY' ? order : maker;
      const sellerOrder = order.side === 'SELL' ? order : maker;
      const buyer = this.getWallet(buyerOrder.owner);
      const seller = this.getWallet(sellerOrder.owner);
      this.credit(buyer, 'LYNX', amount);
      this.credit(seller, 'SOL', notional);
      this.consumeLockedAmount(buyerOrder, roundAmount(notional + fee));
      this.consumeLockedAmount(sellerOrder, amount);
      this.treasury.sol = roundAmount(this.treasury.sol + fee);
      order.remaining = roundAmount(order.remaining - amount);
      maker.remaining = roundAmount(maker.remaining - amount);
      order.status = order.remaining === 0 ? 'FILLED' : 'PARTIAL_FILLED';
      maker.status = maker.remaining === 0 ? 'FILLED' : 'PARTIAL_FILLED';
      if (order.status === 'FILLED') this.releaseUnusedLock(order);
      if (maker.status === 'FILLED') this.releaseUnusedLock(maker);
      const tradeId = id('trade');
      this.trades.set(tradeId, {
        id: tradeId,
        pair: 'LYNX/SOL',
        maker: maker.owner,
        taker: order.owner,
        side: order.side,
        amount,
        price,
        feeAmount: fee,
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
      const orderId = id('order');
      this.orders.set(orderId, {
        id: orderId,
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

  private mintProtocolDuelLynx(walletAddress: string, protocolSolCounterpart: number) {
    if (protocolSolCounterpart <= 0) return;
    const minted = roundAmount(protocolSolCounterpart * LYNX_EMISSION_PER_SOL);
    const wallet = this.getWallet(walletAddress);
    wallet.lynxBalance = roundAmount(wallet.lynxBalance + minted);
    this.addLedgerEntry({
      wallet: wallet.wallet,
      type: 'EMISSION',
      currency: 'LYNX',
      amount: minted,
      status: 'COMPLETED',
      metadata: { source: '1v1vP', protocolSolCounterpart }
    });
    this.pushNotification(wallet.wallet, {
      type: 'claimable',
      title: 'LYNX protocol-duel emission',
      message: `${minted} LYNX minted from the protocol-side SOL counterpart.`
    });
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
        const total = roundAmount(duel.amount * 2);
        if (creatorWins) {
          const fee = roundAmount(total * GLOBAL_TRADE_FEE);
          const payout = roundAmount(total - fee);
          const wallet = this.getWallet(duel.creator);
          this.credit(wallet, 'SOL', payout);
          this.mintProtocolDuelLynx(wallet.wallet, duel.amount);
          this.treasury.sol = roundAmount(this.treasury.sol + fee);
          duel.winner = duel.creator;
        } else {
          const protocolWallet = this.getWallet(TREASURY_WALLET);
          this.credit(protocolWallet, 'SOL', total);
          this.treasury.protocolDuelSol = roundAmount(this.treasury.protocolDuelSol + total);
          duel.winner = TREASURY_WALLET;
        }
        continue;
      }

      const total = roundAmount(duel.amount * 2);
      const fee = roundAmount(total * GLOBAL_TRADE_FEE);
      const payout = roundAmount(total - fee);
      if (creatorWins && !rivalWins) {
        const wallet = this.getWallet(duel.creator);
        this.credit(wallet, duel.currency, payout);
        if (duel.currency === 'LYNX') {
          this.treasury.lynx = roundAmount(this.treasury.lynx + fee);
        } else {
          this.treasury.sol = roundAmount(this.treasury.sol + fee);
        }
        duel.winner = duel.creator;
      } else if (rivalWins && duel.rival) {
        const wallet = this.getWallet(duel.rival);
        this.credit(wallet, duel.currency, payout);
        if (duel.currency === 'LYNX') {
          this.treasury.lynx = roundAmount(this.treasury.lynx + fee);
        } else {
          this.treasury.sol = roundAmount(this.treasury.sol + fee);
        }
        duel.winner = duel.rival;
      } else {
        if (duel.currency === 'LYNX') {
          this.treasury.lynx = roundAmount(this.treasury.lynx + total);
        } else {
          this.treasury.sol = roundAmount(this.treasury.sol + total);
        }
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

  private addLedgerEntry(input: Omit<LedgerEntry, 'id' | 'createdAt'>) {
    const entry: LedgerEntry = {
      id: id('ledger'),
      createdAt: nowMs(),
      ...input
    };
    this.ledger.set(entry.id, entry);
    return entry;
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
      const orderId = id('order');
      this.orders.set(orderId, {
        id: orderId,
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

  // Claim winning position payout.
  claimPosition(walletAddress: string, positionId: string) {
    const position = this.positions.get(positionId);
    if (!position) throw new Error('Position not found');
    if (position.wallet !== walletAddress) throw new Error('Position does not belong to this wallet');
    if (position.claimed) throw new Error('Position already claimed');

    const market = this.markets.get(position.marketId);
    if (!market) throw new Error('Market not found');
    if (market.status !== 'RESOLVED') throw new Error('Market is not resolved yet');
    if (!market.result) throw new Error('Market has no result');

    const normalizedResult = normalizePosition(market.result, market.isTernary);
    const normalizedPosition = normalizePosition(position.position, market.isTernary);
    if (normalizedPosition !== normalizedResult) throw new Error('Position did not win');

    // Payout = (user_amount / winning_side_pool) * (total_pool - protocol_fees)
    const winningPool =
      normalizedResult === 'YES' || normalizedResult === 'A'
        ? market.yesAmount
        : normalizedResult === 'NO' || normalizedResult === 'B'
        ? market.noAmount
        : (market.drawAmount ?? 0);

    if (winningPool <= 0) throw new Error('Winning pool is empty');

    const totalFeeRate = STAKER_REWARD_FEE + TREASURY_EVENT_FEE;
    const netPool = roundAmount(market.poolAmount * (1 - totalFeeRate));
    const userShare = position.amount / winningPool;
    const payout = roundAmount(netPool * userShare);

    position.claimed = true;
    const wallet = this.getWallet(walletAddress);
    this.credit(wallet, market.currency, payout);
    wallet.wins = (wallet.wins || 0) + 1;

    this.pushNotification(walletAddress, {
      type: 'claimable',
      title: 'Payout claimed!',
      message: `You claimed ${payout} ${market.currency} from "${market.title}".`
    });

    return { payout, currency: market.currency, portfolio: this.getPortfolio(walletAddress) };
  }

  // Cancel open order and refund.
  cancelOrder(walletAddress: string, orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    if (order.owner !== walletAddress) throw new Error('Order does not belong to this wallet');
    if (order.status === 'FILLED') throw new Error('Order is already filled');
    if (order.status === 'CANCELLED') throw new Error('Order is already cancelled');

    order.status = 'CANCELLED';

    const wallet = this.getWallet(walletAddress);
    if (order.lockedAmount !== undefined && order.lockedCurrency) {
      const refund = roundAmount(order.lockedAmount - (order.spentAmount ?? 0));
      if (refund > 0) this.credit(wallet, order.lockedCurrency, refund);
      order.lockedAmount = order.spentAmount ?? order.lockedAmount;
    } else if (order.pair === 'LYNX/SOL' && order.side === 'BUY') {
      const refund = roundAmount(order.remaining * order.price);
      wallet.solBalance = roundAmount(wallet.solBalance + refund);
    } else if (order.pair === 'LYNX/SOL') {
      wallet.lynxBalance = roundAmount(wallet.lynxBalance + order.remaining);
    } else {
      this.credit(wallet, order.currency, order.remaining);
    }

    return { cancelled: orderId, portfolio: this.getPortfolio(walletAddress) };
  }

  // List positions for a wallet
  listPositions(walletAddress: string) {
    return [...this.positions.values()].filter((p) => p.wallet === walletAddress);
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
