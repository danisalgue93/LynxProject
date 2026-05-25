import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, store } from '../src/server.js';

describe('Lynx backend API', () => {
  it('serves seeded markets', async () => {
    store.seed();
    const response = await request(app).get('/api/markets').expect(200);
    expect(response.body.length).toBeGreaterThanOrEqual(3);
  });

  it('executes a prediction trade and updates portfolio', async () => {
    store.seed();
    await request(app)
      .post('/api/markets/market-sol-btc-100k/trades')
      .send({ wallet: 'TESTER', amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(200);

    const portfolio = await request(app).get('/api/portfolio?wallet=TESTER').expect(200);
    expect(portfolio.body.solBalance).toBe(99);
    expect(portfolio.body.holdings).toHaveLength(1);
  });

  it('burns 15 percent of LYNX special-market stake', async () => {
    store.seed();
    const response = await request(app)
      .post('/api/markets/market-lynx-special/trades')
      .send({ wallet: 'TESTER', amount: 100, position: 'NO', tradeType: 'swap' })
      .expect(200);

    expect(response.body.market.burnedAmount).toBe(15);
    expect(response.body.market.poolAmount).toBe(85);
    expect(response.body.position.amount).toBe(85);
  });

  it('normalizes ternary YES/NO inputs to A/B positions', async () => {
    store.seed();
    const response = await request(app)
      .post('/api/markets/market-1v1vp-final/trades')
      .send({ wallet: 'TESTER', amount: 1, position: 'YES', tradeType: 'swap' })
      .expect(200);

    expect(response.body.position.position).toBe('A');
    expect(response.body.market.yesAmount).toBe(1);
  });

  it('rejects DRAW on binary markets as a client error', async () => {
    store.seed();
    await request(app)
      .post('/api/markets/market-sol-btc-100k/trades')
      .send({ wallet: 'TESTER', amount: 1, position: 'DRAW', tradeType: 'swap' })
      .expect(400);
  });

  it('does not debit a rival when duel acceptance validation fails', async () => {
    store.seed();
    const created = await request(app)
      .post('/api/duels')
      .send({ wallet: 'CREATOR', marketId: 'market-sol-btc-100k', side: 'YES', amount: 5 })
      .expect(201);

    await request(app)
      .post(`/api/duels/${created.body.id}/accept`)
      .send({ wallet: 'RIVAL', side: 'YES' })
      .expect(400);

    const portfolio = await request(app).get('/api/portfolio?wallet=RIVAL').expect(200);
    expect(portfolio.body.solBalance).toBe(100);
  });

  it('locks and refunds prediction limit orders without minting balance', async () => {
    store.seed();
    const created = await request(app)
      .post('/api/markets/market-sol-btc-100k/trades')
      .send({ wallet: 'LIMIT_TRADER', amount: 1, position: 'YES', tradeType: 'limit', limitPrice: 0.5 })
      .expect(200);

    let portfolio = await request(app).get('/api/portfolio?wallet=LIMIT_TRADER').expect(200);
    expect(portfolio.body.solBalance).toBe(99);

    await request(app)
      .delete(`/api/orders/${created.body.order.id}?wallet=LIMIT_TRADER`)
      .expect(200);

    portfolio = await request(app).get('/api/portfolio?wallet=LIMIT_TRADER').expect(200);
    expect(portfolio.body.solBalance).toBe(100);
  });

  it('rejects duels after the parent market cutoff', async () => {
    store.seed();
    const market = store.getMarket('market-sol-btc-100k');
    market.cutoffAt = Date.now() - 1;

    await request(app)
      .post('/api/duels')
      .send({ wallet: 'CREATOR', marketId: market.id, side: 'YES', amount: 1 })
      .expect(400);
  });

  it('locks protocol stake for 1v1vP duels', async () => {
    store.seed();
    await request(app)
      .post('/api/duels')
      .send({ wallet: 'CREATOR', marketId: 'market-1v1vp-final', side: 'YES', amount: 0.1, type: '1v1vP' })
      .expect(201);

    const protocolPortfolio = await request(app).get('/api/portfolio?wallet=LYNX_DEV_TREASURY').expect(200);
    expect(protocolPortfolio.body.solBalance).toBe(99.9);
  });

  it('does not debit creator if protocol side cannot fund a 1v1vP duel', async () => {
    store.seed();
    await request(app)
      .post('/api/duels')
      .send({ wallet: 'CREATOR', marketId: 'market-1v1vp-final', side: 'YES', amount: 101, type: '1v1vP' })
      .expect(400);

    const creatorPortfolio = await request(app).get('/api/portfolio?wallet=CREATOR').expect(200);
    expect(creatorPortfolio.body.solBalance).toBe(100);
  });

  it('clears indexed transactions on development reset', async () => {
    store.seed();
    await request(app)
      .post('/api/transactions')
      .send({ signature: 'TEST_SIGNATURE', wallet: 'TESTER' })
      .expect(200);

    await request(app).post('/api/dev/reset').expect(200);

    const response = await request(app).get('/api/transactions').expect(200);
    expect(response.body).toHaveLength(0);
  });

  it('rejects repeated DAO votes from the same wallet', async () => {
    store.seed();
    await request(app)
      .post('/api/proposals/LDAO-1/vote')
      .send({ wallet: 'VOTER', voteType: 'yes' })
      .expect(200);

    await request(app)
      .post('/api/proposals/LDAO-1/vote')
      .send({ wallet: 'VOTER', voteType: 'no' })
      .expect(400);
  });
});
