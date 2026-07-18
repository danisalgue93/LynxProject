import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { dbToWallet, dbToMarket, dbToLedger } from '../src/persistence.js';

// Regression for the money-corruption bug: Prisma returns Decimal columns as
// Decimal objects whose valueOf() is a string, so `balance + amount` string-
// concatenates ("10" + 5 -> "105") instead of adding. dbToWallet/dbToMarket/
// dbToLedger must coerce every Decimal field to a real number on load, or the
// first credit after any DB reload inflates the balance (and, via withdrawal,
// drains the treasury).
describe('persistence: Decimal columns are coerced to numbers on load', () => {
  const D = (v: string) => new Prisma.Decimal(v);

  it('dbToWallet balances are numbers that add, not strings that concatenate', () => {
    const w = dbToWallet({
      wallet: 'W1',
      solBalance: D('10'), lynxBalance: D('20'), stakedLynx: D('3'),
      rewardsSol: D('1.5'), rewardsLynx: D('0'), totalVolume: D('99'),
      wins: 2, losses: 1, approvedAt: null, approvalNonce: null, connectedWallets: null,
    });
    for (const [k, v] of Object.entries({
      solBalance: w.solBalance, lynxBalance: w.lynxBalance, stakedLynx: w.stakedLynx,
      rewardsSol: w.rewardsSol, rewardsLynx: w.rewardsLynx, totalVolume: w.totalVolume,
    })) {
      expect(typeof v, `${k} must be a number`).toBe('number');
    }
    expect(w.solBalance).toBe(10);
    // The bug turned this into "105"; a real number gives 15.
    expect(w.solBalance + 5).toBe(15);
  });

  it('dbToMarket pool amounts are numbers', () => {
    const m = dbToMarket({
      id: 'M1', title: 't', description: 'd', category: 'c', status: 'OPEN',
      poolAmount: D('100'), yesAmount: D('60'), noAmount: D('40'),
      drawAmount: null, burnedAmount: D('0'),
      isTernary: false, currency: 'SOL', oracleId: 'o', oracleMode: 'manual',
      createdAt: new Date(), cutoffAt: new Date(),
    });
    expect(typeof m.poolAmount).toBe('number');
    expect(m.poolAmount + 1).toBe(101);
    expect(m.yesAmount + m.noAmount).toBe(100);
  });

  it('dbToLedger amount is a number (or undefined)', () => {
    const e = dbToLedger({
      id: 'L1', wallet: 'W1', type: 'DEPOSIT', currency: 'SOL',
      amount: D('5'), status: 'COMPLETED', createdAt: new Date(),
    });
    expect(typeof e.amount).toBe('number');
    expect(e.amount).toBe(5);

    const noAmount = dbToLedger({
      id: 'L2', wallet: 'W1', type: 'APPROVE', amount: null,
      status: 'COMPLETED', createdAt: new Date(),
    });
    expect(noAmount.amount).toBeUndefined();
  });
});
