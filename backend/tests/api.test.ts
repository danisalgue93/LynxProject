import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/markets verifies on-chain that the market account exists, is owned
// by our program, and that `signature` is a confirmed transaction touching it
// (audit finding A3). That is correct in production, but it makes the suite
// depend on a live Solana RPC holding accounts that a unit test never creates —
// which is why every market-creating test 400'd with "No account found
// on-chain". Stub the chain seam here rather than adding a
// skip-verification flag to production code: a test-only escape hatch in the
// server is exactly the kind of backdoor this codebase already had too many of.
//
// Must be declared before importing server.js — vi.mock is hoisted, so the
// module graph sees the stub.
vi.mock('../src/chain.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/chain.js')>();
  return {
    ...actual,
    // No-op the background indexer: it opens sockets and polls an RPC forever.
    startChainIndexer: vi.fn(async () => undefined),
    getIndexerStatus: vi.fn(() => ({ running: false, lastSlot: 0, lastError: null })),
    verifyOnChainMarketCreation: vi.fn(async ({ expectedTitle }: { expectedTitle?: string }) => ({
      ok: true as const,
      onChainTitle: expectedTitle ?? 'Admin created binary market',
    })),
  };
});

import { app, store } from '../src/server.js';
import {
  getMintRatio,
  LYNX_PARTICIPANT_SHARE,
  LYNX_TREASURY_SHARE,
  LYNX_INITIAL_SALE_SHARE,
  roundAmount,
  TREASURY_WALLET
} from '../src/economy.js';

const sig = 'TEST_SIGNATURE_123';

// Admin identity comes from ADMIN_WALLETS (set in vitest.config.ts) — there are
// no hardcoded admin credentials. These seeds must stay in sync with the
// wallets listed there.
const ADMIN_SEEDS = { primary: 7, secondary: 9 } as const;

function adminKeypair(which: keyof typeof ADMIN_SEEDS = 'primary') {
  return nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(ADMIN_SEEDS[which]));
}

export function adminWallet(which: keyof typeof ADMIN_SEEDS = 'primary') {
  return bs58.encode(adminKeypair(which).publicKey);
}

/**
 * Authenticates an admin the way a real client does: sign the LYNX_LOGIN
 * challenge with the wallet's ed25519 key and exchange it for a JWT.
 *
 * The previous version of this helper pinged /api/health with the test-bypass
 * header and then returned the literal string 'test-admin-token'. That string
 * was sent as `Authorization: Bearer test-admin-token`, which is not a JWT, so
 * verifyToken() rejected it and every admin-guarded request 401'd — the whole
 * suite (30 tests) was red. Signing for real also means these tests now
 * actually exercise the wallet-login path, signature verification, and the
 * admin-role derivation from ADMIN_WALLETS, instead of bypassing all three.
 */
async function loginAdmin(which: keyof typeof ADMIN_SEEDS = 'primary') {
  const kp = adminKeypair(which);
  const wallet = bs58.encode(kp.publicKey);
  const signatureMessage = JSON.stringify({
    app: 'lynx',
    action: 'LYNX_LOGIN',
    wallet,
    issuedAt: new Date().toISOString(),
    // Ed25519 is deterministic, and the server consumes each signature exactly
    // once to block replay. Without a nonce, two logins issued within the same
    // millisecond would produce an identical signature and the second would be
    // rejected as a replay.
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  const signature = Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(signatureMessage), kp.secretKey)
  ).toString('base64');

  const response = await request(app)
    .post('/auth/wallet-login')
    .send({ wallet, signatureMessage, signature })
    .expect(200);
  return response.body.token as string;
}

export type Actor = { token: string; wallet: string };

/**
 * Registers a user and returns both their token and the wallet they actually own.
 *
 * Every route that touches money is guarded by requireAuthMatchesWallet: a user
 * may only act on their own walletAddress / managedWalletAddress (admins may act
 * on any). The suite used to pass invented identifiers like 'TRADE_USER' — a
 * wallet belonging to nobody — which the pre-audit API happily accepted. That is
 * the IDOR this codebase was fixed to reject, so those tests now 403 by design.
 *
 * In NODE_ENV=test, register issues a managed wallet immediately (email
 * verification is off) and auto-approves it, so `wallet` is ready to trade with.
 */
async function registerUser(label: string): Promise<Actor> {
  const response = await request(app)
    .post('/auth/register')
    .send({ email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@lynx.local`, password: 'password123', displayName: label })
    .expect(201);
  const wallet = response.body.user?.managedWalletAddress as string | undefined;
  if (!wallet) {
    throw new Error(`registerUser(${label}): no managedWalletAddress issued — is NODE_ENV=test set?`);
  }
  return { token: response.body.token as string, wallet };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function getSetCookieHeader(headers: Record<string, unknown>) {
  const values = headers['set-cookie'];
  if (Array.isArray(values)) return values;
  if (typeof values === 'string') return [values];
  return [];
}

async function createMarket(token: string, input: Partial<Record<string, any>> = {}) {
  const now = Date.now();
  const response = await request(app)
    .post('/api/markets')
    .set(auth(token))
    .send({
      id: input.id || `market-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: input.title || 'Admin created binary market',
      description: input.description || 'Test settlement rules',
      category: input.category || 'Test',
      currency: input.currency || 'SOL',
      isTernary: input.isTernary || false,
      oracleId: input.oracleId || 'manual:test',
      cutoffAt: input.cutoffAt || now + 60 * 60 * 1000,
      resolveAt: input.resolveAt || now + 2 * 60 * 60 * 1000,
      signature: input.signature || sig,
      // Must be a real base58 Solana pubkey: POST /api/markets validates this
      // ("onChainMarket is not a valid Solana public key"). The old placeholder
      // 'DevnetMarket111' predates that check and 400'd every market creation.
      onChainMarket: input.onChainMarket || 'FMUEmtxhU46GzhKF4FW9MLJdQWiLgjiXP9TYRWSrqTpV'
    })
    .expect(201);
  return response.body;
}

/**
 * Approves a managed wallet for trading.
 *
 * Deliberately sends no `externalWallet`: that field means "link this external
 * Solana wallet to my account", and linking now requires a real ed25519
 * signature proving control of that address. A managed `MAGIC:` wallet is not an
 * external wallet and holds no key it could sign with — passing it here (as this
 * helper used to, alongside a made-up signature string) asked the API to link a
 * wallet nobody can prove ownership of.
 */
async function approveWallet(token: string, wallet: string) {
  await request(app)
    .post('/api/ledger/approve')
    .set(auth(token))
    .send({ wallet, signature: `${sig}_${wallet}`, signatureMessage: `approve ${wallet}` })
    .expect(200);
}

/** Links a real external Solana wallet, signing the challenge the API expects. */
async function linkExternalWallet(token: string, managedWallet: string, kp: nacl.SignKeyPair) {
  const externalWallet = bs58.encode(kp.publicKey);
  const signatureMessage = JSON.stringify({
    app: 'LYNX',
    action: 'APPROVE_INTERNAL_LEDGER',
    wallet: externalWallet,
    payload: { wallet: managedWallet },
    issuedAt: new Date().toISOString(),
  });
  const signature = Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(signatureMessage), kp.secretKey)
  ).toString('base64');
  return request(app)
    .post('/api/ledger/approve')
    .set(auth(token))
    .send({ wallet: managedWallet, externalWallet, signature, signatureMessage });
}

