use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod constants;
pub mod error;
pub mod state;

use constants::*;
use error::LynxError;
use state::*;

declare_id!("CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu");

#[program]
pub mod lynx_project {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, emergency_delay: i64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = ctx.accounts.treasury.key();
        config.lynx_mint = ctx.accounts.lynx_mint.key();
        config.stake_vault = ctx.accounts.stake_vault.key();
        config.rewards_vault = ctx.accounts.rewards_vault.key();
        config.total_lynx_supply = 0;
        config.total_lynx_burned = 0;
        config.total_staked = 0;
        config.reward_per_token_scaled = 0;
        config.emergency_delay = emergency_delay;
        config.bump = ctx.bumps.config;
        config.stake_vault_bump = 0;
        config.rewards_vault_bump = ctx.bumps.rewards_vault;
        ctx.accounts.rewards_vault.bump = ctx.bumps.rewards_vault;
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);
        ctx.accounts.config.admin = new_admin;
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        title: String,
        oracle_authority: Pubkey,
        cutoff_ts: i64,
        resolve_ts: i64,
        currency: Currency,
        is_ternary: bool,
    ) -> Result<()> {
        require!(title.len() <= Market::TITLE_MAX, LynxError::TextTooLong);
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);
        let now = Clock::get()?.unix_timestamp;
        require!(cutoff_ts > now, LynxError::CutoffInPast);
        require!(resolve_ts > cutoff_ts, LynxError::CutoffInPast);

        let market = &mut ctx.accounts.market;
        market.id = market_id;
        market.admin = ctx.accounts.admin.key();
        market.vault = ctx.accounts.vault.key();
        market.oracle_authority = oracle_authority;
        market.title = title;
        market.currency = currency;
        market.status = MarketStatus::Open;
        market.is_ternary = is_ternary;
        market.cutoff_ts = cutoff_ts;
        market.resolve_ts = resolve_ts;
        market.oracle_deadline = resolve_ts.checked_add(ORACLE_TIMEOUT_SECONDS).ok_or(LynxError::MathOverflow)?;
        market.resolved_ts = 0;
        market.result = Outcome::Unresolved;
        market.pool_total = 0;
        market.yes_total = 0;
        market.no_total = 0;
        market.draw_total = 0;
        market.winning_total = 0;
        market.burned_lynx = 0;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;

        let vault = &mut ctx.accounts.vault;
        vault.market = market.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn buy_position_sol(ctx: Context<BuyPositionSol>, outcome: Outcome, lamports: u64) -> Result<()> {
        require!(lamports > 0, LynxError::InvalidAmount);
        require!(outcome_is_tradeable(outcome, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);

        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Open || market.status == MarketStatus::Active, LynxError::MarketClosed);
        require!(now < market.cutoff_ts, LynxError::MarketClosed);

        invoke(
            &system_instruction::transfer(&ctx.accounts.buyer.key(), &ctx.accounts.vault.key(), lamports),
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        add_market_amounts(market, outcome, lamports)?;
        write_position(
            &mut ctx.accounts.position,
            market.key(),
            ctx.accounts.buyer.key(),
            outcome,
            lamports,
            ctx.bumps.position,
        )?;
        Ok(())
    }

    pub fn buy_position_lynx_with_burn(ctx: Context<BuyPositionLynxWithBurn>, outcome: Outcome, amount: u64) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(outcome_is_tradeable(outcome, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require!(ctx.accounts.market.currency == Currency::LYNX, LynxError::InvalidCurrency);

        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open || market.status == MarketStatus::Active, LynxError::MarketClosed);
        require!(now < market.cutoff_ts, LynxError::MarketClosed);

        let burn_amount = bps(amount, LYNX_EVENT_BURN_BPS)?;
        if burn_amount > 0 {
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.lynx_mint.to_account_info(),
                        from: ctx.accounts.user_lynx_account.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                burn_amount,
            )?;
        }
        let net_amount = amount.checked_sub(burn_amount).ok_or(LynxError::MathOverflow)?;
        if net_amount > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_lynx_account.to_account_info(),
                        to: ctx.accounts.market_lynx_vault.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                net_amount,
            )?;
        }

        market.burned_lynx = market.burned_lynx.checked_add(burn_amount).ok_or(LynxError::MathOverflow)?;
        ctx.accounts.config.total_lynx_burned = ctx
            .accounts
            .config
            .total_lynx_burned
            .checked_add(burn_amount)
            .ok_or(LynxError::MathOverflow)?;

        add_market_amounts(market, outcome, net_amount)?;
        write_position(
            &mut ctx.accounts.position,
            market.key(),
            ctx.accounts.buyer.key(),
            outcome,
            net_amount,
            ctx.bumps.position,
        )?;
        Ok(())
    }

    pub fn cut_off_market(ctx: Context<CutOffMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open || market.status == MarketStatus::Active, LynxError::InvalidStatus);
        require!(Clock::get()?.unix_timestamp >= market.cutoff_ts, LynxError::CutoffNotReached);
        market.status = MarketStatus::CutOff;
        Ok(())
    }

    pub fn resolve_market_oracle(ctx: Context<ResolveMarketOracle>, result: Outcome) -> Result<()> {
        require!(result_is_valid(result, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require_keys_eq!(ctx.accounts.oracle_authority.key(), ctx.accounts.market.oracle_authority, LynxError::Unauthorized);
        require!(Clock::get()?.unix_timestamp >= ctx.accounts.market.resolve_ts, LynxError::ResolveTimeNotReached);
        finalize_market_and_fees(
            &mut ctx.accounts.config,
            &mut ctx.accounts.market,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.rewards_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            result,
        )
    }

    pub fn resolve_market_admin(ctx: Context<ResolveMarketAdmin>, result: Outcome) -> Result<()> {
        require!(result_is_valid(result, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);
        require!(Clock::get()?.unix_timestamp >= ctx.accounts.market.oracle_deadline, LynxError::OracleTimeoutNotReached);
        finalize_market_and_fees(
            &mut ctx.accounts.config,
            &mut ctx.accounts.market,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.rewards_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            result,
        )
    }

    pub fn claim_market_sol(ctx: Context<ClaimMarketSol>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(!position.claimed, LynxError::AlreadyClaimed);
        require!(position_is_winner(market, position), LynxError::LosingPosition);

        let denominator = if market.result == Outcome::Draw { market.pool_total } else { market.winning_total };
        require!(denominator > 0, LynxError::NoWinningPool);
        let payout_pool = bps(market.pool_total, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS)?;
        let payout = payout_pool
            .checked_mul(position.amount).ok_or(LynxError::MathOverflow)?
            .checked_div(denominator).ok_or(LynxError::MathOverflow)?;

        transfer_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.claimant.to_account_info(), payout)?;
        position.claimed = true;
        Ok(())
    }

    pub fn mint_lynx_distribution(ctx: Context<MintLynxDistribution>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(!ctx.accounts.position.lynx_minted, LynxError::AlreadyClaimed);
        require!(market.pool_total > 0, LynxError::InvalidAmount);

        let total_micro_lynx = market
            .pool_total
            .checked_div(LAMPORTS_TO_MICRO_LYNX_DENOMINATOR)
            .ok_or(LynxError::MathOverflow)?;
        let position_amount = ctx.accounts.position.amount;
        let participant_amount = prorated_bps(total_micro_lynx, LYNX_PARTICIPANT_BPS, position_amount, market.pool_total)?;
        let treasury_amount = prorated_bps(total_micro_lynx, LYNX_TREASURY_BPS, position_amount, market.pool_total)?;
        let sale_amount = prorated_bps(total_micro_lynx, LYNX_INITIAL_SALE_BPS, position_amount, market.pool_total)?;

        let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        mint_to_lynx(
            &ctx.accounts.token_program,
            &ctx.accounts.lynx_mint,
            &ctx.accounts.config,
            &ctx.accounts.holder_lynx_account,
            participant_amount,
            signer,
        )?;
        mint_to_lynx(
            &ctx.accounts.token_program,
            &ctx.accounts.lynx_mint,
            &ctx.accounts.config,
            &ctx.accounts.treasury_lynx_account,
            treasury_amount,
            signer,
        )?;
        mint_to_lynx(
            &ctx.accounts.token_program,
            &ctx.accounts.lynx_mint,
            &ctx.accounts.config,
            &ctx.accounts.initial_sale_lynx_account,
            sale_amount,
            signer,
        )?;

        let minted = participant_amount
            .checked_add(treasury_amount).ok_or(LynxError::MathOverflow)?
            .checked_add(sale_amount).ok_or(LynxError::MathOverflow)?;
        ctx.accounts.config.total_lynx_supply = ctx
            .accounts
            .config
            .total_lynx_supply
            .checked_add(minted)
            .ok_or(LynxError::MathOverflow)?;
        ctx.accounts.position.lynx_minted = true;
        Ok(())
    }

    pub fn stake_lynx(ctx: Context<StakeLynx>, amount: u64) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        settle_staker(&ctx.accounts.config, &mut ctx.accounts.stake_position)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_lynx_account.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        ctx.accounts.stake_position.owner = ctx.accounts.owner.key();
        ctx.accounts.stake_position.amount = ctx.accounts.stake_position.amount.checked_add(amount).ok_or(LynxError::MathOverflow)?;
        ctx.accounts.stake_position.reward_debt_scaled = reward_debt(ctx.accounts.stake_position.amount, ctx.accounts.config.reward_per_token_scaled)?;
        ctx.accounts.stake_position.bump = ctx.bumps.stake_position;
        ctx.accounts.config.total_staked = ctx.accounts.config.total_staked.checked_add(amount).ok_or(LynxError::MathOverflow)?;
        Ok(())
    }

    pub fn unstake_lynx(ctx: Context<UnstakeLynx>, amount: u64) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(ctx.accounts.stake_position.amount >= amount, LynxError::InsufficientFunds);
        settle_staker(&ctx.accounts.config, &mut ctx.accounts.stake_position)?;

        let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.user_lynx_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        ctx.accounts.stake_position.amount = ctx.accounts.stake_position.amount.checked_sub(amount).ok_or(LynxError::MathOverflow)?;
        ctx.accounts.stake_position.reward_debt_scaled = reward_debt(ctx.accounts.stake_position.amount, ctx.accounts.config.reward_per_token_scaled)?;
        ctx.accounts.config.total_staked = ctx.accounts.config.total_staked.checked_sub(amount).ok_or(LynxError::MathOverflow)?;
        Ok(())
    }

    pub fn claim_staking_rewards(ctx: Context<ClaimStakingRewards>) -> Result<()> {
        settle_staker(&ctx.accounts.config, &mut ctx.accounts.stake_position)?;
        let amount = ctx.accounts.stake_position.pending_rewards;
        require!(amount > 0, LynxError::InvalidAmount);
        transfer_lamports(&ctx.accounts.rewards_vault.to_account_info(), &ctx.accounts.owner.to_account_info(), amount)?;
        ctx.accounts.stake_position.pending_rewards = 0;
        ctx.accounts.stake_position.reward_debt_scaled = reward_debt(ctx.accounts.stake_position.amount, ctx.accounts.config.reward_per_token_scaled)?;
        Ok(())
    }

    pub fn create_duel(ctx: Context<CreateDuel>, duel_id: u64, amount: u64, creator_outcome: Outcome, duel_type: DuelType, expires_ts: i64) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(outcome_is_tradeable(creator_outcome, ctx.accounts.parent_market.is_ternary), LynxError::InvalidOutcome);
        require!(ctx.accounts.parent_market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(ctx.accounts.parent_market.status == MarketStatus::Open || ctx.accounts.parent_market.status == MarketStatus::Active, LynxError::MarketClosed);
        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.parent_market.cutoff_ts, LynxError::MarketClosed);
        require!(now < expires_ts && expires_ts <= ctx.accounts.parent_market.cutoff_ts, LynxError::DuelExpired);
        require!(
            (duel_type == DuelType::OneVOne && !ctx.accounts.parent_market.is_ternary) ||
            (duel_type == DuelType::OneVOneVProtocol && ctx.accounts.parent_market.is_ternary),
            LynxError::InvalidDuelType
        );

        invoke(
            &system_instruction::transfer(&ctx.accounts.creator.key(), &ctx.accounts.duel_vault.key(), amount),
            &[
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.duel_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let duel = &mut ctx.accounts.duel;
        duel.parent_market = ctx.accounts.parent_market.key();
        duel.creator = ctx.accounts.creator.key();
        duel.rival = if duel_type == DuelType::OneVOneVProtocol { ctx.accounts.config.key() } else { Pubkey::default() };
        duel.id = duel_id;
        duel.amount = amount;
        duel.creator_outcome = creator_outcome;
        duel.rival_outcome = if duel_type == DuelType::OneVOneVProtocol {
            default_rival_outcome(creator_outcome, ctx.accounts.parent_market.is_ternary)
        } else {
            Outcome::Unresolved
        };
        duel.duel_type = duel_type;
        duel.status = if duel_type == DuelType::OneVOneVProtocol { DuelStatus::Active } else { DuelStatus::Open };
        duel.expires_ts = expires_ts;
        duel.bump = ctx.bumps.duel;
        duel.vault_bump = ctx.bumps.duel_vault;

        ctx.accounts.duel_vault.duel = duel.key();
        ctx.accounts.duel_vault.bump = ctx.bumps.duel_vault;
        Ok(())
    }

    pub fn accept_duel(ctx: Context<AcceptDuel>, rival_outcome: Outcome) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        require!(duel.duel_type == DuelType::OneVOne, LynxError::InvalidDuelType);
        require!(duel.status == DuelStatus::Open, LynxError::InvalidStatus);
        require!(ctx.accounts.parent_market.status == MarketStatus::Open || ctx.accounts.parent_market.status == MarketStatus::Active, LynxError::MarketClosed);
        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.parent_market.cutoff_ts, LynxError::MarketClosed);
        require!(now < duel.expires_ts, LynxError::DuelExpired);
        require!(outcome_is_tradeable(rival_outcome, ctx.accounts.parent_market.is_ternary), LynxError::InvalidOutcome);
        require!(ctx.accounts.rival.key() != duel.creator, LynxError::Unauthorized);
        require!(rival_outcome != duel.creator_outcome, LynxError::SameDuelOutcome);

        invoke(
            &system_instruction::transfer(&ctx.accounts.rival.key(), &ctx.accounts.duel_vault.key(), duel.amount),
            &[
                ctx.accounts.rival.to_account_info(),
                ctx.accounts.duel_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        duel.rival = ctx.accounts.rival.key();
        duel.rival_outcome = rival_outcome;
        duel.status = DuelStatus::Active;
        Ok(())
    }

    pub fn resolve_duel_sol(ctx: Context<ResolveDuelSol>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        let market = &ctx.accounts.parent_market;
        require!(duel.duel_type == DuelType::OneVOne, LynxError::InvalidDuelType);
        require!(duel.status == DuelStatus::Active, LynxError::InvalidStatus);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);

        let creator_wins = market.result == duel.creator_outcome;
        let rival_wins = market.result == duel.rival_outcome;
        let recipient_key = if creator_wins && !rival_wins {
            duel.creator
        } else if rival_wins && !creator_wins {
            duel.rival
        } else {
            ctx.accounts.config.treasury
        };
        require_keys_eq!(ctx.accounts.recipient.key(), recipient_key, LynxError::Unauthorized);

        let total = duel.amount.checked_mul(2).ok_or(LynxError::MathOverflow)?;
        let fee = bps(total, GLOBAL_TRADE_FEE_BPS)?;
        if recipient_key == ctx.accounts.config.treasury {
            transfer_lamports(&ctx.accounts.duel_vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), total)?;
        } else {
            transfer_lamports(&ctx.accounts.duel_vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), fee)?;
            transfer_lamports(&ctx.accounts.duel_vault.to_account_info(), &ctx.accounts.recipient.to_account_info(), total.checked_sub(fee).ok_or(LynxError::MathOverflow)?)?;
        }
        duel.status = DuelStatus::Resolved;
        Ok(())
    }

    pub fn resolve_protocol_duel(ctx: Context<ResolveProtocolDuel>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        let market = &ctx.accounts.parent_market;
        require!(duel.duel_type == DuelType::OneVOneVProtocol, LynxError::InvalidDuelType);
        require!(duel.status == DuelStatus::Active, LynxError::InvalidStatus);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);

        let creator_wins = market.result == duel.creator_outcome;
        if creator_wins {
            require_keys_eq!(ctx.accounts.recipient.key(), duel.creator, LynxError::Unauthorized);
            transfer_lamports(&ctx.accounts.duel_vault.to_account_info(), &ctx.accounts.recipient.to_account_info(), duel.amount)?;
            let payout_micro_lynx = duel
                .amount
                .checked_div(LAMPORTS_TO_MICRO_LYNX_DENOMINATOR)
                .ok_or(LynxError::MathOverflow)?;
            let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.lynx_mint.to_account_info(),
                        to: ctx.accounts.recipient_lynx_account.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                payout_micro_lynx,
            )?;
            ctx.accounts.config.total_lynx_supply = ctx
                .accounts
                .config
                .total_lynx_supply
                .checked_add(payout_micro_lynx)
                .ok_or(LynxError::MathOverflow)?;
        } else {
            transfer_lamports(&ctx.accounts.duel_vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), duel.amount)?;
        }
        duel.status = DuelStatus::Resolved;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(init, payer = admin, space = ProtocolConfig::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub lynx_mint: Account<'info, Mint>,
    #[account(mut)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(init, payer = admin, space = RewardsVault::LEN, seeds = [b"rewards_vault"], bump)]
    pub rewards_vault: Account<'info, RewardsVault>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: treasury wallet configured by deployer
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(init, payer = admin, space = Market::LEN, seeds = [b"market", market_id.to_le_bytes().as_ref()], bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = admin, space = MarketVault::LEN, seeds = [b"vault", market.key().as_ref()], bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(outcome: Outcome)]
pub struct BuyPositionSol<'info> {
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), buyer.key().as_ref(), &[outcome.as_seed()]],
        bump
    )]
    pub position: Account<'info, UserPosition>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(outcome: Outcome)]
