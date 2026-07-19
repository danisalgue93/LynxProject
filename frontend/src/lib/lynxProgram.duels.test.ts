// @vitest-environment node
//
// Runs in node, not jsdom: PublicKey.findProgramAddressSync needs a working
// synchronous sha256 the jsdom + buffer-polyfill test env does not provide.
// No DOM is used. Same rationale as lynxProgram.staking.test.ts.
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
const creator = Keypair.generate().publicKey;
const rival = Keypair.generate().publicKey;
const parentMarket = Keypair.generate().publicKey;

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

describe('duel instruction discriminators', () => {
  it('match sha256("global:<name>")[:8]', () => {
    expect(globalDisc('create_duel')).toEqual(Buffer.from([49, 28, 93, 11, 75, 242, 69, 165]));
    expect(globalDisc('accept_duel')).toEqual(Buffer.from([80, 52, 90, 135, 172, 221, 175, 102]));
    expect(globalDisc('cancel_duel')).toEqual(Buffer.from([83, 124, 224, 237, 235, 44, 38, 57]));
  });
});

describe('buildCreateDuelTx', () => {
  it('encodes duel_id, amount, outcome, duel_type, expires_ts and the CreateDuel accounts', async () => {
    const expiresTs = 1893456000; // fixed unix seconds
    const { tx, duelId, duelPubkey } = await lynx.buildCreateDuelTx({
      creator,
      parentMarket,
      creatorOutcome: 'Yes',
      duelType: 'OneVOneVProtocol',
      amountSol: 1.5,
      expiresTs,
    });
    const ix = tx.instructions[0];

    // data = disc(8) + duel_id(8) + amount(8) + outcome(1) + duel_type(1) + expires_ts(8)
    expect(ix.data).toHaveLength(34);
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('create_duel'));
    expect(ix.data.readBigUInt64LE(8)).toBe(duelId);
    expect(ix.data.readBigUInt64LE(16)).toBe(1_500_000_000n); // 1.5 SOL
    expect(ix.data[24]).toBe(1); // Outcome::Yes
    expect(ix.data[25]).toBe(1); // DuelType::OneVOneVProtocol
    expect(ix.data.readBigInt64LE(26)).toBe(BigInt(expiresTs));

    // The derived duel PDA must match the seeds the program uses.
    expect(duelPubkey.toBase58()).toBe(lynx.duelPda(parentMarket, creator, duelId, programId).toBase58());
    const duelVault = lynx.duelVaultPda(duelPubkey, programId);
    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: true },
      { key: parentMarket, signer: false, writable: false },
      { key: duelPubkey, signer: false, writable: true },
      { key: duelVault, signer: false, writable: true },
      { key: creator, signer: true, writable: true },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
  });

  it('encodes DuelType::OneVOne as 0', async () => {
    const { tx } = await lynx.buildCreateDuelTx({
      creator, parentMarket, creatorOutcome: 'No', duelType: 'OneVOne', amountSol: 1, expiresTs: 0,
    });
    expect(tx.instructions[0].data[25]).toBe(0);
    expect(tx.instructions[0].data[24]).toBe(2); // Outcome::No
  });
});

describe('buildAcceptDuelTx', () => {
  it('encodes rival_outcome and the AcceptDuel accounts', () => {
    const duel = Keypair.generate().publicKey;
    const ix = lynx.buildAcceptDuelTx({ rival, duel, parentMarket, rivalOutcome: 'No' }).instructions[0];

    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('accept_duel'));
    expect(ix.data).toHaveLength(9);
    expect(ix.data[8]).toBe(2); // Outcome::No

    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: false },
      { key: duel, signer: false, writable: true },
      { key: parentMarket, signer: false, writable: false },
      { key: lynx.duelVaultPda(duel, programId), signer: false, writable: true },
      { key: rival, signer: true, writable: true },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
  });
});

describe('buildCancelDuelTx', () => {
  it('takes no args and uses the CancelDuel accounts (creator signs)', () => {
    const duel = Keypair.generate().publicKey;
    const ix = lynx.buildCancelDuelTx({ creator, duel }).instructions[0];

    expect(ix.data).toEqual(globalDisc('cancel_duel'));
    assertKeys(ix.keys, [
      { key: creator, signer: true, writable: true },
      { key: duel, signer: false, writable: true },
      { key: lynx.duelVaultPda(duel, programId), signer: false, writable: true },
    ]);
  });
});
