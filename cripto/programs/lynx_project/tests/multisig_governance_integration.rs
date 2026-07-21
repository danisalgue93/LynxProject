//! Integration coverage for the on-chain 2-of-2 admin governance — the security
//! mechanism that gates every privileged config/multisig change. It had no
//! integration test. Drives the real flow against the compiled program:
//!   init_multisig -> propose_action -> approve_action (threshold met)
//!   -> execute BEFORE the timelock must FAIL (TimelockNotElapsed)
//!   -> advance past the timelock -> execute applies the action.
//! Proves the dual-signature requirement and the execution timelock both hold.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::GOVERNANCE_EXECUTION_DELAY_SECONDS;
use lynx_project::state::{GovernanceAction, GovernanceProposal, Multisig, ProtocolConfig};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account, clock::Clock, instruction::Instruction, native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey, rent::Rent, signature::{Keypair, Signer}, system_program, transaction::Transaction,
};
use std::str::FromStr;

async fn send(ctx: &mut ProgramTestContext, ix: Instruction, extra: &[&Keypair]) -> Result<(), BanksClientError> {
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut signers: Vec<&Keypair> = vec![&payer];
    signers.extend_from_slice(extra);
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&signers, bh);
    ctx.banks_client.process_transaction(tx).await
}

fn pid() -> Pubkey { Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap() }
fn bytes<T: AccountSerialize>(s: &T) -> Vec<u8> { let mut d = Vec::new(); s.try_serialize(&mut d).unwrap(); d }

fn config_account(admin: Pubkey, bump: u8) -> ProtocolConfig {
    let (_rv, rvb) = Pubkey::find_program_address(&[b"rewards_vault"], &pid());
    ProtocolConfig {
        admin, treasury: Pubkey::new_unique(), lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump, rewards_vault_bump: rvb, paused: false, multisig_initialized: false,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    }
}

async fn set_clock(ctx: &mut ProgramTestContext, slot: u64, unix_ts: i64) {
    ctx.warp_to_slot(slot).unwrap();
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = unix_ts;
    ctx.set_sysvar(&clock);
}

#[tokio::test]
async fn two_of_two_governance_with_timelock() {
    let admin = Keypair::new();   // multisig signer #1 + proposer
    let signer_b = Keypair::new(); // multisig signer #2 + approver
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (multisig_pda, _) = Pubkey::find_program_address(&[b"multisig", config_pda.as_ref()], &pid());
    let (proposal_pda, _) = Pubkey::find_program_address(
        &[b"gov_proposal", multisig_pda.as_ref(), &0u64.to_le_bytes()], &pid());

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    let cfg = config_account(admin.pubkey(), cb);
    let data = bytes(&cfg);
    pt.add_account(config_pda, Account {
        lamports: Rent::default().minimum_balance(data.len()), data, owner: pid(), executable: false, rent_epoch: 0,
    });
    // Fund the admin at GENESIS (not via set_account after start): set_account adds
    // lamports out of thin air, which warp_to_slot's capitalization hash-verify
    // then rejects. Accounts present before start_with_context are counted in the
    // genesis capitalization, so warping is consistent.
    pt.add_account(admin.pubkey(), Account {
        lamports: 10 * LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0,
    });
    let mut ctx = pt.start_with_context().await;
    let base = 1_800_000_000i64;
    set_clock(&mut ctx, 3, base).await;

    // 1) init_multisig([admin, signer_b], threshold = 2)
    let init = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::InitMultisig {
            admin: admin.pubkey(), config: config_pda, multisig: multisig_pda, system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::InitMultisig { signers: vec![admin.pubkey(), signer_b.pubkey()], threshold: 2 }.data(),
    };
    send(&mut ctx, init, &[&admin]).await.expect("init_multisig");

    // 2) propose SetPaused{true} (proposer auto-approves as #0)
    let propose = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ProposeAction {
            config: config_pda, multisig: multisig_pda, proposal: proposal_pda,
            proposer: admin.pubkey(), system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::ProposeAction { action: GovernanceAction::SetPaused { paused: true } }.data(),
    };
    send(&mut ctx, propose, &[&admin]).await.expect("propose_action");

    // A single signature must NOT be enough to execute: threshold (2) not reached.
    let exec_ix = || Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ExecuteAction {
            config: config_pda, multisig: multisig_pda, proposal: proposal_pda,
        }.to_account_metas(None),
        data: lynx_project::instruction::ExecuteAction {}.data(),
    };
    assert!(send(&mut ctx, exec_ix(), &[]).await.is_err(),
        "one approval must not reach the 2-of-2 threshold");

    // 3) second signer approves -> threshold reached
    let approve = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ApproveAction {
            config: config_pda, multisig: multisig_pda, proposal: proposal_pda, signer: signer_b.pubkey(),
        }.to_account_metas(None),
        data: lynx_project::instruction::ApproveAction {}.data(),
    };
    send(&mut ctx, approve, &[&signer_b]).await.expect("approve_action");

    // Threshold reached, but the execution timelock has NOT elapsed yet -> must fail.
    assert!(send(&mut ctx, exec_ix(), &[]).await.is_err(),
        "execute before the governance timelock elapses must fail");

    // 4) advance past the timelock -> execute applies SetPaused
    set_clock(&mut ctx, 20, base + GOVERNANCE_EXECUTION_DELAY_SECONDS + 1).await;
    send(&mut ctx, exec_ix(), &[]).await
        .expect("execute after the timelock must apply the action");

    let ca = ctx.banks_client.get_account(config_pda).await.unwrap().unwrap();
    let c = ProtocolConfig::try_deserialize(&mut ca.data.as_slice()).unwrap();
    assert!(c.paused, "SetPaused governance action must have paused the protocol");
    let pa = ctx.banks_client.get_account(proposal_pda).await.unwrap().unwrap();
    let p = GovernanceProposal::try_deserialize(&mut pa.data.as_slice()).unwrap();
    assert!(p.executed, "proposal must be marked executed");
    let ma = ctx.banks_client.get_account(multisig_pda).await.unwrap().unwrap();
    let m = Multisig::try_deserialize(&mut ma.data.as_slice()).unwrap();
    assert_eq!(m.threshold, 2);
    assert_eq!(m.signer_count, 2);
}
