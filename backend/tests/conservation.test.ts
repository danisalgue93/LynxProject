import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/chain.js', async (o) => {
  const a = await o<typeof import('../src/chain.js')>();
  return { ...a, startChainIndexer: vi.fn(async () => undefined),
    getIndexerStatus: vi.fn(() => ({ running: false, lastSlot: 0, lastError: null })),
    verifyOnChainMarketCreation: vi.fn(async () => ({ ok: true as const, onChainTitle: 'x' })) };
});
import { store } from '../src/server.js';

/** Suma TODO el SOL y LYNX del sistema: wallets + treasury + lo bloqueado en órdenes. */
function totals() {
  const wallets = [...(store as any).wallets.values()] as any[];
  const orders = [...(store as any).orders.values()] as any[];
  let sol = 0, lynx = 0;
  for (const w of wallets) {
    sol += (w.solBalance || 0) + (w.rewardsSol || 0);
    lynx += (w.lynxBalance || 0) + (w.stakedLynx || 0) + (w.rewardsLynx || 0);
  }
  sol += store.treasury.sol;
  lynx += store.treasury.lynx + (store.treasury.lynxForInitialSale || 0);
  // SOL/LYNX retenido en órdenes abiertas (ya debitado de la wallet)
  for (const o of orders) {
    if (o.status !== 'OPEN' && o.status !== 'PARTIAL') continue;
    const locked = (o.lockedAmount ?? 0) - (o.spentAmount ?? 0);
    if (locked <= 0) continue;
    if (o.lockedCurrency === 'SOL') sol += locked; else if (o.lockedCurrency === 'LYNX') lynx += locked;
  }
  return { sol: Math.round(sol * 1e6) / 1e6, lynx: Math.round(lynx * 1e6) / 1e6 };
}

describe('CONSERVACION: el libro LYNX/SOL no crea ni destruye valor', () => {
  beforeEach(() => store.seed());

  it('un cruce de ordenes conserva SOL y LYNX (salvo la fee, que va a treasury)', () => {
    const S = 'MAGIC:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
    const B = 'MAGIC:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';
    store.approveWallet(S); store.approveWallet(B);
    store.deposit({ wallet: S, currency: 'LYNX', amount: 1000 });
    store.deposit({ wallet: B, currency: 'SOL', amount: 1000 });

    const antes = totals();
    store.placeOrder({ wallet: S, pair: 'LYNX/SOL', side: 'SELL', amount: 100, price: 0.5, currency: 'LYNX', tradeType: 'limit' } as any);
    store.placeOrder({ wallet: B, pair: 'LYNX/SOL', side: 'BUY', amount: 100, price: 0.5, currency: 'LYNX', tradeType: 'limit' } as any);
    const despues = totals();

    console.log(`  SOL  antes=${antes.sol}  despues=${despues.sol}  delta=${(despues.sol - antes.sol).toFixed(6)}`);
    console.log(`  LYNX antes=${antes.lynx} despues=${despues.lynx} delta=${(despues.lynx - antes.lynx).toFixed(6)}`);

    expect(despues.sol).toBeCloseTo(antes.sol, 6);
    expect(despues.lynx).toBeCloseTo(antes.lynx, 6);
  });

  it('cancelar una orden devuelve exactamente lo bloqueado', () => {
    const B = 'MAGIC:ccccccccccccccccccccccccccccccc3';
    store.approveWallet(B);
    store.deposit({ wallet: B, currency: 'SOL', amount: 100 });

    const antes = totals();
    const r: any = store.placeOrder({ wallet: B, pair: 'LYNX/SOL', side: 'BUY', amount: 50, price: 0.4, currency: 'LYNX', tradeType: 'limit' } as any);
    store.cancelOrder(B, r.order.id);
    const despues = totals();

    console.log(`  cancelar -> SOL delta=${(despues.sol - antes.sol).toFixed(6)} LYNX delta=${(despues.lynx - antes.lynx).toFixed(6)}`);
    expect(despues.sol).toBeCloseTo(antes.sol, 6);
    expect(despues.lynx).toBeCloseTo(antes.lynx, 6);
  });
});

