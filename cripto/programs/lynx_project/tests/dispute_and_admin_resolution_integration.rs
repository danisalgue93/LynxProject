//! Integration coverage for the two resolution-safety paths that had no runtime
//! test: dispute_resolution (any multisig signer can veto a proposed result while
//! it is still inside the dispute window, sending the market back to CutOff and
//! moving no funds) and execute_resolve_market_admin (the governance fallback
//! that resolves a market when the oracle never proposed a result before its
//! deadline). Driven against the REAL compiled program via BanksClient.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::{GOVERNANCE_EXECUTION_DELAY_SECONDS, SUPPLY_SNAPSHOT_COUNT};
use lynx_project::state::{
    CirculatingSupplyTwap, Currency, GovernanceAction, GovernanceProposal, Market, MarketStatus,
    MarketVault, Multisig, Outcome, ProtocolConfig, RewardsVault,
};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account, clock::Clock, instruction::Instruction, native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey, rent::Rent, signature::{Keypair, Signer}, system_program, transaction::Transaction,
};
use std::str::FromStr;

fn pid() -> Pubkey { Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap() }
fn bytes<T: AccountSerialize>(s: &T) -> Vec<u8> { let mut d = Vec::new(); s.try_serialize(&mut d).unwrap(); d }
fn racct(data: Vec<u8>, extra: u64) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()) + extra, data, owner: pid(), executable: false, rent_epoch: 0 }
}

const BASE_TS: i64 = 1_800_000_000;

fn config_account(bump: u8, treasury: Pubkey) -> ProtocolConfig {
    ProtocolConfig {
        admin: Pubkey::new_unique(), treasury, lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump, rewards_vault_bump: 0, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    }
}
fn multisig_account(config: Pubkey, signers: &[Pubkey], bump: u8) -> Multisig {
    let mut arr = [Pubkey::default(); 5];
    for (i, s) in signers.iter().enumerate() { arr[i] = *s; }
    Multisig { config, signers: arr, signer_count: signers.len() as u8, threshold: signers.len() as u8, proposal_seq: 1, bump }
}
async fn set_clock(ctx: &mut ProgramTestContext, slot: u64, ts: i64) {
    ctx.warp_to_slot(slot).unwrap();
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = ts;
    ctx.set_sysvar(&clock);
}

// ---- dispute_resolution --------------------------------------------------