pub struct BuyPositionLynxWithBurn<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), buyer.key().as_ref(), &[outcome.as_seed()]],
        bump
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub user_lynx_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = market_lynx_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency,
        constraint = market_lynx_vault.owner == config.key() @ LynxError::Unauthorized
    )]
    pub market_lynx_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CutOffMarket<'info> {
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ResolveMarketOracle<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut, seeds = [b"rewards_vault"], bump = rewards_vault.bump)]
    pub rewards_vault: Account<'info, RewardsVault>,
    pub oracle_authority: Signer<'info>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResolveMarketAdmin<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut, seeds = [b"rewards_vault"], bump = rewards_vault.bump)]
    pub rewards_vault: Account<'info, RewardsVault>,
    pub admin: Signer<'info>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimMarketSol<'info> {
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut, has_one = market, constraint = position.owner == claimant.key() @ LynxError::Unauthorized)]
    pub position: Account<'info, UserPosition>,
    #[account(mut)]
    pub claimant: Signer<'info>,
}

#[derive(Accounts)]
pub struct MintLynxDistribution<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, has_one = market, constraint = position.owner == payer.key() @ LynxError::Unauthorized)]
    pub position: Account<'info, UserPosition>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Account<'info, Mint>,
    #[account(mut)]
    pub holder_lynx_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_lynx_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initial_sale_lynx_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct StakeLynx<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, address = config.stake_vault)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = StakePosition::LEN,
        seeds = [b"stake", owner.key().as_ref()],
        bump
    )]
    pub stake_position: Account<'info, StakePosition>,
    #[account(mut)]
    pub user_lynx_account: Account<'info, TokenAccount>,
    #[account(address = config.lynx_mint)]
    pub lynx_mint: Account<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeLynx<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, address = config.stake_vault)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"stake", owner.key().as_ref()], bump = stake_position.bump, has_one = owner)]
    pub stake_position: Account<'info, StakePosition>,
    #[account(mut)]
    pub user_lynx_account: Account<'info, TokenAccount>,
    #[account(address = config.lynx_mint)]
    pub lynx_mint: Account<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimStakingRewards<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"rewards_vault"], bump = rewards_vault.bump)]
    pub rewards_vault: Account<'info, RewardsVault>,
    #[account(mut, seeds = [b"stake", owner.key().as_ref()], bump = stake_position.bump, has_one = owner)]
    pub stake_position: Account<'info, StakePosition>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(duel_id: u64)]
