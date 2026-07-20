// Byte-layout tests for the on-chain Duel / DaoProposal indexer decoders.
// Hand-builds the exact Borsh account bytes the program writes (per state.rs)
// and asserts the decoder reads every field at the right offset. A reordered or
// resized field in state.rs breaks this rather than silently mis-indexing the UI.
import { describe, it, expect } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { decodeDuel, decodeDaoProposal } from '../src/chain.js';

function u64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function i64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; }
function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}
const disc = Buffer.alloc(8); // decoders start at offset 8; content irrelevant

describe('decodeDuel', () => {
  it('reads Duel fields in the state.rs order', () => {
    const self = Keypair.generate().publicKey;
    const parentMarket = Keypair.generate().publicKey;
    const creator = Keypair.generate().publicKey;
    const rival = Keypair.generate().publicKey;
    const data = Buffer.concat([
      disc,
      parentMarket.toBuffer(), creator.toBuffer(), rival.toBuffer(),
      u64(77n),                 // id
      u64(1_500_000_000n),      // amount (1.5 SOL in lamports)
      Buffer.from([1]),         // creator_outcome = Yes
      Buffer.from([2]),         // rival_outcome = No
      Buffer.from([1]),         // duel_type = OneVOneVProtocol
      Buffer.from([1]),         // status = Active
      i64(1893456000n),         // expires_ts
      Buffer.from([255, 254]),  // bump, vault_bump (trailing, ignored)
    ]);

    const d = decodeDuel(self, data);
    expect(d.pubkey).toBe(self.toBase58());
    expect(d.parentMarket).toBe(parentMarket.toBase58());
    expect(d.creator).toBe(creator.toBase58());
    expect(d.rival).toBe(rival.toBase58());
    expect(d.id).toBe('77');
    expect(d.amount).toBe('1500000000');
    expect(d.creatorOutcome).toBe('Yes');
    expect(d.rivalOutcome).toBe('No');
    expect(d.duelType).toBe('OneVOneVProtocol');
    expect(d.status).toBe('Active');
    expect(d.expiresTs).toBe(1893456000);
  });

  it('maps duel_type 0 -> OneVOne and status 3 -> Cancelled', () => {
    const pk = PublicKey.default;
    const data = Buffer.concat([
      disc, pk.toBuffer(), pk.toBuffer(), pk.toBuffer(),
      u64(1n), u64(1n), Buffer.from([1]), Buffer.from([0]),
      Buffer.from([0]), Buffer.from([3]), i64(0n), Buffer.from([0, 0]),
    ]);
    const d = decodeDuel(pk, data);
    expect(d.duelType).toBe('OneVOne');
    expect(d.status).toBe('Cancelled');
  });
});

describe('decodeDaoProposal', () => {
  it('reads DaoProposal fields in the state.rs order', () => {
    const self = Keypair.generate().publicKey;
    const proposer = Keypair.generate().publicKey;
    const title = 'Increase staking rewards';
    const data = Buffer.concat([
      disc,
      u64(9n),                  // id
      proposer.toBuffer(),
      borshString(title),
      i64(1000n),               // created_ts
      i64(1000n + 86400n),      // end_ts
      u64(90_000_000n),         // votes_yes (micro-LYNX)
      u64(10_000_000n),         // votes_no
      Buffer.from([1]),         // status = Passed
      Buffer.from([255]),       // bump (trailing, ignored)
    ]);

    const p = decodeDaoProposal(self, data);
    expect(p.pubkey).toBe(self.toBase58());
    expect(p.id).toBe('9');
    expect(p.proposer).toBe(proposer.toBase58());
    expect(p.title).toBe(title);
    expect(p.createdTs).toBe(1000);
    expect(p.endTs).toBe(1000 + 86400);
    expect(p.votesYes).toBe('90000000');
    expect(p.votesNo).toBe('10000000');
    expect(p.status).toBe('Passed');
  });

  it('maps status 0 -> Active and 2 -> Rejected', () => {
    const pk = PublicKey.default;
    const build = (status: number) => Buffer.concat([
      disc, u64(1n), pk.toBuffer(), borshString('t'), i64(0n), i64(0n), u64(0n), u64(0n), Buffer.from([status]), Buffer.from([0]),
    ]);
    expect(decodeDaoProposal(pk, build(0)).status).toBe('Active');
    expect(decodeDaoProposal(pk, build(2)).status).toBe('Rejected');
  });
});
