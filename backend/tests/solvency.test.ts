import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/chain.js', async (o) => {
  const a = await o<typeof import('../src/chain.js')>();
  return { ...a, startChainIndexer: vi.fn(async () => undefined),
    getIndexerStatus: vi.fn(() => ({ running: false, lastSlot: 0, lastError: null })),
    verifyOnChainMarketCreation: vi.fn(async () => ({ ok: true as const, onChainTitle: 'x' })) };
});
import { store } from '../src/server.js';

describe('SOLVENCIA: el boost con LYNX no debe crear SOL', () => {
  beforeEach(() => store.seed());

  it('mide SOL depositado vs SOL pagado', () => {
    const A = 'MAGIC:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const B = 'MAGIC:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    store.approveWallet(A); store.approveWallet(B);
    // SOL real que entra al sistema
    store.deposit({ wallet: A, currency: 'SOL', amount: 1 });
    store.deposit({ wallet: B, currency: 'SOL', amount: 1 });
    // LYNX para el boost (no es SOL)
    store.deposit({ wallet: A, currency: 'LYNX', amount: 1000 });
    const SOL_DEPOSITADO = 2;

    const now = Date.now();
    const marketInput: any = {
      id: 'm-solv', title: 'Solvencia', description: 'd', category: 'T', currency: 'SOL',
      isTernary: false, oracleId: 'manual:t', cutoffAt: now + 3600_000, resolveAt: now + 7200_000,
      status: 'OPEN', poolAmount: 0, yesAmount: 0, noAmount: 0, burnedAmount: 0, createdAt: now,
    };
    store.addMarket(marketInput);
    const market = marketInput;

    store.executePredictionTrade({ marketId: market.id, wallet: A, amount: 1, position: 'YES', tradeType: 'swap' } as any);
    store.executePredictionTrade({ marketId: market.id, wallet: B, amount: 1, position: 'NO', tradeType: 'swap' } as any);
    const poolAntes = store.getMarket(market.id)!.poolAmount;

    // Genera TWAP LYNX/SOL a 0.5 con trades reales
    const S = 'MAGIC:cccccccccccccccccccccccccccccccc';
    const Bu = 'MAGIC:dddddddddddddddddddddddddddddddd';
    store.approveWallet(S); store.approveWallet(Bu);
    store.deposit({ wallet: S, currency: 'LYNX', amount: 5000 });
    store.deposit({ wallet: Bu, currency: 'SOL', amount: 5000 });
    for (let i = 0; i < 12; i++) {
      store.placeOrder({ wallet: S, pair: 'LYNX/SOL', side: 'SELL', amount: 60, price: 0.5, currency: 'LYNX', tradeType: 'limit' } as any);
      store.placeOrder({ wallet: Bu, pair: 'LYNX/SOL', side: 'BUY', amount: 60, price: 0.5, currency: 'LYNX', tradeType: 'limit' } as any);
    }

    const posA = [...(store as any).positions.values()].find((p: any) => p.wallet === A && p.marketId === market.id) as any;
    // A quema 2 LYNX (~1 SOL al TWAP 0.5) para impulsar su posición
    store.boostPositionWithLynxBurn(A, posA.id, 2);
    const poolDespues = store.getMarket(market.id)!.poolAmount;

    const treasuryAntes = store.treasury.sol;
    store.resolveMarket({ marketId: market.id, result: 'YES', source: 'manual' });
    const claim = store.claimPosition(A, posA.id);
    const feesSol = store.treasury.sol - treasuryAntes;
    const stakersSol = [...(store as any).wallets.values()].reduce((s: number, w: any) => s + (w.rewardsSol || 0), 0);
    const SOL_PAGADO = claim.payout + feesSol + stakersSol;

    console.log(`  pool antes del boost : ${poolAntes} SOL`);
    console.log(`  pool tras el boost   : ${poolDespues} SOL  (+${poolDespues - poolAntes} sin depositar SOL)`);
    console.log(`  SOL depositado real  : ${SOL_DEPOSITADO}`);
    console.log(`  pagado al ganador    : ${claim.payout}`);
    console.log(`  fees a treasury      : ${feesSol}`);
    console.log(`  rewards a stakers    : ${stakersSol}`);
    console.log(`  SOL PAGADO TOTAL     : ${SOL_PAGADO}`);
    console.log(`  >>> DESCUADRE        : ${SOL_PAGADO - SOL_DEPOSITADO} SOL creados de la nada`);

    expect(SOL_PAGADO).toBeLessThanOrEqual(SOL_DEPOSITADO);
  });
});

