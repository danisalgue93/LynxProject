import { describe, it, expect } from 'vitest';
import { solPerLynxToPriceScaled, priceScaledToSolPerLynx, PRICE_SCALE } from './lynxProgram';

/**
 * Regression for a 1e9 unit bug in the spot orderbook price conversion.
 *
 * The on-chain program stores a spot price as `price_scaled` = lamports per
 * micro-LYNX × PRICE_SCALE (1e9), and computes the SOL cost of a fill as
 * `spot_sol_amount = micro_lynx × price_scaled / PRICE_SCALE`. So for the cost to
 * come out right, price_scaled must equal solPerLynx × 1e12.
 *
 * The builder used to also divide by 1e9, producing a value 1e9 too small, which
 * broke spot trading (buy escrows fell under MIN_ORDER_LAMPORTS and reverted; a
 * matched sell would have paid the seller 1e9× too little).
 */
describe('spot price conversion (solPerLynx <-> price_scaled)', () => {
  // Replicates the on-chain spot_sol_amount(micro_lynx, price_scaled).
  function spotSolAmountLamports(microLynx: bigint, priceScaled: bigint): bigint {
    return (microLynx * priceScaled) / PRICE_SCALE;
  }

  it('produces the price_scaled that makes the on-chain cost correct', () => {
    // 1000 LYNX (1e9 micro-LYNX) at 0.005 SOL/LYNX must cost 5 SOL = 5e9 lamports.
    const priceScaled = solPerLynxToPriceScaled(0.005);
    expect(priceScaled).toBe(5_000_000_000n); // 0.005 * 1e12
    const microLynx = 1_000_000_000n; // 1000 LYNX
    expect(spotSolAmountLamports(microLynx, priceScaled)).toBe(5_000_000_000n); // 5 SOL
  });

  it('round-trips solPerLynx -> price_scaled -> solPerLynx', () => {
    for (const price of [0.001, 0.005, 0.5, 1, 3.14]) {
      const scaled = solPerLynxToPriceScaled(price);
      expect(priceScaledToSolPerLynx(scaled)).toBeCloseTo(price, 6);
    }
  });

  it('1 SOL/LYNX maps to exactly 1e12', () => {
    expect(solPerLynxToPriceScaled(1)).toBe(1_000_000_000_000n);
  });
});
