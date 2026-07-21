//! Integration coverage for the LYNX (SPL-token) prediction limit-order paths,
//! the token mirror of prediction_order_integration.rs (which covers the SOL
//! side). These fill/refund real LYNX out of a per-order escrow whose authority
//! is the order PDA itself, and the fill additionally BURNS a slice of the order
//! (LYNX_EVENT_BURN_BPS) before crediting the market vault — logic that does not
//! exist on the SOL path, so it needs its own runtime proof. Driven against the
//! REAL compiled program via BanksClient.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::LYNX_EVENT_BURN_BPS;
use lynx_project::state::{
    Currency, Market, MarketStatus, Outcome, PredictionOrder, PredictionOrderStatus,
    ProtocolConfig, UserPosition,
};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account, instruction::Instruction, program_option::COption, program_pack::Pack,
    pubkey::Pubkey, rent::Rent, signature::{Keypair, Signer}, system_program,
    transaction::Transaction,
};
use std::str::FromStr;

fn pid() -> Pubkey { Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap() }
fn bytes<T: AccountSerialize>(s: &T) -> Vec<u8> { let mut d = Vec::new(); s.try_serialize(&mut d).unwrap(); d }
fn racct(data: Vec<u8>) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: pid(), executable: false, rent_epoch: 0 }
}
fn spl_token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint, owner, amount, delegate: COption::None,
        state: spl_token::state::AccountState::Initialized, is_native: COption::None,
        delegated_amount: 0, close_authority: COption::None,
    }.pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}
fn spl_mint(authority: Pubkey, supply: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: COption::Some(authority), supply, decimals: 6,
        is_initialized: true, freeze_authority: COption::None,
    }.pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}
fn token_amount(a: &Account) -> u64 { spl_token::state::Account::unpack(&a.data).unwrap().amount }
fn mint_supply(a: &Account) -> u64 { spl_token::state::Mint::unpack(&a.data).unwrap().supply }

fn config_with(lynx_mint: Pubkey, bump: u8) -> ProtocolConfig {
    ProtocolConfig {
        admin: Pubkey::new_unique(), treasury: Pubkey::new_unique(), lynx_mint,
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump, rewards_vault_bump: 0, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    }
}
#[allow(clippy::too_many_arguments)]
fn lynx_market(id: u64, bump: u8, lynx_vault_bump: u8, pool: u64, yes: u64, no: u64) -> Market {
    Market {
        id, admin: Pubkey::new_unique(), vault: Pubkey::new_unique(), oracle_authority: Pubkey::new_unique(),
        title: "lynx limit market".into(), currency: Currency::LYNX, status: MarketStatus::Active,
        is_ternary: false, cutoff_ts: i64::MAX, resolve_ts: i64::MAX, oracle_deadline: i64::MAX,
        resolved_ts: 0, result: Outcome::Unresolved, pool_total: pool, yes_total: yes, no_total: no,
        draw_total: 0, winning_total: 0, burned_lynx: 0, bump, vault_bump: 0, lynx_vault_bump,
        mint_ratio_bps: 0, swept: false, proposed_result: Outcome::Unresolved, proposed_ts: 0,
        mint_ratio_snapshot_bps: 0, total_claimed: 0, resolved_by: Pubkey::default(),
    }
}
fn open_order(id: u64, owner: Pubkey, market: Pubkey, amount: u64, order_bump: u8, escrow_bump: u8) -> PredictionOrder {
    PredictionOrder {
        id, owner, market, outcome: Outcome::No, amount, limit_price_bps: 5000,
        status: PredictionOrderStatus::Open, created_ts: 0, expires_ts: i64::MAX,
        bump: order_bump, escrow_bump,
    }
}

