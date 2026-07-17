//! Staking: stake / unstake / claim rewards, against the real compiled program.
//!
//! Staking had no runtime coverage at all, and it is the mechanism that decides
//! who is owed protocol fees. The reward accounting is the risky part: rewards
//! accrue through a `reward_per_token_scaled` accumulator on ProtocolConfig, and
//! each staker's entitlement is the difference between that accumulator and
//! their own `reward_debt_scaled` watermark. Get the watermark wrong on either
//! side and a staker can either claim rewards accrued before they staked (paying
//! them other people's money), or silently lose rewards they earned.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::REWARD_SCALE;
use lynx_project::state::{ProtocolConfig, RewardsVault, StakePosition};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{Instruction, InstructionError},
    native_token::LAMPORTS_PER_SOL,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    system_program,
    transaction::{Transaction, TransactionError},
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

fn program_account(data: Vec<u8>, extra_lamports: u64) -> Account {
    Account {
        lamports: Rent::default().minimum_balance(data.len()) + extra_lamports,
        data,
        owner: program_id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn spl_token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: spl_token::state::AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    }
    .pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}

fn spl_mint(authority: Pubkey, supply: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: COption::Some(authority),
        supply,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    }
    .pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}

fn token_amount(a: &Account) -> u64 {
    spl_token::state::Account::unpack(&a.data).unwrap().amount
}

const MICRO: u64 = 1_000_000; // 1 LYNX

/// Anchor error codes start at 6000; InvalidAmount is the 2nd LynxError variant
/// (index 1). claim_staking_rewards raises it via `require!(amount > 0, ..)`
/// when there is nothing accrued to pay out.
const LYNX_ERROR_INVALID_AMOUNT: u32 = 6001;

fn config_pda() -> (Pubkey, u8) { Pubkey::find_program_address(&[b"config"], &program_id()) }
fn rewards_vault_pda() -> (Pubkey, u8) { Pubkey::find_program_address(&[b"rewards_vault"], &program_id()) }
fn stake_pda(owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"stake", owner.as_ref()], &program_id())
}

/// Pubkeys split out of Fixture so the instruction builders can borrow them
/// while `ctx` is mutably borrowed to send a transaction.
#[derive(Clone, Copy)]
struct Keys {
    lynx_mint: Pubkey,
    stake_vault: Pubkey,
    config: Pubkey,
    rewards_vault: Pubkey,
}

struct Fixture {
    ctx: ProgramTestContext,
    keys: Keys,
}

/// Builds a protocol with `total_staked` / `reward_per_token_scaled` preset, so a
/// test can place a staker into a protocol that has *already* accrued rewards.
async fn setup(total_staked: u64, reward_per_token_scaled: u128, rewards_lamports: u64) -> Fixture {
    let pid = program_id();
    let (config, config_bump) = config_pda();
    let (rewards_vault, rv_bump) = rewards_vault_pda();
    let lynx_mint = Pubkey::new_unique();
    let stake_vault = Pubkey::new_unique();

    let cfg = ProtocolConfig {
        admin: Pubkey::new_unique(),
        treasury: Pubkey::new_unique(),
        lynx_mint,
        stake_vault,
        rewards_vault,
        total_lynx_supply: 1_000_000 * MICRO,
        total_lynx_burned: 0,
        total_staked,
        reward_per_token_scaled,
        bump: config_bump,
        rewards_vault_bump: rv_bump,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: u64::MAX,
    };

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config, program_account(account_bytes(&cfg), 0));
    pt.add_account(rewards_vault, program_account(account_bytes(&RewardsVault { bump: rv_bump }), rewards_lamports));
    pt.add_account(lynx_mint, spl_mint(config, 1_000_000 * MICRO));
    pt.add_account(stake_vault, spl_token_account(lynx_mint, config, total_staked));

    Fixture {
        ctx: pt.start_with_context().await,
        keys: Keys { lynx_mint, stake_vault, config, rewards_vault },
    }
}

async fn send(
    ctx: &mut ProgramTestContext,
    ix: Instruction,
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut all: Vec<&Keypair> = vec![&payer];
    all.extend_from_slice(signers);
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&all, blockhash);
    ctx.banks_client.process_transaction(tx).await
}

fn stake_ix(f: &Keys, owner: &Pubkey, user_lynx: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::StakeLynx {
            config: f.config,
            stake_vault: f.stake_vault,
            stake_position: stake_pda(owner).0,
            user_lynx_account: user_lynx,
            lynx_mint: f.lynx_mint,
            owner: *owner,
            token_program: spl_token::id(),
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::StakeLynx { amount }.data(),
    }
}

fn unstake_ix(f: &Keys, owner: &Pubkey, user_lynx: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::UnstakeLynx {
            config: f.config,
            stake_vault: f.stake_vault,
            stake_position: stake_pda(owner).0,
            user_lynx_account: user_lynx,
            lynx_mint: f.lynx_mint,
            owner: *owner,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::UnstakeLynx { amount }.data(),
    }
}

