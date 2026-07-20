// @vitest-environment node
//
// Runs in node, not jsdom (see lynxProgram.staking.test.ts for why). Locks the
// on-chain data layout of the market-buy instructions after adding the
// max_price_bps slippage guard, plus the client-side slippage math.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = 'CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu';
vi.stubEnv('VITE_PROGRAM_ID', PROGRAM_ID);

import * as lynx from './lynxProgram';

function globalDisc(name: string): Buffer {
  return Buffer.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}

const programId = new PublicKey(PROGRAM_ID);
const buyer = Keypair.generate().publicKey;
const market = Keypair.generate().publicKey;

describe('buildBuyPositionSolTx (with slippage guard)', () => {
  it('appends max_price_bps as a trailing u64: disc(8)+outcome(1)+lamports(8)+max_price_bps(8)', async () => {
    const tx = await lynx.buildBuyPositionSolTx({ buyer, market, outcome: 'Yes', amountSol: 1, maxPriceBps: 8000 });
    const ix = tx.instructions[0];
    expect(ix.data).toHaveLength(8 + 1 + 8 + 8);
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('buy_position_sol'));
    expect(ix.data[8]).toBe(1); // Outcome::Yes
    expect(ix.data.readBigUInt64LE(9)).toBe(1_000_000_000n); // 1 SOL
    expect(ix.data.readBigUInt64LE(17)).toBe(8000n); // max_price_bps

    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      lynx.configPda(programId).toBase58(),
      market.toBase58(),
      lynx.marketVaultPda(market, programId).toBase58(),
      lynx.positionPda(market, buyer, 'Yes', programId).toBase58(),
      buyer.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
  });

  it('defaults max_price_bps to 10000 (guard disabled) when omitted', async () => {
    const tx = await lynx.buildBuyPositionSolTx({ buyer, market, outcome: 'No', amountSol: 0.5 });
    expect(tx.instructions[0].data.readBigUInt64LE(17)).toBe(10_000n);
  });
});

describe('slippage math', () => {
  it('impliedPriceBpsForSide reflects the side share, or null on an empty pool', () => {
    expect(lynx.impliedPriceBpsForSide({ yes: 0, no: 0 }, 'Yes')).toBeNull();
    expect(lynx.impliedPriceBpsForSide({ yes: 70, no: 30 }, 'Yes')).toBe(7000);
    expect(lynx.impliedPriceBpsForSide({ yes: 70, no: 30 }, 'No')).toBe(3000);
    expect(lynx.impliedPriceBpsForSide({ yes: 1, no: 1, draw: 2 }, 'Draw')).toBe(5000);
  });

  it('maxPriceBpsWithSlippage adds the band and clamps to [1,10000]', () => {
    // empty pool → no reference price → guard disabled (10000)
    expect(lynx.maxPriceBpsWithSlippage({ yes: 0, no: 0 }, 'Yes')).toBe(10_000);
    // 30% side + default 1000 band = 4000
    expect(lynx.maxPriceBpsWithSlippage({ yes: 70, no: 30 }, 'No')).toBe(4000);
    // near-100% side + band clamps to 10000
    expect(lynx.maxPriceBpsWithSlippage({ yes: 99, no: 1 }, 'Yes')).toBe(10_000);
    // custom tighter band
    expect(lynx.maxPriceBpsWithSlippage({ yes: 50, no: 50 }, 'Yes', 200)).toBe(5200);
  });
});
