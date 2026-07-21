//! End-to-end proof that the keeper's limit-order fill works.
//!
//! `execute_prediction_limit_order_sol` is the permissionless crank the backend
//! keeper (and any third-party bot) calls to fill an in-the-money prediction
//! limit order. It had NO integration test before — only account-list review —
//! so a keeper-path regression (wrong account, broken price check, escrow bug)
//! could have shipped silently. This seeds a market with a pool and an Open order
//! whose price condition is met, invokes the crank against the REAL compiled
//! program, and asserts the order is Filled, the pool grew by the order amount on
//! the ordered side, and the owner's position was created — paid to the order
//! owner, not to the keeper who signed.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::state::{
    Currency, Market, MarketStatus, MarketVault, Outcome, PredictionOrder,
    PredictionOrderEscrowSol, PredictionOrderStatus, ProtocolConfig, UserPosition,
};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account, instruction::Instruction, native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey, rent::Rent, signature::{Keypair, Signer}, system_program,
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
fn rent_account(data: Vec<u8>, owner: Pubkey, extra: u64) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()) + extra, data, owner, executable: false, rent_epoch: 0 }
}

#[tokio::test]
async fn keeper_fills_an_in_the_money_prediction_limit_order() {
    let pid = program_id();
    let owner = Keypair::new(); // the order owner; receives the position
    let keeper = Keypair::new(); // pays for + signs the execution; owns nothing
    let order_id: u64 = 1;
    let market_id: u64 = 1;
    let order_amount = LAMPORTS_PER_SOL; // 1 SOL

    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"config"], &pid);
    let (market_pda, market_bump) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid);
    let (vault_pda, vault_bump) = Pubkey::find_program_address(&[b"vault", market_pda.as_ref()], &pid);
    let (order_pda, order_bump) = Pubkey::find_program_address(
        &[b"pred_order", market_pda.as_ref(), owner.pubkey().as_ref(), &order_id.to_le_bytes()], &pid);
    let (escrow_pda, escrow_bump) = Pubkey::find_program_address(&[b"pred_order_escrow_sol", order_pda.as_ref()], &pid);
    let (position_pda, _) = Pubkey::find_program_address(
        &[b"position", market_pda.as_ref(), owner.pubkey().as_ref(), &[Outcome::No.as_seed()]], &pid);
    let (_rv, rv_bump) = Pubkey::find_program_address(&[b"rewards_vault"], &pid);

    let config = ProtocolConfig {
        admin: Pubkey::new_unique(), treasury: Pubkey::new_unique(), lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump: config_bump, rewards_vault_bump: rv_bump, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    };
    // Active SOL market, pool = 10 SOL all on YES -> implied price of NO is 0,
    // which is below the order's 5000 bps limit, so the NO order is in-the-money.
    let market = Market {
        id: market_id, admin: Pubkey::new_unique(), vault: vault_pda, oracle_authority: Pubkey::new_unique(),
        title: "limit order market".into(), currency: Currency::SOL, status: MarketStatus::Active,
        is_ternary: false, cutoff_ts: i64::MAX, resolve_ts: i64::MAX, oracle_deadline: i64::MAX,
        resolved_ts: 0, result: Outcome::Unresolved, pool_total: 10 * LAMPORTS_PER_SOL,
        yes_total: 10 * LAMPORTS_PER_SOL, no_total: 0, draw_total: 0, winning_total: 0, burned_lynx: 0,
        bump: market_bump, vault_bump, lynx_vault_bump: 0, mint_ratio_bps: 0, swept: false,
        proposed_result: Outcome::Unresolved, proposed_ts: 0, mint_ratio_snapshot_bps: 0,
        total_claimed: 0, resolved_by: Pubkey::default(),
    };
    let order = PredictionOrder {
        id: order_id, owner: owner.pubkey(), market: market_pda, outcome: Outcome::No,
        amount: order_amount, limit_price_bps: 5000, status: PredictionOrderStatus::Open,
        created_ts: 0, expires_ts: i64::MAX, bump: order_bump, escrow_bump,
    };
    let escrow = PredictionOrderEscrowSol { order: order_pda, bump: escrow_bump };
    let vault = MarketVault { market: market_pda, bump: vault_bump };

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config_pda, rent_account(account_bytes(&config), pid, 0));
    pt.add_account(market_pda, rent_account(account_bytes(&market), pid, 0));
    pt.add_account(vault_pda, rent_account(account_bytes(&vault), pid, 10 * LAMPORTS_PER_SOL));
    pt.add_account(order_pda, rent_account(account_bytes(&order), pid, 0));
    // The escrow marker holds the order's 1 SOL above its rent (the deposit).
    pt.add_account(escrow_pda, rent_account(account_bytes(&escrow), pid, order_amount));
    let mut ctx = pt.start_with_context().await;
    // Fund the keeper so it can pay the position-init rent.
    ctx.set_account(&keeper.pubkey(), &Account {
        lamports: 5 * LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0,
    }.into());

    let ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ExecutePredictionLimitOrderSol {
            config: config_pda, market: market_pda, vault: vault_pda, order: order_pda,
            escrow: escrow_pda, position: position_pda, payer: keeper.pubkey(),
            system_program: system_program::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::ExecutePredictionLimitOrderSol {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &keeper], bh);
    ctx.banks_client.process_transaction(tx).await
        .expect("keeper must fill an in-the-money limit order");

    // Order is Filled.
    let oa = ctx.banks_client.get_account(order_pda).await.unwrap().unwrap();
    let o = PredictionOrder::try_deserialize(&mut oa.data.as_slice()).unwrap();
    assert!(o.status == PredictionOrderStatus::Filled, "order must be Filled after execution");
    // The fill added the order amount to the NO side of the pool.
    let ma = ctx.banks_client.get_account(market_pda).await.unwrap().unwrap();
    let m = Market::try_deserialize(&mut ma.data.as_slice()).unwrap();
    assert_eq!(m.no_total, order_amount, "the fill must add the order amount to NO");
    assert_eq!(m.pool_total, 10 * LAMPORTS_PER_SOL + order_amount);
    // The position belongs to the ORDER OWNER, never the keeper who signed.
    let pa = ctx.banks_client.get_account(position_pda).await.unwrap().unwrap();
    let p = UserPosition::try_deserialize(&mut pa.data.as_slice()).unwrap();
    assert_eq!(p.owner, owner.pubkey(), "the filled position must belong to the order owner");
    assert_eq!(p.amount, order_amount);
    assert!(p.outcome == Outcome::No);
}
