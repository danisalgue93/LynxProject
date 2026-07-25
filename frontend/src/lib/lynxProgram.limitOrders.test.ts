// @vitest-environment node
//
// Runs in node, not jsdom: PublicKey.findProgramAddressSync needs a working
// synchronous sha256 the jsdom + buffer-polyfill test env does not provide.
// No DOM is used. Same rationale as lynxProgram.staking.test.ts.
//
// Pins the exact account order/flags of the prediction limit-order builders
// against the #[derive(Accounts)] structs in lib.rs. This is the surface where
// a missing `config` account in buildCancelLimitOrderLynxTx went unnoticed
// (every account shifted by one, so the program rejected the cancel and the
// user's escrowed LYNX was stuck): the untested cancel builders. A reordered or
// missing account in the program now breaks this test instead of shipping a
// transaction the program rejects.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

const PROGRAM_ID = 'CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu';
vi.stubEnv('VITE_PROGRAM_ID', PROGRAM_ID);

import * as lynx from './lynxProgram';

function globalDisc(name: string): Buffer {
  return Buffer.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}
const CONFIG_ACCOUNT_DISC = Buffer.from(
  createHash('sha256').update('account:ProtocolConfig').digest().subarray(0, 8),
);

// Synthetic ProtocolConfig: discriminator + admin, treasury, lynx_mint,
// stake_vault, rewards_vault (32 bytes each). Only lynx_mint (offset 72) is read
// by these builders.
const lynxMint = Keypair.generate().publicKey;
function makeConfigBuffer(): Buffer {
  const buf = Buffer.alloc(8 + 32 * 5);
  CONFIG_ACCOUNT_DISC.copy(buf, 0);
  Keypair.generate().publicKey.toBuffer().copy(buf, 8); // admin
  Keypair.generate().publicKey.toBuffer().copy(buf, 40); // treasury
  lynxMint.toBuffer().copy(buf, 72);
  Keypair.generate().publicKey.toBuffer().copy(buf, 104); // stake_vault
  Keypair.generate().publicKey.toBuffer().copy(buf, 136); // rewards_vault
  return buf;
}

const programId = new PublicKey(PROGRAM_ID);
const owner = Keypair.generate().publicKey;
const signer = Keypair.generate().publicKey;
const market = Keypair.generate().publicKey;
const connection = {
  getAccountInfo: vi.fn().mockResolvedValue({ data: makeConfigBuffer() }),
} as unknown as Connection;

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

beforeEach(() => {
  lynx.clearProtocolConfigCache();
});

describe('prediction limit-order discriminators', () => {
  it('match sha256("global:<name>")[:8]', () => {
    expect(globalDisc('create_prediction_limit_order_sol')).toEqual(
      Buffer.from([119, 18, 41, 21, 24, 40, 207, 22]),
    );
    expect(globalDisc('create_prediction_limit_order_lynx')).toEqual(
      Buffer.from([93, 235, 9, 196, 136, 88, 220, 192]),
    );
    expect(globalDisc('cancel_prediction_limit_order_sol')).toEqual(
      Buffer.from([22, 87, 65, 13, 171, 10, 20, 69]),
    );
    expect(globalDisc('cancel_prediction_limit_order_lynx')).toEqual(
      Buffer.from([25, 34, 254, 136, 55, 212, 7, 221]),
    );
  });
});

describe('buildCancelLimitOrderSolTx', () => {
  // CancelPredictionLimitOrderSol { market, order, escrow, owner, signer }
  it('pins the 5 CancelPredictionLimitOrderSol accounts (no config)', () => {
    const order = lynx.predictionOrderPda(market, owner, 7n, programId);
    const escrow = lynx.predictionOrderEscrowSolPda(order, programId);
    const tx = lynx.buildCancelLimitOrderSolTx({ signer, market, order, orderOwner: owner });
    const ix = tx.instructions[0];
    expect(ix.data).toEqual(globalDisc('cancel_prediction_limit_order_sol'));
    assertKeys(ix.keys, [
      { key: market, signer: false, writable: false },
      { key: order, signer: false, writable: true },
      { key: escrow, signer: false, writable: true },
      { key: owner, signer: false, writable: true },
      { key: signer, signer: true, writable: false },
    ]);
  });
});