pub struct CreateDuel<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"market", parent_market.id.to_le_bytes().as_ref()], bump = parent_market.bump)]
    pub parent_market: Account<'info, Market>,
    #[account(init, payer = creator, space = Duel::LEN, seeds = [b"duel", parent_market.key().as_ref(), creator.key().as_ref(), duel_id.to_le_bytes().as_ref()], bump)]
    pub duel: Account<'info, Duel>,
    #[account(init, payer = creator, space = DuelVault::LEN, seeds = [b"duel_vault", duel.key().as_ref()], bump)]
    pub duel_vault: Account<'info, DuelVault>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptDuel<'info> {
    #[account(mut, seeds = [b"duel", duel.parent_market.as_ref(), duel.creator.as_ref(), duel.id.to_le_bytes().as_ref()], bump = duel.bump)]
    pub duel: Account<'info, Duel>,
    #[account(seeds = [b"market", parent_market.id.to_le_bytes().as_ref()], bump = parent_market.bump, constraint = parent_market.key() == duel.parent_market @ LynxError::InvalidStatus)]
    pub parent_market: Account<'info, Market>,
    #[account(mut, seeds = [b"duel_vault", duel.key().as_ref()], bump = duel_vault.bump)]
    pub duel_vault: Account<'info, DuelVault>,
    #[account(mut)]
    pub rival: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveDuelSol<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"market", parent_market.id.to_le_bytes().as_ref()], bump = parent_market.bump)]
    pub parent_market: Account<'info, Market>,
    #[account(mut, has_one = parent_market)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"duel_vault", duel.key().as_ref()], bump = duel_vault.bump)]
    pub duel_vault: Account<'info, DuelVault>,
    /// CHECK: checked against duel winner
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResolveProtocolDuel<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"market", parent_market.id.to_le_bytes().as_ref()], bump = parent_market.bump)]
    pub parent_market: Account<'info, Market>,
    #[account(mut, has_one = parent_market)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"duel_vault", duel.key().as_ref()], bump = duel_vault.bump)]
    pub duel_vault: Account<'info, DuelVault>,
    /// CHECK: checked against duel creator
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Account<'info, Mint>,
    #[account(mut)]
    pub recipient_lynx_account: Account<'info, TokenAccount>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

