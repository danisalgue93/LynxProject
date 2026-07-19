//! The LYNX/SOL spot book: place / match / cancel, against the real program.
//!
//! Unlike prediction orders (which fill against a pool), every spot fill moves
//! money between two real counterparties. `match_spot_orders` is permissionless
//! — any keeper can crank it — and it takes three UncheckedAccounts
//! (seller_wallet, buyer_wallet, treasury). That combination is exactly where a
//! malicious keeper would try to redirect funds, so these tests assert both that
//! an honest fill conserves value and that a hostile crank cannot steal it.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::{GLOBAL_TRADE_FEE_BPS, PRICE_SCALE};
use lynx_project::state::{ProtocolConfig, SpotOrder};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    native_token::LAMPORTS_PER_SOL,
    program_option::COption,
    program_pack::Pack,
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

fn account_bytes<T: AccountSerialize>(s: &T) -> Vec<u8> {
    let mut d = Vec::new();
    s.try_serialize(&mut d).unwrap();
    d
}

fn program_account(data: Vec<u8>) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: program_id(), executable: false, rent_epoch: 0 }
}

fn wallet(lamports: u64) -> Account {
    Account { lamports, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }
}

fn spl_token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint, owner, amount,
        delegate: COption::None,
        state: spl_token::state::AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    }.pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}

fn spl_mint(authority: Pubkey) -> Account {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: COption::Some(authority),
        supply: 1_000_000_000,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    }.pack_into_slice(&mut data);
    Account { lamports: Rent::default().minimum_balance(data.len()), data, owner: spl_token::id(), executable: false, rent_epoch: 0 }
}

fn token_amount(a: &Account) -> u64 { spl_token::state::Account::unpack(&a.data).unwrap().amount }

const MICRO: u64 = 1_000_000;
/// 0.5 SOL per LYNX = 0.5 lamports per micro-LYNX, scaled by PRICE_SCALE.
const PRICE_HALF: u128 = PRICE_SCALE / 2;

fn config_pda() -> (Pubkey, u8) { Pubkey::find_program_address(&[b"config"], &program_id()) }
fn spot_order_pda(owner: &Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"spot_order", owner.as_ref(), &id.to_le_bytes()], &program_id())
}
fn buy_escrow_pda(order: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"spot_order_escrow_sol", order.as_ref()], &program_id())
}
fn sell_escrow_pda(order: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"spot_order_escrow_lynx", order.as_ref()], &program_id())
}

#[derive(Clone, Copy)]
struct Keys { config: Pubkey, lynx_mint: Pubkey, treasury: Pubkey }

struct Fixture { ctx: ProgramTestContext, keys: Keys }

async fn setup(accounts: Vec<(Pubkey, Account)>) -> Fixture {
    let (config, bump) = config_pda();
    let lynx_mint = Pubkey::new_unique();
    let treasury = Pubkey::new_unique();

    let cfg = ProtocolConfig {
        admin: Pubkey::new_unique(),
        treasury,
        lynx_mint,
        stake_vault: Pubkey::new_unique(),
        rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 1_000_000 * MICRO,
        total_lynx_burned: 0,
        total_staked: 0,
        reward_per_token_scaled: 0,
        bump,
        rewards_vault_bump: 0,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: u64::MAX,
    };

    let mut pt = ProgramTest::new("lynx_project", program_id(), None);
    pt.add_account(config, program_account(account_bytes(&cfg)));
    pt.add_account(lynx_mint, spl_mint(config));
    pt.add_account(treasury, wallet(LAMPORTS_PER_SOL));
    for (k, a) in accounts { pt.add_account(k, a); }

    Fixture { ctx: pt.start_with_context().await, keys: Keys { config, lynx_mint, treasury } }
}

async fn send(ctx: &mut ProgramTestContext, ix: Instruction, extra: &[&Keypair]) -> Result<(), solana_program_test::BanksClientError> {
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let payer = ctx.payer.insecure_clone();
    let mut signers: Vec<&Keypair> = vec![&payer];
    signers.extend_from_slice(extra);
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(&signers, blockhash);
    ctx.banks_client.process_transaction(tx).await
}

