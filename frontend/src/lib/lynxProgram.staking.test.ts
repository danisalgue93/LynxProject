// @vitest-environment node
//
// Runs in node, not jsdom: PublicKey.findProgramAddressSync needs a working
// synchronous sha256, which the jsdom + buffer-polyfill test env does not
// provide (it fails with "Unable to find a viable program address nonce"). The
// real browser has it; node has it; only jsdom here does not. No DOM is used.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

// getProgramId() reads this at call time; stub it before importing the module
// so the builders can derive PDAs.
const PROGRAM_ID = 'CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu';
vi.stubEnv('VITE_PROGRAM_ID', PROGRAM_ID);

import * as lynx from './lynxProgram';

// The authoritative source of truth for these builders is the on-chain program:
// - instruction discriminator = sha256("global:<snake_name>")[:8]
// - account order/flags        = the #[derive(Accounts)] struct in lib.rs
// This suite recomputes the discriminators independently and pins the exact
// account metas, so a rename or a reordered account in the program breaks the
// test instead of silently shipping a transaction the program rejects.
function globalDisc(name: string): Buffer {
  return Buffer.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
}
const CONFIG_ACCOUNT_DISC = Buffer.from(
  createHash('sha256').update('account:ProtocolConfig').digest().subarray(0, 8),
);

// Synthetic ProtocolConfig: discriminator + admin, treasury, lynx_mint,
// stake_vault, rewards_vault (32 bytes each), matching the field order in
// state.rs. Only lynx_mint (offset 72) and stake_vault (offset 104) are read.
const lynxMint = Keypair.generate().publicKey;
const stakeVault = Keypair.generate().publicKey;
function makeConfigBuffer(): Buffer {
  const buf = Buffer.alloc(8 + 32 * 5);
  CONFIG_ACCOUNT_DISC.copy(buf, 0);
  Keypair.generate().publicKey.toBuffer().copy(buf, 8); // admin
  Keypair.generate().publicKey.toBuffer().copy(buf, 40); // treasury
  lynxMint.toBuffer().copy(buf, 72);
  stakeVault.toBuffer().copy(buf, 104);
  Keypair.generate().publicKey.toBuffer().copy(buf, 136); // rewards_vault (PDA-derived by client)
  return buf;
}

const programId = new PublicKey(PROGRAM_ID);
const owner = Keypair.generate().publicKey;
const connection = {
  getAccountInfo: vi.fn().mockResolvedValue({ data: makeConfigBuffer() }),
} as unknown as Connection;

function u64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}

beforeEach(() => {
  lynx.clearProtocolConfigCache();
});

describe('staking instruction discriminators', () => {
  it('match sha256("global:<name>")[:8] — the same scheme Anchor 0.31 uses', () => {
    // Hardcoded in lynxProgram.ts; recomputed here from the instruction name.
    expect(globalDisc('stake_lynx')).toEqual(Buffer.from([171, 43, 75, 147, 83, 188, 211, 242]));
    expect(globalDisc('unstake_lynx')).toEqual(Buffer.from([196, 208, 22, 83, 84, 204, 179, 239]));
    expect(globalDisc('claim_staking_rewards')).toEqual(Buffer.from([229, 141, 170, 69, 111, 94, 6, 72]));
  });
});

describe('buildStakeLynxTx', () => {
  it('builds stake_lynx with the exact accounts StakeLynx expects', async () => {
    const tx = await lynx.buildStakeLynxTx({ connection, owner, amountLynx: 10 });
    expect(tx.instructions).toHaveLength(1);
    const ix = tx.instructions[0];

    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('stake_lynx'));
    expect(ix.data.subarray(8, 16)).toEqual(u64LE(10_000_000n)); // 10 LYNX at 6 decimals

    const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);
    const expected = [
      { key: lynx.configPda(programId), signer: false, writable: true },
      { key: stakeVault, signer: false, writable: true },
      { key: lynx.stakePositionPda(owner, programId), signer: false, writable: true },
      { key: userLynxAccount, signer: false, writable: true },
      { key: lynxMint, signer: false, writable: false },
      { key: owner, signer: true, writable: true },
      { key: TOKEN_PROGRAM_ID, signer: false, writable: false },
      { key: SystemProgram.programId, signer: false, writable: false },
    ];
    expect(ix.keys).toHaveLength(expected.length);
    ix.keys.forEach((k, i) => {
      expect(k.pubkey.toBase58()).toBe(expected[i].key.toBase58());
      expect(k.isSigner).toBe(expected[i].signer);
      expect(k.isWritable).toBe(expected[i].writable);
    });
  });
});

describe('buildUnstakeLynxTx', () => {
  it('builds unstake_lynx with the exact accounts UnstakeLynx expects', async () => {
    const tx = await lynx.buildUnstakeLynxTx({ connection, owner, amountLynx: 2.5 });
    const ix = tx.instructions[0];

    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('unstake_lynx'));
    expect(ix.data.subarray(8, 16)).toEqual(u64LE(2_500_000n));

    const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);
    const expected = [
      { key: lynx.configPda(programId), signer: false, writable: true },
      { key: stakeVault, signer: false, writable: true },
      { key: lynx.stakePositionPda(owner, programId), signer: false, writable: true },
      { key: userLynxAccount, signer: false, writable: true },
      { key: lynxMint, signer: false, writable: false },
      { key: owner, signer: true, writable: true },
      { key: TOKEN_PROGRAM_ID, signer: false, writable: false },
    ];
    expect(ix.keys).toHaveLength(expected.length);
    ix.keys.forEach((k, i) => {
      expect(k.pubkey.toBase58()).toBe(expected[i].key.toBase58());
      expect(k.isSigner).toBe(expected[i].signer);
      expect(k.isWritable).toBe(expected[i].writable);
    });
  });
});

describe('buildClaimStakingRewardsTx', () => {
  it('builds claim_staking_rewards with no args and the 4 expected accounts', () => {
    const tx = lynx.buildClaimStakingRewardsTx({ owner });
    const ix = tx.instructions[0];

    expect(ix.data).toEqual(globalDisc('claim_staking_rewards')); // no trailing args
    const expected = [
      { key: lynx.configPda(programId), signer: false, writable: false },
      { key: lynx.rewardsVaultPda(programId), signer: false, writable: true },
      { key: lynx.stakePositionPda(owner, programId), signer: false, writable: true },
      { key: owner, signer: true, writable: true },
    ];
    expect(ix.keys).toHaveLength(expected.length);
    ix.keys.forEach((k, i) => {
      expect(k.pubkey.toBase58()).toBe(expected[i].key.toBase58());
      expect(k.isSigner).toBe(expected[i].signer);
      expect(k.isWritable).toBe(expected[i].writable);
    });
  });
});