fn add_market_amounts(market: &mut Account<Market>, outcome: Outcome, amount: u64) -> Result<()> {
    market.status = MarketStatus::Active;
    market.pool_total = market.pool_total.checked_add(amount).ok_or(LynxError::MathOverflow)?;
    match outcome {
        Outcome::Yes => market.yes_total = market.yes_total.checked_add(amount).ok_or(LynxError::MathOverflow)?,
        Outcome::No => market.no_total = market.no_total.checked_add(amount).ok_or(LynxError::MathOverflow)?,
        Outcome::Draw => market.draw_total = market.draw_total.checked_add(amount).ok_or(LynxError::MathOverflow)?,
        Outcome::Unresolved => return err!(LynxError::InvalidOutcome),
    }
    Ok(())
}

fn write_position(
    position: &mut Account<UserPosition>,
    market: Pubkey,
    owner: Pubkey,
    outcome: Outcome,
    amount: u64,
    bump: u8,
) -> Result<()> {
    if position.amount == 0 {
        position.market = market;
        position.owner = owner;
        position.outcome = outcome;
        position.claimed = false;
        position.lynx_minted = false;
        position.bump = bump;
    }
    position.amount = position.amount.checked_add(amount).ok_or(LynxError::MathOverflow)?;
    Ok(())
}

