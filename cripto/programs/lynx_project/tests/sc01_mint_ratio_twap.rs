//! SC-01: mint-ratio manipulation via last-minute LYNX burns.
//!
//! The LYNX mint ratio is tiered on circulating supply: below 500k LYNX it pays
//! RATIO_TIER_1_BPS (10_000), at/above 5M LYNX it pays RATIO_FLOOR_BPS (250) —
//! a 40x spread. It used to be read from the *instantaneous* circulating supply
//! (`total_lynx_supply - total_lynx_burned`), both of which move within a single
//! transaction. An attacker could therefore burn a large position and resolve a
//! high-value market in the same breath, freezing an inflated ratio and minting
//! up to 40x the LYNX they were owed — atomically, with no price exposure.
//!
//! The fix derives the ratio from a TWAP of circulating supply, sampled by a
//! permissionless crank at most once per SUPPLY_SNAPSHOT_INTERVAL_SECONDS. A
//! last-moment burn now moves at most one of SUPPLY_SNAPSHOT_COUNT samples.
//!
//! These tests exercise the real bytecode.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::{
    RATIO_FLOOR_BPS, RATIO_TIER_1_BPS, SUPPLY_SNAPSHOT_COUNT, SUPPLY_SNAPSHOT_INTERVAL_SECONDS,
};
use lynx_project::state::{
    CirculatingSupplyTwap, Currency, Market, MarketStatus, Outcome, ProtocolConfig,
};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::Instruction,
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};
use std::str::FromStr;

fn program_id() -> Pubkey {
    Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap()
}

fn account_bytes<T: AccountSerialize>(state: &T) -> Vec<u8> {
    let mut data = Vec::new();
    state.try_serialize(&mut data).unwrap();
    data
}

fn program_account(data: Vec<u8>) -> Account {
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner: program_id(),
        executable: false,
        rent_epoch: 0,
    }
}

const MICRO: u64 = 1_000_000; // 1 LYNX
const NOW_TS: i64 = 1_700_000_000;
const MARKET_ID: u64 = 777;

/// Circulating supply well inside the worst tier (>= 5M LYNX → 250 bps).
const HONEST_SUPPLY: u64 = 6_000_000 * MICRO;

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &program_id())
}
fn supply_twap_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"supply_twap", config_pda().0.as_ref()], &program_id())
}

/// Pin the validator clock immediately before a transaction.
///
/// set_sysvar alone does not survive a bank advancing to a new slot — the
/// runtime recomputes unix_timestamp from genesis (which ProgramTest sets to
/// real wall-clock time). Warping and then re-pinning right before each send is
/// what actually gives a test deterministic control over `Clock::get()`.
async fn set_clock(ctx: &mut ProgramTestContext, slot: u64, unix_ts: i64) {
    ctx.warp_to_slot(slot).unwrap();
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = unix_ts;
    ctx.set_sysvar(&clock);
}

fn seed_config(total_supply: u64, burned: u64) -> ProtocolConfig {
    ProtocolConfig {
        admin: Pubkey::new_unique(),
        treasury: Pubkey::new_unique(),
        lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(),
        rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: total_supply,
        total_lynx_burned: burned,
        total_staked: 0,
        reward_per_token_scaled: 0,
        bump: config_pda().1,
        rewards_vault_bump: 0,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: u64::MAX,
    }
}

fn seed_cutoff_market(oracle: Pubkey) -> Market {
    let (market_pda, market_bump) =
        Pubkey::find_program_address(&[b"market", &MARKET_ID.to_le_bytes()], &program_id());
    let _ = market_pda;
    Market {
        id: MARKET_ID,
        admin: Pubkey::new_unique(),
        vault: Pubkey::new_unique(),
        oracle_authority: oracle,
        title: "high value".to_string(),
        currency: Currency::SOL,
        status: MarketStatus::CutOff,
        is_ternary: false,
        cutoff_ts: NOW_TS - 100,
        resolve_ts: NOW_TS - 50,
        oracle_deadline: NOW_TS + 3_600,
        resolved_ts: 0,
        result: Outcome::Unresolved,
        pool_total: 100_000_000_000,
        yes_total: 50_000_000_000,
        no_total: 50_000_000_000,
        draw_total: 0,
        winning_total: 0,
        burned_lynx: 0,
        bump: market_bump,
        vault_bump: 0,
        lynx_vault_bump: 0,
        mint_ratio_bps: 0,
        swept: false,
        proposed_result: Outcome::Unresolved,
        proposed_ts: 0,
        mint_ratio_snapshot_bps: 0,
        total_claimed: 0,
        resolved_by: Pubkey::default(),
    }
}

/// A TWAP whose window is already full of honest, pre-attack samples — the state
/// a live protocol is in after a day of cranking.
fn seed_full_twap(sample: u64) -> CirculatingSupplyTwap {
    CirculatingSupplyTwap {
        config: config_pda().0,
        snapshots: [sample; SUPPLY_SNAPSHOT_COUNT],
        count: SUPPLY_SNAPSHOT_COUNT as u8,
        next_index: 0,
        last_snapshot_ts: NOW_TS - SUPPLY_SNAPSHOT_INTERVAL_SECONDS,
        bump: supply_twap_pda().1,
    }
}

