import { Prisma, PrismaClient } from '@prisma/client';
import type { LynxState } from './state.js';
import type {
  Duel,
  LedgerEntry,
  Market,
  Notification,
  Order,
  Proposal,
  Trade,
  UserPosition,
  WalletState
} from './types.js';

export interface Persistence {
  driver: 'memory' | 'prisma';
  load(store: LynxState): Promise<void>;
  save(store: LynxState): Promise<void>;
  loadAuthUsers<T>(): Promise<[string, T][] | undefined>;
  saveAuthUsers<T>(users: [string, T][]): Promise<void>;
}

const TREASURY_ID = 'default';

// ── DateTime helpers ──────────────────────────────────────────────────────────
// In-memory types use number (ms since epoch); DB uses DateTime (Date objects).

function msToDate(ms: number): Date { return new Date(ms); }
function dateToMs(d: Date): number { return d.getTime(); }
function msToDateOpt(ms?: number): Date | null { return ms != null ? new Date(ms) : null; }
function dateToMsOpt(d: Date | null): number | undefined { return d != null ? d.getTime() : undefined; }

// ── In-memory → DB converters ─────────────────────────────────────────────────

function marketToDb(m: Market) {
  return {
    id:               m.id,
    title:            m.title,
    description:      m.description,
    category:         m.category,
    imageUrl:         m.imageUrl ?? null,
    status:           m.status,
    poolAmount:       m.poolAmount,
    yesAmount:        m.yesAmount,
    noAmount:         m.noAmount,
    drawAmount:       m.drawAmount ?? null,
    burnedAmount:     m.burnedAmount,
    isTernary:        m.isTernary ?? false,
    currency:         m.currency,
    oracleId:         m.oracleId,
    oracleMode:       m.oracleMode,
    onChainMarket:    m.onChainMarket ?? null,
    onChainSignature: m.onChainSignature ?? null,
    createdBy:        m.createdBy ?? null,
    createdAt:        msToDate(m.createdAt),
    cutoffAt:         msToDate(m.cutoffAt),
    resolveAt:        msToDateOpt(m.resolveAt),
    oracleDeadline:   msToDateOpt(m.oracleDeadline),
    resolvedAt:       msToDateOpt(m.resolvedAt),
    result:           m.result ?? null,
  };
}

function positionToDb(p: UserPosition) {
  return {
    id:         p.id,
    marketId:   p.marketId,
    wallet:     p.wallet,
    position:   p.position,
    amount:     p.amount,
    entryPrice: p.entryPrice,
    currency:   p.currency,
    claimed:    p.claimed,
    createdAt:  msToDate(p.createdAt),
  };
}