async fn run_dispute(signer: &Keypair, signer_is_member: bool) -> Result<(), solana_program_test::BanksClientError> {
    let market_id: u64 = 1;
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (multisig_pda, msb) = Pubkey::find_program_address(&[b"multisig", config_pda.as_ref()], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());

    let member = if signer_is_member { signer.pubkey() } else { Pubkey::new_unique() };
    let mut market = Market {
        id: market_id, admin: Pubkey::new_unique(), vault: Pubkey::new_unique(), oracle_authority: Pubkey::new_unique(),
        title: "m".into(), currency: Currency::SOL, status: MarketStatus::PendingResolution, is_ternary: false,
        cutoff_ts: 0, resolve_ts: 0, oracle_deadline: 0, resolved_ts: 0, result: Outcome::Unresolved,
        pool_total: LAMPORTS_PER_SOL, yes_total: LAMPORTS_PER_SOL, no_total: 0, draw_total: 0, winning_total: 0,
        burned_lynx: 0, bump: mb, vault_bump: 0, lynx_vault_bump: 0, mint_ratio_bps: 0, swept: false,
        proposed_result: Outcome::Yes, proposed_ts: BASE_TS, mint_ratio_snapshot_bps: 5_000, total_claimed: 0,
        resolved_by: Pubkey::default(),
    };
    market.proposed_ts = BASE_TS;

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_account(cb, Pubkey::new_unique())), 0));
    pt.add_account(multisig_pda, racct(bytes(&multisig_account(config_pda, &[member], msb)), 0));
    pt.add_account(market_pda, racct(bytes(&market), 0));
    pt.add_account(signer.pubkey(), Account {
        lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0,
    });
    let mut ctx = pt.start_with_context().await;
    // Well inside the 24h dispute window.
    set_clock(&mut ctx, 5, BASE_TS + 100).await;

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::DisputeResolution {
            config: config_pda, multisig: multisig_pda, market: market_pda, signer: signer.pubkey(),
        }.to_account_metas(None),
        data: lynx_project::instruction::DisputeResolution {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&[&payer, signer], bh);
    let res = ctx.banks_client.process_transaction(tx).await;
    if res.is_ok() {
        let m = Market::try_deserialize(&mut ctx.banks_client.get_account(market_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
        assert!(m.status == MarketStatus::CutOff, "a disputed market returns to CutOff");
        assert!(m.proposed_result == Outcome::Unresolved && m.proposed_ts == 0, "the proposal is cleared");
    }
    res
}

#[tokio::test]
async fn a_multisig_signer_can_dispute_within_the_window() {
    let signer = Keypair::new();
    run_dispute(&signer, true).await.expect("a multisig signer must be able to dispute");
}

#[tokio::test]
async fn a_non_signer_cannot_dispute() {
    let signer = Keypair::new();
    assert!(run_dispute(&signer, false).await.is_err(), "a non-signer must not be able to dispute");
}

// ---- execute_resolve_market_admin (LYNX market, fallback) ----------------

#[tokio::test]
async fn admin_fallback_resolves_a_market_after_the_oracle_deadline() {
    let market_id: u64 = 2;
    let treasury_owner = Pubkey::new_unique();
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (multisig_pda, msb) = Pubkey::find_program_address(&[b"multisig", config_pda.as_ref()], &pid());
    let (twap_pda, tb) = Pubkey::find_program_address(&[b"supply_twap", config_pda.as_ref()], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());
    let (vault_pda, vb) = Pubkey::find_program_address(&[b"vault", market_pda.as_ref()], &pid());
    let (rewards_pda, rvb) = Pubkey::find_program_address(&[b"rewards_vault"], &pid());
    let proposal_key = Pubkey::new_unique();
    let a = Pubkey::new_unique();
    let b = Pubkey::new_unique();

    // LYNX market so finalize_market_and_fees moves no SOL and needs no mint-ratio
    // snapshot — this isolates the fallback-resolution glue itself. CutOff, and its
    // oracle deadline has already passed, so the fallback is unlocked.
    let market = Market {
        id: market_id, admin: Pubkey::new_unique(), vault: vault_pda, oracle_authority: Pubkey::new_unique(),
        title: "lynx m".into(), currency: Currency::LYNX, status: MarketStatus::CutOff, is_ternary: false,
        cutoff_ts: 0, resolve_ts: 0, oracle_deadline: BASE_TS - 1, resolved_ts: 0, result: Outcome::Unresolved,
        pool_total: 1_000_000_000, yes_total: 1_000_000_000, no_total: 0, draw_total: 0, winning_total: 0,
        burned_lynx: 0, bump: mb, vault_bump: vb, lynx_vault_bump: 0, mint_ratio_bps: 0, swept: false,
        proposed_result: Outcome::Unresolved, proposed_ts: 0, mint_ratio_snapshot_bps: 0, total_claimed: 0,
        resolved_by: Pubkey::default(),
    };
    let proposal = GovernanceProposal {
        multisig: multisig_pda, proposer: a, proposal_id: 0,
        action: GovernanceAction::ResolveMarketAdmin { market: market_pda, result: Outcome::Yes },
        approvals: [Pubkey::default(); 5], approval_count: 2, threshold_reached_ts: BASE_TS,
        executed: false, cancelled: false, created_ts: BASE_TS, expires_ts: BASE_TS + 10_000_000, bump: 0,
    };
    let twap = CirculatingSupplyTwap {
        config: config_pda, snapshots: [0u64; SUPPLY_SNAPSHOT_COUNT], count: 0, next_index: 0,
        last_snapshot_ts: 0, bump: tb,
    };

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_account(cb, treasury_owner)), 0));
    pt.add_account(multisig_pda, racct(bytes(&multisig_account(config_pda, &[a, b], msb)), 0));
    pt.add_account(twap_pda, racct(bytes(&twap), 0));
    pt.add_account(market_pda, racct(bytes(&market), 0));
    pt.add_account(vault_pda, racct(bytes(&MarketVault { market: market_pda, bump: vb }), 0));
    pt.add_account(rewards_pda, racct(bytes(&RewardsVault { bump: rvb }), 0));
    pt.add_account(proposal_key, racct(bytes(&proposal), 0));
    pt.add_account(treasury_owner, Account {
        lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0,
    });
    let mut ctx = pt.start_with_context().await;
    // Past the governance execution timelock.
    set_clock(&mut ctx, 10, BASE_TS + GOVERNANCE_EXECUTION_DELAY_SECONDS + 1).await;

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ExecuteResolveMarketAdmin {
            config: config_pda, multisig: multisig_pda, proposal: proposal_key, supply_twap: twap_pda,
            market: market_pda, vault: vault_pda, rewards_vault: rewards_pda, treasury: treasury_owner,
        }.to_account_metas(None),
        data: lynx_project::instruction::ExecuteResolveMarketAdmin {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&[&payer], bh);
    ctx.banks_client.process_transaction(tx).await.expect("governance fallback must resolve the market");

    let m = Market::try_deserialize(&mut ctx.banks_client.get_account(market_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(m.status == MarketStatus::Resolved, "market must be Resolved");
    assert!(m.result == Outcome::Yes, "result must be the proposed governance outcome");
    assert_eq!(m.winning_total, 1_000_000_000, "winning_total set to the YES side");
    let p = GovernanceProposal::try_deserialize(&mut ctx.banks_client.get_account(proposal_key).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(p.executed, "proposal must be marked executed");
}
