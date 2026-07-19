//! On-chain DAO: create proposal (admin), stake-weighted voting, one-vote-per
//! staker, and finalize. Drives the real compiled program through BanksClient.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::state::{DaoProposal, DaoProposalStatus, DaoVote, ProtocolConfig, StakePosition};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    native_token::LAMPORTS_PER_SOL,
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
fn program_account(data: Vec<u8>, extra: u64) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()) + extra, data, owner: program_id(), executable: false, rent_epoch: 0 }
}
const MICRO: u64 = 1_000_000;

fn config_pda() -> (Pubkey, u8) { Pubkey::find_program_address(&[b"config"], &program_id()) }
fn stake_pda(owner: &Pubkey) -> (Pubkey, u8) { Pubkey::find_program_address(&[b"stake", owner.as_ref()], &program_id()) }
fn proposal_pda(id: u64) -> (Pubkey, u8) { Pubkey::find_program_address(&[b"dao_proposal", &id.to_le_bytes()], &program_id()) }
fn vote_pda(proposal: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"dao_vote", proposal.as_ref(), voter.as_ref()], &program_id())
}

fn config_account(admin: Pubkey) -> ProtocolConfig {
    let (config, bump) = config_pda();
    let (_rv, rv_bump) = Pubkey::find_program_address(&[b"rewards_vault"], &program_id());
    let _ = config;
    ProtocolConfig {
        admin,
        treasury: Pubkey::new_unique(),
        lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(),
        rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 1_000_000 * MICRO,
        total_lynx_burned: 0,
        total_staked: 0,
        reward_per_token_scaled: 0,
        bump,
        rewards_vault_bump: rv_bump,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: u64::MAX,
    }
}

fn stake_position(owner: Pubkey, amount: u64) -> StakePosition {
    let (_p, bump) = stake_pda(&owner);
    StakePosition { owner, amount, reward_debt_scaled: 0, pending_rewards: 0, bump }
}

async fn fund(ctx: &mut ProgramTestContext, who: &Pubkey) {
    ctx.set_account(who, &Account { lamports: 10 * LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into());
}
async fn send(ctx: &mut ProgramTestContext, ix: Instruction, extra: &[&Keypair]) -> Result<(), BanksClientError> {
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut signers: Vec<&Keypair> = vec![&payer];
    signers.extend_from_slice(extra);
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&signers, bh);
    ctx.banks_client.process_transaction(tx).await
}

fn create_ix(admin: &Pubkey, id: u64, title: &str, duration: i64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::CreateDaoProposal {
            config: config_pda().0,
            proposal: proposal_pda(id).0,
            admin: *admin,
            system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CreateDaoProposal { proposal_id: id, title: title.to_string(), duration_seconds: duration }.data(),
    }
}
fn vote_ix(voter: &Pubkey, id: u64, yes: bool) -> Instruction {
    let proposal = proposal_pda(id).0;
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::CastDaoVote {
            proposal,
            stake_position: stake_pda(voter).0,
            vote: vote_pda(&proposal, voter).0,
            voter: *voter,
            system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CastDaoVote { vote_yes: yes }.data(),
    }
}
fn finalize_ix(id: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::FinalizeDaoProposal { proposal: proposal_pda(id).0 }.to_account_metas(None),
        data: lynx_project::instruction::FinalizeDaoProposal {}.data(),
    }
}

async fn read_proposal(ctx: &mut ProgramTestContext, id: u64) -> DaoProposal {
    let a = ctx.banks_client.get_account(proposal_pda(id).0).await.unwrap().unwrap();
    DaoProposal::try_deserialize(&mut a.data.as_slice()).unwrap()
}

