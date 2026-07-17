//! End-to-end proof that C-02 is fixed.
//!
//! C-02: `claim_market_sol` computed the winner payout as
//! `payout_pool * position.amount / winning_total` in u64. For any market with
//! a pool above ~4.5 SOL the intermediate product `payout_pool * position.amount`
//! exceeds u64::MAX, so `checked_mul` returned None and the claim reverted with
//! MathOverflow — permanently. There is no other instruction that releases a
//! winner's SOL, so those funds were locked forever.
//!
//! This test drives the REAL compiled program (target/deploy/lynx_project.so)
//! through solana-program-test's BanksClient. It seeds a market that has already
//! resolved with a 20 SOL pool — the exact size that used to overflow — and then
//! actually invokes claim_market_sol, asserting the sole winner is paid the full
//! 18 SOL (90% of pool, after the 10% protocol fee). Against the pre-fix code
//! this transaction fails with MathOverflow; against the fixed mul_div it pays out.
//!
//! Run with: SBF_OUT_DIR pointing at target/deploy (set automatically by
//! `cargo test-sbf`, or exported by the test runner script).

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::state::{Currency, Market, MarketStatus, MarketVault, Outcome, UserPosition};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    native_token::LAMPORTS_PER_SOL,
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::str::FromStr;

fn program_id() -> Pubkey {
    Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap()
}

/// Serialize an Anchor `#[account]` type exactly as the on-chain program stores
/// it: 8-byte discriminator followed by the Borsh body.
fn account_bytes<T: AccountSerialize>(state: &T) -> Vec<u8> {
    let mut data = Vec::new();
    state.try_serialize(&mut data).unwrap();
    data
}

fn rent_account(data: Vec<u8>, owner: Pubkey, extra_lamports: u64) -> Account {
    let lamports = Rent::default().minimum_balance(data.len()) + extra_lamports;
    Account { lamports, data, owner, executable: false, rent_epoch: 0 }
}

#[tokio::test]
async fn winner_can_claim_a_twenty_sol_market() {
    let program_id = program_id();
    let market_id: u64 = 1;

    let (market_pda, market_bump) =
        Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &program_id);
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[b"vault", market_pda.as_ref()], &program_id);

    let claimant = Keypair::new();

    // Binary market, resolved YES. Pool = 20 SOL, the whole winning (YES) side is
    // this one claimant's 10 SOL, so winning_total == position.amount == 10 SOL.
    let pool_total = 20 * LAMPORTS_PER_SOL;
    let winning_total = 10 * LAMPORTS_PER_SOL;
    let position_amount = 10 * LAMPORTS_PER_SOL;
    // payout_pool = 90% of 20 SOL = 18 SOL; payout = 18 * 10 / 10 = 18 SOL.
    let expected_payout = 18 * LAMPORTS_PER_SOL;

    let market = Market {
        id: market_id,
        admin: Pubkey::new_unique(),
        vault: vault_pda,
        oracle_authority: Pubkey::new_unique(),
        title: "20 SOL market".to_string(),
        currency: Currency::SOL,
        status: MarketStatus::Resolved,
        is_ternary: false,
        cutoff_ts: 0,
        resolve_ts: 0,
        oracle_deadline: 0,
        resolved_ts: 1,
        result: Outcome::Yes,
        pool_total,
        yes_total: winning_total,
        no_total: 10 * LAMPORTS_PER_SOL,
        draw_total: 0,
        winning_total,
        burned_lynx: 0,
        bump: market_bump,
        vault_bump,
        lynx_vault_bump: 0,
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
        amount: position_amount,
        claimed: false,
        lynx_minted: false,
        bump: 0,
    };
    let position_pubkey = Pubkey::new_unique();

    let vault = MarketVault { market: market_pda, bump: vault_bump };

    // `None` processor → solana-program-test loads the compiled BPF program from
    // SBF_OUT_DIR (target/deploy/lynx_project.so) and runs the real bytecode,
    // rather than a native Rust entrypoint.
    let mut pt = ProgramTest::new("lynx_project", program_id, None);
    // Seed the resolved market, the winning position, and a vault holding the
    // full 20 SOL pool so the 18 SOL payout has real lamports to move.
    pt.add_account(market_pda, rent_account(account_bytes(&market), program_id, 0));
    pt.add_account(position_pubkey, rent_account(account_bytes(&position), program_id, 0));
    pt.add_account(vault_pda, rent_account(account_bytes(&vault), program_id, pool_total));

    let mut ctx = pt.start_with_context().await;

    let ix = Instruction {
        program_id,
        accounts: lynx_project::accounts::ClaimMarketSol {
            market: market_pda,
            vault: vault_pda,
            position: position_pubkey,
            claimant: claimant.pubkey(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ClaimMarketSol {}.data(),
    };

    let before = ctx
        .banks_client
        .get_balance(claimant.pubkey())
        .await
        .unwrap();

    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &claimant], ctx.last_blockhash);

    // The assertion that matters: pre-fix this returns Err(MathOverflow).
    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("claim on a 20 SOL market must succeed (pre-C-02-fix this overflowed u64)");

    let after = ctx
        .banks_client
        .get_balance(claimant.pubkey())
        .await
        .unwrap();

    assert_eq!(
        after - before,
        expected_payout,
        "winner of a 20 SOL market must receive exactly 18 SOL (90% after protocol fee)"
    );

    // The position must now be flagged claimed so it cannot be drained twice.
    let position_account = ctx
        .banks_client
        .get_account(position_pubkey)
        .await
        .unwrap()
        .expect("position still exists");
    let refreshed = UserPosition::try_deserialize(&mut position_account.data.as_slice()).unwrap();
    assert!(refreshed.claimed, "position must be marked claimed after payout");
}