function walletToDb(w: WalletState) {
  return {
    wallet:           w.wallet,
    solBalance:       w.solBalance,
    lynxBalance:      w.lynxBalance,
    stakedLynx:       w.stakedLynx,
    rewardsSol:       w.rewardsSol,
    rewardsLynx:      w.rewardsLynx,
    totalVolume:      w.totalVolume,
    wins:             w.wins,
    losses:           w.losses,
    approvedAt:       msToDateOpt(w.approvedAt),
    approvalNonce:    w.approvalNonce ?? null,
    connectedWallets: (w.connectedWallets ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
  };
}

function orderToDb(o: Order) {
  return {
    id:             o.id,
    marketId:       o.marketId ?? null,
    pair:           o.pair,
    owner:          o.owner,
    side:           o.side,
    position:       o.position ?? null,
    amount:         o.amount,
    remaining:      o.remaining,
    price:          o.price,
    currency:       o.currency,
    status:         o.status,
    createdAt:      msToDate(o.createdAt),
    lockedCurrency: o.lockedCurrency ?? null,
    lockedAmount:   o.lockedAmount ?? null,
    spentAmount:    o.spentAmount ?? null,
  };
}

function tradeToDb(t: Trade) {
  return {
    id:        t.id,
    marketId:  t.marketId ?? null,
    pair:      t.pair,
    maker:     t.maker ?? null,
    taker:     t.taker,
    side:      t.side,
    position:  t.position ?? null,
    amount:    t.amount,
    price:     t.price,
    feeAmount: t.feeAmount,
    currency:  t.currency,
    createdAt: msToDate(t.createdAt),
  };
}

function duelToDb(d: Duel) {
  return {
    id:             d.id,
    parentMarketId: d.parentMarketId,
    creator:        d.creator,
    rival:          d.rival ?? null,
    amount:         d.amount,
    grossAmount:    d.grossAmount ?? null,
    burnedAmount:   d.burnedAmount ?? null,
    currency:       d.currency,
    status:         d.status,
    positionA:      d.positionA,
    positionB:      d.positionB ?? null,
    isTernary:      d.isTernary ?? null,
    type:           d.type,
    protocolSide:   d.protocolSide ?? null,
    createdAt:      msToDate(d.createdAt),
    acceptedAt:     msToDateOpt(d.acceptedAt),
    resolvedAt:     msToDateOpt(d.resolvedAt),
    winner:         d.winner ?? null,
  };
}

function proposalToDb(p: Proposal) {
  return {
    id:          p.id,
    title:       p.title,
    description: p.description,
    status:      p.status,
    votesYes:    p.votesYes,
    votesNo:     p.votesNo,
    endTime:     new Date(p.endTime),
    category:    p.category,
    author:      p.author,
    voters:      (p.voters ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
  };
}

function notificationToDb(wallet: string, n: Notification) {
  return {
    id:        n.id,
    wallet,
    type:      n.type,
    title:     n.title,
    message:   n.message,
    timestamp: msToDate(n.timestamp),
    read:      n.read,
  };
}

function transactionToDb(id: string, t: { signature: string; wallet?: string; intent?: any; timestamp: number }) {
  return {
    id,
    signature: t.signature,
    wallet:    t.wallet ?? null,
    intent:    (t.intent ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    timestamp: msToDate(t.timestamp),
  };
}

function ledgerToDb(e: LedgerEntry) {
  return {
    id:        e.id,
    wallet:    e.wallet,
    type:      e.type,
    currency:  e.currency ?? null,
    amount:    e.amount ?? null,
    provider:  e.provider ?? null,
    status:    e.status,
    reference: e.reference ?? null,
    metadata:  (e.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    createdAt: msToDate(e.createdAt),
  };
}

// ── DB → In-memory converters ─────────────────────────────────────────────────

function dbToMarket(r: any): Market {
  return {
    id:               r.id,
    title:            r.title,
    description:      r.description,
    category:         r.category,
    imageUrl:         r.imageUrl ?? undefined,
    status:           r.status,
    poolAmount:       r.poolAmount,
    yesAmount:        r.yesAmount,
    noAmount:         r.noAmount,
    drawAmount:       r.drawAmount ?? undefined,
    burnedAmount:     r.burnedAmount,
    isTernary:        r.isTernary,
    currency:         r.currency,
    oracleId:         r.oracleId,
    oracleMode:       r.oracleMode,
    onChainMarket:    r.onChainMarket ?? undefined,
    onChainSignature: r.onChainSignature ?? undefined,
    createdBy:        r.createdBy ?? undefined,
    createdAt:        dateToMs(r.createdAt),
    cutoffAt:         dateToMs(r.cutoffAt),
    resolveAt:        dateToMsOpt(r.resolveAt),
    oracleDeadline:   dateToMsOpt(r.oracleDeadline),
    resolvedAt:       dateToMsOpt(r.resolvedAt),
    result:           r.result ?? undefined,
  };
}

function dbToPosition(r: any): UserPosition {
  return {
    id:         r.id,
    marketId:   r.marketId,
    wallet:     r.wallet,
    position:   r.position,
    amount:     Number(r.amount),
    entryPrice: Number(r.entryPrice),
    currency:   r.currency,
    claimed:    r.claimed,
    createdAt:  dateToMs(r.createdAt),
  };
}

function dbToWallet(r: any): WalletState {
  return {
    wallet:           r.wallet,
    solBalance:       r.solBalance,
    lynxBalance:      r.lynxBalance,
    stakedLynx:       r.stakedLynx,
    rewardsSol:       r.rewardsSol,
    rewardsLynx:      r.rewardsLynx ?? 0,
    totalVolume:      r.totalVolume,
    wins:             r.wins,
    losses:           r.losses,
    approvedAt:       dateToMsOpt(r.approvedAt),
    approvalNonce:    r.approvalNonce ?? undefined,
    connectedWallets: (r.connectedWallets as string[] | null) ?? undefined,
  };
}

function dbToOrder(r: any): Order {
  return {
    id:             r.id,
    marketId:       r.marketId ?? undefined,
    pair:           r.pair,
    owner:          r.owner,
    side:           r.side,
    position:       r.position ?? undefined,
    amount:         Number(r.amount),
    remaining:      Number(r.remaining),
    price:          Number(r.price),
    currency:       r.currency,
    status:         r.status,
    createdAt:      dateToMs(r.createdAt),
    lockedCurrency: r.lockedCurrency ?? undefined,
    lockedAmount:   r.lockedAmount == null ? undefined : Number(r.lockedAmount),
    spentAmount:    r.spentAmount == null ? undefined : Number(r.spentAmount),
  };
}

function dbToTrade(r: any): Trade {
  return {
    id:        r.id,
    marketId:  r.marketId ?? undefined,
    pair:      r.pair,
    maker:     r.maker ?? undefined,
    taker:     r.taker,
    side:      r.side,
    position:  r.position ?? undefined,
    amount:    Number(r.amount),
    price:     Number(r.price),
    feeAmount: Number(r.feeAmount),
    currency:  r.currency,
    createdAt: dateToMs(r.createdAt),
  };
}

function dbToDuel(r: any): Duel {
  return {
    id:             r.id,
    parentMarketId: r.parentMarketId,
    creator:        r.creator,
    rival:          r.rival ?? undefined,
    amount:         Number(r.amount),
    grossAmount:    r.grossAmount == null ? undefined : Number(r.grossAmount),
    burnedAmount:   r.burnedAmount == null ? undefined : Number(r.burnedAmount),
    currency:       r.currency,
    status:         r.status,
    positionA:      r.positionA,
    positionB:      r.positionB ?? undefined,
    isTernary:      r.isTernary ?? undefined,
    type:           r.type,
    protocolSide:   r.protocolSide ?? undefined,
    createdAt:      dateToMs(r.createdAt),
    acceptedAt:     dateToMsOpt(r.acceptedAt),
    resolvedAt:     dateToMsOpt(r.resolvedAt),
    winner:         r.winner ?? undefined,
  };
}

function dbToProposal(r: any): Proposal {
  return {
    id:          r.id,
    title:       r.title,
    description: r.description,
    status:      r.status,
    votesYes:    Number(r.votesYes),
    votesNo:     Number(r.votesNo),
    endTime:     r.endTime instanceof Date ? r.endTime.toISOString() : r.endTime,
    category:    r.category,
    author:      r.author,
    voters:      (r.voters as Record<string, 'yes' | 'no'> | null) ?? undefined,
  };
}

function dbToNotification(r: any): Notification {
  return {
    id:        r.id,
    type:      r.type,
    title:     r.title,
    message:   r.message,
    timestamp: dateToMs(r.timestamp),
    read:      r.read,
  };
}

function dbToLedger(r: any): LedgerEntry {
  return {
    id:        r.id,
    wallet:    r.wallet,
    type:      r.type,
    currency:  r.currency ?? undefined,
    amount:    r.amount ?? undefined,
    provider:  r.provider ?? undefined,
    status:    r.status,
    reference: r.reference ?? undefined,
    metadata:  (r.metadata as Record<string, unknown> | null) ?? undefined,
    createdAt: dateToMs(r.createdAt),
  };
}

// ── Incremental-save diffing ────────────────────────────────────────────────
// Compares the current set of DB-shaped rows against a snapshot of what was
// last written, and reports only the rows that are new/changed plus the keys
// that disappeared (so callers can upsert the former and delete the latter,
// instead of rewriting every row on every save()). `previousSnapshot` is
// mutated in place to become the new baseline for the next call.

function diffRows<T>(
  current: Map<string, T>,
  previousSnapshot: Map<string, string>
): { changed: T[]; deletedKeys: string[] } {
  const changed: T[] = [];
  const seen = new Set<string>();

  for (const [key, row] of current.entries()) {
    seen.add(key);
    const serialized = JSON.stringify(row);
    if (previousSnapshot.get(key) !== serialized) {
      changed.push(row);
      previousSnapshot.set(key, serialized);
    }
  }

  const deletedKeys: string[] = [];
  for (const key of previousSnapshot.keys()) {
    if (!seen.has(key)) deletedKeys.push(key);
  }
  for (const key of deletedKeys) previousSnapshot.delete(key);

  return { changed, deletedKeys };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPersistence(): Persistence {
  if (process.env.NODE_ENV === 'test' && process.env.STORE_DRIVER !== 'prisma-test') {
    return {
      driver: 'memory',
      load: async () => undefined,
      save: async () => undefined,
      loadAuthUsers: async () => undefined,
      saveAuthUsers: async () => undefined
    };
  }

  // Decide whether to use Prisma (persistent) or the in-memory (volatile) driver.
  //
  // Historically this required BOTH `DATABASE_URL` (the connection string) AND a
  // separate `STORE_DRIVER=prisma` flag to be set, with no warning if only one was
  // present. That is an easy trap: a real Postgres database gets provisioned and
  // `DATABASE_URL` gets configured, but the extra `STORE_DRIVER` flag is forgotten,
  // and the backend silently falls back to in-memory storage — meaning markets,
  // trades, orders and duels all vanish on every restart/redeploy with zero
  // indication anything is wrong.
  //
  // Now: any non-empty `DATABASE_URL` is enough to opt into the Prisma driver,
  // unless someone explicitly opts OUT with `STORE_DRIVER=memory` (useful for local
  // development without a database).
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
  const explicitlyMemory = process.env.STORE_DRIVER === 'memory';
  const wantsPrisma = (process.env.STORE_DRIVER === 'prisma' || hasDatabaseUrl) && !explicitlyMemory;

  if (!wantsPrisma) {
    if (process.env.STORE_DRIVER === 'prisma' && !hasDatabaseUrl) {
      // Someone explicitly asked for Prisma but didn't configure a database — fail
      // loudly instead of quietly losing data.
      throw new Error(
        'STORE_DRIVER=prisma was set but DATABASE_URL is missing/empty. ' +
        'Set DATABASE_URL to a real Postgres connection string, or remove STORE_DRIVER to use the in-memory driver intentionally.'
      );
    }
    console.warn(
      '⚠️  [persistence] Using the IN-MEMORY store driver. ' +
      'All markets, trades, orders, duels and balances will be LOST on every restart or redeploy. ' +
      'Set DATABASE_URL (and run `prisma migrate`/`prisma db push`) to enable persistent storage.'
    );
    return {
      driver: 'memory',
      load: async () => undefined,
      save: async () => undefined,
      loadAuthUsers: async () => undefined,
      saveAuthUsers: async () => undefined
    };
  }

  console.log('✅ [persistence] Using the PRISMA store driver — state will persist across restarts.');

  const prisma = new PrismaClient();

  // Snapshots of what was last written to the DB, keyed the same way as the
  // corresponding store Map (or by notification/transaction id). Used by
  // save() to write only what changed instead of rewriting every table.
  const lastMarkets = new Map<string, string>();
  const lastPositions = new Map<string, string>();
  const lastWallets = new Map<string, string>();
  const lastOrders = new Map<string, string>();
  const lastTrades = new Map<string, string>();
  const lastDuels = new Map<string, string>();
  const lastProposals = new Map<string, string>();
  const lastNotifications = new Map<string, string>();
  const lastTransactions = new Map<string, string>();
  const lastLedger = new Map<string, string>();

  return {
    driver: 'prisma',

    async load(store) {
      const [
        markets,
        positions,
        wallets,
        orders,
        trades,
        duels,
        proposals,
        notifications,
        transactions,
        ledgerEntries,
        treasury,
      ] = await Promise.all([
        prisma.market.findMany(),
        prisma.userPosition.findMany(),
        prisma.walletState.findMany(),
        prisma.order.findMany(),
        prisma.trade.findMany(),
        prisma.duel.findMany(),
        prisma.proposal.findMany(),
        prisma.notification.findMany({ orderBy: { timestamp: 'desc' } }),
        prisma.transaction.findMany(),
        prisma.ledgerEntry.findMany(),
        prisma.treasury.findUnique({ where: { id: TREASURY_ID } }),
      ]);

      store.markets   = new Map(markets.map(r => [r.id, dbToMarket(r)]));
      store.positions = new Map(positions.map(r => [r.id, dbToPosition(r)]));
      store.wallets   = new Map(wallets.map(r => [r.wallet, dbToWallet(r)]));
      store.orders    = new Map(orders.map(r => [r.id, dbToOrder(r)]));
      store.trades    = new Map(trades.map(r => [r.id, dbToTrade(r)]));
      store.duels     = new Map(duels.map(r => [r.id, dbToDuel(r)]));
      store.proposals = new Map(proposals.map(r => [r.id, dbToProposal(r)]));

      // Notifications: group by wallet (already sorted DESC from DB)
      const notifMap = new Map<string, Notification[]>();
      for (const r of notifications) {
        const arr = notifMap.get(r.wallet) ?? [];
        arr.push(dbToNotification(r));
        notifMap.set(r.wallet, arr);
      }
      store.notifications = notifMap;

      store.transactions = new Map(
        transactions.map(r => [r.id, {
          signature: r.signature,
          wallet:    r.wallet ?? undefined,
          intent:    r.intent ?? undefined,
          timestamp: dateToMs(r.timestamp),
        }])
      );

      store.ledger = new Map(ledgerEntries.map(r => [r.id, dbToLedger(r)]));

      if (treasury) {
        store.treasury = {
          sol:                Number(treasury.sol),
          lynx:               Number(treasury.lynx),
          lynxForInitialSale: Number(treasury.lynxForInitialSale),
          lynxBurned:         Number(treasury.lynxBurned),
          protocolDuelSol:    Number(treasury.protocolDuelSol),
        };
      }

      // Fix any stale statuses that weren't updated before the last shutdown
      store.reconcileStatuses();
    },

    async save(store) {
      // Build the current DB-shaped rows for each table, keyed the same way
      // as their primary key, then diff against what was last written so we
      // only upsert new/changed rows and delete the ones that disappeared —
      // instead of deleting and recreating all 10 tables on every save().
      const marketRows = new Map<string, ReturnType<typeof marketToDb>>();
      for (const m of store.markets.values()) marketRows.set(m.id, marketToDb(m));

      const positionRows = new Map<string, ReturnType<typeof positionToDb>>();
      for (const p of store.positions.values()) positionRows.set(p.id, positionToDb(p));

      const walletRows = new Map<string, ReturnType<typeof walletToDb>>();
      for (const w of store.wallets.values()) walletRows.set(w.wallet, walletToDb(w));

      const orderRows = new Map<string, ReturnType<typeof orderToDb>>();
      for (const o of store.orders.values()) orderRows.set(o.id, orderToDb(o));

      const tradeRows = new Map<string, ReturnType<typeof tradeToDb>>();
      for (const t of store.trades.values()) tradeRows.set(t.id, tradeToDb(t));

      const duelRows = new Map<string, ReturnType<typeof duelToDb>>();
      for (const d of store.duels.values()) duelRows.set(d.id, duelToDb(d));

      const proposalRows = new Map<string, ReturnType<typeof proposalToDb>>();
      for (const p of store.proposals.values()) proposalRows.set(p.id, proposalToDb(p));

      // Notifications: flatten map → rows, keyed by notification id
      const notificationRows = new Map<string, ReturnType<typeof notificationToDb>>();
      for (const [wallet, notifications] of store.notifications.entries()) {
        for (const n of notifications) notificationRows.set(n.id, notificationToDb(wallet, n));
      }

      const transactionRows = new Map<string, ReturnType<typeof transactionToDb>>();
      for (const [id, t] of store.transactions.entries()) transactionRows.set(id, transactionToDb(id, t));

      const ledgerRows = new Map<string, ReturnType<typeof ledgerToDb>>();
      for (const e of store.ledger.values()) ledgerRows.set(e.id, ledgerToDb(e));

      const markets = diffRows(marketRows, lastMarkets);
      const positions = diffRows(positionRows, lastPositions);
      const wallets = diffRows(walletRows, lastWallets);
      const orders = diffRows(orderRows, lastOrders);
      const trades = diffRows(tradeRows, lastTrades);
      const duels = diffRows(duelRows, lastDuels);
      const proposals = diffRows(proposalRows, lastProposals);
      const notifications = diffRows(notificationRows, lastNotifications);
      const transactions = diffRows(transactionRows, lastTransactions);
      const ledger = diffRows(ledgerRows, lastLedger);

      await prisma.$transaction(async (tx) => {
        // Markets (upserted first: positions/orders/trades/duels reference them)
        for (const m of markets.changed) {
          await tx.market.upsert({ where: { id: m.id }, create: m, update: m });
        }

        // UserPositions
        for (const p of positions.changed) {
          await tx.userPosition.upsert({ where: { id: p.id }, create: p, update: p });
        }

        // WalletStates
        for (const w of wallets.changed) {
          await tx.walletState.upsert({ where: { wallet: w.wallet }, create: w, update: w });
        }

        // Orders
        for (const o of orders.changed) {
          await tx.order.upsert({ where: { id: o.id }, create: o, update: o });
        }

        // Trades
        for (const t of trades.changed) {
          await tx.trade.upsert({ where: { id: t.id }, create: t, update: t });
        }

        // Duels
        for (const d of duels.changed) {
          await tx.duel.upsert({ where: { id: d.id }, create: d, update: d });
        }

        // Proposals
        for (const p of proposals.changed) {
          await tx.proposal.upsert({ where: { id: p.id }, create: p, update: p });
        }

        // Notifications
        for (const n of notifications.changed) {
          await tx.notification.upsert({ where: { id: n.id }, create: n, update: n });
        }

        // Transactions
        for (const t of transactions.changed) {
          await tx.transaction.upsert({ where: { id: t.id }, create: t, update: t });
        }

        // LedgerEntries
        for (const e of ledger.changed) {
          await tx.ledgerEntry.upsert({ where: { id: e.id }, create: e, update: e });
        }

        // Deletions, in reverse-dependency order (children before the
        // markets/wallets they reference).
        if (positions.deletedKeys.length > 0) {
          await tx.userPosition.deleteMany({ where: { id: { in: positions.deletedKeys } } });
        }
        if (orders.deletedKeys.length > 0) {
          await tx.order.deleteMany({ where: { id: { in: orders.deletedKeys } } });
        }
        if (trades.deletedKeys.length > 0) {
          await tx.trade.deleteMany({ where: { id: { in: trades.deletedKeys } } });
        }
        if (duels.deletedKeys.length > 0) {
          await tx.duel.deleteMany({ where: { id: { in: duels.deletedKeys } } });
        }
        if (markets.deletedKeys.length > 0) {
          await tx.market.deleteMany({ where: { id: { in: markets.deletedKeys } } });
        }
        if (wallets.deletedKeys.length > 0) {
          await tx.walletState.deleteMany({ where: { wallet: { in: wallets.deletedKeys } } });
        }
        if (proposals.deletedKeys.length > 0) {
          await tx.proposal.deleteMany({ where: { id: { in: proposals.deletedKeys } } });
        }
        if (notifications.deletedKeys.length > 0) {
          await tx.notification.deleteMany({ where: { id: { in: notifications.deletedKeys } } });
        }
        if (transactions.deletedKeys.length > 0) {
          await tx.transaction.deleteMany({ where: { id: { in: transactions.deletedKeys } } });
        }
        if (ledger.deletedKeys.length > 0) {
          await tx.ledgerEntry.deleteMany({ where: { id: { in: ledger.deletedKeys } } });
        }

        // Treasury (singleton upsert)
        await tx.treasury.upsert({
          where:  { id: TREASURY_ID },
          create: { id: TREASURY_ID, ...store.treasury },
          update: store.treasury,
        });
      });
    },

  async loadAuthUsers<T>() {
      const rows = await prisma.user.findMany();
      if (rows.length === 0) return undefined;
      return rows.map((r): [string, T] => [r.id, {
        id:                     r.id,
        email:                  r.email,
        passwordHash:           r.passwordHash,
        displayName:            r.displayName ?? undefined,
        role:                   r.role as 'admin' | 'user',
        authMethod:             r.authMethod as 'email' | 'wallet',
        emailVerified:          r.emailVerified,
        walletAddress:          r.walletAddress ?? undefined,
        walletLinkedAt:         r.walletLinkedAt ? r.walletLinkedAt.getTime() : undefined,
        managedWalletAddress:   r.managedWalletAddress ?? undefined,
        emailVerificationToken: r.emailVerificationToken ?? undefined,
        passwordResetToken:     r.passwordResetToken ?? undefined,
        passwordResetExpiresAt: r.passwordResetExpiresAt ? r.passwordResetExpiresAt.getTime() : undefined,
        createdAt:              r.createdAt.getTime(),
      } as T]);
    },

    async saveAuthUsers<T>(users: [string, T][]) {
      // Upsert each user individually so we never wipe the whole table at once.
      // Using a transaction keeps it atomic.
      const rows = users.map(([, u]) => u as any);
      await prisma.$transaction(
        rows.map((u) =>
          prisma.user.upsert({
            where:  { id: u.id },
            create: {
              id:                     u.id,
              email:                  u.email,
              passwordHash:           u.passwordHash ?? '',
              displayName:            u.displayName ?? null,
              role:                   u.role ?? 'user',
              authMethod:             u.authMethod ?? 'email',
              emailVerified:          u.emailVerified ?? false,
              walletAddress:          u.walletAddress ?? null,
              walletLinkedAt:         u.walletLinkedAt ? new Date(u.walletLinkedAt) : null,
              managedWalletAddress:   u.managedWalletAddress ?? null,
              emailVerificationToken: u.emailVerificationToken ?? null,
              passwordResetToken:     u.passwordResetToken ?? null,
              passwordResetExpiresAt: u.passwordResetExpiresAt ? new Date(u.passwordResetExpiresAt) : null,
              createdAt:              u.createdAt ? new Date(u.createdAt) : new Date(),
            },
            update: {
              email:                  u.email,
              passwordHash:           u.passwordHash ?? '',
              displayName:            u.displayName ?? null,
              role:                   u.role ?? 'user',
              authMethod:             u.authMethod ?? 'email',
              emailVerified:          u.emailVerified ?? false,
              walletAddress:          u.walletAddress ?? null,
              walletLinkedAt:         u.walletLinkedAt ? new Date(u.walletLinkedAt) : null,
              managedWalletAddress:   u.managedWalletAddress ?? null,
              emailVerificationToken: u.emailVerificationToken ?? null,
              passwordResetToken:     u.passwordResetToken ?? null,
              passwordResetExpiresAt: u.passwordResetExpiresAt ? new Date(u.passwordResetExpiresAt) : null,
            },
          })
        )
      );
    }
  };
}