describe('CONSERVACION: duelos', () => {
  beforeEach(() => store.seed());

  function mercado(id: string, ternary = false) {
    const now = Date.now();
    const m: any = { id, title: 'D', description: 'd', category: 'T', currency: 'SOL',
      isTernary: ternary, oracleId: 'manual:t', cutoffAt: now + 3600_000, resolveAt: now + 7200_000,
      status: 'OPEN', poolAmount: 0, yesAmount: 0, noAmount: 0, drawAmount: 0, burnedAmount: 0, createdAt: now };
    store.addMarket(m); return m;
  }

  it('1v1: crear + aceptar + resolver conserva el SOL', () => {
    const C = 'MAGIC:ddddddddddddddddddddddddddddddd4';
    const R = 'MAGIC:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5';
    store.approveWallet(C); store.approveWallet(R);
    store.deposit({ wallet: C, currency: 'SOL', amount: 10 });
    store.deposit({ wallet: R, currency: 'SOL', amount: 10 });
    const m = mercado('d-1v1');
    const antes = totals();

    const d: any = store.createDuel({ wallet: C, marketId: m.id, side: 'YES', amount: 5, type: '1v1' } as any);
    store.acceptDuel({ wallet: R, duelId: d.id ?? d.duel?.id, side: 'NO' } as any);
    store.resolveMarket({ marketId: m.id, result: 'YES', source: 'manual' });
    const despues = totals();

    console.log(`  1v1 -> SOL delta=${(despues.sol - antes.sol).toFixed(6)}`);
    expect(despues.sol).toBeCloseTo(antes.sol, 6);
  });

  it('cancelar un duelo no aceptado devuelve el stake', () => {
    const C = 'MAGIC:fffffffffffffffffffffffffffffff6';
    store.approveWallet(C);
    store.deposit({ wallet: C, currency: 'SOL', amount: 10 });
    const m = mercado('d-cancel');
    const antes = totals();

    const d: any = store.createDuel({ wallet: C, marketId: m.id, side: 'YES', amount: 5, type: '1v1' } as any);
    store.cancelDuel({ wallet: C, duelId: d.id ?? d.duel?.id } as any);
    const despues = totals();

    console.log(`  cancel duelo -> SOL delta=${(despues.sol - antes.sol).toFixed(6)}`);
    expect(despues.sol).toBeCloseTo(antes.sol, 6);
  });
});

describe('CONSERVACION: duelo 1v1vProtocol (el protocolo toma partido)', () => {
  beforeEach(() => store.seed());

  it('el creador pierde: su stake va al protocolo, sin crear SOL', () => {
    const C = 'MAGIC:1111111111111111111111111111111a';
    store.approveWallet(C);
    store.deposit({ wallet: C, currency: 'SOL', amount: 10 });
    const now = Date.now();
    const m: any = { id: 'd-1v1vp-lose', title: 'D', description: 'd', category: 'T', currency: 'SOL',
      isTernary: true, oracleId: 'manual:t', cutoffAt: now + 3600_000, resolveAt: now + 7200_000,
      status: 'OPEN', poolAmount: 0, yesAmount: 0, noAmount: 0, drawAmount: 0, burnedAmount: 0, createdAt: now };
    store.addMarket(m);
    const antes = totals();

    store.createDuel({ wallet: C, marketId: m.id, side: 'YES', amount: 5, type: '1v1vP' } as any);
    store.resolveMarket({ marketId: m.id, result: 'NO', source: 'manual' }); // el creador pierde
    const despues = totals();

    console.log(`  1v1vP creador PIERDE -> SOL delta=${(despues.sol - antes.sol).toFixed(6)}`);
    expect(despues.sol).toBeCloseTo(antes.sol, 6);
  });

  it('el creador gana: no debe crear SOL de la nada', () => {
    const C = 'MAGIC:2222222222222222222222222222222b';
    store.approveWallet(C);
    store.deposit({ wallet: C, currency: 'SOL', amount: 10 });
    const now = Date.now();
    const m: any = { id: 'd-1v1vp-win', title: 'D', description: 'd', category: 'T', currency: 'SOL',
      isTernary: true, oracleId: 'manual:t', cutoffAt: now + 3600_000, resolveAt: now + 7200_000,
      status: 'OPEN', poolAmount: 0, yesAmount: 0, noAmount: 0, drawAmount: 0, burnedAmount: 0, createdAt: now };
    store.addMarket(m);
    const antes = totals();

    store.createDuel({ wallet: C, marketId: m.id, side: 'YES', amount: 5, type: '1v1vP' } as any);
    store.resolveMarket({ marketId: m.id, result: 'YES', source: 'manual' }); // el creador gana
    const despues = totals();

    console.log(`  1v1vP creador GANA   -> SOL delta=${(despues.sol - antes.sol).toFixed(6)}  LYNX delta=${(despues.lynx - antes.lynx).toFixed(6)}`);
    // El SOL no puede aumentar: el premio al ganador debe salir del treasury, no del aire.
    expect(despues.sol).toBeLessThanOrEqual(antes.sol + 1e-6);
  });
});
