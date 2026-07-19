//! Integration coverage for the LYNX (SPL-token) money paths, which had no
//! runtime coverage at all.
//!
//! These instructions matter for two independent reasons:
//!
//!  1. `claim_market_lynx` carried the same u64 overflow as `claim_market_sol`
//!     (C-02): `payout_pool * position.amount` computed in u64 overflows for any
//!     meaningful pool, permanently locking LYNX winners out of their payout.
//!
//!  2. The SBF linker reports `ClaimMarketLynx::try_accounts` as exceeding the
//!     4096-byte BPF stack frame by 72 bytes ("may cause undefined behavior
//!     during execution"). Static analysis cannot tell whether that warning is
//!     latent or fatal — only running the real bytecode can. These tests execute
//!     the compiled .so, so a genuine stack fault would surface here.

use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::state::{Currency, Market, MarketStatus, Outcome, ProtocolConfig, UserPosition};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
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

fn spl_token_account(mint: Pubkey, token_owner: Pubkey, amount: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint,
        owner: token_owner,
        amount,
        delegate: COption::None,
        state: spl_token::state::AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    }
    .pack_into_slice(&mut data);
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn spl_mint(mint_authority: Pubkey, supply: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: COption::Some(mint_authority),
        supply,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    }
    .pack_into_slice(&mut data);
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn token_balance(account: &Account) -> u64 {
    spl_token::state::Account::unpack(&account.data).unwrap().amount
}

/// A 20,000 LYNX pool (20e9 micro-LYNX). Mirrors the SOL C-02 scenario: the
/// intermediate `payout_pool * position.amount` is 1.8e20, past u64::MAX.
const POOL_TOTAL: u64 = 20_000_000_000;
const WINNING_TOTAL: u64 = 10_000_000_000;
const EXPECTED_PAYOUT: u64 = 18_000_000_000; // 90% of pool, sole winner
const EXPECTED_FEE: u64 = 2_000_000_000; // remaining 10% to treasury

#[tokio::test]
async fn lynx_winner_is_paid_and_treasury_takes_its_fee() {
    let pid = program_id();
    let treasury_owner = Keypair::new();
    let claimant = Keypair::new();

    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"config"], &pid);
    let lynx_mint = Pubkey::new_unique();

    let market_id: u64 = 99;
    let (market_pda, market_bump) =
        Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid);
    let (lynx_vault_pda, lynx_vault_bump) =
        Pubkey::find_program_address(&[b"lynx_vault", market_pda.as_ref()], &pid);

    let config = ProtocolConfig {
        admin: Pubkey::new_unique(),
        treasury: treasury_owner.pubkey(),
        lynx_mint,
        stake_vault: Pubkey::new_unique(),
        rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: POOL_TOTAL,
        total_lynx_burned: 0,
        total_staked: 0,
        reward_per_token_scaled: 0,
        bump: config_bump,
        rewards_vault_bump: 0,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: u64::MAX,
    };

    let market = Market {
        id: market_id,
        admin: Pubkey::new_unique(),
        vault: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        title: "LYNX market".to_string(),
        currency: Currency::LYNX,
        status: MarketStatus::Resolved,
        is_ternary: false,
        cutoff_ts: 0,
        resolve_ts: 0,
        oracle_deadline: 0,
        resolved_ts: 1,
        result: Outcome::Yes,
        pool_total: POOL_TOTAL,
        yes_total: WINNING_TOTAL,
        no_total: POOL_TOTAL - WINNING_TOTAL,
        draw_total: 0,
        winning_total: WINNING_TOTAL,
        burned_lynx: 0,
        bump: market_bump,
        vault_bump: 0,
        lynx_vault_bump,
        mint_ratio_bps: 0,
        swept: false,
        proposed_result: Outcome::Yes,
        proposed_ts: 1,
        mint_ratio_snapshot_bps: 0,
        total_claimed: 0,
        resolved_by: Pubkey::new_unique(),
    };

    let position = UserPosition {
        market: market_pda,
        owner: claimant.pubkey(),
        outcome: Outcome::Yes,
        amount: WINNING_TOTAL, // sole winner
        claimed: false,
        lynx_minted: false,
        bump: 0,
    };
    let position_pubkey = Pubkey::new_unique();
    let claimant_lynx = Pubkey::new_unique();
    let treasury_lynx = Pubkey::new_unique();

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config_pda, program_account(account_bytes(&config)));
    pt.add_account(market_pda, program_account(account_bytes(&market)));
    pt.add_account(position_pubkey, program_account(account_bytes(&position)));
    pt.add_account(lynx_mint, spl_mint(config_pda, POOL_TOTAL));
    // The market's LYNX vault holds the whole pool; its SPL authority is the
    // config PDA, which is what signs the payout transfers.
    pt.add_account(lynx_vault_pda, spl_token_account(lynx_mint, config_pda, POOL_TOTAL));
    pt.add_account(claimant_lynx, spl_token_account(lynx_mint, claimant.pubkey(), 0));
    pt.add_account(treasury_lynx, spl_token_account(lynx_mint, treasury_owner.pubkey(), 0));

    let ctx = pt.start_with_context().await;

    let ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ClaimMarketLynx {
            config: config_pda,
            market: market_pda,
            position: position_pubkey,
            market_lynx_vault: lynx_vault_pda,
            claimant_lynx_account: claimant_lynx,
            treasury_lynx_account: treasury_lynx,
            claimant: claimant.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ClaimMarketLynx {}.data(),
    };

    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &claimant], blockhash);

    // Pre-C-02-fix this reverts with MathOverflow. A real BPF stack fault from
    // the +72-byte try_accounts frame would also surface here.
    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("LYNX winner must be able to claim a 20,000 LYNX market");

    let claimant_account = ctx.banks_client.get_account(claimant_lynx).await.unwrap().unwrap();
    let treasury_account = ctx.banks_client.get_account(treasury_lynx).await.unwrap().unwrap();
    let vault_account = ctx.banks_client.get_account(lynx_vault_pda).await.unwrap().unwrap();

    assert_eq!(token_balance(&claimant_account), EXPECTED_PAYOUT, "winner receives 90% of the pool");
    assert_eq!(token_balance(&treasury_account), EXPECTED_FEE, "treasury receives the 10% protocol fee");
    // Winner + treasury must exactly drain the pool: no tokens minted from thin
    // air, none stranded in the vault.
    assert_eq!(token_balance(&vault_account), 0, "vault must be fully distributed, conserving supply");

    let refreshed = ctx.banks_client.get_account(position_pubkey).await.unwrap().unwrap();
    let pos = {
        use anchor_lang::AccountDeserialize;
        UserPosition::try_deserialize(&mut refreshed.data.as_slice()).unwrap()
    };
    assert!(pos.claimed, "position must be marked claimed");
}