#[tokio::test]
async fn admin_creates_proposal_and_stakers_vote_by_weight() {
    let admin = Keypair::new();
    let alice = Keypair::new(); // 100 LYNX staked
    let bob = Keypair::new();   // 40 LYNX staked
    let mut pt = ProgramTest::new("lynx_project", program_id(), None);
    pt.add_account(config_pda().0, program_account(account_bytes(&config_account(admin.pubkey())), 0));
    pt.add_account(stake_pda(&alice.pubkey()).0, program_account(account_bytes(&stake_position(alice.pubkey(), 100 * MICRO)), 0));
    pt.add_account(stake_pda(&bob.pubkey()).0, program_account(account_bytes(&stake_position(bob.pubkey(), 40 * MICRO)), 0));
    let mut ctx = pt.start_with_context().await;
    for k in [&admin, &alice, &bob] { fund(&mut ctx, &k.pubkey()).await; }

    // Non-admin cannot create a proposal.
    assert!(send(&mut ctx, create_ix(&alice.pubkey(), 1, "not allowed", 3600), &[&alice]).await.is_err());

    send(&mut ctx, create_ix(&admin.pubkey(), 1, "Increase rewards?", 3600), &[&admin]).await.expect("admin creates proposal");
    let p = read_proposal(&mut ctx, 1).await;
    assert_eq!(p.status, DaoProposalStatus::Active);
    assert_eq!(p.votes_yes, 0);

    send(&mut ctx, vote_ix(&alice.pubkey(), 1, true), &[&alice]).await.expect("alice votes yes");
    send(&mut ctx, vote_ix(&bob.pubkey(), 1, false), &[&bob]).await.expect("bob votes no");

    let p = read_proposal(&mut ctx, 1).await;
    assert_eq!(p.votes_yes, 100 * MICRO, "weight is staked LYNX");
    assert_eq!(p.votes_no, 40 * MICRO);

    // The vote record was written and pins the weight.
    let v = ctx.banks_client.get_account(vote_pda(&proposal_pda(1).0, &alice.pubkey()).0).await.unwrap().unwrap();
    let vote = DaoVote::try_deserialize(&mut v.data.as_slice()).unwrap();
    assert_eq!(vote.weight, 100 * MICRO);
    assert!(vote.vote_yes);

    // Alice cannot vote twice (the DaoVote PDA already exists).
    assert!(send(&mut ctx, vote_ix(&alice.pubkey(), 1, false), &[&alice]).await.is_err());
}

#[tokio::test]
async fn a_wallet_with_no_stake_cannot_vote() {
    let admin = Keypair::new();
    let nobody = Keypair::new(); // stake_position exists but amount 0
    let mut pt = ProgramTest::new("lynx_project", program_id(), None);
    pt.add_account(config_pda().0, program_account(account_bytes(&config_account(admin.pubkey())), 0));
    pt.add_account(stake_pda(&nobody.pubkey()).0, program_account(account_bytes(&stake_position(nobody.pubkey(), 0)), 0));
    let mut ctx = pt.start_with_context().await;
    for k in [&admin, &nobody] { fund(&mut ctx, &k.pubkey()).await; }

    send(&mut ctx, create_ix(&admin.pubkey(), 7, "x", 3600), &[&admin]).await.unwrap();
    assert!(send(&mut ctx, vote_ix(&nobody.pubkey(), 7, true), &[&nobody]).await.is_err(),
        "a zero-weight staker must not be able to vote");
}

#[tokio::test]
async fn finalize_passes_or_rejects_by_majority_only_after_the_window() {
    // Seed proposals directly with end_ts in the past so finalize can run without
    // manipulating the clock.
    let mut pt = ProgramTest::new("lynx_project", program_id(), None);
    let passed = DaoProposal { id: 10, proposer: Pubkey::new_unique(), title: "p".into(), created_ts: 0, end_ts: 1, votes_yes: 90 * MICRO, votes_no: 10 * MICRO, status: DaoProposalStatus::Active, bump: proposal_pda(10).1 };
    let rejected = DaoProposal { id: 11, proposer: Pubkey::new_unique(), title: "r".into(), created_ts: 0, end_ts: 1, votes_yes: 10 * MICRO, votes_no: 90 * MICRO, status: DaoProposalStatus::Active, bump: proposal_pda(11).1 };
    let stillopen = DaoProposal { id: 12, proposer: Pubkey::new_unique(), title: "s".into(), created_ts: 0, end_ts: i64::MAX, votes_yes: 1, votes_no: 0, status: DaoProposalStatus::Active, bump: proposal_pda(12).1 };
    pt.add_account(proposal_pda(10).0, program_account(account_bytes(&passed), 0));
    pt.add_account(proposal_pda(11).0, program_account(account_bytes(&rejected), 0));
    pt.add_account(proposal_pda(12).0, program_account(account_bytes(&stillopen), 0));
    let mut ctx = pt.start_with_context().await;

    send(&mut ctx, finalize_ix(10), &[]).await.expect("finalize passed");
    assert_eq!(read_proposal(&mut ctx, 10).await.status, DaoProposalStatus::Passed);

    send(&mut ctx, finalize_ix(11), &[]).await.expect("finalize rejected");
    assert_eq!(read_proposal(&mut ctx, 11).await.status, DaoProposalStatus::Rejected);

    // Cannot finalize while voting is still open.
    assert!(send(&mut ctx, finalize_ix(12), &[]).await.is_err(),
        "finalizing before end_ts must be rejected");
    // Cannot finalize an already-finalized proposal.
    assert!(send(&mut ctx, finalize_ix(10), &[]).await.is_err());
}
