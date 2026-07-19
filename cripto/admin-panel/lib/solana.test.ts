import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { decodeConfig, decodeMarket, decodeMultisig, decodeProposal } from './solana';

/**
 * These decoders read raw account bytes written by the on-chain program, so a
 * mismatch against programs/lynx_project/src/state.rs is silent: the fields
 * simply come back holding whatever bytes happen to sit at the wrong offset.
 * Two real bugs already lived here — decodeConfig read an `emergency_delay`
 * field that does not exist in ProtocolConfig (shifting `paused` and
 * `multisig_initialized` 8 bytes out of alignment), and decodeProposal skipped a
 * fixed 32 bytes for every GovernanceAction variant even though Borsh encodes
 * them compactly (SetPaused{bool} is 1 byte).
 *
 * The builders below encode each account the way the Rust side does. If the
 * on-chain layout changes and a decoder is not updated with it, these fail.
 */

// ── Borsh-style writers, mirroring the Rust account layouts ─────────────────

class Writer {
  private chunks: Buffer[] = [];
  discriminator(bytes: number[]) { this.chunks.push(Buffer.from(bytes)); return this; }
  pubkey(key: PublicKey) { this.chunks.push(key.toBuffer()); return this; }
  u8(v: number) { this.chunks.push(Buffer.from([v])); return this; }
  bool(v: boolean) { return this.u8(v ? 1 : 0); }
  u64(v: bigint | number) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.chunks.push(b); return this; }
  i64(v: bigint | number) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); this.chunks.push(b); return this; }
  u128(v: bigint | number) { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(v), 0); this.chunks.push(b); return this; }
  string(v: string) {
    const body = Buffer.from(v, 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
    this.chunks.push(len, body); return this;
  }
  build() { return Buffer.concat(this.chunks); }
}

const CONFIG_DISC = [207, 91, 250, 28, 152, 179, 215, 209];
const MARKET_DISC = [219, 190, 213, 55, 0, 227, 198, 154];
const MULTISIG_DISC = [224, 116, 121, 186, 68, 161, 79, 236];
const PROPOSAL_DISC = [53, 107, 240, 190, 43, 73, 65, 143];

const MAX_MULTISIG_SIGNERS = 5;

describe('decodeConfig', () => {
  it('reads ProtocolConfig exactly as state.rs lays it out', () => {
    const admin = PublicKey.unique();
    const treasury = PublicKey.unique();
    const lynxMint = PublicKey.unique();
    const stakeVault = PublicKey.unique();
    const rewardsVault = PublicKey.unique();

    // Field order per #[account] pub struct ProtocolConfig. Note there is NO
    // emergency_delay: the decoder used to read one, pushing every field after
    // reward_per_token_scaled 8 bytes off.
    const data = new Writer()
      .discriminator(CONFIG_DISC)
      .pubkey(admin).pubkey(treasury).pubkey(lynxMint).pubkey(stakeVault).pubkey(rewardsVault)
      .u64(1_000_000)   // total_lynx_supply
      .u64(250_000)     // total_lynx_burned
      .u64(500_000)     // total_staked
      .u128(42)         // reward_per_token_scaled
      .u8(254)          // bump
      .u8(253)          // rewards_vault_bump
      .bool(true)       // paused
      .bool(true)       // multisig_initialized
      .u64(7_000)       // protocol_duel_exposure
      .u64(9_000)       // max_protocol_duel_exposure
      .build();

    const cfg = decodeConfig(data);
    expect(cfg.admin.toBase58()).toBe(admin.toBase58());
    expect(cfg.treasury.toBase58()).toBe(treasury.toBase58());
    expect(cfg.lynxMint.toBase58()).toBe(lynxMint.toBase58());
    expect(cfg.rewardsVault.toBase58()).toBe(rewardsVault.toBase58());
    expect(cfg.bump).toBe(254);
    // The fields the old off-by-eight bug corrupted.
    expect(cfg.paused).toBe(true);
    expect(cfg.multisigInitialized).toBe(true);
    expect(cfg.protocolDuelExposure).toBe(7_000n);
    expect(cfg.maxProtocolDuelExposure).toBe(9_000n);
  });

  it('distinguishes paused=false from paused=true (catches an offset shift)', () => {
    const build = (paused: boolean) => new Writer()
      .discriminator(CONFIG_DISC)
      .pubkey(PublicKey.unique()).pubkey(PublicKey.unique()).pubkey(PublicKey.unique())
      .pubkey(PublicKey.unique()).pubkey(PublicKey.unique())
      .u64(0).u64(0).u64(0).u128(0).u8(1).u8(1).bool(paused).bool(false).u64(0).u64(0)
      .build();

    expect(decodeConfig(build(false)).paused).toBe(false);
    expect(decodeConfig(build(true)).paused).toBe(true);
  });

  it('rejects an account with the wrong discriminator', () => {
    const data = Buffer.alloc(228);
    expect(() => decodeConfig(data)).toThrow(/Invalid config account/);
  });
});

