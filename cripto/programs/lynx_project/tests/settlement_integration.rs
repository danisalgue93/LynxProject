//! Integration coverage for two money-moving settlement cranks that had no test:
//! resolve_duel_sol (pays the 1v1 SOL duel winner, minus the trade fee) and
//! sweep_unclaimed_market_sol (sweeps a no-winner market's net pool to treasury).
//! Both are permissionless and move real lamports, so a regression here silently
//! misroutes funds. Driven against the REAL compiled program via BanksClient.

use anchor_lang::{AccountSerialize, AccountDeserialize, InstructionData, ToAccountMetas};
use lynx_project::constants::GLOBAL_TRADE_FEE_BPS;
use lynx_project::state::{
    Currency, Duel, DuelStatus, DuelType, DuelVault, Market, MarketStatus, MarketVault, Outcome, ProtocolConfig,
};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account, instruction::Instruction, native_token::LAMPORTS_PER_SOL, pubkey::Pubkey,
    rent::Rent, signature::{Keypair, Signer}, transaction::Transaction,
};
use std::str::FromStr;

fn pid() -> Pubkey { Pubkey::from_str("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu").unwrap() }
fn bytes<T: AccountSerialize>(s: &T) -> Vec<u8> { let mut d = Vec::new(); s.try_serialize(&mut d).unwrap(); d }
fn racct(data: Vec<u8>, extra: u64) -> Account {
    Account { lamports: Rent::default().minimum_balance(data.len()) + extra, data, owner: pid(), executable: false, rent_epoch: 0 }
}
fn config_with(treasury: Pubkey, bump: u8) -> ProtocolConfig {
    let (_rv, rvb) = Pubkey::find_program_address(&[b"rewards_vault"], &pid());
    ProtocolConfig {
        admin: Pubkey::new_unique(), treasury, lynx_mint: Pubkey::new_unique(),
        stake_vault: Pubkey::new_unique(), rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 0, total_lynx_burned: 0, total_staked: 0, reward_per_token_scaled: 0,
        bump, rewards_vault_bump: rvb, paused: false, multisig_initialized: true,
        protocol_duel_exposure: 0, max_protocol_duel_exposure: u64::MAX,
    }
}
#[allow(clippy::too_many_arguments)]
fn resolved_market(id: u64, bump: u8, vault: Pubkey, vault_bump: u8, result: Outcome, winning_total: u64, pool_total: u64, yes: u64, no: u64) -> Market {
    Market {
        id, admin: Pubkey::new_unique(), vault, oracle_authority: Pubkey::new_unique(),
        title: "m".into(), currency: Currency::SOL, status: MarketStatus::Resolved, is_ternary: false,
        cutoff_ts: 0, resolve_ts: 0, oracle_deadline: 0, resolved_ts: 1, result,
        pool_total, yes_total: yes, no_total: no, draw_total: 0, winning_total, burned_lynx: 0,
        bump, vault_bump, lynx_vault_bump: 0, mint_ratio_bps: 0, swept: false,
        proposed_result: result, proposed_ts: 1, mint_ratio_snapshot_bps: 0, total_claimed: 0,
        resolved_by: Pubkey::new_unique(),
    }
}