fn place_buy_ix(k: &Keys, owner: &Pubkey, id: u64, amount: u64, price: u128, expires: i64) -> Instruction {
    let order = spot_order_pda(owner, id).0;
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::PlaceSpotOrderBuy {
            config: k.config,
            order,
            escrow: buy_escrow_pda(&order).0,
            owner: *owner,
            system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::PlaceSpotOrderBuy { order_id: id, amount, price_scaled: price, expires_ts: expires }.data(),
    }
}

fn place_sell_ix(k: &Keys, owner: &Pubkey, user_lynx: Pubkey, id: u64, amount: u64, price: u128, expires: i64) -> Instruction {
    let order = spot_order_pda(owner, id).0;
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::PlaceSpotOrderSell {
            config: k.config,
            order,
            lynx_mint: k.lynx_mint,
            user_lynx_account: user_lynx,
            escrow: sell_escrow_pda(&order).0,
            owner: *owner,
            token_program: spl_token::id(),
            system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::PlaceSpotOrderSell { order_id: id, amount, price_scaled: price, expires_ts: expires }.data(),
    }
}

#[allow(clippy::too_many_arguments)]
fn match_ix(
    k: &Keys, buy_order: Pubkey, sell_order: Pubkey,
    seller_wallet: Pubkey, buyer_wallet: Pubkey, buyer_lynx: Pubkey,
    treasury: Pubkey, fill: u64,
) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::MatchSpotOrders {
            config: k.config,
            buy_order,
            buy_escrow: buy_escrow_pda(&buy_order).0,
            sell_order,
            sell_escrow: sell_escrow_pda(&sell_order).0,
            seller_wallet,
            buyer_wallet,
            buyer_lynx_account: buyer_lynx,
            treasury,
            token_program: spl_token::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::MatchSpotOrders { fill_amount: fill }.data(),
    }
}

/// Places a crossing buy+sell pair and returns the accounts involved.
struct Book {
    buyer: Keypair,
    seller: Keypair,
    buy_order: Pubkey,
    sell_order: Pubkey,
    buyer_lynx: Pubkey,
}

async fn crossing_book(f: &mut Fixture, amount: u64, price: u128) -> Book {
    let buyer = Keypair::new();
    let seller = Keypair::new();
    let buyer_lynx = Pubkey::new_unique();
    let seller_lynx = Pubkey::new_unique();

    f.ctx.set_account(&buyer.pubkey(), &wallet(100 * LAMPORTS_PER_SOL).into());
    f.ctx.set_account(&seller.pubkey(), &wallet(100 * LAMPORTS_PER_SOL).into());
    f.ctx.set_account(&buyer_lynx, &spl_token_account(f.keys.lynx_mint, buyer.pubkey(), 0).into());
    f.ctx.set_account(&seller_lynx, &spl_token_account(f.keys.lynx_mint, seller.pubkey(), amount).into());

    let keys = f.keys;
    // Sell first, so the seller is the maker and its price is the execution price.
    send(&mut f.ctx, place_sell_ix(&keys, &seller.pubkey(), seller_lynx, 1, amount, price, i64::MAX), &[&seller])
        .await.expect("place sell");
    send(&mut f.ctx, place_buy_ix(&keys, &buyer.pubkey(), 2, amount, price, i64::MAX), &[&buyer])
        .await.expect("place buy");

    Book {
        buy_order: spot_order_pda(&buyer.pubkey(), 2).0,
        sell_order: spot_order_pda(&seller.pubkey(), 1).0,
        buyer, seller, buyer_lynx,
    }
}

#[tokio::test]
async fn a_fill_conserves_value_between_the_two_counterparties() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO; // 100 LYNX
    let b = crossing_book(&mut f, amount, PRICE_HALF).await;

    let seller_sol_before = f.ctx.banks_client.get_balance(b.seller.pubkey()).await.unwrap();
    let treasury_before = f.ctx.banks_client.get_balance(f.keys.treasury).await.unwrap();

    let keys = f.keys;
    send(&mut f.ctx, match_ix(&keys, b.buy_order, b.sell_order, b.seller.pubkey(), b.buyer.pubkey(), b.buyer_lynx, keys.treasury, amount), &[])
        .await.expect("match should succeed");

    // 100 LYNX at 0.5 lamports/micro-LYNX = 50_000_000 lamports notional.
    let notional = (amount as u128 * PRICE_HALF / PRICE_SCALE) as u64;
    let fee = notional * GLOBAL_TRADE_FEE_BPS / 10_000;

    let seller_sol_after = f.ctx.banks_client.get_balance(b.seller.pubkey()).await.unwrap();
    let treasury_after = f.ctx.banks_client.get_balance(f.keys.treasury).await.unwrap();
    let buyer_lynx = f.ctx.banks_client.get_account(b.buyer_lynx).await.unwrap().unwrap();

    assert_eq!(seller_sol_after - seller_sol_before, notional - fee, "seller receives notional minus fee");
    assert_eq!(treasury_after - treasury_before, fee, "treasury receives exactly the fee");
    assert_eq!(token_amount(&buyer_lynx), amount, "buyer receives the LYNX");

    // Conservation: everything that left the buyer's escrow arrived somewhere.
    assert_eq!((seller_sol_after - seller_sol_before) + (treasury_after - treasury_before), notional);
}