describe('decodeMarket', () => {
  function buildMarket(overrides: { status?: number; result?: number; poolTotal?: bigint } = {}) {
    const vault = PublicKey.unique();
    const oracle = PublicKey.unique();
    return new Writer()
      .discriminator(MARKET_DISC)
      .u64(1001)                       // id
      .pubkey(PublicKey.unique())      // admin
      .pubkey(vault)                   // vault
      .pubkey(oracle)                  // oracle_authority
      .string('BTC > 100k')            // title
      .u8(0)                           // currency: SOL
      .u8(overrides.status ?? 2)       // status: CutOff
      .u8(0)                           // is_ternary
      .i64(1_700_000_000)              // cutoff_ts
      .i64(1_700_003_600)              // resolve_ts
      .i64(1_700_007_200)              // oracle_deadline
      .i64(0)                          // resolved_ts
      .u8(overrides.result ?? 0)       // result
      .u64(overrides.poolTotal ?? 20_000_000_000n) // pool_total
      .u64(10_000_000_000n)            // yes_total
      .u64(10_000_000_000n)            // no_total
      .u64(0)                          // draw_total
      .u64(0)                          // winning_total
      .u64(0)                          // burned_lynx
      .u8(255).u8(254).u8(253)         // bump, vault_bump, lynx_vault_bump
      .u64(0)                          // mint_ratio_bps
      .u8(0)                           // swept
      .u8(1)                           // proposed_result: Yes
      .i64(1_700_004_000)              // proposed_ts
      .build();
  }

  it('decodes a market with the field order from state.rs', () => {
    const m = decodeMarket(PublicKey.unique(), buildMarket());
    expect(m.id).toBe('1001');
    expect(m.title).toBe('BTC > 100k');
    expect(m.status).toBe('CutOff');
    expect(m.isTernary).toBe(false);
    expect(m.oracleDeadline).toBe(1_700_007_200);
    expect(m.poolTotal).toBe('20000000000');
    expect(m.proposedResult).toBe('Yes');
    expect(m.proposedTs).toBe(1_700_004_000);
  });

  it('maps every status index to the right name', () => {
    const names = ['Open', 'Active', 'CutOff', 'PendingResolution', 'Resolved', 'Expired'];
    names.forEach((name, i) => {
      expect(decodeMarket(PublicKey.unique(), buildMarket({ status: i })).status).toBe(name);
    });
  });

  it('maps outcome indices to names, including Unresolved', () => {
    const outcomes = ['Unresolved', 'Yes', 'No', 'Draw'];
    outcomes.forEach((name, i) => {
      // proposed_result sits near the end, so a wrong offset shows up here.
      const data = buildMarket();
      data[data.length - 9] = i;
      expect(decodeMarket(PublicKey.unique(), data).proposedResult).toBe(name);
    });
  });
});

