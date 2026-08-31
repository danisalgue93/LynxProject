//! Two end-to-end proofs against the real compiled program:
//!
//!  1. `full_market_lifecycle_pays_the_winner` — drives the entire SOL market
//!     lifecycle as real transactions (create → buy → cut off → propose →
//!     finalize → claim), advancing the on-chain clock through the cutoff,
//!     resolve, and 24h dispute window. Proves the intermediate instructions
//!     wire together and the winner is actually paid.
//!
//!  2. `protocol_duel_rejects_foreign_lynx_account` — proves the C-04 fix: a
//!     LYNX prize can no longer be redirected to an attacker's token account.
//!     resolve_protocol_duel is permissionless; before the fix, its
//!     `recipient_lynx_account` was validated only by mint, so anyone could pass
//!     their own account and steal the minted LYNX while the SOL leg still paid
//!     the creator. The added `owner == duel.creator` constraint must now reject it.

use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::{DISPUTE_WINDOW_SECONDS, MAX_PROTOCOL_DUEL_EXPOSURE_LAMPORTS};
use lynx_project::state::{
    Currency, Duel, DuelStatus, DuelType, Market, MarketStatus, Outcome, ProtocolConfig,
    RewardsVault,
};
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    clock::Clock,
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

/// Anchor error codes start at 6000; Unauthorized is the 4th LynxError variant
/// (index 3). The recipient_lynx_account owner constraint fails with this exact
/// code, which is what makes the C-04 test prove the fix rather than an accident.
const LYNX_ERROR_UNAUTHORIZED: u32 = 6003;
// Anchor error codes = 6000 + variant index. SlippageExceeded is the 44th
// LynxError variant (index 43), right after the two new slippage variants
// (InvalidSlippage = 6042). Used to prove the market-buy slippage guard rejects
// for the RIGHT reason, not by accident.
const LYNX_ERROR_SLIPPAGE_EXCEEDED: u32 = 6043;
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
    let lamports = Rent::default().minimum_balance(data.len()) + extra_lamports;
    Account { lamports, data, owner: program_id(), executable: false, rent_epoch: 0 }
}

fn funded_wallet(lamports: u64) -> Account {
    Account { lamports, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 }
}

/// A validly-packed SPL token account owned (in the SPL sense) by `token_owner`,
/// with its AccountInfo owner set to the SPL token program so Anchor accepts it
/// as `Account<'info, TokenAccount>`.
fn spl_token_account(mint: Pubkey, token_owner: Pubkey) -> Account {
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint,
        owner: token_owner,
        amount: 0,
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

fn spl_mint(mint_authority: Pubkey) -> Account {
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: COption::Some(mint_authority),
        supply: 0,
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

/// Advance the validator clock to `unix_ts` so time-gated instructions
/// (cutoff, resolve, dispute window) see the moment we want, without warping
/// millions of real slots for the 24h dispute window.
async fn set_clock(ctx: &mut ProgramTestContext, slot: u64, unix_ts: i64) {
    ctx.warp_to_slot(slot).unwrap();
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = unix_ts;
    ctx.set_sysvar(&clock);
}

async fn process(ctx: &mut ProgramTestContext, ix: Instruction, extra_signers: &[&Keypair]) {
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers = vec![&ctx.payer];
    signers.extend_from_slice(extra_signers);
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&signers, blockhash);
    ctx.banks_client.process_transaction(tx).await.expect("transaction should succeed");
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], &program_id())
}
fn supply_twap_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"supply_twap", config_pda().0.as_ref()], &program_id())
}
fn rewards_vault_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"rewards_vault"], &program_id())
}

fn seed_config(admin: Pubkey, treasury: Pubkey, lynx_mint: Pubkey) -> ProtocolConfig {
    let (_, config_bump) = config_pda();
    let (rewards_vault, rv_bump) = rewards_vault_pda();
    ProtocolConfig {
        admin,
        treasury,
        lynx_mint,
        stake_vault: Pubkey::new_unique(),
        rewards_vault,
        total_lynx_supply: 0,
        total_lynx_burned: 0,
        total_staked: 0,
        reward_per_token_scaled: 0,
        bump: config_bump,
        rewards_vault_bump: rv_bump,
        paused: false,
        multisig_initialized: true,
        protocol_duel_exposure: 0,
        max_protocol_duel_exposure: MAX_PROTOCOL_DUEL_EXPOSURE_LAMPORTS,
    }
}

