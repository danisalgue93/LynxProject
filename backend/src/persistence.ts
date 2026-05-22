import { Prisma, PrismaClient } from '@prisma/client';
import type { LynxState } from './state.js';
import type {
  Duel,
  Market,
  Notification,
  Order,
  Proposal,
  Trade,
  UserPosition,
  WalletState
} from './types.js';

type StateSnapshot = {
  markets: [string, Market][];
  positions: [string, UserPosition][];
  wallets: [string, WalletState][];
  orders: [string, Order][];
  trades: [string, Trade][];
  duels: [string, Duel][];
  proposals: [string, Proposal][];
  notifications: [string, Notification[]][];
  transactions?: [string, { signature: string; wallet?: string; intent?: any; timestamp: number }][];
  treasury: LynxState['treasury'];
};

export interface Persistence {
  driver: 'memory' | 'prisma';
  load(store: LynxState): Promise<void>;
  save(store: LynxState): Promise<void>;
}

const STATE_ID = 'default';

function snapshot(store: LynxState): StateSnapshot {
  return JSON.parse(JSON.stringify({
    markets: [...store.markets.entries()],
    positions: [...store.positions.entries()],
    wallets: [...store.wallets.entries()],
    orders: [...store.orders.entries()],
    trades: [...store.trades.entries()],
    duels: [...store.duels.entries()],
    proposals: [...store.proposals.entries()],
    notifications: [...store.notifications.entries()],
    transactions: [...(store.transactions ? store.transactions.entries() : [])],
    treasury: store.treasury
  })) as StateSnapshot;
}

function jsonSnapshot(store: LynxState): Prisma.InputJsonValue {
  return snapshot(store) as unknown as Prisma.InputJsonValue;
}

function restoreMap<T>(entries: [string, T][] | undefined) {
  return new Map<string, T>(entries || []);
}

export function createPersistence(): Persistence {
  if (process.env.STORE_DRIVER !== 'prisma') {
    return {
      driver: 'memory',
      load: async () => undefined,
      save: async () => undefined
    };
  }

  const prisma = new PrismaClient();

  return {
    driver: 'prisma',
    async load(store) {
      const row = await prisma.appState.findUnique({ where: { id: STATE_ID } });
      if (!row) {
        await prisma.appState.upsert({
          where: { id: STATE_ID },
          create: { id: STATE_ID, data: jsonSnapshot(store) },
          update: { data: jsonSnapshot(store) }
        });
        return;
      }

      const data = row.data as StateSnapshot;
      store.markets = restoreMap(data.markets);
      store.positions = restoreMap(data.positions);
      store.wallets = restoreMap(data.wallets);
      store.orders = restoreMap(data.orders);
      store.trades = restoreMap(data.trades);
      store.duels = restoreMap(data.duels);
      store.proposals = restoreMap(data.proposals);
      store.notifications = restoreMap(data.notifications);
      if (data.transactions) {
        // restore transactions as a Map keyed by signature
        // @ts-ignore
        store.transactions = restoreMap(data.transactions as any);
      }
      store.treasury = data.treasury;
    },
    async save(store) {
      await prisma.appState.upsert({
        where: { id: STATE_ID },
        create: { id: STATE_ID, data: jsonSnapshot(store) },
        update: { data: jsonSnapshot(store) }
      });
    }
  };
}