fn finalize_market_and_fees<'info>(
    config: &mut Account<'info, ProtocolConfig>,
    market: &mut Account<'info, Market>,
    vault: &AccountInfo<'info>,
    rewards_vault: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    result: Outcome,
) -> Result<()> {
    require!(market.status == MarketStatus::CutOff || market.status == MarketStatus::Active || market.status == MarketStatus::Open, LynxError::InvalidStatus);
    market.status = MarketStatus::Resolved;
    market.result = result;
    market.resolved_ts = Clock::get()?.unix_timestamp;
    market.winning_total = match result {
        Outcome::Yes => market.yes_total,
        Outcome::No => market.no_total,
        Outcome::Draw => {
            if market.is_ternary { market.draw_total } else { market.pool_total }
        }
        Outcome::Unresolved => 0,
    };

    if market.currency == Currency::SOL && market.pool_total > 0 {
        let reward_fee = bps(market.pool_total, STAKER_REWARD_FEE_BPS)?;
        let treasury_fee = bps(market.pool_total, TREASURY_EVENT_FEE_BPS)?;
        if reward_fee > 0 && config.total_staked > 0 {
            transfer_lamports(vault, rewards_vault, reward_fee)?;
            config.reward_per_token_scaled = config
                .reward_per_token_scaled
                .checked_add((reward_fee as u128).checked_mul(REWARD_SCALE).ok_or(LynxError::MathOverflow)?.checked_div(config.total_staked as u128).ok_or(LynxError::MathOverflow)?)
                .ok_or(LynxError::MathOverflow)?;
        } else {
            transfer_lamports(vault, treasury, reward_fee)?;
        }
        transfer_lamports(vault, treasury, treasury_fee)?;
    }
    Ok(())
}