/**
 * Credits a wallet through the dual-admin approval flow.
 *
 * This used to POST /api/ledger/deposit with provider:'INTERNAL', which now
 * answers 410 Gone: crediting arbitrary balance from a single admin session was
 * the shortest path to printing spendable money (audit finding A2) and was
 * deliberately removed. The supported replacement is propose -> approve ->
 * execute, and the program refuses to let one admin approve their own proposal —
 * hence two distinct admin wallets (see vitest.config.ts).
 *
 * Routing test funding through the real flow means the suite now exercises that
 * control on every single test that needs a funded wallet, instead of bypassing it.
 */
async function fundWallet(_token: string, wallet: string, currency: 'SOL' | 'LYNX', amount: number) {
  const proposer = await loginAdmin('primary');
  const approver = await loginAdmin('secondary');

  if (!store.isWalletApproved(wallet)) {
    await approveWallet(proposer, wallet);
  }

  const proposal = await request(app)
    .post('/api/admin/credits/propose')
    .set(auth(proposer))
    .send({ wallet, currency, amount, reason: `test funding ${currency}` })
    .expect(201);

  // Must be a DIFFERENT admin than the proposer, or the request stays unexecutable.
  await request(app)
    .post(`/api/admin/credits/${proposal.body.id}/approve`)
    .set(auth(approver))
    .expect(200);

  await request(app)
    .post(`/api/admin/credits/${proposal.body.id}/execute`)
    .set(auth(proposer))
    .expect(201);
}

/**
 * Resolves a market through the dual-admin flow.
 *
 * Resolution moves every participant's money, so — like manual credits — it
 * requires two distinct admins: propose -> approve (by someone else) -> execute
 * (audit finding C3). The suite predates that and used to resolve a market with
 * a single admin POST, which now only *proposes* and returns 201.
 */
async function resolveMarket(marketId: string, result: 'YES' | 'NO' | 'DRAW' | 'A' | 'B') {
  const proposer = await loginAdmin('primary');
  const approver = await loginAdmin('secondary');

  const proposed = await request(app)
    .post(`/api/admin/markets/${marketId}/resolve`)
    .set(auth(proposer))
    .send({ action: 'propose', result, source: 'manual', confirmation: `RESOLVE ${result}` })
    .expect(201);
  const requestId = proposed.body.request.id;

  await request(app)
    .post(`/api/admin/markets/${marketId}/resolve`)
    .set(auth(approver))
    .send({ action: 'approve', requestId })
    .expect(200);

  return request(app)
    .post(`/api/admin/markets/${marketId}/resolve`)
    .set(auth(proposer))
    .send({ action: 'execute', requestId })
    .expect(200);
}

async function approveAndFund(token: string, wallet: string, balances: Partial<Record<'SOL' | 'LYNX', number>>) {
  // Managed wallets are approved by /auth/register itself, so only approve when
  // it hasn't happened already (approving twice re-registers the signature and
  // is rejected as a replay).
  if (!store.isWalletApproved(wallet)) {
    await approveWallet(token, wallet);
  }
  if (balances.SOL) await fundWallet(token, wallet, 'SOL', balances.SOL);
  if (balances.LYNX) await fundWallet(token, wallet, 'LYNX', balances.LYNX);
}

