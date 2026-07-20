// @vitest-environment node
//
// Runs in node, not jsdom (see lynxProgram.staking.test.ts). Locks the on-chain
// data layout + account order of the DAO governance builders against
// CreateDaoProposal / CastDaoVote / FinalizeDaoProposal in lib.rs — a rename or
// reordered account there breaks the test rather than shipping a rejected tx.
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
const admin = Keypair.generate().publicKey;
const voter = Keypair.generate().publicKey;

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

describe('DAO instruction discriminators', () => {
  it('match sha256("global:<name>")[:8]', () => {
    expect(globalDisc('create_dao_proposal')).toEqual(Buffer.from([112, 127, 42, 71, 195, 95, 60, 165]));
    expect(globalDisc('cast_dao_vote')).toEqual(Buffer.from([129, 151, 210, 43, 50, 222, 234, 39]));
    expect(globalDisc('finalize_dao_proposal')).toEqual(Buffer.from([76, 23, 122, 24, 113, 102, 12, 35]));
  });
});

describe('buildCreateDaoProposalTx', () => {
  it('encodes proposal_id, title, duration_seconds and the CreateDaoProposal accounts', () => {
    const title = 'Increase rewards?'; // 17 bytes
    const { tx, proposalId, proposalPubkey } = lynx.buildCreateDaoProposalTx({ admin, title, durationSeconds: 3600 });
    const ix = tx.instructions[0];

    // data = disc(8) + proposal_id(8) + title(4+17) + duration_seconds(8)
    expect(ix.data).toHaveLength(8 + 8 + 4 + 17 + 8);
    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('create_dao_proposal'));
    expect(ix.data.readBigUInt64LE(8)).toBe(proposalId);
    expect(ix.data.readUInt32LE(16)).toBe(17);
    expect(ix.data.subarray(20, 37).toString('utf8')).toBe(title);
    expect(ix.data.readBigInt64LE(37)).toBe(3600n);

    expect(proposalPubkey.toBase58()).toBe(lynx.daoProposalPda(proposalId, programId).toBase58());
    assertKeys(ix.keys, [
      { key: lynx.configPda(programId), signer: false, writable: false },
      { key: proposalPubkey, signer: false, writable: true },
      { key: admin, signer: true, writable: true },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
  });

  it('rejects an empty or oversized title', () => {
    expect(() => lynx.buildCreateDaoProposalTx({ admin, title: '  ', durationSeconds: 3600 })).toThrow();
    expect(() => lynx.buildCreateDaoProposalTx({ admin, title: 'x'.repeat(lynx.DAO_TITLE_MAX + 1), durationSeconds: 3600 })).toThrow();
  });
});

describe('buildCastDaoVoteTx', () => {
  it('encodes vote_yes and pins stake_position + vote PDAs to the voter', () => {
    const proposalId = 42n;
    const ix = lynx.buildCastDaoVoteTx({ voter, proposalId, voteYes: true }).instructions[0];
    const proposal = lynx.daoProposalPda(proposalId, programId);

    expect(ix.data.subarray(0, 8)).toEqual(globalDisc('cast_dao_vote'));
    expect(ix.data).toHaveLength(9);
    expect(ix.data[8]).toBe(1); // vote_yes = true

    assertKeys(ix.keys, [
      { key: proposal, signer: false, writable: true },
      { key: lynx.stakePositionPda(voter, programId), signer: false, writable: false },
      { key: lynx.daoVotePda(proposal, voter, programId), signer: false, writable: true },
      { key: voter, signer: true, writable: true },
      { key: SystemProgram.programId, signer: false, writable: false },
    ]);
  });

  it('encodes vote_yes = false as 0', () => {
    const ix = lynx.buildCastDaoVoteTx({ voter, proposalId: 1n, voteYes: false }).instructions[0];
    expect(ix.data[8]).toBe(0);
  });
});

describe('buildFinalizeDaoProposalTx', () => {
  it('takes only the proposal account (permissionless)', () => {
    const proposalId = 7n;
    const ix = lynx.buildFinalizeDaoProposalTx({ payer: admin, proposalId }).instructions[0];
    expect(ix.data).toEqual(globalDisc('finalize_dao_proposal'));
    assertKeys(ix.keys, [
      { key: lynx.daoProposalPda(proposalId, programId), signer: false, writable: true },
    ]);
  });
});