fn outcome_is_tradeable(outcome: Outcome, is_ternary: bool) -> bool {
    matches!(outcome, Outcome::Yes | Outcome::No) || (is_ternary && outcome == Outcome::Draw)
}

fn result_is_valid(outcome: Outcome, is_ternary: bool) -> bool {
    outcome_is_tradeable(outcome, is_ternary)
}

fn position_is_winner(market: &Account<Market>, position: &Account<UserPosition>) -> bool {
    if market.result == Outcome::Draw && !market.is_ternary {
        return true;
    }
    market.result == position.outcome
}

fn default_rival_outcome(outcome: Outcome, is_ternary: bool) -> Outcome {
    if is_ternary {
        match outcome {
            Outcome::Yes => Outcome::No,
            Outcome::No => Outcome::Yes,
            Outcome::Draw => Outcome::Yes,
            Outcome::Unresolved => Outcome::No,
        }
    } else if outcome == Outcome::Yes {
        Outcome::No
    } else {
        Outcome::Yes
    }
}

fn settle_staker(config: &Account<ProtocolConfig>, stake: &mut Account<StakePosition>) -> Result<()> {
    if stake.amount == 0 {
        stake.reward_debt_scaled = 0;
        return Ok(());
    }
    let accumulated = reward_debt(stake.amount, config.reward_per_token_scaled)?;
    if accumulated > stake.reward_debt_scaled {
        let delta_scaled = accumulated.checked_sub(stake.reward_debt_scaled).ok_or(LynxError::MathOverflow)?;
        let delta = delta_scaled.checked_div(REWARD_SCALE).ok_or(LynxError::MathOverflow)? as u64;
        stake.pending_rewards = stake.pending_rewards.checked_add(delta).ok_or(LynxError::MathOverflow)?;
    }
    stake.reward_debt_scaled = accumulated;
    Ok(())
}

