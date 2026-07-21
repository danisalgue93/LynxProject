//! Integration coverage for cancel_spot_order_sell — the LYNX-side refund of a
//! resting spot SELL order. Its BUY counterpart (SOL refund) is exercised live
//! on devnet, but the SELL side moves SPL tokens out of an escrow whose authority
//! is the order PDA, so it gets its own runtime proof here. Driven against the
//! REAL compiled program via BanksClient.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::state::{ProtocolConfig, SpotOrder, SpotOrderSide, SpotOrderStatus};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account, instruction::Instruction, native_token::LAMPORTS_PER_SOL,
    program_option::COption, program_pack::Pack, pubkey::Pubkey, rent::Rent,
    signature::{Keypair, Signer}, system_program, transaction::Transaction,
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
fn token_amount(a: &Account) -> u64 { spl_token::state::Account::unpack(&a.data).unwrap().amount }

#[tokio::test]
async fn cancel_spot_sell_refunds_the_remaining_lynx() {
    let lynx_mint = Pubkey::new_unique();
    let owner = Keypair::new();
    let order_id: u64 = 42;
    let remaining = 750_000_000u64; // 750 LYNX (micro) still resting

    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (order_pda, ob) = Pubkey::find_program_address(
        &[b"spot_order", owner.pubkey().as_ref(), &order_id.to_le_bytes()], &pid());
    let (escrow_pda, eb) = Pubkey::find_program_address(&[b"spot_order_escrow_lynx", order_pda.as_ref()], &pid());
    let owner_lynx = Pubkey::new_unique();

    let config = ProtocolConfig {
        admin: Pubkey::new_unique(), treasury: Pubkey::new_unique(), lynx_mint,
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump: cb, rewards_vault_bump: 0, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    };
    let order = SpotOrder {
        id: order_id, owner: owner.pubkey(), side: SpotOrderSide::Sell, price_scaled: 1_000_000,
        amount: remaining, remaining, status: SpotOrderStatus::Open, created_ts: 0,
        expires_ts: i64::MAX, bump: ob, escrow_bump: eb,
    };

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config)));
    pt.add_account(order_pda, racct(bytes(&order)));
    // Escrow holds the resting LYNX, authority = the order PDA.
    pt.add_account(escrow_pda, spl_token_account(lynx_mint, order_pda, remaining));
    pt.add_account(owner_lynx, spl_token_account(lynx_mint, owner.pubkey(), 0));
    let mut ctx = pt.start_with_context().await;
    ctx.set_account(&owner.pubkey(), &Account {
        lamports: LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0,
    }.into());

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::CancelSpotOrderSell {
            config: config_pda, order: order_pda, escrow: escrow_pda,
            owner_lynx_account: owner_lynx, signer: owner.pubkey(), token_program: spl_token::id(),
        }.to_account_metas(None),
        data: lynx_project::instruction::CancelSpotOrderSell {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &owner], bh);
    ctx.banks_client.process_transaction(tx).await.expect("owner must be able to cancel a resting SELL");

    assert_eq!(token_amount(&ctx.banks_client.get_account(owner_lynx).await.unwrap().unwrap()), remaining, "owner refunded the resting LYNX");
    assert_eq!(token_amount(&ctx.banks_client.get_account(escrow_pda).await.unwrap().unwrap()), 0, "escrow drained");
    let o = SpotOrder::try_deserialize(&mut ctx.banks_client.get_account(order_pda).await.unwrap().unwrap().data.as_slice()).unwrap();
    assert!(o.status == SpotOrderStatus::Cancelled);
    assert_eq!(o.remaining, 0, "remaining zeroed so it can never be refunded twice");
}
