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
      .delete(`/api/orders/${created.body.order.id}?wallet=LIMIT_TRADER`)
      .set(auth(userToken))
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
    await approveWallet(userToken, 'VOTER');
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
});
