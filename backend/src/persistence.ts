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
    totalVolume:      w.totalVolume,
    wins:             w.wins,
    losses:           w.losses,
    approvedAt:       msToDateOpt(w.approvedAt),
    approvalNonce:    w.approvalNonce ?? null,
    connectedWallets: (w.connectedWallets ?? null) as Prisma.InputJsonValue | null,
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
    endTime:     p.endTime,
    category:    p.category,
    author:      p.author,
    voters:      (p.voters ?? null) as Prisma.InputJsonValue | null,
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
    intent:    (t.intent ?? null) as Prisma.InputJsonValue | null,
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
    metadata:  (e.metadata ?? null) as Prisma.InputJsonValue | null,
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
    amount:     r.amount,
    entryPrice: r.entryPrice,
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
    amount:         r.amount,
    remaining:      r.remaining,
    price:          r.price,
    currency:       r.currency,
    status:         r.status,
    createdAt:      dateToMs(r.createdAt),
    lockedCurrency: r.lockedCurrency ?? undefined,
    lockedAmount:   r.lockedAmount ?? undefined,
    spentAmount:    r.spentAmount ?? undefined,
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
    amount:    r.amount,
    price:     r.price,
    feeAmount: r.feeAmount,
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
    amount:         r.amount,
    grossAmount:    r.grossAmount ?? undefined,
    burnedAmount:   r.burnedAmount ?? undefined,
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
    votesYes:    r.votesYes,
    votesNo:     r.votesNo,
    endTime:     r.endTime,
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

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPersistence(): Persistence {
  if (process.env.STORE_DRIVER !== 'prisma') {
    return {
      driver: 'memory',
      load: async () => undefined,
      save: async () => undefined,
      loadAuthUsers: async () => undefined,
      saveAuthUsers: async () => undefined
    };
  }

  const prisma = new PrismaClient();

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
          sol:                treasury.sol,
          lynx:               treasury.lynx,
          lynxForInitialSale: treasury.lynxForInitialSale,
          lynxBurned:         treasury.lynxBurned,
          protocolDuelSol:    treasury.protocolDuelSol,
        };
      }

      // Fix any stale statuses that weren't updated before the last shutdown
      store.reconcileStatuses();
    },

    async save(store) {
      // Flatten notifications map → array de filas
      const notifRows: ReturnType<typeof notificationToDb>[] = [];
      for (const [wallet, notifications] of store.notifications.entries()) {
        for (const n of notifications) {
          notifRows.push(notificationToDb(wallet, n));
        }
      }

      await prisma.$transaction(async (tx) => {
        // Markets
        await tx.market.deleteMany();
        if (store.markets.size > 0) {
          await tx.market.createMany({ data: [...store.markets.values()].map(marketToDb) });
        }

        // UserPositions
        await tx.userPosition.deleteMany();
        if (store.positions.size > 0) {
          await tx.userPosition.createMany({ data: [...store.positions.values()].map(positionToDb) });
        }

        // WalletStates
        await tx.walletState.deleteMany();
        if (store.wallets.size > 0) {
          await tx.walletState.createMany({ data: [...store.wallets.values()].map(walletToDb) });
        }

        // Orders
        await tx.order.deleteMany();
        if (store.orders.size > 0) {
          await tx.order.createMany({ data: [...store.orders.values()].map(orderToDb) });
        }

        // Trades
        await tx.trade.deleteMany();
        if (store.trades.size > 0) {
          await tx.trade.createMany({ data: [...store.trades.values()].map(tradeToDb) });
        }

        // Duels
        await tx.duel.deleteMany();
        if (store.duels.size > 0) {
          await tx.duel.createMany({ data: [...store.duels.values()].map(duelToDb) });
        }

        // Proposals
        await tx.proposal.deleteMany();
        if (store.proposals.size > 0) {
          await tx.proposal.createMany({ data: [...store.proposals.values()].map(proposalToDb) });
        }

        // Notifications
        await tx.notification.deleteMany();
        if (notifRows.length > 0) {
          await tx.notification.createMany({ data: notifRows });
        }

        // Transactions
        await tx.transaction.deleteMany();
        if (store.transactions.size > 0) {
          await tx.transaction.createMany({
            data: [...store.transactions.entries()].map(([id, t]) => transactionToDb(id, t))
          });
        }

        // LedgerEntries
        await tx.ledgerEntry.deleteMany();
        if (store.ledger.size > 0) {
          await tx.ledgerEntry.createMany({ data: [...store.ledger.values()].map(ledgerToDb) });
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