fn reward_debt(amount: u64, reward_per_token_scaled: u128) -> Result<u128> {
    (amount as u128)
        .checked_mul(reward_per_token_scaled)
        .ok_or_else(|| error!(LynxError::MathOverflow))
}

fn mint_to_lynx<'info>(
    token_program: &Program<'info, Token>,
    lynx_mint: &Account<'info, Mint>,
    config: &Account<'info, ProtocolConfig>,
    to: &Account<'info, TokenAccount>,
    amount: u64,
    signer: &[&[&[u8]]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::mint_to(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            MintTo {
                mint: lynx_mint.to_account_info(),
                to: to.to_account_info(),
                authority: config.to_account_info(),
            },
            signer,
        ),
        amount,
    )
}

fn prorated_bps(total: u64, basis_points: u64, numerator: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, LynxError::InvalidAmount);
    bps(total, basis_points)?
        .checked_mul(numerator).ok_or(LynxError::MathOverflow)?
        .checked_div(denominator).ok_or_else(|| error!(LynxError::MathOverflow))
}

fn bps(amount: u64, basis_points: u64) -> Result<u64> {
    amount
        .checked_mul(basis_points).ok_or(LynxError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR).ok_or_else(|| error!(LynxError::MathOverflow))
}

fn transfer_lamports<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let rent_minimum = Rent::get()?.minimum_balance(from.data_len());
    let required = amount.checked_add(rent_minimum).ok_or(LynxError::MathOverflow)?;
    require!(from.lamports() >= required, LynxError::InsufficientFunds);
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}
