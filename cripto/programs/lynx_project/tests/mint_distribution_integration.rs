//! Integration coverage for mint_lynx_distribution — the LYNX participation
//! emission that every participant of a resolved SOL market claims for their own
//! position. It mints new LYNX (30% to the participant, 60% to the order-book
//! account, 10% base to treasury) prorated by the position's share of the pool,
//! and routes the rounding remainder ("dust") to treasury so the minted total is
//! exact. Driven against the REAL compiled program via BanksClient.
//!
//! Two cases: a sole participant (position == whole pool, the clean split) and a
//! fractional participant (a 20% position), which pins down that only true
//! rounding dust — not a whole participant's un-emitted share — reaches treasury.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::state::{Currency, Market, MarketStatus, Outcome, ProtocolConfig, UserPosition};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account, instruction::Instruction, native_token::LAMPORTS_PER_SOL,
    program_option::COption, program_pack::Pack, pubkey::Pubkey, rent::Rent,
    signature::{Keypair, Signer}, transaction::Transaction,
};
use std::str::FromStr;

fn pid() -> Pubkey { Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap() }
fn bytes<T: AccountSerialize>(s: &T) -> Vec<u8> { let mut d = Vec::new(); s.try_serialize(&mut d).unwrap(); d }
fn racct(data: Vec<u8>) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: pid(), executable: false, rent_epoch: 0 }
}
fn spl_token_account(mint: Pubkey, owner: Pubkey) -> Account {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint, owner, amount: 0, delegate: COption::None,
        state: spl_token::state::AccountState::Initialized, is_native: COption::None,
        delegated_amount: 0, close_authority: COption::None,
    }.pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}
fn spl_mint(authority: Pubkey) -> Account {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: COption::Some(authority), supply: 0, decimals: 6,
        is_initialized: true, freeze_authority: COption::None,
    }.pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}
fn token_amount(a: &Account) -> u64 { spl_token::state::Account::unpack(&a.data).unwrap().amount }
fn mint_supply(a: &Account) -> u64 { spl_token::state::Mint::unpack(&a.data).unwrap().supply }