/// A losing position must never be paid, regardless of pool size.
#[tokio::test]
async fn lynx_loser_cannot_claim() {
    let pid = program_id();
    let treasury_owner = Keypair::new();
    let loser = Keypair::new();

    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"config"], &pid);
    let lynx_mint = Pubkey::new_unique();
    let market_id: u64 = 100;
    let (market_pda, market_bump) =
        Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid);
    let (lynx_vault_pda, lynx_vault_bump) =
        Pubkey::find_program_address(&[b"lynx_vault", market_pda.as_ref()], &pid);

    let config = ProtocolConfig {
        admin: Pubkey::new_unique(),
        treasury: treasury_owner.pubkey(),
        lynx_mint,
        stake_vault: Pubkey::new_unique(),
        rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: POOL_TOTAL,
        total_lynx_burned: 0,
        total_staked: 0,
        reward_per_token_scaled: 0,
        bump: config_bump,
        rewards_vault_bump: 0,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: u64::MAX,
    };

    let market = Market {
        id: market_id,
        admin: Pubkey::new_unique(),
        vault: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        title: "LYNX market".to_string(),
        currency: Currency::LYNX,
        status: MarketStatus::Resolved,
        is_ternary: false,
        cutoff_ts: 0,
        resolve_ts: 0,
        oracle_deadline: 0,
        resolved_ts: 1,
        result: Outcome::Yes, // YES wins…
        pool_total: POOL_TOTAL,
        yes_total: WINNING_TOTAL,
        no_total: POOL_TOTAL - WINNING_TOTAL,
        draw_total: 0,
        winning_total: WINNING_TOTAL,
        burned_lynx: 0,
        bump: market_bump,
        vault_bump: 0,
        lynx_vault_bump,
        mint_ratio_bps: 0,
        swept: false,
        proposed_result: Outcome::Yes,
        proposed_ts: 1,
        mint_ratio_snapshot_bps: 0,
        total_claimed: 0,
        resolved_by: Pubkey::new_unique(),
    };

    let position = UserPosition {
        market: market_pda,
        owner: loser.pubkey(),
        outcome: Outcome::No, // …but this position backed NO
        amount: POOL_TOTAL - WINNING_TOTAL,
        claimed: false,
        lynx_minted: false,
        bump: 0,
    };
    let position_pubkey = Pubkey::new_unique();
    let loser_lynx = Pubkey::new_unique();
    let treasury_lynx = Pubkey::new_unique();

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config_pda, program_account(account_bytes(&config)));
    pt.add_account(market_pda, program_account(account_bytes(&market)));
    pt.add_account(position_pubkey, program_account(account_bytes(&position)));
    pt.add_account(lynx_mint, spl_mint(config_pda, POOL_TOTAL));
    pt.add_account(lynx_vault_pda, spl_token_account(lynx_mint, config_pda, POOL_TOTAL));
    pt.add_account(loser_lynx, spl_token_account(lynx_mint, loser.pubkey(), 0));
    pt.add_account(treasury_lynx, spl_token_account(lynx_mint, treasury_owner.pubkey(), 0));

    let ctx = pt.start_with_context().await;

    let ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ClaimMarketLynx {
            config: config_pda,
            market: market_pda,
            position: position_pubkey,
            market_lynx_vault: lynx_vault_pda,
            claimant_lynx_account: loser_lynx,
            treasury_lynx_account: treasury_lynx,
            claimant: loser.pubkey(),
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ClaimMarketLynx {}.data(),
    };

    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &loser], blockhash);

    assert!(
        ctx.banks_client.process_transaction(tx).await.is_err(),
        "a losing position must never be paid out"
    );
    let loser_account = ctx.banks_client.get_account(loser_lynx).await.unwrap().unwrap();
    assert_eq!(token_balance(&loser_account), 0, "loser balance must stay at zero");
}