#[tokio::test]
async fn full_market_lifecycle_pays_the_winner() {
    let pid = program_id();
    let admin = Keypair::new();
    let oracle = Keypair::new();
    let treasury = Keypair::new();
    let winner = Keypair::new(); // bets YES, should be paid
    let loser = Keypair::new(); // bets NO

    let (config, _) = config_pda();
    let (rewards_vault, _) = rewards_vault_pda();

    let market_id: u64 = 42;
    let (market_pda, _) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid);
    let (vault_pda, _) = Pubkey::find_program_address(&[b"vault", market_pda.as_ref()], &pid);

    let base_ts: i64 = 1_700_000_000;
    let cutoff_ts = base_ts + 3_600;
    let resolve_ts = base_ts + 7_200;

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config, program_account(account_bytes(&seed_config(admin.pubkey(), treasury.pubkey(), Pubkey::new_unique())), 0));
    pt.add_account(rewards_vault, program_account(account_bytes(&RewardsVault { bump: rewards_vault_pda().1 }), 0));
    pt.add_account(admin.pubkey(), funded_wallet(10 * LAMPORTS_PER_SOL));
    pt.add_account(oracle.pubkey(), funded_wallet(LAMPORTS_PER_SOL));
    pt.add_account(treasury.pubkey(), funded_wallet(LAMPORTS_PER_SOL));
    pt.add_account(winner.pubkey(), funded_wallet(15 * LAMPORTS_PER_SOL));
    pt.add_account(loser.pubkey(), funded_wallet(15 * LAMPORTS_PER_SOL));

    let mut ctx = pt.start_with_context().await;
    set_clock(&mut ctx, 3, base_ts).await;

    // 0. Bootstrap the circulating-supply TWAP (SC-01). propose_resolution reads
    //    it to freeze the market's mint ratio, so it must exist first.
    let (supply_twap, _) = supply_twap_pda();
    let payer_key = ctx.payer.pubkey();
    process(&mut ctx, Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::InitSupplyTwap { config, supply_twap, payer: payer_key, system_program: system_program::id() }.to_account_metas(None),
        data: lynx_project::instruction::InitSupplyTwap {}.data(),
    }, &[]).await;

    // 1. create_market (admin)
    process(&mut ctx, Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::CreateMarket { config, market: market_pda, vault: vault_pda, admin: admin.pubkey(), system_program: system_program::id() }.to_account_metas(None),
        data: lynx_project::instruction::CreateMarket {
            market_id,
            title: "BTC > 100k".to_string(),
            oracle_authority: oracle.pubkey(),
            cutoff_ts,
            resolve_ts,
            currency: Currency::SOL,
            is_ternary: false,
        }.data(),
    }, &[&admin]).await;

    // 2. two 10 SOL bets on opposite sides → 20 SOL pool
    let (winner_pos, _) = Pubkey::find_program_address(&[b"position", market_pda.as_ref(), winner.pubkey().as_ref(), &[Outcome::Yes.as_seed()]], &pid);
    let (loser_pos, _) = Pubkey::find_program_address(&[b"position", market_pda.as_ref(), loser.pubkey().as_ref(), &[Outcome::No.as_seed()]], &pid);
    for (better, pos, outcome) in [(&winner, winner_pos, Outcome::Yes), (&loser, loser_pos, Outcome::No)] {
        process(&mut ctx, Instruction {
            program_id: pid,
            accounts: lynx_project::accounts::BuyPositionSol { config, market: market_pda, vault: vault_pda, position: pos, buyer: better.pubkey(), system_program: system_program::id() }.to_account_metas(None),
            data: lynx_project::instruction::BuyPositionSol { outcome, lamports: 10 * LAMPORTS_PER_SOL, max_price_bps: 10_000 }.data(),
        }, &[better]).await;
    }

    // 2b. Slippage guard (ALTA-2): with the pool at 10/10 the implied price of
    //     each side is 5000 bps. A market buy on Yes that only tolerates 4000 bps
    //     must be REJECTED with SlippageExceeded. Because it's rejected it moves
    //     no funds and leaves the pool untouched, so the rest of the lifecycle
    //     (and the winner's payout below) is unaffected.
    {
        let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
        let ix = Instruction {
            program_id: pid,
            accounts: lynx_project::accounts::BuyPositionSol { config, market: market_pda, vault: vault_pda, position: winner_pos, buyer: winner.pubkey(), system_program: system_program::id() }.to_account_metas(None),
            data: lynx_project::instruction::BuyPositionSol { outcome: Outcome::Yes, lamports: LAMPORTS_PER_SOL, max_price_bps: 4000 }.data(),
        };
        let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
        tx.sign(&[&ctx.payer, &winner], blockhash);
        match ctx.banks_client.process_transaction(tx).await
            .expect_err("buy must be REJECTED when the pool's implied price exceeds max_price_bps") {
            BanksClientError::TransactionError(TransactionError::InstructionError(_, InstructionError::Custom(code))) =>
                assert_eq!(code, LYNX_ERROR_SLIPPAGE_EXCEEDED, "must fail with LynxError::SlippageExceeded"),
            other => panic!("expected Custom({LYNX_ERROR_SLIPPAGE_EXCEEDED}) SlippageExceeded, got: {other:?}"),
        }
    }

    // 3. cut off at cutoff_ts
    set_clock(&mut ctx, 10, cutoff_ts).await;
    process(&mut ctx, Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::CutOffMarket { market: market_pda }.to_account_metas(None),
        data: lynx_project::instruction::CutOffMarket {}.data(),
    }, &[]).await;

    // 4. oracle proposes YES at resolve_ts
    set_clock(&mut ctx, 20, resolve_ts).await;
    process(&mut ctx, Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ProposeResolution { config, market: market_pda, supply_twap, oracle_authority: oracle.pubkey() }.to_account_metas(None),
        data: lynx_project::instruction::ProposeResolution { result: Outcome::Yes }.data(),
    }, &[&oracle]).await;

    // 5. finalize after the 24h dispute window elapses
    set_clock(&mut ctx, 30, resolve_ts + DISPUTE_WINDOW_SECONDS + 1).await;
    process(&mut ctx, Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::FinalizeResolution { config, market: market_pda, vault: vault_pda, rewards_vault, treasury: treasury.pubkey() }.to_account_metas(None),
        data: lynx_project::instruction::FinalizeResolution {}.data(),
    }, &[]).await;

    // 6. winner claims
    let before = ctx.banks_client.get_balance(winner.pubkey()).await.unwrap();
    process(&mut ctx, Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ClaimMarketSol { market: market_pda, vault: vault_pda, position: winner_pos, claimant: winner.pubkey() }.to_account_metas(None),
        data: lynx_project::instruction::ClaimMarketSol {}.data(),
    }, &[&winner]).await;
    let after = ctx.banks_client.get_balance(winner.pubkey()).await.unwrap();

    // Pool 20 SOL, YES side = winner's 10 SOL. payout_pool = 90% * 20 = 18 SOL,
    // winner is sole YES staker → gets all 18 SOL.
    assert_eq!(after - before, 18 * LAMPORTS_PER_SOL, "winner must receive 18 SOL through the full lifecycle");
}

