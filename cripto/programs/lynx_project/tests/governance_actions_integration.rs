//! Integration coverage for the individual GovernanceAction arms of
//! execute_action, plus cancel_proposal. multisig_governance_integration.rs
//! already proves the propose -> approve -> timelock -> execute machinery with a
//! SetPaused action; this file pins down that each remaining config/multisig arm
//! actually applies its effect (AddSigner, RemoveSigner, SetThreshold,
//! TransferAdmin), that the market-only ResolveMarketAdmin arm is rejected here,
//! and that a proposer can cancel their own proposal.
//!
//! These seed an already-approved GovernanceProposal directly (ExecuteAction only
//! constrains `has_one = multisig`, no PDA seeds), advance past the timelock, and
//! invoke the real compiled program via BanksClient.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::GOVERNANCE_EXECUTION_DELAY_SECONDS;
use lynx_project::state::{GovernanceAction, GovernanceProposal, Multisig, Outcome, ProtocolConfig};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account, clock::Clock, instruction::Instruction, pubkey::Pubkey, rent::Rent,
    signature::{Keypair, Signer}, transaction::Transaction,
};
use std::str::FromStr;

fn pid() -> Pubkey { Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap() }
fn bytes<T: AccountSerialize>(s: &T) -> Vec<u8> { let mut d = Vec::new(); s.try_serialize(&mut d).unwrap(); d }
fn racct(data: Vec<u8>) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: pid(), executable: false, rent_epoch: 0 }
}

const BASE_TS: i64 = 1_800_000_000;

fn config_account(admin: Pubkey, bump: u8) -> ProtocolConfig {
    ProtocolConfig {
        admin, treasury: Pubkey::new_unique(), lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump, rewards_vault_bump: 0, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    }
}
fn multisig_account(config: Pubkey, signers: &[Pubkey], threshold: u8, bump: u8) -> Multisig {
    let mut arr = [Pubkey::default(); 5];
    for (i, s) in signers.iter().enumerate() { arr[i] = *s; }
    Multisig { config, signers: arr, signer_count: signers.len() as u8, threshold, proposal_seq: 1, bump }
}
fn approved_proposal(multisig: Pubkey, proposer: Pubkey, action: GovernanceAction) -> GovernanceProposal {
    GovernanceProposal {
        multisig, proposer, proposal_id: 0, action,
        approvals: [Pubkey::default(); 5], approval_count: 2,
        // Threshold already reached at BASE_TS; the timelock is measured from here.
        threshold_reached_ts: BASE_TS, executed: false, cancelled: false,
        created_ts: BASE_TS, expires_ts: BASE_TS + 10_000_000, bump: 0,
    }
}

/// Seeds config + multisig + an already-approved proposal, advances the clock
/// past the execution timelock, and returns the running context plus the pubkeys.
async fn setup(signers: &[Pubkey], threshold: u8, action: GovernanceAction)
    -> (ProgramTestContext, Pubkey, Pubkey, Pubkey) {
    let admin = signers[0];
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (multisig_pda, msb) = Pubkey::find_program_address(&[b"multisig", config_pda.as_ref()], &pid());
    let proposal_key = Pubkey::new_unique();

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_account(admin, cb))));
    pt.add_account(multisig_pda, racct(bytes(&multisig_account(config_pda, signers, threshold, msb))));
    pt.add_account(proposal_key, racct(bytes(&approved_proposal(multisig_pda, admin, action))));
    let mut ctx = pt.start_with_context().await;

    // Advance past the timelock so execute_action is allowed.
    ctx.warp_to_slot(10).unwrap();
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = BASE_TS + GOVERNANCE_EXECUTION_DELAY_SECONDS + 1;
    ctx.set_sysvar(&clock);
    (ctx, config_pda, multisig_pda, proposal_key)
}

async fn execute(ctx: &mut ProgramTestContext, config: Pubkey, multisig: Pubkey, proposal: Pubkey) -> Result<(), BanksClientError> {
    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ExecuteAction { config, multisig, proposal }.to_account_metas(None),
        data: lynx_project::instruction::ExecuteAction {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&[&payer], bh);
    ctx.banks_client.process_transaction(tx).await
}