#[tokio::test]
async fn resolve_duel_sol_pays_the_winner_minus_fee() {
    let market_id: u64 = 1;
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());
    let (vault_pda, vb) = Pubkey::find_program_address(&[b"vault", market_pda.as_ref()], &pid());
    let creator = Keypair::new().pubkey();
    let rival = Keypair::new().pubkey();
    let treasury = Keypair::new().pubkey();
    let duel_key = Pubkey::new_unique();
    let (duel_vault_pda, dvb) = Pubkey::find_program_address(&[b"duel_vault", duel_key.as_ref()], &pid());

    let amount = LAMPORTS_PER_SOL / 2; // 0.5 SOL each side
    let total = amount * 2;            // 1 SOL pot
    let fee = total * GLOBAL_TRADE_FEE_BPS / 10_000; // 10 bps = 0.001 SOL

    // Market resolved YES; the duel creator picked YES so the creator wins.
    let market = resolved_market(market_id, mb, vault_pda, vb, Outcome::Yes, LAMPORTS_PER_SOL, 2 * LAMPORTS_PER_SOL, LAMPORTS_PER_SOL, LAMPORTS_PER_SOL);
    let duel = Duel {
        parent_market: market_pda, creator, rival, id: 1, amount,
        creator_outcome: Outcome::Yes, rival_outcome: Outcome::No, duel_type: DuelType::OneVOne,
        status: DuelStatus::Active, expires_ts: 1, bump: 0, vault_bump: dvb,
    };

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_with(treasury, cb)), 0));
    pt.add_account(market_pda, racct(bytes(&market), 0));
    pt.add_account(duel_key, racct(bytes(&duel), 0));
    // duel_vault holds the 1 SOL pot above its rent (seeded as a DuelVault so its
    // Anchor discriminator matches — MarketVault has the same layout but a
    // different discriminator, which would fail deserialization).
    pt.add_account(duel_vault_pda, racct(bytes(&DuelVault { duel: duel_key, bump: dvb }), total));
    let ctx = pt.start_with_context().await;

    let before = ctx.banks_client.get_balance(creator).await.unwrap();
    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::ResolveDuelSol {
            config: config_pda, parent_market: market_pda, duel: duel_key, duel_vault: duel_vault_pda,
            recipient: creator, treasury,
        }.to_account_metas(None),
        data: lynx_project::instruction::ResolveDuelSol {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer], bh);
    ctx.banks_client.process_transaction(tx).await.expect("resolve_duel_sol must pay the winner");

    let after = ctx.banks_client.get_balance(creator).await.unwrap();
    assert_eq!(after - before, total - fee, "creator (winner) receives the pot minus the trade fee");
    assert_eq!(ctx.banks_client.get_balance(treasury).await.unwrap(), fee, "treasury receives the fee");
    let da = ctx.banks_client.get_account(duel_key).await.unwrap().unwrap();
    let d = Duel::try_deserialize(&mut da.data.as_slice()).unwrap();
    assert!(d.status == DuelStatus::Resolved, "duel must be Resolved");
}

#[tokio::test]
async fn sweep_unclaimed_market_sol_sends_net_pool_to_treasury() {
    let market_id: u64 = 2;
    let (config_pda, cb) = Pubkey::find_program_address(&[b"config"], &pid());
    let (market_pda, mb) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid());
    let (vault_pda, vb) = Pubkey::find_program_address(&[b"vault", market_pda.as_ref()], &pid());
    let treasury = Keypair::new().pubkey();
    let caller = Keypair::new();

    // Resolved YES but nobody bet YES: winning_total = 0 -> whole net pool swept.
    let pool = 10 * LAMPORTS_PER_SOL;
    let net_pool = pool * 9_000 / 10_000; // 90% (10% EVENT_PROTOCOL_FEE)
    let market = resolved_market(market_id, mb, vault_pda, vb, Outcome::Yes, 0, pool, 0, pool);

    let mut pt = ProgramTest::new("lynx_project", pid(), None);
    pt.add_account(config_pda, racct(bytes(&config_with(treasury, cb)), 0));
    pt.add_account(market_pda, racct(bytes(&market), 0));
    pt.add_account(vault_pda, racct(bytes(&MarketVault { market: market_pda, bump: vb }), pool));
    let mut ctx = pt.start_with_context().await;
    ctx.set_account(&caller.pubkey(), &Account { lamports: LAMPORTS_PER_SOL, data: vec![], owner: solana_sdk::system_program::id(), executable: false, rent_epoch: 0 }.into());

    let ix = Instruction {
        program_id: pid(),
        accounts: lynx_project::accounts::SweepUnclaimedMarketSol {
            config: config_pda, market: market_pda, vault: vault_pda, treasury, caller: caller.pubkey(),
        }.to_account_metas(None),
        data: lynx_project::instruction::SweepUnclaimedMarketSol {}.data(),
    };
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &caller], bh);
    ctx.banks_client.process_transaction(tx).await.expect("sweep must move the net pool to treasury");

    assert_eq!(ctx.banks_client.get_balance(treasury).await.unwrap(), net_pool, "treasury gets 90% of the pool");
    let ma = ctx.banks_client.get_account(market_pda).await.unwrap().unwrap();
    let m = Market::try_deserialize(&mut ma.data.as_slice()).unwrap();
    assert!(m.swept, "market must be flagged swept");
}