#[tokio::test]
async fn protocol_duel_rejects_foreign_lynx_account() {
    let pid = program_id();
    let treasury = Keypair::new();
    let creator = Keypair::new();
    let attacker = Keypair::new();
    let lynx_mint = Pubkey::new_unique();

    let (config, _) = config_pda();

    // Parent market: ternary, resolved so the creator's side wins.
    let market_id: u64 = 7;
    let (market_pda, market_bump) = Pubkey::find_program_address(&[b"market", &market_id.to_le_bytes()], &pid);
    let mut market = seed_resolved_ternary_market(market_id, market_bump, Outcome::Yes);
    market.mint_ratio_bps = 10_000; // non-zero so the LYNX mint path would run

    // Duel: protocol duel, active, creator bet YES (the winning side).
    let duel_id: u64 = 1;
    let (duel_pda, duel_bump) = Pubkey::find_program_address(&[b"duel", market_pda.as_ref(), creator.pubkey().as_ref(), &duel_id.to_le_bytes()], &pid);
    let (duel_vault_pda, dv_bump) = Pubkey::find_program_address(&[b"duel_vault", duel_pda.as_ref()], &pid);
    let duel = Duel {
        parent_market: market_pda,
        creator: creator.pubkey(),
        rival: config,
        id: duel_id,
        amount: LAMPORTS_PER_SOL,
        creator_outcome: Outcome::Yes,
        rival_outcome: Outcome::No,
        duel_type: DuelType::OneVOneVProtocol,
        status: DuelStatus::Active,
        expires_ts: 1,
        bump: duel_bump,
        vault_bump: dv_bump,
    };

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    // create_duel increments protocol_duel_exposure by the duel amount, and
    // resolve_protocol_duel decrements it on settlement. Seeding it at 0 while an
    // Active 1 SOL duel exists is an impossible state that made the instruction
    // fail with MathOverflow on the checked_sub — masking whether the security
    // constraint was doing any work at all.
    let mut cfg = seed_config(Pubkey::new_unique(), treasury.pubkey(), lynx_mint);
    cfg.protocol_duel_exposure = LAMPORTS_PER_SOL;
    pt.add_account(config, program_account(account_bytes(&cfg), 0));
    pt.add_account(market_pda, program_account(account_bytes(&market), 0));
    pt.add_account(duel_pda, program_account(account_bytes(&duel), 0));
    pt.add_account(duel_vault_pda, program_account(account_bytes(&lynx_project::state::DuelVault { duel: duel_pda, bump: dv_bump }), LAMPORTS_PER_SOL));
    pt.add_account(lynx_mint, spl_mint(config));
    // PASO 13: resolve_protocol_duel ahora acredita la mitad del SOL ganado a los
    // stakers via el rewards_vault, asi que la cuenta debe existir en el test.
    pt.add_account(rewards_vault_pda().0, program_account(account_bytes(&RewardsVault { bump: rewards_vault_pda().1 }), 0));
    pt.add_account(treasury.pubkey(), funded_wallet(LAMPORTS_PER_SOL));
    pt.add_account(creator.pubkey(), funded_wallet(LAMPORTS_PER_SOL));
    // The attack: a LYNX token account owned by the ATTACKER, not the creator.
    let attacker_lynx = Pubkey::new_unique();
    pt.add_account(attacker_lynx, spl_token_account(lynx_mint, attacker.pubkey()));

    let ctx = pt.start_with_context().await;

    let ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::ResolveProtocolDuel {
            config,
            parent_market: market_pda,
            duel: duel_pda,
            duel_vault: duel_vault_pda,
            recipient: creator.pubkey(), // SOL leg correctly targets the creator…
            lynx_mint,
            recipient_lynx_account: attacker_lynx, // …but the LYNX leg is hijacked
            treasury: treasury.pubkey(),
            rewards_vault: rewards_vault_pda().0,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::ResolveProtocolDuel {}.data(),
    };

    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    let mut tx = tx;
    tx.sign(&[&ctx.payer], blockhash);
    let result = ctx.banks_client.process_transaction(tx).await;

    // Must be rejected, and specifically by the owner constraint (Unauthorized /
    // 6003) — not by some incidental failure that would make this a false pass.
    match result.expect_err("resolve_protocol_duel must REJECT a foreign recipient_lynx_account (C-04)") {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => assert_eq!(
            code, LYNX_ERROR_UNAUTHORIZED,
            "must fail with LynxError::Unauthorized (the recipient_lynx_account.owner == duel.creator constraint)"
        ),
        other => panic!("expected Custom({LYNX_ERROR_UNAUTHORIZED}) Unauthorized, got: {other:?}"),
    }
}

fn seed_resolved_ternary_market(id: u64, bump: u8, result: Outcome) -> Market {
    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[b"vault", Pubkey::find_program_address(&[b"market", &id.to_le_bytes()], &program_id()).0.as_ref()],
        &program_id(),
    );
    Market {
        id,
        admin: Pubkey::new_unique(),
        vault: vault_pda,
        oracle_authority: Pubkey::new_unique(),
        title: "duel parent".to_string(),
        currency: Currency::SOL,
        status: MarketStatus::Resolved,
        is_ternary: true,
        cutoff_ts: 0,
        resolve_ts: 0,
        oracle_deadline: 0,
        resolved_ts: 1,
        result,
        pool_total: 0,
        yes_total: 0,
        no_total: 0,
        draw_total: 0,
        winning_total: 0,
        burned_lynx: 0,
        bump,
        vault_bump,
        lynx_vault_bump: 0,
        mint_ratio_bps: 0,
        swept: false,
        proposed_result: result,
        proposed_ts: 1,
        mint_ratio_snapshot_bps: 0,
        total_claimed: 0,
        resolved_by: Pubkey::new_unique(),
    }
}