#[tokio::test]
async fn execute_add_signer_grows_the_signer_set() {
    let a = Pubkey::new_unique();
    let b = Pubkey::new_unique();
    let new_signer = Pubkey::new_unique();
    let (mut ctx, config, ms, prop) = setup(&[a, b], 2, GovernanceAction::AddSigner { signer: new_signer }).await;
    execute(&mut ctx, config, ms, prop).await.expect("AddSigner must apply");
    let m = Multisig::try_deserialize(&mut ctx.banks_client.get_account(ms).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(m.signer_count, 3);
    assert!(m.signers[..3].contains(&new_signer), "the new signer must be recorded");
}

#[tokio::test]
async fn execute_remove_signer_shrinks_the_signer_set() {
    let a = Pubkey::new_unique();
    let b = Pubkey::new_unique();
    let c = Pubkey::new_unique();
    // 3 signers, threshold 2: removing one leaves count(2) == threshold(2), still valid.
    let (mut ctx, config, ms, prop) = setup(&[a, b, c], 2, GovernanceAction::RemoveSigner { signer: b }).await;
    execute(&mut ctx, config, ms, prop).await.expect("RemoveSigner must apply");
    let m = Multisig::try_deserialize(&mut ctx.banks_client.get_account(ms).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(m.signer_count, 2);
    assert!(!m.signers[..2].contains(&b), "the removed signer must be gone");
    assert!(m.signers[..2].contains(&a) && m.signers[..2].contains(&c), "the survivors remain");
}

#[tokio::test]
async fn execute_set_threshold_changes_the_threshold() {
    let a = Pubkey::new_unique();
    let b = Pubkey::new_unique();
    let c = Pubkey::new_unique();
    let (mut ctx, config, ms, prop) = setup(&[a, b, c], 2, GovernanceAction::SetThreshold { threshold: 3 }).await;
    execute(&mut ctx, config, ms, prop).await.expect("SetThreshold must apply");
    let m = Multisig::try_deserialize(&mut ctx.banks_client.get_account(ms).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(m.threshold, 3, "threshold updated to the full signer set");
}

#[tokio::test]
async fn execute_transfer_admin_rotates_the_admin() {
    let a = Pubkey::new_unique();
    let b = Pubkey::new_unique();
    let new_admin = Pubkey::new_unique();
    let (mut ctx, config, ms, prop) = setup(&[a, b], 2, GovernanceAction::TransferAdmin { new_admin }).await;
    execute(&mut ctx, config, ms, prop).await.expect("TransferAdmin must apply");
    let c = ProtocolConfig::try_deserialize(&mut ctx.banks_client.get_account(config).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(c.admin, new_admin, "admin rotated via governance");
}

/// ResolveMarketAdmin moves market funds and MUST NOT be executable through the
/// account-light execute_action path — it has to go through
/// execute_resolve_market_admin (which carries the market/vault/treasury).
#[tokio::test]
async fn execute_action_rejects_the_resolve_market_arm() {
    let a = Pubkey::new_unique();
    let b = Pubkey::new_unique();
    let action = GovernanceAction::ResolveMarketAdmin { market: Pubkey::new_unique(), result: Outcome::Yes };
    let (mut ctx, config, ms, prop) = setup(&[a, b], 2, action).await;
    assert!(execute(&mut ctx, config, ms, prop).await.is_err(),
        "the fund-moving ResolveMarketAdmin arm must be rejected by execute_action");
}

/// The proposer can cancel their own (not-yet-executed) proposal; once cancelled,
/// execute_action must refuse it.
#[tokio::test]
async fn proposer_cancels_then_execution_is_refused() {
    let admin = Keypair::new();
    let b = Pubkey::new_unique();
    let (mut ctx, config, ms, prop) = setup(
        &[admin.pubkey(), b], 2, GovernanceAction::SetPaused { paused: true }).await;

    let cancel = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::CancelProposal {
            config, multisig: ms, proposal: prop, signer: admin.pubkey(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CancelProposal {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut tx = Transaction::new_with_payer(&[cancel], Some(&payer.pubkey()));
    tx.sign(&[&payer, &admin], bh);
    ctx.banks_client.process_transaction(tx).await.expect("proposer must be able to cancel");

    let p = GovernanceProposal::try_deserialize(&mut ctx.banks_client.get_account(prop).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(p.cancelled, "proposal must be flagged cancelled");
    assert!(execute(&mut ctx, config, ms, prop).await.is_err(), "a cancelled proposal must not execute");
}