/// A permissionless crank must not be able to send the seller's proceeds to an
/// address of its choosing.
#[tokio::test]
async fn a_malicious_keeper_cannot_redirect_the_sellers_proceeds() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO;
    let b = crossing_book(&mut f, amount, PRICE_HALF).await;

    let attacker = Keypair::new();
    f.ctx.set_account(&attacker.pubkey(), &wallet(LAMPORTS_PER_SOL).into());

    let keys = f.keys;
    let result = send(
        &mut f.ctx,
        match_ix(&keys, b.buy_order, b.sell_order, attacker.pubkey(), b.buyer.pubkey(), b.buyer_lynx, keys.treasury, amount),
        &[],
    ).await;
    assert!(result.is_err(), "seller_wallet must be checked against sell_order.owner");
}

/// …nor divert the bought LYNX into its own token account.
#[tokio::test]
async fn a_malicious_keeper_cannot_steal_the_bought_lynx() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO;
    let b = crossing_book(&mut f, amount, PRICE_HALF).await;

    let attacker = Keypair::new();
    let attacker_lynx = Pubkey::new_unique();
    f.ctx.set_account(&attacker.pubkey(), &wallet(LAMPORTS_PER_SOL).into());
    f.ctx.set_account(&attacker_lynx, &spl_token_account(f.keys.lynx_mint, attacker.pubkey(), 0).into());

    let keys = f.keys;
    let result = send(
        &mut f.ctx,
        match_ix(&keys, b.buy_order, b.sell_order, b.seller.pubkey(), b.buyer.pubkey(), attacker_lynx, keys.treasury, amount),
        &[],
    ).await;
    assert!(result.is_err(), "buyer_lynx_account must be checked against buy_order.owner");
}

/// …nor route the protocol fee to itself.
#[tokio::test]
async fn a_malicious_keeper_cannot_redirect_the_protocol_fee() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO;
    let b = crossing_book(&mut f, amount, PRICE_HALF).await;

    let attacker = Keypair::new();
    f.ctx.set_account(&attacker.pubkey(), &wallet(LAMPORTS_PER_SOL).into());

    let keys = f.keys;
    let result = send(
        &mut f.ctx,
        match_ix(&keys, b.buy_order, b.sell_order, b.seller.pubkey(), b.buyer.pubkey(), b.buyer_lynx, attacker.pubkey(), amount),
        &[],
    ).await;
    assert!(result.is_err(), "treasury must be pinned to config.treasury");
}

/// Orders that do not cross must not fill, whoever cranks them.
#[tokio::test]
async fn orders_that_do_not_cross_cannot_be_matched() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO;

    let buyer = Keypair::new();
    let seller = Keypair::new();
    let buyer_lynx = Pubkey::new_unique();
    let seller_lynx = Pubkey::new_unique();
    f.ctx.set_account(&buyer.pubkey(), &wallet(100 * LAMPORTS_PER_SOL).into());
    f.ctx.set_account(&seller.pubkey(), &wallet(100 * LAMPORTS_PER_SOL).into());
    f.ctx.set_account(&buyer_lynx, &spl_token_account(f.keys.lynx_mint, buyer.pubkey(), 0).into());
    f.ctx.set_account(&seller_lynx, &spl_token_account(f.keys.lynx_mint, seller.pubkey(), amount).into());

    let keys = f.keys;
    // Seller wants 0.6, buyer offers 0.4 — no cross.
    let sell_price = PRICE_SCALE * 6 / 10;
    let buy_price = PRICE_SCALE * 4 / 10;
    send(&mut f.ctx, place_sell_ix(&keys, &seller.pubkey(), seller_lynx, 1, amount, sell_price, i64::MAX), &[&seller]).await.unwrap();
    send(&mut f.ctx, place_buy_ix(&keys, &buyer.pubkey(), 2, amount, buy_price, i64::MAX), &[&buyer]).await.unwrap();

    let result = send(
        &mut f.ctx,
        match_ix(&keys, spot_order_pda(&buyer.pubkey(), 2).0, spot_order_pda(&seller.pubkey(), 1).0,
                 seller.pubkey(), buyer.pubkey(), buyer_lynx, keys.treasury, amount),
        &[],
    ).await;
    assert!(result.is_err(), "a keeper must not be able to force a fill across a spread");
}