async fn frozen_ratio_after_propose(config: ProtocolConfig, twap: CirculatingSupplyTwap) -> u64 {
    let pid = program_id();
    let oracle = Keypair::new();
    let (config_key, _) = config_pda();
    let (twap_key, _) = supply_twap_pda();
    let (market_pda, _) = Pubkey::find_program_address(&[b"market", &MARKET_ID.to_le_bytes()], &pid);

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config_key, program_account(account_bytes(&config)));
    pt.add_account(twap_key, program_account(account_bytes(&twap)));
    pt.add_account(market_pda, program_account(account_bytes(&seed_cutoff_market(oracle.pubkey()))));

    let ctx: ProgramTestContext = pt.start_with_context().await;
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = NOW_TS;
    ctx.set_sysvar(&clock);

    let ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ProposeResolution {
            config: config_key,
            market: market_pda,
            supply_twap: twap_key,
            oracle_authority: oracle.pubkey(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ProposeResolution { result: Outcome::Yes }.data(),
    };
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &oracle], blockhash);
    ctx.banks_client.process_transaction(tx).await.expect("propose_resolution should succeed");

    let m = ctx.banks_client.get_account(market_pda).await.unwrap().unwrap();
    Market::try_deserialize(&mut m.data.as_slice()).unwrap().mint_ratio_snapshot_bps
}

/// The attack, executed. An attacker burns ~92% of circulating supply right
/// before the oracle resolves a 100 SOL market. Under the old instantaneous
/// read the frozen ratio would jump from the 250 bps floor to 10_000 bps (40x).
/// With the TWAP, the burn is one sample out of a full honest window and the
/// frozen ratio must not move at all.
#[tokio::test]
async fn last_minute_burn_cannot_inflate_the_frozen_mint_ratio() {
    // Honest baseline: 6M LYNX circulating → worst tier.
    let honest = frozen_ratio_after_propose(seed_config(HONEST_SUPPLY, 0), seed_full_twap(HONEST_SUPPLY)).await;
    assert_eq!(honest, RATIO_FLOOR_BPS, "6M circulating must price at the floor tier");

    // Attack: same protocol, but the attacker has just burned supply down to
    // 400k LYNX — instantaneously the most generous tier. The TWAP window still
    // holds 24 honest samples.
    let burned = HONEST_SUPPLY - 400_000 * MICRO;
    let attacked = frozen_ratio_after_propose(
        seed_config(HONEST_SUPPLY, burned),
        seed_full_twap(HONEST_SUPPLY),
    )
    .await;

    assert_eq!(
        attacked, RATIO_FLOOR_BPS,
        "a last-minute burn must not move the frozen mint ratio (SC-01)"
    );
    assert_ne!(
        attacked, RATIO_TIER_1_BPS,
        "the attacker must not reach the 40x tier by burning at resolution time"
    );
    assert_eq!(attacked, honest, "the attack must be a no-op on the frozen ratio");
}

/// The TWAP must still track *genuine* sustained supply changes — otherwise the
/// fix would break the intended tokenomics rather than protect them.
#[tokio::test]
async fn twap_still_reflects_a_sustained_supply_reduction() {
    // A window genuinely full of low-supply samples prices at the top tier.
    let sustained = frozen_ratio_after_propose(
        seed_config(400_000 * MICRO, 0),
        seed_full_twap(400_000 * MICRO),
    )
    .await;
    assert_eq!(
        sustained, RATIO_TIER_1_BPS,
        "a supply reduction sustained across the whole TWAP window must price at tier 1"
    );
}

/// The crank is permissionless, so its rate limit is load-bearing: without it an
/// attacker could overwrite all SUPPLY_SNAPSHOT_COUNT samples with a manipulated
/// supply inside one transaction and defeat the average entirely.
#[tokio::test]
async fn snapshot_crank_enforces_its_interval() {
    let pid = program_id();
    let (config_key, _) = config_pda();
    let (twap_key, _) = supply_twap_pda();

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config_key, program_account(account_bytes(&seed_config(HONEST_SUPPLY, 0))));

    let mut ctx: ProgramTestContext = pt.start_with_context().await;
    set_clock(&mut ctx, 3, NOW_TS).await;

    // Bootstrap the ring buffer.
    let init_ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::InitSupplyTwap {
            config: config_key,
            supply_twap: twap_key,
            payer: ctx.payer.pubkey(),
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::InitSupplyTwap {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[init_ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer], bh);
    ctx.banks_client.process_transaction(tx).await.expect("init_supply_twap");

    let record_ix = || Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::RecordSupplySnapshot { config: config_key, supply_twap: twap_key }
            .to_account_metas(None),
        data: lynx_project::instruction::RecordSupplySnapshot {}.data(),
    };

    // First sample: allowed (last_snapshot_ts == 0).
    set_clock(&mut ctx, 5, NOW_TS).await;
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[record_ix()], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer], bh);
    ctx.banks_client.process_transaction(tx).await.expect("first snapshot should be accepted");

    // Second sample a few seconds later: must be rejected. This is the property
    // that stops an attacker overwriting the whole window in one go.
    set_clock(&mut ctx, 7, NOW_TS + 10).await;
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[record_ix()], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer], bh);
    assert!(
        ctx.banks_client.process_transaction(tx).await.is_err(),
        "a second snapshot inside the interval must be rejected (SnapshotTooSoon)"
    );

    // Once the interval has elapsed it is accepted again.
    set_clock(&mut ctx, 9, NOW_TS + SUPPLY_SNAPSHOT_INTERVAL_SECONDS).await;
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[record_ix()], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer], bh);
    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("a snapshot after the interval should be accepted");

    let acct = ctx.banks_client.get_account(twap_key).await.unwrap().unwrap();
    let twap = CirculatingSupplyTwap::try_deserialize(&mut acct.data.as_slice()).unwrap();
    assert_eq!(twap.count, 2, "exactly two samples should have been recorded");
    assert_eq!(twap.snapshots[0], HONEST_SUPPLY);
    assert_eq!(twap.snapshots[1], HONEST_SUPPLY);
}