describe('buildCancelLimitOrderLynxTx', () => {
  // CancelPredictionLimitOrderLynx { config, market, order, escrow,
  //   owner_lynx_account, signer, token_program }. The config account at index 0
  //   was previously missing — this is the regression guard.
  it('pins the 7 CancelPredictionLimitOrderLynx accounts, config first', async () => {
    const order = lynx.predictionOrderPda(market, owner, 7n, programId);
    const escrow = lynx.predictionOrderEscrowLynxPda(order, programId);
    const ownerLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);
    const tx = await lynx.buildCancelLimitOrderLynxTx({
      connection,
      signer,
      market,
      order,
      orderOwner: owner,
    });
    const ix = tx.instructions[0];
    expect(ix.data).toEqual(globalDisc('cancel_prediction_limit_order_lynx'));
    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: false },
      { key: market, signer: false, writable: false },
      { key: order, signer: false, writable: true },
      { key: escrow, signer: false, writable: true },
      { key: ownerLynxAccount, signer: false, writable: true },
      { key: signer, signer: true, writable: false },
      { key: TOKEN_PROGRAM_ID, signer: false, writable: false },
    ]);
  });
});

describe('buildCreateLimitOrderSolTx', () => {
  // CreatePredictionLimitOrderSol { config, market, order, escrow, owner, system_program }
  it('pins the 6 accounts and encodes order_id, outcome, amount, limit_bps, expires_ts', async () => {
    const expiresTs = 1893456000;
    const { tx, orderId, orderPubkey } = await lynx.buildCreateLimitOrderSolTx({
      owner,
      market,
      outcome: 'Yes',
      amountSol: 2,
      limitProbability: 0.5,
      expiresTs,
    });
    const ix = tx.instructions[0];
    // data = disc(8) + order_id(8) + outcome(1) + amount(8) + limit_bps(8) + expires_ts(8)
    expect(ix.data).toHaveLength(41);
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('create_prediction_limit_order_sol'));
    const escrow = lynx.predictionOrderEscrowSolPda(orderPubkey, programId);
    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: false },
      { key: market, signer: false, writable: false },
      { key: orderPubkey, signer: false, writable: true },
      { key: escrow, signer: false, writable: true },
      { key: owner, signer: true, writable: true },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
    expect(lynx.predictionOrderPda(market, owner, orderId, programId).toBase58()).toBe(
      orderPubkey.toBase58(),
    );
  });
});

describe('buildCreateLimitOrderLynxTx', () => {
  // CreatePredictionLimitOrderLynx { config, market, order, lynx_mint,
  //   user_lynx_account, escrow, owner, token_program, system_program }
  it('pins the 9 accounts including lynx_mint and user_lynx_account', async () => {
    const expiresTs = 1893456000;
    const { tx, orderPubkey } = await lynx.buildCreateLimitOrderLynxTx({
      connection,
      owner,
      market,
      outcome: 'No',
      amountLynx: 100,
      limitProbability: 0.3,
      expiresTs,
    });
    const ix = tx.instructions[0];
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('create_prediction_limit_order_lynx'));
    const escrow = lynx.predictionOrderEscrowLynxPda(orderPubkey, programId);
    const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);
    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: false },
      { key: market, signer: false, writable: false },
      { key: orderPubkey, signer: false, writable: true },
      { key: lynxMint, signer: false, writable: true },
      { key: userLynxAccount, signer: false, writable: true },
      { key: escrow, signer: false, writable: true },
      { key: owner, signer: true, writable: true },
      { key: TOKEN_PROGRAM_ID, signer: false, writable: false },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
  });
});