describe('decodeMultisig', () => {
  it('returns only the active signers, not the empty array slots', () => {
    const s1 = PublicKey.unique();
    const s2 = PublicKey.unique();
    const w = new Writer().discriminator(MULTISIG_DISC).pubkey(PublicKey.unique()); // config
    w.pubkey(s1).pubkey(s2);
    // Remaining slots are Pubkey::default() — must never be reported as signers.
    for (let i = 2; i < MAX_MULTISIG_SIGNERS; i++) w.pubkey(PublicKey.default);
    const data = w.u8(2).u8(2).u64(7).build(); // signer_count, threshold, proposal_seq

    const ms = decodeMultisig(PublicKey.unique(), data);
    expect(ms.signers).toEqual([s1.toBase58(), s2.toBase58()]);
    expect(ms.threshold).toBe(2);
    expect(ms.proposalSeq).toBe('7');
  });
});

describe('decodeProposal', () => {
  const GOV = { TransferAdmin: 0, SetPaused: 1, AddSigner: 2, RemoveSigner: 3, SetThreshold: 4, ResolveMarketAdmin: 5 };

  function buildProposal(writeAction: (w: Writer) => void, approvalCount = 1) {
    const proposer = PublicKey.unique();
    const w = new Writer()
      .discriminator(PROPOSAL_DISC)
      .pubkey(PublicKey.unique())  // multisig
      .pubkey(proposer)            // proposer
      .u64(3);                     // proposal_id
    writeAction(w);                // action — Borsh encodes this COMPACTLY
    w.pubkey(proposer);
    for (let i = 1; i < MAX_MULTISIG_SIGNERS; i++) w.pubkey(PublicKey.default);
    w.u8(approvalCount).i64(0).bool(false).bool(false).i64(1_700_000_000).i64(1_700_600_000);
    return { data: w.build(), proposer };
  }

  it('decodes ResolveMarketAdmin { market, result }', () => {
    const market = PublicKey.unique();
    const { data, proposer } = buildProposal((w) => {
      w.u8(GOV.ResolveMarketAdmin).pubkey(market).u8(1); // Outcome::Yes
    });
    const p = decodeProposal(PublicKey.unique(), data);
    expect(p.actionVariant).toBe(GOV.ResolveMarketAdmin);
    expect(p.actionMarket).toBe(market.toBase58());
    expect(p.actionResult).toBe('Yes');
    expect(p.approvals).toEqual([proposer.toBase58()]);
    expect(p.executed).toBe(false);
    expect(p.expiresTs).toBe(1_700_600_000);
  });

  it('stays aligned on SetPaused, whose Borsh payload is 1 byte not 32', () => {
    // The decoder used to skip a flat 32 bytes here, desynchronising everything
    // after `action` by 31 bytes — and fetchOpenProposals decodes EVERY open
    // proposal, so one pause proposal corrupted the whole list.
    const { data, proposer } = buildProposal((w) => w.u8(GOV.SetPaused).bool(true));
    const p = decodeProposal(PublicKey.unique(), data);
    expect(p.actionVariant).toBe(GOV.SetPaused);
    expect(p.approvals).toEqual([proposer.toBase58()]);
    expect(p.approvalCount).toBe(1);
    expect(p.executed).toBe(false);
    expect(p.cancelled).toBe(false);
    expect(p.expiresTs).toBe(1_700_600_000);
  });

  it('stays aligned on SetThreshold { u8 }', () => {
    const { data, proposer } = buildProposal((w) => w.u8(GOV.SetThreshold).u8(2));
    const p = decodeProposal(PublicKey.unique(), data);
    expect(p.approvals).toEqual([proposer.toBase58()]);
    expect(p.expiresTs).toBe(1_700_600_000);
  });

  it('stays aligned on the Pubkey-payload variants', () => {
    for (const variant of [GOV.TransferAdmin, GOV.AddSigner, GOV.RemoveSigner]) {
      const { data, proposer } = buildProposal((w) => w.u8(variant).pubkey(PublicKey.unique()));
      const p = decodeProposal(PublicKey.unique(), data);
      expect(p.actionVariant).toBe(variant);
      expect(p.approvals).toEqual([proposer.toBase58()]);
      expect(p.expiresTs).toBe(1_700_600_000);
    }
  });

  it('refuses to decode an unknown action variant rather than misaligning', () => {
    const { data } = buildProposal((w) => w.u8(99).u8(0));
    expect(() => decodeProposal(PublicKey.unique(), data)).toThrow(/Unknown GovernanceAction variant/);
  });
});
