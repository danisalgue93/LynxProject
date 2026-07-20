// Socket.IO authorization boundary — regression test for audit A-N2.
//
// Private, wallet-scoped events (ledger:deposit/withdrawal/approved, crypto:tx)
// must reach ONLY the sockets that authenticated as that wallet, never every
// connected client. Before the fix they went out via io.emit() (global), so any
// authenticated user could harvest everyone else's deposit/withdrawal amounts
// and tx signatures. This drives the real Socket.IO server end to end.

import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'net';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

// Same chain stub as api.test.ts: no live RPC, no background indexer sockets.
vi.mock('../src/chain.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/chain.js')>();
  return {
    ...actual,
    startChainIndexer: vi.fn(async () => undefined),
    getIndexerStatus: vi.fn(() => ({ running: false, lastSlot: 0, lastError: null })),
  };
});

import { app, httpServer, emitToWallet } from '../src/server.js';

let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function registerUser(label: string): Promise<{ token: string; wallet: string }> {
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@lynx.local`, password: 'password123', displayName: label })
    .expect(201);
  const wallet = res.body.user?.managedWalletAddress as string | undefined;
  if (!wallet) throw new Error(`registerUser(${label}): no managedWalletAddress — is NODE_ENV=test set?`);
  return { token: res.body.token as string, wallet };
}

function connect(token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 4000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

describe('Socket.IO authorization (audit A-N2)', () => {
  it('rejects a connection with no token', async () => {
    await expect(connect(undefined)).rejects.toThrow(/Authentication required/i);
  });

  it('rejects a connection with an invalid token', async () => {
    await expect(connect('not-a-real-jwt')).rejects.toThrow(/Invalid or expired token/i);
  });

  it('delivers a wallet-scoped event only to that wallet, not to other authenticated users', async () => {
    const alice = await registerUser('sock-alice');
    const bob = await registerUser('sock-bob');

    const socketA = await connect(alice.token);
    const socketB = await connect(bob.token);
    try {
      const received: Record<'A' | 'B', unknown[]> = { A: [], B: [] };
      socketA.on('ledger:deposit', (p) => received.A.push(p));
      socketB.on('ledger:deposit', (p) => received.B.push(p));

      // Give both clients a moment to finish joining their JWT-derived rooms.
      await new Promise((r) => setTimeout(r, 150));

      const payload = { wallet: alice.wallet, ledgerEntry: { id: 'x', type: 'DEPOSIT', amount: 1.23 } };
      emitToWallet(alice.wallet, 'ledger:deposit', payload);

      // Wait long enough that a mis-scoped (global) emit would have arrived at B.
      await new Promise((r) => setTimeout(r, 300));

      expect(received.A).toHaveLength(1);
      expect(received.A[0]).toMatchObject({ wallet: alice.wallet });
      expect(received.B, "Bob must NOT receive Alice's private ledger event").toHaveLength(0);
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });
});
