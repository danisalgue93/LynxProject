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
  // BE-H-08: Accepts a single user (id, object) instead of the full array to avoid
  // rewriting every user row on every auth-related state change.
  saveAuthUser<T>(userId: string, user: T): Promise<void>;
  // DB-level belt-and-suspenders guard against double voting. Attempts to
  // durably record a single (proposalId, wallet) vote via the ProposalVote
  // table's UNIQUE(proposalId, wallet) constraint. Returns false if a vote
  // for that pair already exists — this still protects against a double
  // vote even if the in-memory `voters` check in state.ts were ever bypassed
  // (e.g. after a restart that reloads a stale/incomplete Proposal.voters
  // snapshot from Postgres). The memory driver has no durable storage at all
  // (see the warning logged in createPersistence()), so it always returns
  // true there — consistent with everything else being volatile in that mode.
  recordVote(proposalId: string, wallet: string, voteType: 'yes' | 'no', weight: number): Promise<boolean>;
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
    solPrincipal:           p.solPrincipal ?? null,
    lynxBoostSolEquivalent: p.lynxBoostSolEquivalent ?? null,
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
  // BE-M-10: Validate endTime is a valid ISO string
  if (typeof p.endTime !== 'string' || isNaN(Date.parse(p.endTime))) {
    throw new Error(`Proposal.endTime must be a valid ISO string, got: ${typeof p.endTime}`);
  }
  return {
    id:            p.id,
    title:         p.title,
    description:   p.description,
    status:        p.status,
    votesYes:      p.votesYes,
    votesNo:       p.votesNo,
    endTime:       p.endTime,
    category:      p.category,
    author:        p.author,
    voters:        (p.voters ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    stakeSnapshot: (p.stakeSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
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

export function dbToMarket(r: any): Market {
  return {
    id:               r.id,
    title:            r.title,
    description:      r.description,
    category:         r.category,
    imageUrl:         r.imageUrl ?? undefined,
    status:           r.status,
    // Decimal → number (see dbToWallet): raw Decimal objects string-concatenate
    // under `+`, so pool math would corrupt on the first trade after a DB load.
    poolAmount:       Number(r.poolAmount),
    yesAmount:        Number(r.yesAmount),
    noAmount:         Number(r.noAmount),
    drawAmount:       r.drawAmount != null ? Number(r.drawAmount) : undefined,
    burnedAmount:     Number(r.burnedAmount),
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
    solPrincipal:           r.solPrincipal != null ? Number(r.solPrincipal) : undefined,
    lynxBoostSolEquivalent: r.lynxBoostSolEquivalent != null ? Number(r.lynxBoostSolEquivalent) : undefined,
  };
}

export function dbToWallet(r: any): WalletState {
  // Decimal columns come back from Prisma as Decimal objects, NOT numbers, and
  // Decimal.valueOf() is a string — so `wallet.solBalance + amount` in credit()
  // would string-concatenate ("10" + 5 -> "105") and inflate the balance on the
  // first credit after any DB load. Coerce every Decimal field to a real number,
  // exactly like dbToPosition/dbToOrder/dbToTrade already do. (wins/losses are
  // Int columns, so Prisma already returns them as numbers.)
  return {
    wallet:           r.wallet,
    solBalance:       Number(r.solBalance),
    lynxBalance:      Number(r.lynxBalance),
    stakedLynx:       Number(r.stakedLynx),
    rewardsSol:       Number(r.rewardsSol),
    rewardsLynx:      r.rewardsLynx != null ? Number(r.rewardsLynx) : 0,
    totalVolume:      Number(r.totalVolume),
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
    id:            r.id,
    title:         r.title,
    description:   r.description,
    status:        r.status,
    votesYes:      Number(r.votesYes),
    votesNo:       Number(r.votesNo),
    endTime:       r.endTime instanceof Date ? r.endTime.toISOString() : r.endTime,
    category:      r.category,
    author:        r.author,
    voters:        (r.voters as Record<string, 'yes' | 'no'> | null) ?? undefined,
    stakeSnapshot: (r.stakeSnapshot as Record<string, number> | null) ?? undefined,
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

export function dbToLedger(r: any): LedgerEntry {
  return {
    id:        r.id,
    wallet:    r.wallet,
    type:      r.type,
    currency:  r.currency ?? undefined,
    amount:    r.amount != null ? Number(r.amount) : undefined,
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

/**
 * Diff the current rows against the last-written snapshot.
 *
 * PURE with respect to `previousSnapshot`: the snapshot is only advanced when
 * the caller invokes the returned `commit()`, which MUST happen after the
 * database transaction has actually committed.
 *
 * This used to mutate `previousSnapshot` inline, while building the diff, which
 * caused two bugs:
 *
 *  1. DATA LOSS. The snapshot claimed the rows were persisted before the
 *     transaction ran. If that transaction then failed (DB down, deadlock,
 *     dropped connection), the next save() saw no difference for those rows and
 *     never wrote them again — balances/orders/ledger entries silently stayed
 *     in memory only and were lost on restart.
 *  2. The batch-insert fast path was dead. The write phase decides new-vs-
 *     existing via `lastTransactions.has(id)` / `lastLedger.has(id)`, but the
 *     ids had already been inserted into those maps, so `.has()` was always
 *     true and every row took the slow per-row upsert path instead of
 *     createMany.
 */
export function diffRows<T>(
  current: Map<string, T>,
  previousSnapshot: Map<string, string>
): { changed: T[]; deletedKeys: string[]; commit: () => void } {
  const changed: T[] = [];
  const pending = new Map<string, string>();
  const seen = new Set<string>();

  for (const [key, row] of current.entries()) {
    seen.add(key);
    const serialized = JSON.stringify(row);
    if (previousSnapshot.get(key) !== serialized) {
      changed.push(row);
      pending.set(key, serialized);
    }
  }

  const deletedKeys: string[] = [];
  for (const key of previousSnapshot.keys()) {
    if (!seen.has(key)) deletedKeys.push(key);
  }

  const commit = () => {
    for (const [key, serialized] of pending) previousSnapshot.set(key, serialized);
    for (const key of deletedKeys) previousSnapshot.delete(key);
  };

  return { changed, deletedKeys, commit };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPersistence(): Persistence {
  if (process.env.NODE_ENV === 'production' && process.env.STORE_DRIVER !== 'prisma') {
    throw new Error(
      'STORE_DRIVER must be "prisma" in production. In-memory mode loses all data on restart ' +
      'and is only intended for local development and testing.'
    );
  }

  if (process.env.NODE_ENV === 'test' && process.env.STORE_DRIVER !== 'prisma-test') {
    return {
      driver: 'memory',
      load: async () => undefined,
      save: async () => undefined,
      loadAuthUsers: async () => undefined,
      saveAuthUser: async () => undefined,
      recordVote: async () => true
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

  // Checked BEFORE the wantsPrisma branch below. It used to live inside
  // `if (!wantsPrisma)`, which this case never reaches — with
  // STORE_DRIVER=prisma, wantsPrisma is `(true || …) && true` = true — so the
  // "fail loudly" guard was unreachable and the process instead built a
  // PrismaClient with no connection string, failing later with a far more
  // obscure error at the first query.
  if (process.env.STORE_DRIVER === 'prisma' && !hasDatabaseUrl) {
    throw new Error(
      'STORE_DRIVER=prisma was set but DATABASE_URL is missing/empty. ' +
      'Set DATABASE_URL to a real Postgres connection string, or remove STORE_DRIVER to use the in-memory driver intentionally.'
    );
  }

  const wantsPrisma = (process.env.STORE_DRIVER === 'prisma' || hasDatabaseUrl) && !explicitlyMemory;

  if (!wantsPrisma) {
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
      saveAuthUser: async () => undefined,
      recordVote: async () => true
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

      // Rebuild in-memory indexes from loaded data (BE-M-06)
      store.positionsByWallet = new Map<string, string[]>();
      for (const p of store.positions.values()) {
        const ids = store.positionsByWallet.get(p.wallet) || [];
        ids.push(p.id);
        store.positionsByWallet.set(p.wallet, ids);
      }
      store.tradesByWallet = new Map<string, string[]>();
      for (const t of store.trades.values()) {
        const indexFor = (wallet: string) => {
          const ids = store.tradesByWallet.get(wallet) || [];
          ids.push(t.id);
          store.tradesByWallet.set(wallet, ids);
        };
        indexFor(t.taker);
        if (t.maker) indexFor(t.maker);
      }
      store.transactionsByWallet = new Map<string, string[]>();
      for (const [id, t] of store.transactions.entries()) {
        if (t.wallet) {
          const ids = store.transactionsByWallet.get(t.wallet) || [];
          ids.push(id);
          store.transactionsByWallet.set(t.wallet, ids);
        }
      }

      if (treasury) {
        const treasuryRecord = treasury as Record<string, unknown>;
        store.treasury = {
          sol:                Number(treasuryRecord.sol ?? 0),
          lynx:               Number(treasuryRecord.lynx ?? 0),
          lynxForInitialSale: Number(treasuryRecord.lynxForInitialSale ?? 0),
          lynxBurned:         Number(treasuryRecord.lynxBurned ?? 0),
          lynxTotalMinted:    Number(treasuryRecord.lynxTotalMinted ?? 0),
          protocolDuelSol:    Number(treasuryRecord.protocolDuelSol ?? 0),
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

        // Trades — BE-H-06: single raw SQL batch upsert (INSERT … ON CONFLICT DO UPDATE)
        if (trades.changed.length > 0) {
          const values = trades.changed.map(t =>
            Prisma.sql`(${t.id}, ${t.marketId}, ${t.pair}, ${t.maker}, ${t.taker}, ${t.side}, ${t.position}, ${t.amount}, ${t.price}, ${t.feeAmount}, ${t.currency}, ${t.createdAt})`
          );
          await tx.$executeRaw`
            INSERT INTO "Trade" ("id","marketId","pair","maker","taker","side","position","amount","price","feeAmount","currency","createdAt")
            VALUES ${Prisma.join(values)}
            ON CONFLICT ("id") DO UPDATE SET
              "marketId"  = EXCLUDED."marketId",
              "pair"      = EXCLUDED."pair",
              "maker"     = EXCLUDED."maker",
              "taker"     = EXCLUDED."taker",
              "side"      = EXCLUDED."side",
              "position"  = EXCLUDED."position",
              "amount"    = EXCLUDED."amount",
              "price"     = EXCLUDED."price",
              "feeAmount" = EXCLUDED."feeAmount",
              "currency"  = EXCLUDED."currency"
          `;
        }

        // Duels
        for (const d of duels.changed) {
          const { status: _ds, ...duelData } = d as any;
          await tx.duel.upsert({ where: { id: d.id }, create: duelData, update: duelData });
        }

        // Proposals
        for (const p of proposals.changed) {
          const { status: _ps, ...proposalData } = p as any;
          await tx.proposal.upsert({ where: { id: p.id }, create: proposalData, update: proposalData });
        }

        // Notifications
        for (const n of notifications.changed) {
          await tx.notification.upsert({ where: { id: n.id }, create: n, update: n });
        }

        // Transactions — BE-H-06: batch insert for large tables
        if (transactions.changed.length > 0) {
          const newTx: typeof transactions.changed = [];
          const existingTx: typeof transactions.changed = [];
          for (const t of transactions.changed) {
            if (lastTransactions.has(t.id)) {
              existingTx.push(t);
            } else {
              newTx.push(t);
            }
          }
          if (newTx.length > 0) {
            await tx.transaction.createMany({ data: newTx, skipDuplicates: true });
          }
          for (const t of existingTx) {
            await tx.transaction.upsert({ where: { id: t.id }, create: t, update: t });
          }
        }

        // LedgerEntries — BE-H-06: batch insert for large tables
        if (ledger.changed.length > 0) {
          const newLedger: typeof ledger.changed = [];
          const existingLedger: typeof ledger.changed = [];
          for (const e of ledger.changed) {
            if (lastLedger.has(e.id)) {
              existingLedger.push(e);
            } else {
              newLedger.push(e);
            }
          }
          if (newLedger.length > 0) {
            await tx.ledgerEntry.createMany({ data: newLedger.map(e => { const { type: _t, ...rest } = e as any; return rest; }), skipDuplicates: true });
          }
          for (const e of existingLedger) {
            const { type: _et, ...ledgerData } = e as any;
            await tx.ledgerEntry.upsert({ where: { id: e.id }, create: ledgerData, update: ledgerData });
          }
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

      // Only NOW mark these rows as persisted. If $transaction above threw, this
      // is never reached, the snapshots keep their previous values, and the next
      // save() retries the same rows instead of silently dropping them forever.
      markets.commit();
      positions.commit();
      wallets.commit();
      orders.commit();
      trades.commit();
      duels.commit();
      proposals.commit();
      notifications.commit();
      transactions.commit();
      ledger.commit();
    },

    async recordVote(proposalId, wallet, voteType, weight) {
      try {
        await prisma.proposalVote.create({
          data: { id: `${proposalId}:${wallet}`, proposalId, wallet, voteType, weight }
        });
        return true;
      } catch (err: any) {
        if (err?.code === 'P2002') return false; // UNIQUE(proposalId, wallet) violation — already voted
        throw err;
      }
    },

  async loadAuthUsers<T>() {
      const rows = await prisma.user.findMany();
      if (rows.length === 0) return undefined;
      return rows.map((r): [string, T] => [r.id, {
        id:                     r.id,
        email:                  r.email,
        passwordHash:           r.passwordHash,
        displayName:            r.displayName ?? undefined,
        // La app usa 'admin'/'user' y 'email'/'wallet' en minusculas; Prisma
        // almacena los enums Role/AuthMethod en MAYUSCULAS. Antes se casteaba
        // sin convertir ('ADMIN' as 'admin'), asi que un usuario cargado desde
        // la DB nunca pasaba los checks user.role === 'admin'.
        role:                   (r.role === 'ADMIN' ? 'admin' : 'user') as 'admin' | 'user',
        authMethod:             (r.authMethod === 'WALLET' ? 'wallet' : 'email') as 'email' | 'wallet',
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

    // BE-H-08: Upsert a single user instead of rewriting the full user table.
    async saveAuthUser<T>(_userId: string, user: T) {
      const r = user as any;
      // Espejo del mapeo de loadAuthUsers: la app maneja 'admin'/'wallet' en
      // minusculas, pero los enums Prisma (Role/AuthMethod) son MAYUSCULAS.
      // Escribir r.role directamente reventaba el upsert con "Invalid value
      // for argument `role`. Expected Role." en el primer wallet-login.
      const dbRole = (r.role === 'admin' ? 'ADMIN' : 'USER') as 'ADMIN' | 'USER';
      const dbAuthMethod = (r.authMethod === 'wallet' ? 'WALLET' : 'EMAIL') as 'WALLET' | 'EMAIL';
      await prisma.user.upsert({
        where:  { id: r.id },
        create: {
          id:                     r.id,
          email:                  r.email,
          passwordHash:           r.passwordHash ?? '',
          displayName:            r.displayName ?? null,
          role:                   dbRole,
          authMethod:             dbAuthMethod,
          emailVerified:          r.emailVerified ?? false,
          walletAddress:          r.walletAddress ?? null,
          walletLinkedAt:         r.walletLinkedAt ? new Date(r.walletLinkedAt) : null,
          managedWalletAddress:   r.managedWalletAddress ?? null,
          emailVerificationToken: r.emailVerificationToken ?? null,
          passwordResetToken:     r.passwordResetToken ?? null,
          passwordResetExpiresAt: r.passwordResetExpiresAt ? new Date(r.passwordResetExpiresAt) : null,
          createdAt:              r.createdAt ? new Date(r.createdAt) : new Date(),
        },
        update: {
          email:                  r.email,
          passwordHash:           r.passwordHash ?? '',
          displayName:            r.displayName ?? null,
          role:                   dbRole,
          authMethod:             dbAuthMethod,
          emailVerified:          r.emailVerified ?? false,
          walletAddress:          r.walletAddress ?? null,
          walletLinkedAt:         r.walletLinkedAt ? new Date(r.walletLinkedAt) : null,
          managedWalletAddress:   r.managedWalletAddress ?? null,
          emailVerificationToken: r.emailVerificationToken ?? null,
          passwordResetToken:     r.passwordResetToken ?? null,
          passwordResetExpiresAt: r.passwordResetExpiresAt ? new Date(r.passwordResetExpiresAt) : null,
        },
      });
    }
  };
}