/// Runs mint_lynx_distribution for a single position and returns
/// (holder, treasury, initial_sale, config.total_lynx_supply, mint.supply).
async fn run_distribution(pool_total: u64, position_amount: u64) -> (u64, u64, u64, u64, u64) {
    let market_id: u64 = 1;
    let holder = Keypair::new();
    let treasury_owner = Pubkey::new_unique();
    let lynx_mint = Pubkey::new_unique();

    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());
    let (position_pda, _) = Pubkey::find_program_address(
        &[b"position", market_pda.as_ref(), holder.pubkey().as_ref(), &[Outcome::Yes.as_seed()]], &pid());

    let config = ProtocolConfig {
        admin: Pubkey::new_unique(), treasury: treasury_owner, lynx_mint,
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump: cb, rewards_vault_bump: 0, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    };
    // Resolved SOL market, mint ratio frozen at 100% (10000 bps) so the emitted
    // total is exactly pool_total / LAMPORTS_TO_MICRO_LYNX_DENOMINATOR.
    let market = Market {
        id: market_id, admin: Pubkey::new_unique(), vault: Pubkey::new_unique(), oracle_authority: Pubkey::new_unique(),
        title: "sol market".into(), currency: Currency::SOL, status: MarketStatus::Resolved, is_ternary: false,
        cutoff_ts: 0, resolve_ts: 0, oracle_deadline: 0, resolved_ts: 1, result: Outcome::Yes,
        pool_total, yes_total: position_amount, no_total: pool_total - position_amount, draw_total: 0,
        winning_total: position_amount, burned_lynx: 0, bump: mb, vault_bump: 0, lynx_vault_bump: 0,
        mint_ratio_bps: 10_000, swept: false, proposed_result: Outcome::Yes, proposed_ts: 1,
        mint_ratio_snapshot_bps: 0, total_claimed: 0, resolved_by: Pubkey::new_unique(),
    };
    let position = UserPosition {
        market: market_pda, owner: holder.pubkey(), outcome: Outcome::Yes,
        amount: position_amount, claimed: false, lynx_minted: false, bump: 0,
    };
    let holder_lynx = Pubkey::new_unique();
    let treasury_lynx = Pubkey::new_unique();
    let sale_lynx = Pubkey::new_unique();

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config)));
    pt.add_account(market_pda, racct(bytes(&market)));
    pt.add_account(position_pda, racct(bytes(&position)));
    pt.add_account(lynx_mint, spl_mint(config_pda));
    pt.add_account(holder_lynx, spl_token_account(lynx_mint, holder.pubkey()));
    pt.add_account(treasury_lynx, spl_token_account(lynx_mint, treasury_owner));
    pt.add_account(sale_lynx, spl_token_account(lynx_mint, treasury_owner));
    let mut ctx = pt.start_with_context().await;
    ctx.set_account(&holder.pubkey(), &Account {
        lamports: LAMPORTS_PER_SOL, data: vec![], owner: solana_sdk::system_program::id(), executable: false, rent_epoch: 0,
    }.into());

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::MintLynxDistribution {
            config: config_pda, market: market_pda, position: position_pda, lynx_mint,
            holder_lynx_account: holder_lynx, treasury_lynx_account: treasury_lynx,
            initial_sale_lynx_account: sale_lynx, payer: holder.pubkey(), token_program: spl_token::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::MintLynxDistribution {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &holder], bh);
    ctx.banks_client.process_transaction(tx).await.expect("participant must be able to mint their LYNX distribution");

    let cfg = ProtocolConfig::try_deserialize(&mut ctx.banks_client.get_account(config_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    let pos = UserPosition::try_deserialize(&mut ctx.banks_client.get_account(position_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(pos.lynx_minted, "position must be flagged so it cannot mint twice");
    (
        token_amount(&ctx.banks_client.get_account(holder_lynx).await.unwrap().unwrap()),
        token_amount(&ctx.banks_client.get_account(treasury_lynx).await.unwrap().unwrap()),
        token_amount(&ctx.banks_client.get_account(sale_lynx).await.unwrap().unwrap()),
        cfg.total_lynx_supply,
        mint_supply(&ctx.banks_client.get_account(lynx_mint).await.unwrap().unwrap()),
    )
}

#[tokio::test]
async fn sole_participant_gets_the_full_30_60_10_split() {
    // pool = 10 SOL, this position IS the whole pool. base = pool/1000 = 10_000_000
    // micro-LYNX; ratio 100% -> total emission 10_000_000.
    let (holder, treasury, sale, supply, mint) = run_distribution(10 * LAMPORTS_PER_SOL, 10 * LAMPORTS_PER_SOL).await;
    assert_eq!(holder, 3_000_000, "participant gets 30%");
    assert_eq!(sale, 6_000_000, "order-book account gets 60%");
    assert_eq!(treasury, 1_000_000, "treasury gets its 10% share (no dust: splits evenly)");
    assert_eq!(supply, 10_000_000, "config supply grows by exactly the emission");
    assert_eq!(mint, 10_000_000, "mint supply grows by exactly the emission");
}

#[tokio::test]
async fn fractional_participant_only_mints_its_own_prorated_share() {
    // pool = 10 SOL, this position is 20% of it. The position's emission is 20% of
    // the 10_000_000 total = 2_000_000; split 30/60/10 that's 600_000 / 1_200_000 / 200_000,
    // all three exact, so there is no rounding dust and NOTHING beyond this position's own
    // share is minted. (A proration that measured dust against the whole-pool
    // emission would over-mint the other 80% to treasury.)
    let (holder, treasury, sale, supply, mint) = run_distribution(10 * LAMPORTS_PER_SOL, 2 * LAMPORTS_PER_SOL).await;
    assert_eq!(holder, 600_000, "participant gets 30% of its own 20% share");
    assert_eq!(sale, 1_200_000, "order-book account gets 60% of its own 20% share");
    assert_eq!(treasury, 200_000, "treasury gets its 10% share plus any true rounding dust, not the un-emitted remainder");
    assert_eq!(supply, 2_000_000, "config supply grows only by this position's prorated emission");
    assert_eq!(mint, 2_000_000, "mint supply grows only by this position's prorated emission");
}
