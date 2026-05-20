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
  });
});