describe('SOLVENCIA: el boost redistribuye, no crea', () => {
  beforeEach(() => store.seed());

  it('el booster gana cuota a costa de otros ganadores, sin descuadrar', () => {
    const A = 'MAGIC:11111111111111111111111111111111';
    const C = 'MAGIC:22222222222222222222222222222222';
    const B = 'MAGIC:33333333333333333333333333333333';
    for (const w of [A, C, B]) store.approveWallet(w);
    store.deposit({ wallet: A, currency: 'SOL', amount: 1 });
    store.deposit({ wallet: C, currency: 'SOL', amount: 1 });
    store.deposit({ wallet: B, currency: 'SOL', amount: 1 });
    store.deposit({ wallet: A, currency: 'LYNX', amount: 100 });
    const DEPOSITADO = 3;

    const now = Date.now();
    const m: any = { id: 'm-redis', title: 'Redistribucion', description: 'd', category: 'T',
      currency: 'SOL', isTernary: false, oracleId: 'manual:t', cutoffAt: now + 3600_000,
      resolveAt: now + 7200_000, status: 'OPEN', poolAmount: 0, yesAmount: 0, noAmount: 0,
      burnedAmount: 0, createdAt: now };
    store.addMarket(m);
    store.executePredictionTrade({ marketId: m.id, wallet: A, amount: 1, position: 'YES', tradeType: 'swap' } as any);
    store.executePredictionTrade({ marketId: m.id, wallet: C, amount: 1, position: 'YES', tradeType: 'swap' } as any);
    store.executePredictionTrade({ marketId: m.id, wallet: B, amount: 1, position: 'NO', tradeType: 'swap' } as any);

    const S = 'MAGIC:44444444444444444444444444444444';
    const Bu = 'MAGIC:55555555555555555555555555555555';
    store.approveWallet(S); store.approveWallet(Bu);
    store.deposit({ wallet: S, currency: 'LYNX', amount: 5000 });
    store.deposit({ wallet: Bu, currency: 'SOL', amount: 5000 });
    for (let i = 0; i < 12; i++) {
      store.placeOrder({ wallet: S, pair: 'LYNX/SOL', side: 'SELL', amount: 60, price: 0.5, currency: 'LYNX', tradeType: 'limit' } as any);
      store.placeOrder({ wallet: Bu, pair: 'LYNX/SOL', side: 'BUY', amount: 60, price: 0.5, currency: 'LYNX', tradeType: 'limit' } as any);
    }

    const posA: any = [...(store as any).positions.values()].find((p: any) => p.wallet === A && p.marketId === m.id);
    const posC: any = [...(store as any).positions.values()].find((p: any) => p.wallet === C && p.marketId === m.id);
    store.boostPositionWithLynxBurn(A, posA.id, 2); // ~1 SOL de peso

    const tBefore = store.treasury.sol;
    store.resolveMarket({ marketId: m.id, result: 'YES', source: 'manual' });
    const payA = store.claimPosition(A, posA.id).payout;
    const payC = store.claimPosition(C, posC.id).payout;
    const fees = store.treasury.sol - tBefore;
    const stakers = [...(store as any).wallets.values()].reduce((s: number, w: any) => s + (w.rewardsSol || 0), 0);

    // A impulsó, así que se lleva más que C — a costa de C, no del aire.
    expect(payA).toBeGreaterThan(payC);
    // Y el total sigue sin exceder lo depositado.
    expect(payA + payC + fees + stakers).toBeLessThanOrEqual(DEPOSITADO + 1e-6);
  });
});
