// @vitest-environment node
//
// Runs in node, not jsdom: PublicKey.findProgramAddressSync needs a working
// synchronous sha256 the jsdom + buffer-polyfill test env does not provide.
// Same rationale as lynxProgram.staking.test.ts / lynxProgram.duels.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = 'CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu';
vi.stubEnv('VITE_PROGRAM_ID', PROGRAM_ID);

import * as lynx from './lynxProgram';

// Independently recompute what the program uses, so a rename or reordered
// account in lib.rs breaks the test rather than shipping a rejected transaction.
function globalDisc(name: string): Buffer {
  return Buffer.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}

const programId = new PublicKey(PROGRAM_ID);
const admin = Keypair.generate().publicKey;

function assertKeys(
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
  expected: { key: PublicKey; signer: boolean; writable: boolean }[],
) {
  expect(keys).toHaveLength(expected.length);
  keys.forEach((k, i) => {
    expect(k.pubkey.toBase58()).toBe(expected[i].key.toBase58());
    expect(k.isSigner).toBe(expected[i].signer);
    expect(k.isWritable).toBe(expected[i].writable);
  });
}

describe('create_market discriminator', () => {
  it('matches sha256("global:create_market")[:8]', () => {
    expect(globalDisc('create_market')).toEqual(Buffer.from([103, 226, 97, 235, 200, 188, 251, 254]));
  });
});

describe('buildCreateMarketTx', () => {
  it('encodes market_id, title, oracle_authority, timestamps, currency, is_ternary and the CreateMarket accounts', () => {
    const title = 'Will it rain?'; // 13 UTF-8 bytes
    const cutoffTs = 1893456000; // fixed unix seconds
    const resolveTs = 1893542400;
    const { tx, marketId, marketPubkey } = lynx.buildCreateMarketTx({
      admin,
      title,
      currency: 'SOL',
      isTernary: false,
      cutoffTs,
      resolveTs,
    });
    const ix = tx.instructions[0];

    // data = disc(8) + market_id(8) + title(4+13) + oracle_authority(32) + cutoff(8) + resolve(8) + currency(1) + is_ternary(1)
    expect(ix.data).toHaveLength(8 + 8 + 4 + 13 + 32 + 8 + 8 + 1 + 1);
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('create_market'));
    expect(ix.data.readBigUInt64LE(8)).toBe(marketId);
    expect(ix.data.readUInt32LE(16)).toBe(13); // Borsh string length
    expect(ix.data.subarray(20, 33).toString('utf8')).toBe(title);
    // oracle_authority defaults to the admin (manual oracle).
    expect(new PublicKey(ix.data.subarray(33, 65)).toBase58()).toBe(admin.toBase58());
    expect(ix.data.readBigInt64LE(65)).toBe(BigInt(cutoffTs));
    expect(ix.data.readBigInt64LE(73)).toBe(BigInt(resolveTs));
    expect(ix.data[81]).toBe(0); // Currency::SOL
    expect(ix.data[82]).toBe(0); // is_ternary = false

    // The derived Market PDA must match the seeds the program uses.
    expect(marketPubkey.toBase58()).toBe(lynx.marketPda(marketId, programId).toBase58());
    const vault = lynx.marketVaultPda(marketPubkey, programId);
    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: true },
      { key: marketPubkey, signer: false, writable: true },
      { key: vault, signer: false, writable: true },
      { key: admin, signer: true, writable: true },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
  });

  it('encodes Currency::LYNX as 1, is_ternary as 1, and honours a custom oracle_authority', () => {
    const oracle = Keypair.generate().publicKey;
    const { tx } = lynx.buildCreateMarketTx({
      admin, title: 'A/B/Draw', currency: 'LYNX', isTernary: true, cutoffTs: 1, resolveTs: 2, oracleAuthority: oracle,
    });
    const data = tx.instructions[0].data;
    const oracleStart = 8 + 8 + 4 + Buffer.from('A/B/Draw', 'utf8').length;
    expect(new PublicKey(data.subarray(oracleStart, oracleStart + 32)).toBase58()).toBe(oracle.toBase58());
    expect(data[data.length - 2]).toBe(1); // Currency::LYNX
    expect(data[data.length - 1]).toBe(1); // is_ternary = true
  });

  it('rejects an empty or oversized title before building', () => {
    expect(() => lynx.buildCreateMarketTx({ admin, title: '   ', currency: 'SOL', isTernary: false, cutoffTs: 1, resolveTs: 2 })).toThrow();
    const tooLong = 'x'.repeat(lynx.MARKET_TITLE_MAX + 1);
    expect(() => lynx.buildCreateMarketTx({ admin, title: tooLong, currency: 'SOL', isTernary: false, cutoffTs: 1, resolveTs: 2 })).toThrow();
  });
});
