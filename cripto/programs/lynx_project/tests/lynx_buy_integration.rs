//! Does the LYNX *entry* path work at all?
//!
//! `ClaimMarketLynx::try_accounts` overflowed the 4096-byte BPF stack by 72
//! bytes and hard-faulted at runtime ("Access violation ... at address 0x8"),
//! which meant LYNX market winners could never be paid. The SBF linker reports
//! the same class of overflow for `BuyPositionLynxWithBurn` (+64 bytes).
//!
//! If buying also faults, LYNX-denominated markets are non-functional end to
//! end: users cannot enter, and (before the Box fix) could not exit either.
//! Only executing the compiled bytecode can settle this.

use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
use lynx_project::constants::LYNX_EVENT_BURN_BPS;
use lynx_project::state::{Currency, Market, MarketStatus, Outcome, ProtocolConfig};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    clock::Clock,
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

const BUY_AMOUNT: u64 = 10_000_000; // 10 LYNX (6 decimals)
const MARKET_ID: u64 = 500;
const NOW_TS: i64 = 1_700_000_000;

#[tokio::test]
async fn buying_into_a_lynx_market_works() {
    let pid = program_id();
    let buyer = Keypair::new();
    let lynx_mint = Pubkey::new_unique();

    let (config_pda, config_bump) = Pubkey::find_program_address(&[b"config"], &pid);
    let (market_pda, market_bump) =
        Pubkey::find_program_address(&[b"market", &MARKET_ID.to_le_bytes()], &pid);
    let (lynx_vault_pda, _) = Pubkey::find_program_address(&[b"lynx_vault", market_pda.as_ref()], &pid);
    let (position_pda, _) = Pubkey::find_program_address(
        &[b"position", market_pda.as_ref(), buyer.pubkey().as_ref(), &[Outcome::Yes.as_seed()]],
        &pid,
    );

    let config = ProtocolConfig {
        admin: Pubkey::new_unique(),
        treasury: Pubkey::new_unique(),
        lynx_mint,
        stake_vault: Pubkey::new_unique(),
        rewards_vault: Pubkey::new_unique(),
        total_lynx_supply: 1_000_000_000,
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

    // Open LYNX market whose cutoff is still in the future.
    let market = Market {
        id: MARKET_ID,
        admin: Pubkey::new_unique(),
        vault: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        title: "LYNX entry".to_string(),
        currency: Currency::LYNX,
        status: MarketStatus::Open,
        is_ternary: false,
        cutoff_ts: NOW_TS + 3_600,
        resolve_ts: NOW_TS + 7_200,
        oracle_deadline: NOW_TS + 10_800,
        resolved_ts: 0,
        result: Outcome::Unresolved,
        pool_total: 0,
        yes_total: 0,
        no_total: 0,
        draw_total: 0,
        winning_total: 0,
        burned_lynx: 0,
        bump: market_bump,
        vault_bump: 0,
        lynx_vault_bump: 0, // set by the instruction on first LYNX purchase
        mint_ratio_bps: 0,
        swept: false,
        proposed_result: Outcome::Unresolved,
        proposed_ts: 0,
        mint_ratio_snapshot_bps: 0,
        total_claimed: 0,
        resolved_by: Pubkey::default(),
    };

    let user_lynx = Pubkey::new_unique();

    let mut pt = ProgramTest::new("lynx_project", pid, None);
    pt.add_account(config_pda, program_account(account_bytes(&config)));
    pt.add_account(market_pda, program_account(account_bytes(&market)));
    pt.add_account(lynx_mint, spl_mint(config_pda, 1_000_000_000));
    pt.add_account(user_lynx, spl_token_account(lynx_mint, buyer.pubkey(), BUY_AMOUNT));
    // Buyer funds rent for the position PDA and the market LYNX vault it creates.
    pt.add_account(
        buyer.pubkey(),
        Account { lamports: 5 * LAMPORTS_PER_SOL, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 },
    );
    // NOTE: lynx_vault_pda and position_pda are deliberately NOT seeded — the
    // instruction creates them via init_if_needed, which is part of what makes
    // this try_accounts frame large.

    let ctx: ProgramTestContext = pt.start_with_context().await;
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = NOW_TS;
    ctx.set_sysvar(&clock);

    // The market's LYNX vault is now created by its own one-time instruction
    // instead of `init_if_needed` inside the buy path (whose init codegen blew
    // the BPF stack). This mirrors what a real client does after create_market.
    let init_vault_ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::InitMarketLynxVault {
            config: config_pda,
            market: market_pda,
            lynx_mint,
            market_lynx_vault: lynx_vault_pda,
            payer: buyer.pubkey(),
            token_program: spl_token::id(),
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::InitMarketLynxVault {}.data(),
    };
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut init_tx = Transaction::new_with_payer(&[init_vault_ix], Some(&ctx.payer.pubkey()));
    init_tx.sign(&[&ctx.payer, &buyer], blockhash);
    ctx.banks_client
        .process_transaction(init_tx)
        .await
        .expect("init_market_lynx_vault must succeed");

    let ix = Instruction {
        program_id: pid,
        accounts: lynx_project::accounts::BuyPositionLynxWithBurn {
            config: config_pda,
            market: market_pda,
            position: position_pda,
            lynx_mint,
            user_lynx_account: user_lynx,
            market_lynx_vault: lynx_vault_pda,
            buyer: buyer.pubkey(),
            token_program: spl_token::id(),
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: lynx_project::instruction::BuyPositionLynxWithBurn {
            outcome: Outcome::Yes,
            amount: BUY_AMOUNT,
        }
        .data(),
    };

    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&ctx.payer.pubkey()));
    tx.sign(&[&ctx.payer, &buyer], blockhash);

    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("a user must be able to buy into a LYNX market");

    // 15% of the stake is burned on entry; the rest is escrowed in the market vault.
    let burn = BUY_AMOUNT * LYNX_EVENT_BURN_BPS / 10_000;
    let net = BUY_AMOUNT - burn;

    let vault = ctx.banks_client.get_account(lynx_vault_pda).await.unwrap().unwrap();
    let vault_balance = spl_token::state::Account::unpack(&vault.data).unwrap().amount;
    assert_eq!(vault_balance, net, "market vault must hold the stake net of the burn");

    let user = ctx.banks_client.get_account(user_lynx).await.unwrap().unwrap();
    let user_balance = spl_token::state::Account::unpack(&user.data).unwrap().amount;
    assert_eq!(user_balance, 0, "the buyer's whole stake left their account");

    let refreshed_market = ctx.banks_client.get_account(market_pda).await.unwrap().unwrap();
    let m = {
        use anchor_lang::AccountDeserialize;
        Market::try_deserialize(&mut refreshed_market.data.as_slice()).unwrap()
    };
    assert_eq!(m.pool_total, net, "pool must grow by the net stake");
    assert_eq!(m.yes_total, net, "the YES side must record the stake");
    assert_eq!(m.burned_lynx, burn, "the burn must be recorded on the market");
}