/// Filling more than an order's remaining size must be rejected, or the escrow
/// could be drained past what the owner deposited.
#[tokio::test]
async fn a_fill_larger_than_the_order_is_rejected() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO;
    let b = crossing_book(&mut f, amount, PRICE_HALF).await;

    let keys = f.keys;
    let result = send(
        &mut f.ctx,
        match_ix(&keys, b.buy_order, b.sell_order, b.seller.pubkey(), b.buyer.pubkey(), b.buyer_lynx, keys.treasury, amount * 10),
        &[],
    ).await;
    assert!(result.is_err(), "fill_amount above remaining must be rejected");
}

#[tokio::test]
async fn cancelling_a_buy_order_refunds_the_owner_not_the_canceller() {
    let mut f = setup(vec![]).await;
    let amount = 100 * MICRO;
    let buyer = Keypair::new();
    f.ctx.set_account(&buyer.pubkey(), &wallet(100 * LAMPORTS_PER_SOL).into());

    let keys = f.keys;
    send(&mut f.ctx, place_buy_ix(&keys, &buyer.pubkey(), 1, amount, PRICE_HALF, i64::MAX), &[&buyer]).await.unwrap();
    let order = spot_order_pda(&buyer.pubkey(), 1).0;

    let before = f.ctx.banks_client.get_balance(buyer.pubkey()).await.unwrap();
    let ix = Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::CancelSpotOrderBuy {
            order,
            escrow: buy_escrow_pda(&order).0,
            owner: buyer.pubkey(),
            signer: buyer.pubkey(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CancelSpotOrderBuy {}.data(),
    };
    send(&mut f.ctx, ix, &[&buyer]).await.expect("owner can cancel their own order");

    let after = f.ctx.banks_client.get_balance(buyer.pubkey()).await.unwrap();
    let notional = (amount as u128 * PRICE_HALF / PRICE_SCALE) as u64;
    assert_eq!(after - before, notional, "the full escrowed notional comes back");

    let acct = f.ctx.banks_client.get_account(order).await.unwrap().unwrap();
    let o = SpotOrder::try_deserialize(&mut acct.data.as_slice()).unwrap();
    assert_eq!(o.remaining, 0);
}

/// A stranger must not be able to cancel someone else's live order.
#[tokio::test]
async fn a_stranger_cannot_cancel_a_live_buy_order() {
    let mut f = setup(vec![]).await;
    let buyer = Keypair::new();
    let attacker = Keypair::new();
    f.ctx.set_account(&buyer.pubkey(), &wallet(100 * LAMPORTS_PER_SOL).into());
    f.ctx.set_account(&attacker.pubkey(), &wallet(LAMPORTS_PER_SOL).into());

    let keys = f.keys;
    send(&mut f.ctx, place_buy_ix(&keys, &buyer.pubkey(), 1, 100 * MICRO, PRICE_HALF, i64::MAX), &[&buyer]).await.unwrap();
    let order = spot_order_pda(&buyer.pubkey(), 1).0;

    let ix = Instruction {
        program_id: program_id(),
        accounts: lynx_project::accounts::CancelSpotOrderBuy {
            order,
            escrow: buy_escrow_pda(&order).0,
            owner: buyer.pubkey(),
            signer: attacker.pubkey(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CancelSpotOrderBuy {}.data(),
    };
    assert!(
        send(&mut f.ctx, ix, &[&attacker]).await.is_err(),
        "only the owner may cancel an unexpired order"
    );
}
