import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, store } from '../src/server.js';

const sig = 'TEST_SIGNATURE_123';

async function loginAdmin() {
  const response = await request(app)
    .post('/auth/login')
    .send({ email: 'admin@lynx.local', password: 'admin123' })
    .expect(200);
  return response.body.token as string;
}

async function registerUser(label: string) {
  const response = await request(app)
    .post('/auth/register')
    .send({ email: `${label}-${Date.now()}@lynx.local`, password: 'password123', displayName: label })
    .expect(201);
  return response.body.token as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
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
      onChainMarket: input.onChainMarket || 'DevnetMarket111'
    })
    .expect(201);
  return response.body;
}

async function approveWallet(token: string, wallet: string) {
  await request(app)
    .post('/api/ledger/approve')
    .set(auth(token))
    .send({ wallet, externalWallet: wallet, signature: `${sig}_${wallet}`, signatureMessage: `approve ${wallet}` })
    .expect(200);
}

async function fundWallet(token: string, wallet: string, currency: 'SOL' | 'LYNX', amount: number) {
  await request(app)
    .post('/api/ledger/deposit')
    .set(auth(token))
    .send({ wallet, currency, amount, provider: 'INTERNAL', reference: `test-${wallet}-${currency}` })
    .expect(201);
}

async function approveAndFund(token: string, wallet: string, balances: Partial<Record<'SOL' | 'LYNX', number>>) {
  await approveWallet(token, wallet);
  if (balances.SOL) await fundWallet(token, wallet, 'SOL', balances.SOL);
  if (balances.LYNX) await fundWallet(token, wallet, 'LYNX', balances.LYNX);
}