/// The keeper fills an in-the-money LYNX order: LYNX_EVENT_BURN_BPS of the order
/// is burned (mint supply drops, market.burned_lynx / config.total_lynx_burned
/// grow), the net is moved from the order escrow into the market LYNX vault, the
/// NO side of the pool grows by the net, and the order owner (not the keeper)
/// receives the position.
#[tokio::test]
async fn keeper_fills_a_lynx_limit_order_and_burns_its_slice() {
    let market_id: u64 = 1;
    let owner = Keypair::new();
    let keeper = Keypair::new();
    let order_id: u64 = 7;
    let gross = 1_000_000_000u64; // 1,000 LYNX (micro)
    let burn = gross * LYNX_EVENT_BURN_BPS / 10_000; // 15%
    let net = gross - burn;

    let lynx_mint = Pubkey::new_unique();
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());
    let (lynx_vault_pda, lvb) = Pubkey::find_program_address(&[b"lynx_vault", market_pda.as_ref()], &pid());
    let (order_pda, ob) = Pubkey::find_program_address(
        &[b"pred_order", market_pda.as_ref(), owner.pubkey().as_ref(), &order_id.to_le_bytes()], &pid());
    let (escrow_pda, eb) = Pubkey::find_program_address(&[b"pred_order_escrow_lynx", order_pda.as_ref()], &pid());
    let (position_pda, _) = Pubkey::find_program_address(
        &[b"position", market_pda.as_ref(), owner.pubkey().as_ref(), &[Outcome::No.as_seed()]], &pid());

    // Pool all on YES so NO's implied price is 0 < the 5000 bps limit -> fillable.
    let market = lynx_market(market_id, mb, lvb, 10 * gross, 10 * gross, 0);
    let order = open_order(order_id, owner.pubkey(), market_pda, gross, ob, eb);

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_with(lynx_mint, cb))));
    pt.add_account(market_pda, racct(bytes(&market)));
    pt.add_account(order_pda, racct(bytes(&order)));
    pt.add_account(lynx_mint, spl_mint(config_pda, gross));
    // Escrow holds the whole order, authority = the order PDA (only the fill/cancel
    // instructions, signing with the order seeds, can move it).
    pt.add_account(escrow_pda, spl_token_account(lynx_mint, order_pda, gross));
    pt.add_account(lynx_vault_pda, spl_token_account(lynx_mint, config_pda, 0));
    let mut ctx = pt.start_with_context().await;
    ctx.set_account(&keeper.pubkey(), &Account {
        lamports: 5 * solana_sdk::native_token::LAMPORTS_PER_SOL, data: vec![],
        owner: system_program::id(), executable: false, rent_epoch: 0,
    }.into());

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ExecutePredictionLimitOrderLynx {
            config: config_pda, market: market_pda, order: order_pda, escrow: escrow_pda,
            lynx_mint, market_lynx_vault: lynx_vault_pda, position: position_pda,
            payer: keeper.pubkey(), token_program: spl_token::id(), system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::ExecutePredictionLimitOrderLynx {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &keeper], bh);
    ctx.banks_client.process_transaction(tx).await.expect("keeper must fill an in-the-money LYNX order");

    // The burn slice actually left circulation.
    let m = mint_supply(&ctx.banks_client.get_account(lynx_mint).await.unwrap().unwrap());
    assert_eq!(m, gross - burn, "mint supply must drop by the burned slice");
    // The net landed in the market's LYNX vault; the escrow is drained.
    assert_eq!(token_amount(&ctx.banks_client.get_account(lynx_vault_pda).await.unwrap().unwrap()), net, "vault gets the net");
    assert_eq!(token_amount(&ctx.banks_client.get_account(escrow_pda).await.unwrap().unwrap()), 0, "escrow fully drained");
    // Order Filled, NO side grew by net, position belongs to the owner.
    let o = PredictionOrder::try_deserialize(&mut ctx.banks_client.get_account(order_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(o.status == PredictionOrderStatus::Filled);
    let mk = Market::try_deserialize(&mut ctx.banks_client.get_account(market_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(mk.no_total, net, "NO side grows by the net amount");
    assert_eq!(mk.burned_lynx, burn, "market records the burn");
    let cfg = ProtocolConfig::try_deserialize(&mut ctx.banks_client.get_account(config_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(cfg.total_lynx_burned, burn, "config records the burn");
    let p = UserPosition::try_deserialize(&mut ctx.banks_client.get_account(position_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert_eq!(p.owner, owner.pubkey(), "position belongs to the order owner, not the keeper");
    assert_eq!(p.amount, net);
    assert!(p.outcome == Outcome::No);
}

/// Cancelling an open LYNX order returns the full escrowed amount to the owner's
/// token account and marks the order Cancelled (nothing is burned on cancel).
#[tokio::test]
async fn owner_cancels_a_lynx_limit_order_and_is_refunded() {
    let market_id: u64 = 2;
    let owner = Keypair::new();
    let order_id: u64 = 9;
    let gross = 500_000_000u64;

    let lynx_mint = Pubkey::new_unique();
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());
    let (order_pda, ob) = Pubkey::find_program_address(
        &[b"pred_order", market_pda.as_ref(), owner.pubkey().as_ref(), &order_id.to_le_bytes()], &pid());
    let (escrow_pda, eb) = Pubkey::find_program_address(&[b"pred_order_escrow_lynx", order_pda.as_ref()], &pid());
    let owner_lynx = Pubkey::new_unique();

    let market = lynx_market(market_id, mb, 0, gross, gross, 0);
    let order = open_order(order_id, owner.pubkey(), market_pda, gross, ob, eb);

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_with(lynx_mint, cb))));
    pt.add_account(market_pda, racct(bytes(&market)));
    pt.add_account(order_pda, racct(bytes(&order)));
    pt.add_account(escrow_pda, spl_token_account(lynx_mint, order_pda, gross));
    pt.add_account(owner_lynx, spl_token_account(lynx_mint, owner.pubkey(), 0));
    let mut ctx = pt.start_with_context().await;
    ctx.set_account(&owner.pubkey(), &Account {
        lamports: solana_sdk::native_token::LAMPORTS_PER_SOL, data: vec![],
        owner: system_program::id(), executable: false, rent_epoch: 0,
    }.into());

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::CancelPredictionLimitOrderLynx {
            config: config_pda, market: market_pda, order: order_pda, escrow: escrow_pda,
            owner_lynx_account: owner_lynx, signer: owner.pubkey(), token_program: spl_token::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CancelPredictionLimitOrderLynx {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &owner], bh);
    ctx.banks_client.process_transaction(tx).await.expect("owner must be able to cancel and be refunded");

    assert_eq!(token_amount(&ctx.banks_client.get_account(owner_lynx).await.unwrap().unwrap()), gross, "owner refunded in full");
    assert_eq!(token_amount(&ctx.banks_client.get_account(escrow_pda).await.unwrap().unwrap()), 0, "escrow drained");
    let o = PredictionOrder::try_deserialize(&mut ctx.banks_client.get_account(order_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(o.status == PredictionOrderStatus::Cancelled);
}