describe('Lynx backend API', () => {
  beforeEach(() => {
    app.locals.testBypassAuth = true;
    app.locals.solWithdrawalSender = async () => ({
      ok: true,
      signature: `TEST_WITHDRAWAL_${Date.now()}_${Math.random().toString(36).slice(2)}`
    });
    store.seed();
  });

  // This used to log in as a seeded admin@lynx.local / admin123 account. Those
  // hardcoded credentials were deliberately deleted — admin identity now comes
  // only from ADMIN_WALLETS via signed wallet-login. Asserting the old account
  // is *gone* is worth more than asserting it works: it keeps the backdoor shut.
  it('grants admin role only through signed wallet-login, not a seeded password account', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: 'admin@lynx.local', password: 'admin123' })
      .expect(401);

    const token = await loginAdmin('primary');
    // /auth/me returns the public user object directly, not wrapped in { user }.
    const me = await request(app).get('/auth/me').set(auth(token)).expect(200);
    expect(me.body.role).toBe('admin');
    expect(me.body.walletAddress).toBe(adminWallet('primary'));
  });

  it('revokes the refresh token on logout so it cannot mint new sessions', async () => {
    const registration = await request(app)
      .post('/auth/register')
      .send({ email: `revoke-${Date.now()}@lynx.local`, password: 'password123', displayName: 'revoke' })
      .expect(201);
    const cookie = getSetCookieHeader(registration.headers as Record<string, unknown>);

    // Works before logout.
    await request(app).post('/auth/refresh').set('Cookie', cookie).expect(200);

    await request(app).post('/auth/logout').set('Cookie', cookie).expect(200);

    // A stolen refresh token must be dead the moment the user logs out. Without
    // revocation it would keep minting access tokens until it expired by itself,
    // which is the whole reason logout exists.
    await request(app).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('refreshes access tokens from the httpOnly refresh cookie', async () => {
    // Any real account works here; the point is the cookie mechanics, so use a
    // freshly registered user rather than the deleted seeded admin.
    const email = `refresh-${Date.now()}@lynx.local`;
    const registration = await request(app)
      .post('/auth/register')
      .send({ email, password: 'password123', displayName: 'refresh' })
      .expect(201);
    const cookie = getSetCookieHeader(registration.headers as Record<string, unknown>);
    expect(cookie.length).toBeGreaterThan(0);
    expect(cookie.join('; ')).toContain('HttpOnly');
    expect(cookie.join('; ')).toContain('SameSite=Strict');

    const refreshed = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);

    expect(refreshed.body.token).toBeTypeOf('string');
    // The refresh token must never be echoed in the body — it lives in the
    // httpOnly cookie precisely so JavaScript cannot read it.
    expect(refreshed.body.refreshToken).toBeUndefined();
    expect(refreshed.body.user.email).toBe(email);
  });

  // GET /api/markets and /api/duels are paginated: they answer
  // { data, total, limit, offset }, not a bare array. Unbounded list responses
  // are a DoS vector, so the envelope is deliberate and these assertions follow
  // the code rather than the other way round.
  it('starts without demo markets by default', async () => {
    const response = await request(app).get('/api/markets').expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it('allows only admins to create signed markets', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('not-admin');

    await request(app)
      .post('/api/markets')
      .set(auth(user.token))
      .send({ title: 'User market', signature: sig })
      .expect(403);

    const market = await createMarket(adminToken, { id: 'market-admin-created' });
    expect(market.id).toBe('market-admin-created');
    expect(market.onChainSignature).toBe(sig);
  });

  it('rejects unsigned admin market creation', async () => {
    const adminToken = await loginAdmin();
    await request(app)
      .post('/api/markets')
      .set(auth(adminToken))
      .send({ title: 'Unsigned market' })
      .expect(400);
  });

  it('requires funded internal balance before trading', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('trade-user');
    const market = await createMarket(adminToken, { id: 'market-trade' });

    // Registration already approves the managed wallet, so the remaining gate
    // is balance: trading with an empty wallet must be rejected.
    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(user.token))
      .send({ wallet: user.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(400);

    await approveAndFund(user.token, user.wallet, { SOL: 2 });
    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(user.token))
      .send({ wallet: user.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(200);

    // Reading a portfolio requires proving you own the wallet: the suite used to
    // fetch this unauthenticated, which is exactly the IDOR that was closed.
    const portfolio = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
      .set(auth(user.token))
      .expect(200);
    expect(portfolio.body.solBalance).toBe(1);
    expect(portfolio.body.holdings).toHaveLength(1);
  });

  it('burns 15 percent of LYNX special-market stake', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('lynx-burn');
    const market = await createMarket(adminToken, { id: 'market-lynx-special', currency: 'LYNX' });
    await approveAndFund(user.token, user.wallet, { LYNX: 200 });

    const response = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(user.token))
      .send({ wallet: user.wallet, amount: 100, position: 'NO', tradeType: 'swap' })
      .expect(200);

    expect(response.body.market.burnedAmount).toBe(15);
    expect(response.body.market.poolAmount).toBe(85);
    expect(response.body.position.amount).toBe(85);
  });

  it('uses the 30/60/10 LYNX emission split after SOL event resolution', async () => {
    const adminToken = await loginAdmin();
    const emitterA = await registerUser('emitter-a');
    const emitterB = await registerUser('emitter-b');
    const market = await createMarket(adminToken, { id: 'market-emission' });
    await approveAndFund(emitterA.token, emitterA.wallet, { SOL: 6 });
    await approveAndFund(emitterB.token, emitterB.wallet, { SOL: 4 });

    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(emitterA.token))
      .send({ wallet: emitterA.wallet, amount: 6, position: 'YES', tradeType: 'swap' })
      .expect(200);
    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(emitterB.token))
      .send({ wallet: emitterB.wallet, amount: 4, position: 'NO', tradeType: 'swap' })
      .expect(200);

    await resolveMarket(market.id, 'YES');

    const a = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(emitterA.wallet)}`)
      .set(auth(emitterA.token))
      .expect(200);
    const b = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(emitterB.wallet)}`)
      .set(auth(emitterB.token))
      .expect(200);
    // Fresh seed() means circulating supply is 0 -> tier-1 mint ratio (1.00),
    // and the SOL pool is 6 + 4 = 10, so totalEmission = 10.
    // Whitepaper PASO 4 split: 30% users / 60% order book / 10% treasury.
    // A staked 6 of the 10 SOL pool -> 6 LYNX emitted for A, 30% = 1.8 to A.
    expect(a.body.lynxBalance).toBe(1.8);
    // B staked 4 -> 4 LYNX emitted for B, 30% = 1.2 to B.
    expect(b.body.lynxBalance).toBe(1.2);
    // 10% of the whole 10 LYNX emission is the protocol LYNX inventory.
    expect(store.treasury.lynx).toBe(1);
    // 60% goes to the order book.
    expect(store.treasury.lynxForInitialSale).toBe(6);
  });

  it('splits 100% of the calculated LYNX emission across participant/treasury/initial-sale shares, with none lost', async () => {
    const adminToken = await loginAdmin();
    const emitterA = await registerUser('emitter-a-full');
    const emitterB = await registerUser('emitter-b-full');
    const market = await createMarket(adminToken, { id: 'market-emission-full' });
    await approveAndFund(emitterA.token, emitterA.wallet, { SOL: 6 });
    await approveAndFund(emitterB.token, emitterB.wallet, { SOL: 4 });

    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(emitterA.token))
      .send({ wallet: emitterA.wallet, amount: 6, position: 'YES', tradeType: 'swap' })
      .expect(200);
    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(emitterB.token))
      .send({ wallet: emitterB.wallet, amount: 4, position: 'NO', tradeType: 'swap' })
      .expect(200);

    const treasuryLynxBefore = store.treasury.lynx;
    const treasuryInitialSaleBefore = store.treasury.lynxForInitialSale;

    await resolveMarket(market.id, 'YES');

    const a = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(emitterA.wallet)}`)
      .set(auth(emitterA.token))
      .expect(200);
    const b = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(emitterB.wallet)}`)
      .set(auth(emitterB.token))
      .expect(200);

    // The three shares must always add up to exactly 100% of the ratio-adjusted
    // total emission — no LYNX should be lost or invented across the split.
    expect(LYNX_PARTICIPANT_SHARE + LYNX_TREASURY_SHARE + LYNX_INITIAL_SALE_SHARE).toBe(1);

    const poolAmount = 10; // 6 + 4 SOL, no burn applies to SOL markets
    const totalEmission = roundAmount(poolAmount * getMintRatio(0));
    const participantMinted = roundAmount(a.body.lynxBalance + b.body.lynxBalance);
    const treasuryMinted = roundAmount(store.treasury.lynx - treasuryLynxBefore);
    const initialSaleMinted = roundAmount(store.treasury.lynxForInitialSale - treasuryInitialSaleBefore);

    expect(roundAmount(participantMinted + treasuryMinted + initialSaleMinted)).toBe(totalEmission);
  });

  it('supports 1v1 LYNX duels from active LYNX markets and burns both sides', async () => {
    const adminToken = await loginAdmin();
    const creator = await registerUser('lynx-duel-creator');
    const rival = await registerUser('lynx-duel-rival');
    const market = await createMarket(adminToken, { id: 'market-lynx-duel', currency: 'LYNX' });
    await approveAndFund(creator.token, creator.wallet, { LYNX: 100 });
    await approveAndFund(rival.token, rival.wallet, { LYNX: 100 });

    const created = await request(app)
      .post('/api/duels')
      .set(auth(creator.token))
      .send({ wallet: creator.wallet, marketId: market.id, side: 'YES', amount: 100, type: '1v1' })
      .expect(201);

    expect(created.body.currency).toBe('LYNX');
    expect(created.body.amount).toBe(85);
    expect(created.body.burnedAmount).toBe(15);

    const accepted = await request(app)
      .post(`/api/duels/${created.body.id}/accept`)
      .set(auth(rival.token))
      .send({ wallet: rival.wallet, side: 'NO' })
      .expect(200);

    expect(accepted.body.burnedAmount).toBe(30);
  });

  it('tracks approve, deposit and withdrawal in the internal ledger', async () => {
    const user = await registerUser('ledger-user');
    await fundWallet(user.token, user.wallet, 'SOL', 2);
    await request(app)
      .post('/api/ledger/withdraw')
      .set(auth(user.token))
      .send({ wallet: user.wallet, currency: 'SOL', amount: 1 })
      .expect(200);

    const ledger = await request(app)
      .get(`/api/ledger?wallet=${encodeURIComponent(user.wallet)}`)
      .set(auth(user.token))
      .expect(200);
    expect(ledger.body.map((entry: any) => entry.type)).toEqual(['WITHDRAWAL', 'DEPOSIT', 'APPROVE']);
    const portfolio = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
      .set(auth(user.token))
      .expect(200);
    expect(portfolio.body.approvedAt).toBeTypeOf('number');
    expect(portfolio.body.solBalance).toBe(1);
  });

  it('refuses to credit a deposit outside test mode without on-chain proof (no infinite money)', async () => {
    const registerResponse = await request(app)
      .post('/auth/register')
      .send({ email: `exploit-user-${Date.now()}@lynx.local`, password: 'password123', displayName: 'exploit-user' })
      .expect(201);
    const userToken = registerResponse.body.token as string;
    const wallet = registerResponse.body.user.managedWalletAddress as string;
    expect(wallet).toBeTruthy();
    await approveWallet(userToken, wallet);

    app.locals.testBypassAuth = false;
    try {
      // EXTERNAL_WALLET claims a real deposit but supplies no transaction signature.
      await request(app)
        .post('/api/ledger/deposit')
        .set(auth(userToken))
        .send({ wallet, currency: 'SOL', amount: 999999, provider: 'EXTERNAL_WALLET' })
        .expect(400);

      // INTERNAL provider has no on-chain proof at all. This used to assert 403
      // ("admin-only"), but the endpoint no longer accepts that path from anyone:
      // crediting balance with no proof was the shortest route to printing money
      // (audit finding A2), so it answers 410 Gone and manual credits must go
      // through the dual-admin propose/approve/execute flow. 410 is strictly
      // stronger than the 403 this test originally demanded — the "no infinite
      // money" intent holds, and now not even a single admin can bypass it.
      await request(app)
        .post('/api/ledger/deposit')
        .set(auth(userToken))
        .send({ wallet, currency: 'SOL', amount: 999999, provider: 'INTERNAL' })
        .expect(410);

      const portfolio = await request(app).get(`/api/portfolio?wallet=${wallet}`).set(auth(userToken)).expect(200);
      expect(portfolio.body.solBalance).not.toBe(999999);
    } finally {
      app.locals.testBypassAuth = true;
    }
  });

  it('locks and refunds prediction limit orders without minting balance', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('limit-user');
    const market = await createMarket(adminToken, { id: 'market-limit' });
    await approveAndFund(user.token, user.wallet, { SOL: 1 });
    const portfolioOf = () =>
      request(app)
        .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);

    const created = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(user.token))
      .send({ wallet: user.wallet, amount: 1, position: 'YES', tradeType: 'limit', limitPrice: 0.5 })
      .expect(200);

    let portfolio = await portfolioOf();
    expect(portfolio.body.solBalance).toBe(0);

    await request(app)
      .delete(`/api/orders/${created.body.order.id}`)
      .set(auth(user.token))
      .send({ wallet: user.wallet })
      .expect(200);

    portfolio = await portfolioOf();
    expect(portfolio.body.solBalance).toBe(1);
  });

  it('cuts off markets through the admin endpoint and blocks new duels', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('cutoff-user');
    const market = await createMarket(adminToken, { id: 'market-cutoff' });
    await approveAndFund(user.token, user.wallet, { SOL: 1 });

    await request(app)
      .post(`/api/admin/markets/${market.id}/cutoff`)
      .set(auth(adminToken))
      .send({ force: true, signature: sig })
      .expect(200);

    await request(app)
      .post('/api/duels')
      .set(auth(user.token))
      .send({ wallet: user.wallet, marketId: market.id, side: 'YES', amount: 1 })
      .expect(400);
  });

  it('keeps a market in the default listing after cutoff, only dropping it once it is actually RESOLVED', async () => {
    const adminToken = await loginAdmin();
    const market = await createMarket(adminToken, { id: 'market-listing-cutoff' });

    await request(app)
      .post(`/api/admin/markets/${market.id}/cutoff`)
      .set(auth(adminToken))
      .send({ force: true, signature: sig })
      .expect(200);

    // New entries are correctly blocked past cutoff (covered by the test
    // above), but the market itself — now awaiting resolution — must still
    // be visible in the default (non-includeFinished) listing.
    const afterCutoff = await request(app).get('/api/markets').expect(200);
    const found = afterCutoff.body.data.find((m: any) => m.id === market.id);
    expect(found).toBeDefined();
    expect(found.status).toBe('CUT_OFF');

    await resolveMarket(market.id, 'YES');

    // Only once the admin actually finalizes the market does it drop out.
    const afterResolve = await request(app).get('/api/markets').expect(200);
    expect(afterResolve.body.data.some((m: any) => m.id === market.id)).toBe(false);

    // It's still reachable directly and via includeFinished=true.
    const direct = await request(app).get(`/api/markets/${market.id}`).expect(200);
    expect(direct.body.status).toBe('RESOLVED');
    const withFinished = await request(app).get('/api/markets?includeFinished=true').expect(200);
    expect(withFinished.body.data.some((m: any) => m.id === market.id)).toBe(true);
  });

  it('keeps a market listed past its cutoffAt timestamp even without a manual admin cutoff call', async () => {
    const adminToken = await loginAdmin();
    const now = Date.now();
    const market = await createMarket(adminToken, {
      id: 'market-listing-elapsed',
      cutoffAt: now + 50,
      resolveAt: now + 1000 * 60 * 60
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const listed = await request(app).get('/api/markets').expect(200);
    const found = listed.body.data.find((m: any) => m.id === market.id);
    expect(found).toBeDefined();
    // Reading the list also reconciles the stale status on the fly — no
    // server restart or background job required for the badge to be right.
    expect(found.status).toBe('CUT_OFF');

    const direct = await request(app).get(`/api/markets/${market.id}`).expect(200);
    expect(direct.body.status).toBe('CUT_OFF');
  });

  it('keeps OPEN and ACTIVE duels in the default listing after their market is cut off, until it actually resolves', async () => {
    const adminToken = await loginAdmin();
    const creator = await registerUser('duel-listing-creator');
    const rival = await registerUser('duel-listing-rival');
    const openCreator = await registerUser('duel-listing-open-creator');
    const market = await createMarket(adminToken, { id: 'market-duel-listing' });
    await approveAndFund(creator.token, creator.wallet, { SOL: 1 });
    await approveAndFund(rival.token, rival.wallet, { SOL: 1 });
    await approveAndFund(openCreator.token, openCreator.wallet, { SOL: 1 });

    const created = await request(app)
      .post('/api/duels')
      .set(auth(creator.token))
      .send({ wallet: creator.wallet, marketId: market.id, side: 'YES', amount: 1 })
      .expect(201);

    const stillOpen = await request(app)
      .post('/api/duels')
      .set(auth(openCreator.token))
      .send({ wallet: openCreator.wallet, marketId: market.id, side: 'NO', amount: 1 })
      .expect(201);

    const accepted = await request(app)
      .post(`/api/duels/${created.body.id}/accept`)
      .set(auth(rival.token))
      .send({ wallet: rival.wallet })
      .expect(200);
    expect(accepted.body.status).toBe('ACTIVE');

    // Force the parent market past cutoff, same as the cron/admin job would do.
    await request(app)
      .post(`/api/admin/markets/${market.id}/cutoff`)
      .set(auth(adminToken))
      .send({ force: true, signature: sig })
      .expect(200);

    // The ACTIVE duel has two users' funds locked and is waiting on
    // resolveMarket() — it must still show up in the default
    // (non-includeFinished) listing. The OPEN duel can still legitimately be
    // accepted past cutoff (per acceptDuel()), so it must stay listed too.
    const listed = await request(app).get('/api/duels').expect(200);
    const listedIds = listed.body.data.map((d: any) => d.id);
    expect(listedIds).toContain(created.body.id);
    expect(listedIds).toContain(stillOpen.body.id);

    const filteredByMarket = await request(app).get(`/api/duels?marketId=${market.id}`).expect(200);
    expect(filteredByMarket.body.data.map((d: any) => d.id)).toContain(created.body.id);

    // Once the market actually resolves, resolveDuelsForMarket() settles the
    // ACTIVE duel and it drops out of the default listing.
    await resolveMarket(market.id, 'YES');

    const afterResolve = await request(app).get('/api/duels').expect(200);
    expect(afterResolve.body.data.some((d: any) => d.id === created.body.id)).toBe(false);
  });

  it('does not lock protocol SOL stake when creating a 1v1vP duel', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('protocol-duel');
    const market = await createMarket(adminToken, { id: 'market-1v1vp', isTernary: true });
    await approveAndFund(user.token, user.wallet, { SOL: 1 });
    await fundWallet(user.token, TREASURY_WALLET, 'SOL', 1);

    await request(app)
      .post('/api/duels')
      .set(auth(user.token))
      .send({ wallet: user.wallet, marketId: market.id, side: 'YES', amount: 0.1, type: '1v1vP' })
      .expect(201);

    // The protocol never co-stakes SOL for 1v1vP duels: it only collects the
    // creator's stake if it wins and mints LYNX if it loses, per
    // resolve_protocol_duel on-chain. Its SOL balance must stay untouched.
    // Read as an admin — the treasury is nobody's personal wallet.
    const protocolPortfolio = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(TREASURY_WALLET)}`)
      .set(auth(adminToken))
      .expect(200);
    expect(protocolPortfolio.body.solBalance).toBe(1);
  });

  it('creates a 1v1vP duel even if the protocol treasury holds no SOL', async () => {
    const adminToken = await loginAdmin();
    const user = await registerUser('protocol-unfunded');
    const market = await createMarket(adminToken, { id: 'market-1v1vp-unfunded', isTernary: true });
    await approveAndFund(user.token, user.wallet, { SOL: 101 });
    // The treasury is intentionally left unfunded (starts at 0 SOL) to prove the
    // protocol no longer needs a matching SOL balance to accept a 1v1vP duel.

    const created = await request(app)
      .post('/api/duels')
      .set(auth(user.token))
      .send({ wallet: user.wallet, marketId: market.id, side: 'YES', amount: 101, type: '1v1vP' })
      .expect(201);

    expect(created.body.amount).toBe(101);

    const creatorPortfolio = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
      .set(auth(user.token))
      .expect(200);
    expect(creatorPortfolio.body.solBalance).toBe(0);
  });

  it('clears indexed transactions on development reset', async () => {
    const user = await registerUser('tx-reset-user');
    const adminToken = await loginAdmin();

    await request(app)
      .post('/api/transactions')
      // A base58, signature-shaped value: the route now validates the format
      // (part of the H-1 hardening), so the old 'TEST_SIGNATURE' placeholder is
      // correctly rejected.
      .send({ signature: 'TxSignature' + 'a'.repeat(60), wallet: user.wallet })
      .set(auth(user.token))
      .expect(200);

    await request(app).post('/api/dev/reset').set(auth(adminToken)).expect(200);

    const response = await request(app)
      .get(`/api/transactions?wallet=${encodeURIComponent(user.wallet)}`)
      .set(auth(user.token))
      .expect(200);
    expect(response.body).toHaveLength(0);
  });

  // Regression for audit H-1: POST /api/transactions must not let a user register
  // a transaction under someone else's wallet (which previously allowed poisoning
  // another user's history and spoofing a crypto:tx socket event to their room).
  it('rejects registering a transaction under a wallet the caller does not own', async () => {
    const attacker = await registerUser('tx-attacker');
    const victim = await registerUser('tx-victim');

    await request(app)
      .post('/api/transactions')
      .send({ signature: 'VictimSig' + 'b'.repeat(60), wallet: victim.wallet })
      .set(auth(attacker.token))
      .expect(403);

    // The victim's transaction history stays empty — nothing was written for them.
    const victimTxs = await request(app)
      .get(`/api/transactions?wallet=${encodeURIComponent(victim.wallet)}`)
      .set(auth(victim.token))
      .expect(200);
    expect(victimTxs.body).toHaveLength(0);
  });

  it('rejects repeated DAO votes from the same approved wallet', async () => {
    const adminToken = await loginAdmin();
    const voter = await registerUser('dao-voter');
    await approveAndFund(voter.token, voter.wallet, { LYNX: 50 });
    await request(app)
      .post('/api/staking/stake')
      .set(auth(voter.token))
      .send({ wallet: voter.wallet, amount: 50 })
      .expect(200);
    const proposal = await request(app)
      .post('/api/proposals')
      .set(auth(adminToken))
      .send({ title: 'DAO vote test', description: 'Test proposal', category: 'protocol' })
      .expect(201);

    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(voter.token))
      .send({ wallet: voter.wallet, voteType: 'yes' })
      .expect(200);

    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(voter.token))
      .send({ wallet: voter.wallet, voteType: 'no' })
      .expect(400);
  });

  it('refuses to let a user vote using a wallet they do not own', async () => {
    const victim = await registerUser('dao-victim');
    await approveAndFund(victim.token, victim.wallet, { LYNX: 50 });
    await request(app)
      .post('/api/staking/stake')
      .set(auth(victim.token))
      .send({ wallet: victim.wallet, amount: 50 })
      .expect(200);

    const attacker = await registerUser('dao-attacker');

    const adminToken = await loginAdmin();
    const proposal = await request(app)
      .post('/api/proposals')
      .set(auth(adminToken))
      .send({ title: 'Hijack test', description: 'Test proposal', category: 'protocol' })
      .expect(201);

    // The attacker is authenticated as themselves but tries to cast a vote
    // using the victim's wallet address — this must be rejected.
    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(attacker.token))
      .send({ wallet: victim.wallet, voteType: 'yes' })
      .expect(403);

    // The victim must still be free to cast their own vote afterwards.
    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(victim.token))
      .send({ wallet: victim.wallet, voteType: 'no' })
      .expect(200);
  });

  it('refuses to let a user claim a winning position from a wallet they do not own', async () => {
    const adminToken = await loginAdmin();
    const victim = await registerUser('claim-victim');
    const market = await createMarket(adminToken, { id: 'market-claim-hijack' });
    await approveAndFund(victim.token, victim.wallet, { SOL: 1 });

    const trade = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(victim.token))
      .send({ wallet: victim.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(200);

    await resolveMarket(market.id, 'YES');

    const attacker = await registerUser('claim-attacker');

    // The attacker is authenticated as themselves but tries to trigger the
    // claim using the victim's wallet address — this must be rejected.
    await request(app)
      .post(`/api/positions/${trade.body.position.id}/claim`)
      .set(auth(attacker.token))
      .send({ wallet: victim.wallet })
      .expect(403);

    // The victim must still be free to claim their own payout afterwards.
    await request(app)
      .post(`/api/positions/${trade.body.position.id}/claim`)
      .set(auth(victim.token))
      .send({ wallet: victim.wallet })
      .expect(200);
  });

  it('only takes the documented 10% staker+treasury fee on SOL market resolution (no extra protocol fee)', async () => {
    const adminToken = await loginAdmin();
    const winner = await registerUser('fee-winner');
    const market = await createMarket(adminToken, { id: 'market-fee-check' });
    await approveAndFund(winner.token, winner.wallet, { SOL: 10 });

    const treasurySolBefore = store.treasury.sol;

    const trade = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(winner.token))
      .send({ wallet: winner.wallet, amount: 10, position: 'YES', tradeType: 'swap' })
      .expect(200);

    await resolveMarket(market.id, 'YES');

    // With no active stakers, both the 5% treasury fee and the 5% staker
    // fee (which has nowhere else to go) land in the treasury — 10% total,
    // never more.
    expect(store.treasury.sol - treasurySolBefore).toBe(1);

    const claim = await request(app)
      .post(`/api/positions/${trade.body.position.id}/claim`)
      .set(auth(winner.token))
      .send({ wallet: winner.wallet })
      .expect(200);

    // Sole winner claims the full pool minus the 10% staker+treasury fee —
    // never minus an extra, separately-applied EVENT_PROTOCOL_FEE.
    expect(claim.body.payout).toBe(9);

    const portfolio = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(winner.wallet)}`)
      .set(auth(winner.token))
      .expect(200);
    expect(portfolio.body.solBalance).toBe(9);
  });

  it('credits the staker+treasury fee in LYNX (not SOL) on LYNX market resolution, instead of discarding it', async () => {
    const adminToken = await loginAdmin();
    const winner = await registerUser('lynx-fee-winner');
    const market = await createMarket(adminToken, { id: 'market-lynx-fee-check', currency: 'LYNX' });
    await approveAndFund(winner.token, winner.wallet, { LYNX: 100 });

    const treasuryLynxBefore = store.treasury.lynx;
    const treasurySolBefore = store.treasury.sol;

    const trade = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(winner.token))
      .send({ wallet: winner.wallet, amount: 100, position: 'YES', tradeType: 'swap' })
      .expect(200);

    // 15% entry burn leaves an 85 LYNX pool (separate mechanism, unaffected by this fix).
    expect(trade.body.market.poolAmount).toBe(85);

    await resolveMarket(market.id, 'YES');

    // With no active stakers, the 10% staker+treasury fee (5% + 5% of the
    // 85 LYNX pool = 8.5 LYNX) must land in treasury.lynx — not vanish, and
    // not be misrouted into treasury.sol.
    expect(store.treasury.lynx - treasuryLynxBefore).toBe(8.5);
    expect(store.treasury.sol).toBe(treasurySolBefore);

    const claim = await request(app)
      .post(`/api/positions/${trade.body.position.id}/claim`)
      .set(auth(winner.token))
      .send({ wallet: winner.wallet })
      .expect(200);

    // Sole winner claims the 85 LYNX pool minus the 10% fee that was just
    // credited to treasury above — the same 10% claimPosition() always
    // deducted, now actually accounted for instead of disappearing.
    expect(claim.body.payout).toBe(76.5);
    expect(claim.body.currency).toBe('LYNX');
  });

  it('pays LYNX staking rewards (not SOL) to stakers when a LYNX market resolves, claimable via /api/staking/claim', async () => {
    const adminToken = await loginAdmin();
    const staker = await registerUser('lynx-fee-staker');
    const trader = await registerUser('lynx-fee-trader');
    const market = await createMarket(adminToken, { id: 'market-lynx-staker-fee', currency: 'LYNX' });
    await approveAndFund(staker.token, staker.wallet, { LYNX: 50 });
    await approveAndFund(trader.token, trader.wallet, { LYNX: 100 });

    await request(app)
      .post('/api/staking/stake')
      .set(auth(staker.token))
      .send({ wallet: staker.wallet, amount: 50 })
      .expect(200);

    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(trader.token))
      .send({ wallet: trader.wallet, amount: 100, position: 'YES', tradeType: 'swap' })
      .expect(200);

    await resolveMarket(market.id, 'YES');

    // 5% staker fee on the 85 LYNX pool = 4.25 LYNX, sole staker takes it all.
    const claim = await request(app)
      .post('/api/staking/claim')
      .set(auth(staker.token))
      .send({ wallet: staker.wallet })
      .expect(200);

    expect(claim.body.claimedLynx).toBe(4.25);
    expect(claim.body.claimedSol).toBe(0);

    const portfolio = await request(app)
      .get(`/api/portfolio?wallet=${encodeURIComponent(staker.wallet)}`)
      .set(auth(staker.token))
      .expect(200);
    // Staked balance (50) was debited from lynxBalance on stake, then the
    // 4.25 LYNX reward is credited back on claim.
    expect(portfolio.body.lynxBalance).toBe(4.25);
  });

  describe('boosting a SOL-market position by burning LYNX', () => {
    /**
     * Generates real LYNX/SOL trading history at `price`.
     *
     * The burn boost no longer values LYNX at the best resting bid — it uses
     * getLynxTwapPrice(), a volume-weighted average of *executed* trades over
     * the last 30 minutes, requiring at least LYNX_BURN_TWAP_MIN_TRADES (10)
     * fills and LYNX_BURN_TWAP_MIN_VOLUME (500) of volume. That hardening
     * matters: with a best-bid oracle, an attacker could post one absurd bid and
     * boost their position against a price nobody ever traded at.
     *
     * So the old helper — a single resting BUY — cannot produce a price at all.
     * Cross real buy/sell orders instead.
     */
    async function seedLynxSolTwap(price: number, tradeCount = 12, sizePerTrade = 60) {
      const buyer = await registerUser('lynx-sol-buyer');
      const seller = await registerUser('lynx-sol-seller');
      const solNeeded = price * sizePerTrade * tradeCount + 10;
      const lynxNeeded = sizePerTrade * tradeCount + 10;
      await approveAndFund(buyer.token, buyer.wallet, { SOL: solNeeded });
      await approveAndFund(seller.token, seller.wallet, { LYNX: lynxNeeded });

      for (let i = 0; i < tradeCount; i++) {
        await request(app)
          .post('/api/orders')
          .set(auth(seller.token))
          .send({ wallet: seller.wallet, pair: 'LYNX/SOL', side: 'SELL', amount: sizePerTrade, price, currency: 'LYNX', tradeType: 'limit' })
          .expect(201);
        await request(app)
          .post('/api/orders')
          .set(auth(buyer.token))
          .send({ wallet: buyer.wallet, pair: 'LYNX/SOL', side: 'BUY', amount: sizePerTrade, price, currency: 'LYNX', tradeType: 'limit' })
          .expect(201);
      }

      const twap = store.getLynxTwapPrice('LYNX/SOL');
      expect(twap, 'seeded trades must produce a usable TWAP').toBeCloseTo(price, 6);
    }

    it('lets a user burn LYNX to add weight to their own open SOL position, valued at the LYNX/SOL TWAP', async () => {
      const adminToken = await loginAdmin();
      const market = await createMarket(adminToken, { id: 'market-lynx-boost-basic' });
      await seedLynxSolTwap(0.5);

      const user = await registerUser('boost-user');
      await approveAndFund(user.token, user.wallet, { SOL: 1, LYNX: 10 });

      const trade = await request(app)
        .post(`/api/markets/${market.id}/trades`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
        .expect(200);

      const positionId = trade.body.position.id;
      expect(trade.body.position.solPrincipal).toBe(1);

      const treasuryBurnedBefore = store.treasury.lynxBurned;
      const marketBefore = await request(app).get(`/api/markets/${market.id}`).expect(200);
      expect(marketBefore.body.poolAmount).toBe(1);
      expect(marketBefore.body.yesAmount).toBe(1);

      // Burning 2 LYNX at a 0.5 SOL best bid = 1 SOL of equivalent weight,
      // exactly matching the 1 SOL principal cap.
      const boost = await request(app)
        .post(`/api/positions/${positionId}/boost-with-lynx`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, lynxAmount: 2 })
        .expect(200);

      expect(boost.body.solEquivalent).toBe(1);
      expect(boost.body.position.amount).toBe(2);
      expect(boost.body.position.lynxBoostSolEquivalent).toBe(1);
      expect(boost.body.market.yesAmount).toBe(2);

      // The pool must NOT grow: burning LYNX buys a bigger share of the existing
      // SOL, it does not add SOL. This assertion previously demanded
      // poolAmount === 2 — i.e. it pinned the accounting hole in place as if it
      // were the feature. claimPosition pays `netPool * share` in real SOL, so a
      // pool inflated by burns paid out money that was never deposited: 2 SOL in,
      // 3 SOL out. See tests/solvency.test.ts, which measures it end to end.
      expect(boost.body.market.poolAmount).toBe(1);

      // LYNX was burned, not transferred: it left the user's balance and was
      // recorded against the protocol's burned counter, not credited to the
      // treasury or the pool as LYNX.
      expect(store.treasury.lynxBurned - treasuryBurnedBefore).toBe(2);

      const portfolio = await request(app)
        .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);
      expect(portfolio.body.lynxBalance).toBe(8);
    });

    it('rejects a burn that would push the SOL-equivalent weight past the original SOL principal', async () => {
      const adminToken = await loginAdmin();
      const market = await createMarket(adminToken, { id: 'market-lynx-boost-cap' });
      await seedLynxSolTwap(0.5);

      const user = await registerUser('boost-cap-user');
      await approveAndFund(user.token, user.wallet, { SOL: 1, LYNX: 10 });

      const trade = await request(app)
        .post(`/api/markets/${market.id}/trades`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
        .expect(200);

      // 3 LYNX at 0.5 SOL = 1.5 SOL equivalent, which is over the 1 SOL cap.
      const rejected = await request(app)
        .post(`/api/positions/${trade.body.position.id}/boost-with-lynx`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, lynxAmount: 3 })
        .expect(400);
      expect(rejected.body.error).toMatch(/boost cap/i);

      // A first, in-range burn should succeed and count toward the cap...
      await request(app)
        .post(`/api/positions/${trade.body.position.id}/boost-with-lynx`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, lynxAmount: 1 })
        .expect(200);

      // ...so a second burn that would only tip the *cumulative* total over
      // the cap must also be rejected, even though it alone would fit.
      const secondRejected = await request(app)
        .post(`/api/positions/${trade.body.position.id}/boost-with-lynx`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, lynxAmount: 2 })
        .expect(400);
      expect(secondRejected.body.error).toMatch(/boost cap/i);
    });

    it('refuses to let a user boost a position from a wallet they do not own', async () => {
      const adminToken = await loginAdmin();
      const market = await createMarket(adminToken, { id: 'market-lynx-boost-hijack' });
      await seedLynxSolTwap(0.5);

      const victim = await registerUser('boost-victim');
      await approveAndFund(victim.token, victim.wallet, { SOL: 1 });
      const trade = await request(app)
        .post(`/api/markets/${market.id}/trades`)
        .set(auth(victim.token))
        .send({ wallet: victim.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
        .expect(200);

      const attacker = await registerUser('boost-attacker');
      await approveAndFund(attacker.token, attacker.wallet, { LYNX: 10 });

      await request(app)
        .post(`/api/positions/${trade.body.position.id}/boost-with-lynx`)
        .set(auth(attacker.token))
        .send({ wallet: victim.wallet, lynxAmount: 1 })
        .expect(403);
    });

    it('refuses to boost a position in a LYNX-currency market', async () => {
      const adminToken = await loginAdmin();
      const market = await createMarket(adminToken, { id: 'market-lynx-boost-wrong-currency', currency: 'LYNX' });
      await seedLynxSolTwap(0.5);

      const user = await registerUser('boost-wrong-currency-user');
      await approveAndFund(user.token, user.wallet, { LYNX: 10 });
      const trade = await request(app)
        .post(`/api/markets/${market.id}/trades`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 5, position: 'YES', tradeType: 'swap' })
        .expect(200);

      const rejected = await request(app)
        .post(`/api/positions/${trade.body.position.id}/boost-with-lynx`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, lynxAmount: 1 })
        .expect(400);
      expect(rejected.body.error).toMatch(/SOL/i);
    });
  });

  // These were `it.skip` stubs with empty bodies (BE-L-08) — coverage that was
  // declared but never existed. Several were excused as "requires a real Solana
  // wallet"; the suite now derives deterministic ed25519 keypairs and signs for
  // real, so that is no longer a blocker.
  describe('wallet-login endpoint', () => {
    /** Signs the LYNX_LOGIN challenge with an arbitrary keypair. */
    function signLogin(kp: nacl.SignKeyPair, overrides: Record<string, unknown> = {}) {
      const wallet = bs58.encode(kp.publicKey);
      const signatureMessage = JSON.stringify({
        app: 'lynx',
        action: 'LYNX_LOGIN',
        wallet,
        issuedAt: new Date().toISOString(),
        nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...overrides,
      });
      const signature = Buffer.from(
        nacl.sign.detached(new TextEncoder().encode(signatureMessage), kp.secretKey)
      ).toString('base64');
      return { wallet, signatureMessage, signature };
    }

    it('authenticates a valid wallet signature and returns a JWT', async () => {
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(31));
      const response = await request(app).post('/auth/wallet-login').send(signLogin(kp)).expect(200);

      expect(response.body.token).toBeTypeOf('string');
      expect(response.body.user.walletAddress).toBe(bs58.encode(kp.publicKey));
      // A non-ADMIN_WALLETS wallet must never be handed the admin role.
      expect(response.body.user.role).not.toBe('admin');
      // The refresh token belongs in the httpOnly cookie, never the body.
      expect(response.body.refreshToken).toBeUndefined();
      expect(getSetCookieHeader(response.headers as Record<string, unknown>).join('; ')).toContain('HttpOnly');
    });

    it('rejects a signature that does not match the claimed wallet', async () => {
      const attacker = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(32));
      const victimWallet = bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(33)).publicKey);
      // Attacker signs with their own key but claims to be the victim.
      const payload = signLogin(attacker);
      await request(app)
        .post('/auth/wallet-login')
        .send({ ...payload, wallet: victimWallet })
        .expect(401);
    });

    it('rejects a replayed signature', async () => {
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(34));
      const payload = signLogin(kp);
      await request(app).post('/auth/wallet-login').send(payload).expect(200);
      // Ed25519 is deterministic, so a captured message+signature pair would
      // otherwise stay valid for its whole freshness window.
      await request(app).post('/auth/wallet-login').send(payload).expect(401);
    });

    it('rejects a stale login challenge', async () => {
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(35));
      const stale = signLogin(kp, { issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
      await request(app).post('/auth/wallet-login').send(stale).expect(401);
    });
  });

  describe('staking endpoints', () => {
    it('stakes LYNX, debiting the balance and crediting the stake', async () => {
      const user = await registerUser('stake-basic');
      await approveAndFund(user.token, user.wallet, { LYNX: 100 });

      // The staking routes answer with the portfolio itself, not { portfolio }.
      const staked = await request(app)
        .post('/api/staking/stake')
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 40 })
        .expect(200);

      expect(staked.body.lynxBalance).toBe(60);
      expect(staked.body.stakedLynx).toBe(40);
    });

    it('refuses to stake more LYNX than the wallet holds', async () => {
      const user = await registerUser('stake-overdraw');
      await approveAndFund(user.token, user.wallet, { LYNX: 10 });

      await request(app)
        .post('/api/staking/stake')
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 999 })
        .expect(400);
    });

    it('unstakes LYNX back into the spendable balance', async () => {
      const user = await registerUser('unstake-basic');
      await approveAndFund(user.token, user.wallet, { LYNX: 100 });
      await request(app)
        .post('/api/staking/stake')
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 100 })
        .expect(200);

      const unstaked = await request(app)
        .post('/api/staking/unstake')
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 30 })
        .expect(200);

      expect(unstaked.body.lynxBalance).toBe(30);
      expect(unstaked.body.stakedLynx).toBe(70);

      // Unstaking more than is staked must not mint balance from nothing.
      await request(app)
        .post('/api/staking/unstake')
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 999 })
        .expect(400);
    });

    it('refuses to let a user stake from a wallet they do not own', async () => {
      const victim = await registerUser('stake-victim');
      await approveAndFund(victim.token, victim.wallet, { LYNX: 50 });
      const attacker = await registerUser('stake-attacker');

      await request(app)
        .post('/api/staking/stake')
        .set(auth(attacker.token))
        .send({ wallet: victim.wallet, amount: 50 })
        .expect(403);
    });
  });

  describe('onchain endpoints', () => {
    it('reports indexer status', async () => {
      const response = await request(app).get('/api/onchain/status').expect(200);
      expect(response.body).toBeTypeOf('object');
      expect(response.body).toHaveProperty('running');
    });

    it('lists indexed on-chain markets', async () => {
      const response = await request(app).get('/api/onchain/markets').expect(200);
      // The indexer is stubbed in this suite, so the list is empty — the
      // contract under test is that the route answers with a shape clients can
      // iterate, not with an error.
      expect(Array.isArray(response.body) || Array.isArray(response.body?.data)).toBe(true);
    });

    it('accepts a sync trigger', async () => {
      const response = await request(app).post('/api/onchain/sync').send({});
      expect([200, 202]).toContain(response.status);
    });
  });

  describe('credit approval endpoints', () => {
    async function propose(adminToken: string, wallet: string, amount = 1) {
      return request(app)
        .post('/api/admin/credits/propose')
        .set(auth(adminToken))
        .send({ wallet, currency: 'SOL', amount, reason: 'coverage test' })
        .expect(201);
    }

    it('requires a second, different admin to approve before execution', async () => {
      const proposer = await loginAdmin('primary');
      const user = await registerUser('credit-dual');
      const proposal = await propose(proposer, user.wallet);

      // The proposer counts as the first approval, so executing straight away
      // must fail — this is the whole point of the control (audit A1/A2).
      await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/execute`)
        .set(auth(proposer))
        .expect(400);

      const approver = await loginAdmin('secondary');
      const approved = await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/approve`)
        .set(auth(approver))
        .expect(200);
      expect(approved.body.readyToExecute).toBe(true);

      await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/execute`)
        .set(auth(proposer))
        .expect(201);

      const portfolio = await request(app)
        .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);
      expect(portfolio.body.solBalance).toBe(1);
    });

    it('refuses to let the proposing admin approve their own request', async () => {
      const proposer = await loginAdmin('primary');
      const user = await registerUser('credit-self-approve');
      const proposal = await propose(proposer, user.wallet);

      // A single compromised admin must not be able to credit a wallet alone.
      await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/approve`)
        .set(auth(proposer))
        .expect(400);
    });

    it('refuses to execute the same approved credit twice', async () => {
      const proposer = await loginAdmin('primary');
      const approver = await loginAdmin('secondary');
      const user = await registerUser('credit-replay');
      const proposal = await propose(proposer, user.wallet, 2);

      await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/approve`)
        .set(auth(approver))
        .expect(200);
      await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/execute`)
        .set(auth(proposer))
        .expect(201);

      // Replaying execute must not double-credit the wallet. Either rejection is
      // correct: 400 if the request is still held and flagged executed, 404 once
      // it has been purged. What matters is that it is never credited twice.
      const replay = await request(app)
        .post(`/api/admin/credits/${proposal.body.id}/execute`)
        .set(auth(proposer));
      expect([400, 404]).toContain(replay.status);

      const portfolio = await request(app)
        .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);
      expect(portfolio.body.solBalance).toBe(2);
    });

    it('rejects credit endpoints for non-admin callers', async () => {
      const user = await registerUser('credit-outsider');
      await request(app)
        .post('/api/admin/credits/propose')
        .set(auth(user.token))
        .send({ wallet: user.wallet, currency: 'SOL', amount: 1, reason: 'self service' })
        .expect(403);
    });
  });

  describe('linking an external wallet via /api/ledger/approve', () => {
    it('links an external wallet when the signature proves control of it', async () => {
      const user = await registerUser('link-approve-ok');
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(51));

      const linked = await linkExternalWallet(user.token, user.wallet, kp);
      expect(linked.status).toBe(200);

      const portfolio = await request(app)
        .get(`/api/portfolio?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);
      expect(portfolio.body.connectedWallets).toContain(bs58.encode(kp.publicKey));
    });

    it('rejects a made-up signature for an external wallet', async () => {
      const user = await registerUser('link-approve-forged');
      const victimWallet = bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(52)).publicKey);

      // Attaching an address the caller cannot sign for must fail: this used to
      // succeed with any 8+ character string, recording a "signed" approval in
      // the audit log that proved nothing.
      await request(app)
        .post('/api/ledger/approve')
        .set(auth(user.token))
        .send({
          wallet: user.wallet,
          externalWallet: victimWallet,
          signature: 'not-a-real-signature',
          signatureMessage: JSON.stringify({ action: 'APPROVE_INTERNAL_LEDGER', wallet: victimWallet }),
        })
        .expect(400);
    });

    it('rejects a valid signature replayed to link a different wallet', async () => {
      const user = await registerUser('link-approve-replay');
      const attackerKp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(53));
      const victimWallet = bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(54)).publicKey);

      // Genuinely sign as the attacker, then claim the message authorises
      // linking the victim's address instead.
      const signatureMessage = JSON.stringify({
        app: 'LYNX',
        action: 'APPROVE_INTERNAL_LEDGER',
        wallet: bs58.encode(attackerKp.publicKey),
        issuedAt: new Date().toISOString(),
      });
      const signature = Buffer.from(
        nacl.sign.detached(new TextEncoder().encode(signatureMessage), attackerKp.secretKey)
      ).toString('base64');

      await request(app)
        .post('/api/ledger/approve')
        .set(auth(user.token))
        .send({ wallet: user.wallet, externalWallet: victimWallet, signature, signatureMessage })
        .expect(400);
    });
  });

  describe('link-wallet endpoint', () => {
    function signLink(kp: nacl.SignKeyPair) {
      const wallet = bs58.encode(kp.publicKey);
      const signatureMessage = JSON.stringify({
        app: 'lynx',
        action: 'LINK_WALLET',
        wallet,
        issuedAt: new Date().toISOString(),
        nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      const signature = Buffer.from(
        nacl.sign.detached(new TextEncoder().encode(signatureMessage), kp.secretKey)
      ).toString('base64');
      return { wallet, signatureMessage, signature };
    }

    it('links a Solana wallet to an authenticated user', async () => {
      const user = await registerUser('link-owner');
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(41));

      // Answers with the public user object directly, not wrapped in { user }.
      const response = await request(app)
        .post('/auth/link-wallet')
        .set(auth(user.token))
        .send(signLink(kp))
        .expect(200);

      expect(response.body.walletAddress).toBe(bs58.encode(kp.publicKey));
    });

    it('rejects linking a wallet the caller cannot sign for', async () => {
      const user = await registerUser('link-thief');
      const someoneElse = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(42));
      const attackerKp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(43));

      // Sign with the attacker's key while claiming someone else's address:
      // linking must prove control of the private key, not merely name it.
      const payload = signLink(attackerKp);
      await request(app)
        .post('/auth/link-wallet')
        .set(auth(user.token))
        .send({ ...payload, wallet: bs58.encode(someoneElse.publicKey) })
        .expect(400);
    });

    it('requires authentication', async () => {
      const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(44));
      await request(app).post('/auth/link-wallet').send(signLink(kp)).expect(401);
    });
  });

  describe('notifications endpoints', () => {
    it("returns the authenticated wallet's notifications and marks them read", async () => {
      const adminToken = await loginAdmin();
      const user = await registerUser('notify-user');
      const market = await createMarket(adminToken, { id: 'market-notify' });
      await approveAndFund(user.token, user.wallet, { SOL: 1 });

      // Resolving a market the user holds a position in is what generates a
      // notification for them.
      await request(app)
        .post(`/api/markets/${market.id}/trades`)
        .set(auth(user.token))
        .send({ wallet: user.wallet, amount: 1, position: 'YES', tradeType: 'swap' })
        .expect(200);
      await resolveMarket(market.id, 'YES');

      const listed = await request(app)
        .get(`/api/notifications?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);
      expect(Array.isArray(listed.body)).toBe(true);

      await request(app)
        .post('/api/notifications/read')
        .set(auth(user.token))
        .send({})
        .expect(200);

      const afterRead = await request(app)
        .get(`/api/notifications?wallet=${encodeURIComponent(user.wallet)}`)
        .set(auth(user.token))
        .expect(200);
      expect(afterRead.body.every((n: any) => n.read !== false)).toBe(true);
    });

    it("refuses to read another wallet's notifications", async () => {
      const victim = await registerUser('notify-victim');
      const attacker = await registerUser('notify-attacker');

      await request(app)
        .get(`/api/notifications?wallet=${encodeURIComponent(victim.wallet)}`)
        .set(auth(attacker.token))
        .expect(403);
    });
  });
});