fn claim_ix(f: &Keys, owner: &Pubkey) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::ClaimStakingRewards {
            config: f.config,
            rewards_vault: f.rewards_vault,
            stake_position: stake_pda(owner).0,
            owner: *owner,
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ClaimStakingRewards {}.data(),
    }
}

async fn read_stake(ctx: &mut ProgramTestContext, owner: &Pubkey) -> StakePosition {
    let acct = ctx.banks_client.get_account(stake_pda(owner).0).await.unwrap().unwrap();
    StakePosition::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

#[tokio::test]
async fn stake_moves_tokens_into_the_vault_and_records_the_position() {
    let staker = Keypair::new();
    let mut f = setup(0, 0, 0).await;
    let user_lynx = Pubkey::new_unique();
    f.ctx.set_account(&user_lynx, &spl_token_account(f.keys.lynx_mint, staker.pubkey(), 100 * MICRO).into());
    f.ctx.set_account(
        &staker.pubkey(),
        &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into(),
    );

    send(&mut f.ctx, stake_ix(&f.keys, &staker.pubkey(), user_lynx, 40 * MICRO), &[&staker])
        .await
        .expect("stake should succeed");

    let pos = read_stake(&mut f.ctx, &staker.pubkey()).await;
    assert_eq!(pos.amount, 40 * MICRO, "position records the staked amount");
    assert_eq!(pos.owner, staker.pubkey());

    let vault = f.ctx.banks_client.get_account(f.keys.stake_vault).await.unwrap().unwrap();
    assert_eq!(token_amount(&vault), 40 * MICRO, "tokens actually moved into the stake vault");

    let user = f.ctx.banks_client.get_account(user_lynx).await.unwrap().unwrap();
    assert_eq!(token_amount(&user), 60 * MICRO, "and left the staker's account");
}

/// The core accounting property: a staker who joins a protocol that has already
/// accrued rewards must NOT be able to claim any of them. Their reward_debt
/// watermark has to be set to the current accumulator at stake time — otherwise
/// they'd claim rewards funded by fees earned before they staked, i.e. take
/// money from the stakers who were actually there.
#[tokio::test]
async fn a_new_staker_cannot_claim_rewards_accrued_before_they_staked() {
    let staker = Keypair::new();
    // Protocol already has 100 LYNX staked and a non-zero accumulator.
    let existing_accumulator: u128 = REWARD_SCALE / 10; // 0.1 lamports per micro-LYNX
    let mut f = setup(100 * MICRO, existing_accumulator, 10 * LAMPORTS_PER_SOL).await;

    let user_lynx = Pubkey::new_unique();
    f.ctx.set_account(&user_lynx, &spl_token_account(f.keys.lynx_mint, staker.pubkey(), 100 * MICRO).into());
    f.ctx.set_account(
        &staker.pubkey(),
        &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into(),
    );

    send(&mut f.ctx, stake_ix(&f.keys, &staker.pubkey(), user_lynx, 50 * MICRO), &[&staker])
        .await
        .expect("stake should succeed");

    let pos = read_stake(&mut f.ctx, &staker.pubkey()).await;
    // The watermark must equal amount * current accumulator — i.e. "you are owed
    // nothing yet", not zero (which would mean "you are owed everything so far").
    assert_eq!(
        pos.reward_debt_scaled,
        (50 * MICRO) as u128 * existing_accumulator,
        "a fresh stake must start with its debt at the current accumulator"
    );
    assert_eq!(pos.pending_rewards, 0, "and with no pending rewards");

    // Claiming immediately must fail: there is nothing owed.
    let err = send(&mut f.ctx, claim_ix(&f.keys, &staker.pubkey()), &[&staker]).await.unwrap_err();
    match err {
        BanksClientError::TransactionError(TransactionError::InstructionError(_, InstructionError::Custom(_))) => {}
        other => panic!("expected a program error claiming zero rewards, got {other:?}"),
    }
}

#[tokio::test]
async fn unstake_returns_tokens_and_cannot_withdraw_more_than_staked() {
    let staker = Keypair::new();
    let mut f = setup(0, 0, 0).await;
    let user_lynx = Pubkey::new_unique();
    f.ctx.set_account(&user_lynx, &spl_token_account(f.keys.lynx_mint, staker.pubkey(), 100 * MICRO).into());
    f.ctx.set_account(
        &staker.pubkey(),
        &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into(),
    );

    send(&mut f.ctx, stake_ix(&f.keys, &staker.pubkey(), user_lynx, 100 * MICRO), &[&staker]).await.unwrap();

    send(&mut f.ctx, unstake_ix(&f.keys, &staker.pubkey(), user_lynx, 30 * MICRO), &[&staker])
        .await
        .expect("partial unstake should succeed");

    let pos = read_stake(&mut f.ctx, &staker.pubkey()).await;
    assert_eq!(pos.amount, 70 * MICRO);
    let user = f.ctx.banks_client.get_account(user_lynx).await.unwrap().unwrap();
    assert_eq!(token_amount(&user), 30 * MICRO, "unstaked tokens came back");

    // Over-withdrawing must be rejected — otherwise the vault could be drained
    // past what this position ever contributed.
    let err = send(&mut f.ctx, unstake_ix(&f.keys, &staker.pubkey(), user_lynx, 999 * MICRO), &[&staker])
        .await
        .unwrap_err();
    match err {
        BanksClientError::TransactionError(TransactionError::InstructionError(_, InstructionError::Custom(_))) => {}
        other => panic!("expected InsufficientFunds, got {other:?}"),
    }
}

/// Rewards must be paid once. Claiming twice in a row must not pay twice.
#[tokio::test]
async fn rewards_cannot_be_claimed_twice() {
    let staker = Keypair::new();
    let accumulator: u128 = REWARD_SCALE / 100;
    let mut f = setup(0, 0, 10 * LAMPORTS_PER_SOL).await;

    let user_lynx = Pubkey::new_unique();
    f.ctx.set_account(&user_lynx, &spl_token_account(f.keys.lynx_mint, staker.pubkey(), 100 * MICRO).into());
    f.ctx.set_account(
        &staker.pubkey(),
        &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into(),
    );

    // Stake while the accumulator is 0, so later accrual is genuinely theirs.
    send(&mut f.ctx, stake_ix(&f.keys, &staker.pubkey(), user_lynx, 100 * MICRO), &[&staker]).await.unwrap();

    // Simulate fees accruing: bump the accumulator on config.
    let mut cfg_acct = f.ctx.banks_client.get_account(f.keys.config).await.unwrap().unwrap();
    let mut cfg = ProtocolConfig::try_deserialize(&mut cfg_acct.data.as_slice()).unwrap();
    cfg.reward_per_token_scaled = accumulator;
    cfg_acct.data = account_bytes(&cfg);
    f.ctx.set_account(&f.keys.config, &cfg_acct.into());

    let before = f.ctx.banks_client.get_balance(staker.pubkey()).await.unwrap();
    send(&mut f.ctx, claim_ix(&f.keys, &staker.pubkey()), &[&staker]).await.expect("first claim should pay");
    let after_first = f.ctx.banks_client.get_balance(staker.pubkey()).await.unwrap();
    let paid = after_first - before;
    assert!(paid > 0, "the staker must actually be paid their accrued rewards");

    // Send the second claim with a DIFFERENT fee payer.
    //
    // Repeating the first claim verbatim produces a byte-identical transaction:
    // same instruction, same signers, same blockhash. The runtime dedupes it by
    // signature and it never reaches the program, so this test was flaky — it
    // failed when the dedupe surfaced as Ok, and when it "passed" it was usually
    // passing for the wrong reason, since a duplicate rejection is
    // indistinguishable from a program rejection.
    //
    // Changing the fee payer changes the message, hence the signature, so the
    // instruction genuinely executes. (get_new_latest_blockhash() is not enough:
    // with no block produced in between it can return the same hash. And
    // warp_to_slot cannot be used here — it verifies the accounts hash, which
    // the set_account calls above legitimately invalidate.)
    let second_payer = Keypair::new();
    f.ctx.set_account(
        &second_payer.pubkey(),
        &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into(),
    );
    let blockhash = f.ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(
        &[claim_ix(&f.keys, &staker.pubkey())],
        Some(&second_payer.pubkey()),
    );
    tx.sign(&[&second_payer, &staker], blockhash);
    let err = f.ctx.banks_client.process_transaction(tx).await.unwrap_err();

    match err {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => assert_eq!(
            code, LYNX_ERROR_INVALID_AMOUNT,
            "a repeat claim must be refused by the program's zero-rewards check, \
             not incidentally by transaction dedup"
        ),
        other => panic!("expected Custom({LYNX_ERROR_INVALID_AMOUNT}) on the second claim, got {other:?}"),
    }
    let after_second = f.ctx.banks_client.get_balance(staker.pubkey()).await.unwrap();
    assert_eq!(after_second, after_first, "a repeated claim must not pay twice");
}

/// A staker must not be able to claim using someone else's stake position.
#[tokio::test]
async fn cannot_claim_rewards_from_another_stakers_position() {
    let victim = Keypair::new();
    let attacker = Keypair::new();
    let mut f = setup(0, 0, 10 * LAMPORTS_PER_SOL).await;

    let victim_lynx = Pubkey::new_unique();
    f.ctx.set_account(&victim_lynx, &spl_token_account(f.keys.lynx_mint, victim.pubkey(), 100 * MICRO).into());
    for kp in [&victim, &attacker] {
        f.ctx.set_account(
            &kp.pubkey(),
            &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }.into(),
        );
    }
    send(&mut f.ctx, stake_ix(&f.keys, &victim.pubkey(), victim_lynx, 100 * MICRO), &[&victim]).await.unwrap();

    // Attacker signs, but points at the victim's stake position PDA.
    let ix = Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::ClaimStakingRewards {
            config: f.keys.config,
            rewards_vault: f.keys.rewards_vault,
            stake_position: stake_pda(&victim.pubkey()).0,
            owner: attacker.pubkey(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ClaimStakingRewards {}.data(),
    };
    assert!(
        send(&mut f.ctx, ix, &[&attacker]).await.is_err(),
        "claiming against another staker's position must be rejected"
    );
}