describe('Lynx backend API', () => {
  beforeEach(() => {
    store.seed();
  });

  it('authenticates the development admin account with admin role', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@lynx.local', password: 'admin123' })
      .expect(200);

    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user.email).toBe('admin@lynx.local');
    expect(response.body.user.role).toBe('admin');
  });

  it('starts without demo markets by default', async () => {
    const response = await request(app).get('/api/markets').expect(200);
    expect(response.body).toEqual([]);
  });

  it('allows only admins to create signed markets', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('not-admin');

    await request(app)
      .post('/api/markets')
      .set(auth(userToken))
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

  it('requires approve and internal balance before trading', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('trade-user');
    const market = await createMarket(adminToken, { id: 'market-trade' });

    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(userToken))
      .send({ wallet: 'TRADE_USER', amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(400);

    await approveAndFund(userToken, 'TRADE_USER', { SOL: 2 });
    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(userToken))
      .send({ wallet: 'TRADE_USER', amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(200);

    const portfolio = await request(app).get('/api/portfolio?wallet=TRADE_USER').expect(200);
    expect(portfolio.body.solBalance).toBe(1);
    expect(portfolio.body.holdings).toHaveLength(1);
  });

  it('burns 15 percent of LYNX special-market stake', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('lynx-burn');
    const market = await createMarket(adminToken, { id: 'market-lynx-special', currency: 'LYNX' });
    await approveAndFund(userToken, 'LYNX_TRADER', { LYNX: 200 });

    const response = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(userToken))
      .send({ wallet: 'LYNX_TRADER', amount: 100, position: 'NO', tradeType: 'swap' })
      .expect(200);

    expect(response.body.market.burnedAmount).toBe(15);
    expect(response.body.market.poolAmount).toBe(85);
    expect(response.body.position.amount).toBe(85);
  });

  it('uses the 30/10/60 LYNX emission split after SOL event resolution', async () => {
    const adminToken = await loginAdmin();
    const aToken = await registerUser('emitter-a');
    const bToken = await registerUser('emitter-b');
    const market = await createMarket(adminToken, { id: 'market-emission' });
    await approveAndFund(aToken, 'EMITTER_A', { SOL: 6 });
    await approveAndFund(bToken, 'EMITTER_B', { SOL: 4 });

    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(aToken))
      .send({ wallet: 'EMITTER_A', amount: 6, position: 'YES', tradeType: 'swap' })
      .expect(200);
    await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(bToken))
      .send({ wallet: 'EMITTER_B', amount: 4, position: 'NO', tradeType: 'swap' })
      .expect(200);

    await request(app)
      .post(`/api/admin/markets/${market.id}/resolve`)
      .set(auth(adminToken))
      .send({ result: 'YES', source: 'manual', confirmation: 'RESOLVE YES' })
      .expect(200);

    const a = await request(app).get('/api/portfolio?wallet=EMITTER_A').expect(200);
    const b = await request(app).get('/api/portfolio?wallet=EMITTER_B').expect(200);
    expect(a.body.lynxBalance).toBe(1.8);
    expect(b.body.lynxBalance).toBe(1.2);
    expect(store.treasury.lynx).toBe(1);
    expect(store.treasury.lynxForInitialSale).toBe(6);
  });

  it('supports 1v1 LYNX duels from active LYNX markets and burns both sides', async () => {
    const adminToken = await loginAdmin();
    const creatorToken = await registerUser('lynx-duel-creator');
    const rivalToken = await registerUser('lynx-duel-rival');
    const market = await createMarket(adminToken, { id: 'market-lynx-duel', currency: 'LYNX' });
    await approveAndFund(creatorToken, 'LYNX_CREATOR', { LYNX: 100 });
    await approveAndFund(rivalToken, 'LYNX_RIVAL', { LYNX: 100 });

    const created = await request(app)
      .post('/api/duels')
      .set(auth(creatorToken))
      .send({ wallet: 'LYNX_CREATOR', marketId: market.id, side: 'YES', amount: 100, type: '1v1' })
      .expect(201);

    expect(created.body.currency).toBe('LYNX');
    expect(created.body.amount).toBe(85);
    expect(created.body.burnedAmount).toBe(15);

    const accepted = await request(app)
      .post(`/api/duels/${created.body.id}/accept`)
      .set(auth(rivalToken))
      .send({ wallet: 'LYNX_RIVAL', side: 'NO' })
      .expect(200);

    expect(accepted.body.burnedAmount).toBe(30);
  });

  it('tracks approve, deposit and withdrawal in the internal ledger', async () => {
    const userToken = await registerUser('ledger-user');
    await approveWallet(userToken, 'LEDGER_USER');
    await fundWallet(userToken, 'LEDGER_USER', 'SOL', 2);
    await request(app)
      .post('/api/ledger/withdraw')
      .set(auth(userToken))
      .send({ wallet: 'LEDGER_USER', currency: 'SOL', amount: 1 })
      .expect(200);

    const ledger = await request(app).get('/api/ledger?wallet=LEDGER_USER').expect(200);
    expect(ledger.body.map((entry: any) => entry.type)).toEqual(['WITHDRAWAL', 'DEPOSIT', 'APPROVE']);
    const portfolio = await request(app).get('/api/portfolio?wallet=LEDGER_USER').expect(200);
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

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // EXTERNAL_WALLET claims a real deposit but supplies no transaction signature.
      await request(app)
        .post('/api/ledger/deposit')
        .set(auth(userToken))
        .send({ wallet, currency: 'SOL', amount: 999999, provider: 'EXTERNAL_WALLET' })
        .expect(400);

      // INTERNAL provider has no on-chain proof at all and must be admin-only.
      await request(app)
        .post('/api/ledger/deposit')
        .set(auth(userToken))
        .send({ wallet, currency: 'SOL', amount: 999999, provider: 'INTERNAL' })
        .expect(403);

      const portfolio = await request(app).get(`/api/portfolio?wallet=${wallet}`).set(auth(userToken)).expect(200);
      expect(portfolio.body.solBalance).not.toBe(999999);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('locks and refunds prediction limit orders without minting balance', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('limit-user');
    const market = await createMarket(adminToken, { id: 'market-limit' });
    await approveAndFund(userToken, 'LIMIT_TRADER', { SOL: 1 });

    const created = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(userToken))
      .send({ wallet: 'LIMIT_TRADER', amount: 1, position: 'YES', tradeType: 'limit', limitPrice: 0.5 })
      .expect(200);

    let portfolio = await request(app).get('/api/portfolio?wallet=LIMIT_TRADER').expect(200);
    expect(portfolio.body.solBalance).toBe(0);

    await request(app)
      .delete(`/api/orders/${created.body.order.id}`)
      .set(auth(userToken))
      .send({ wallet: 'LIMIT_TRADER' })
      .expect(200);

    portfolio = await request(app).get('/api/portfolio?wallet=LIMIT_TRADER').expect(200);
    expect(portfolio.body.solBalance).toBe(1);
  });

  it('cuts off markets through the admin endpoint and blocks new duels', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('cutoff-user');
    const market = await createMarket(adminToken, { id: 'market-cutoff' });
    await approveAndFund(userToken, 'CUTOFF_CREATOR', { SOL: 1 });

    await request(app)
      .post(`/api/admin/markets/${market.id}/cutoff`)
      .set(auth(adminToken))
      .send({ force: true, signature: sig })
      .expect(200);

    await request(app)
      .post('/api/duels')
      .set(auth(userToken))
      .send({ wallet: 'CUTOFF_CREATOR', marketId: market.id, side: 'YES', amount: 1 })
      .expect(400);
  });

  it('locks protocol stake for 1v1vP duels', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('protocol-duel');
    const market = await createMarket(adminToken, { id: 'market-1v1vp', isTernary: true });
    await approveAndFund(userToken, 'CREATOR', { SOL: 1 });
    await fundWallet(userToken, 'LYNX_DEV_TREASURY', 'SOL', 1);

    await request(app)
      .post('/api/duels')
      .set(auth(userToken))
      .send({ wallet: 'CREATOR', marketId: market.id, side: 'YES', amount: 0.1, type: '1v1vP' })
      .expect(201);

    const protocolPortfolio = await request(app).get('/api/portfolio?wallet=LYNX_DEV_TREASURY').expect(200);
    expect(protocolPortfolio.body.solBalance).toBe(0.9);
  });

  it('does not debit creator if protocol side cannot fund a 1v1vP duel', async () => {
    const adminToken = await loginAdmin();
    const userToken = await registerUser('protocol-insufficient');
    const market = await createMarket(adminToken, { id: 'market-1v1vp-insufficient', isTernary: true });
    await approveAndFund(userToken, 'CREATOR', { SOL: 101 });

    await request(app)
      .post('/api/duels')
      .set(auth(userToken))
      .send({ wallet: 'CREATOR', marketId: market.id, side: 'YES', amount: 101, type: '1v1vP' })
      .expect(400);

    const creatorPortfolio = await request(app).get('/api/portfolio?wallet=CREATOR').expect(200);
    expect(creatorPortfolio.body.solBalance).toBe(101);
  });

  it('clears indexed transactions on development reset', async () => {
    await request(app)
      .post('/api/transactions')
      .send({ signature: 'TEST_SIGNATURE', wallet: 'TESTER' })
      .expect(200);

    await request(app).post('/api/dev/reset').expect(200);

    const response = await request(app).get('/api/transactions').expect(200);
    expect(response.body).toHaveLength(0);
  });

  it('rejects repeated DAO votes from the same approved wallet', async () => {
    const userToken = await registerUser('dao-voter');
    await approveAndFund(userToken, 'VOTER', { LYNX: 50 });
    await request(app)
      .post('/api/staking/stake')
      .set(auth(userToken))
      .send({ wallet: 'VOTER', amount: 50 })
      .expect(200);
    const proposal = await request(app)
      .post('/api/proposals')
      .set(auth(userToken))
      .send({ title: 'DAO vote test', description: 'Test proposal', category: 'protocol' })
      .expect(201);

    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(userToken))
      .send({ wallet: 'VOTER', voteType: 'yes' })
      .expect(200);

    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(userToken))
      .send({ wallet: 'VOTER', voteType: 'no' })
      .expect(400);
  });

  it('refuses to let a user vote using a wallet they do not own', async () => {
    const victimToken = await registerUser('dao-victim');
    await approveAndFund(victimToken, 'VICTIM_VOTER', { LYNX: 50 });
    await request(app)
      .post('/api/staking/stake')
      .set(auth(victimToken))
      .send({ wallet: 'VICTIM_VOTER', amount: 50 })
      .expect(200);

    const attackerRegister = await request(app)
      .post('/auth/register')
      .send({ email: `dao-attacker-${Date.now()}@lynx.local`, password: 'password123', displayName: 'dao-attacker' })
      .expect(201);
    const attackerToken = attackerRegister.body.token as string;

    const adminToken = await loginAdmin();
    const proposal = await request(app)
      .post('/api/proposals')
      .set(auth(adminToken))
      .send({ title: 'Hijack test', description: 'Test proposal', category: 'protocol' })
      .expect(201);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // The attacker is authenticated as themselves but tries to cast a vote
      // using the victim's wallet address — this must be rejected.
      await request(app)
        .post(`/api/proposals/${proposal.body.id}/vote`)
        .set(auth(attackerToken))
        .send({ wallet: 'VICTIM_VOTER', voteType: 'yes' })
        .expect(403);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    // The victim must still be free to cast their own vote afterwards.
    await request(app)
      .post(`/api/proposals/${proposal.body.id}/vote`)
      .set(auth(victimToken))
      .send({ wallet: 'VICTIM_VOTER', voteType: 'no' })
      .expect(200);
  });

  it('refuses to let a user claim a winning position from a wallet they do not own', async () => {
    const adminToken = await loginAdmin();
    const victimToken = await registerUser('claim-victim');
    const market = await createMarket(adminToken, { id: 'market-claim-hijack' });
    await approveAndFund(victimToken, 'CLAIM_VICTIM', { SOL: 1 });

    const trade = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(victimToken))
      .send({ wallet: 'CLAIM_VICTIM', amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(200);

    await request(app)
      .post(`/api/admin/markets/${market.id}/resolve`)
      .set(auth(adminToken))
      .send({ result: 'YES', source: 'manual', confirmation: 'RESOLVE YES' })
      .expect(200);

    const attackerRegister = await request(app)
      .post('/auth/register')
      .send({ email: `claim-attacker-${Date.now()}@lynx.local`, password: 'password123', displayName: 'claim-attacker' })
      .expect(201);
    const attackerToken = attackerRegister.body.token as string;

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // The attacker is authenticated as themselves but tries to trigger the
      // claim using the victim's wallet address — this must be rejected.
      await request(app)
        .post(`/api/positions/${trade.body.position.id}/claim`)
        .set(auth(attackerToken))
        .send({ wallet: 'CLAIM_VICTIM' })
        .expect(403);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    // The victim must still be free to claim their own payout afterwards.
    await request(app)
      .post(`/api/positions/${trade.body.position.id}/claim`)
      .set(auth(victimToken))
      .send({ wallet: 'CLAIM_VICTIM' })
      .expect(200);
  });

  it('only takes the documented 10% staker+treasury fee on SOL market resolution (no extra protocol fee)', async () => {
    const adminToken = await loginAdmin();
    const winnerToken = await registerUser('fee-winner');
    const market = await createMarket(adminToken, { id: 'market-fee-check' });
    await approveAndFund(winnerToken, 'FEE_WINNER', { SOL: 10 });

    const treasurySolBefore = store.treasury.sol;

    const trade = await request(app)
      .post(`/api/markets/${market.id}/trades`)
      .set(auth(winnerToken))
      .send({ wallet: 'FEE_WINNER', amount: 10, position: 'YES', tradeType: 'swap' })
      .expect(200);

    await request(app)
      .post(`/api/admin/markets/${market.id}/resolve`)
      .set(auth(adminToken))
      .send({ result: 'YES', source: 'manual', confirmation: 'RESOLVE YES' })
      .expect(200);

    // With no active stakers, both the 5% treasury fee and the 5% staker
    // fee (which has nowhere else to go) land in the treasury — 10% total,
    // never more.
    expect(store.treasury.sol - treasurySolBefore).toBe(1);

    const claim = await request(app)
      .post(`/api/positions/${trade.body.position.id}/claim`)
      .set(auth(winnerToken))
      .send({ wallet: 'FEE_WINNER' })
      .expect(200);

    // Sole winner claims the full pool minus the 10% staker+treasury fee —
    // never minus an extra, separately-applied EVENT_PROTOCOL_FEE.
    expect(claim.body.payout).toBe(9);

    const portfolio = await request(app).get('/api/portfolio?wallet=FEE_WINNER').expect(200);
    expect(portfolio.body.solBalance).toBe(9);
  });
});
