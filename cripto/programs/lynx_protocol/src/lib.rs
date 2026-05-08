use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

pub mod error;
pub mod state;

use error::LynxError;
use state::*;

declare_id!("7hPfrAwhNPJ6Xt7Y3ximBog1EdzfJV31VBTnYQxLRYCy");

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const SETTLEMENT_FEE_BPS: u64 = 1_500;
pub const FOUNDERS_FEE_BPS: u64 = 500;
pub const DIVIDENDS_FEE_BPS: u64 = 750;
pub const INFRA_FEE_BPS: u64 = 250;
pub const TRADE_FEE_BPS: u64 = 10;
pub const LYNX_PER_POSITION_UNIT: u64 = 1;

#[program]
pub mod lynx_protocol {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, emergency_delay: i64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.founders_treasury = ctx.accounts.founders_treasury.key();
        config.dividends_treasury = ctx.accounts.dividends_treasury.key();
        config.infra_treasury = ctx.accounts.infra_treasury.key();
        config.emergency_delay = emergency_delay;
        config.total_lynx_supply = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        title: String,
        oracle_id: String,
        cutoff_ts: i64,
        currency: Currency,
    ) -> Result<()> {
        require!(title.len() <= Market::TITLE_MAX, LynxError::TextTooLong);
        require!(oracle_id.len() <= Market::ORACLE_MAX, LynxError::TextTooLong);
        require!(cutoff_ts > Clock::get()?.unix_timestamp, LynxError::CutoffInPast);

        let market = &mut ctx.accounts.market;
        market.id = market_id;
        market.admin = ctx.accounts.admin.key();
        market.vault = ctx.accounts.vault.key();
        market.title = title;
        market.oracle_id = oracle_id;
        market.currency = currency;
        market.status = MarketStatus::Open;
        market.cutoff_ts = cutoff_ts;
        market.resolved_ts = 0;
        market.result = Outcome::Unresolved;
        market.pool_total = 0;
        market.yes_total = 0;
        market.no_total = 0;
        market.winning_total = 0;
        market.bump = ctx.bumps.market;

        let vault = &mut ctx.accounts.vault;
        vault.market = market.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn buy_position(ctx: Context<BuyPosition>, outcome: BinaryOutcome, lamports: u64) -> Result<()> {
        require!(lamports > 0, LynxError::InvalidAmount);
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open || market.status == MarketStatus::Active, LynxError::MarketClosed);
        require!(clock.unix_timestamp < market.cutoff_ts, LynxError::MarketClosed);

        invoke(
            &system_instruction::transfer(&ctx.accounts.buyer.key(), &ctx.accounts.vault.key(), lamports),
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        market.status = MarketStatus::Active;
        market.pool_total = market.pool_total.checked_add(lamports).ok_or(LynxError::MathOverflow)?;
        match outcome {
            BinaryOutcome::Yes => market.yes_total = market.yes_total.checked_add(lamports).ok_or(LynxError::MathOverflow)?,
            BinaryOutcome::No => market.no_total = market.no_total.checked_add(lamports).ok_or(LynxError::MathOverflow)?,
        }

        let position = &mut ctx.accounts.position;
        position.market = market.key();
        position.owner = ctx.accounts.buyer.key();
        position.outcome = outcome;
        position.amount = position.amount.checked_add(lamports).ok_or(LynxError::MathOverflow)?;
        position.claimed = false;
        position.lynx_minted = false;
        position.bump = ctx.bumps.position;
        Ok(())
    }

    pub fn cut_off_market(ctx: Context<CutOffMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Active || market.status == MarketStatus::Open, LynxError::InvalidStatus);
        require!(Clock::get()?.unix_timestamp >= market.cutoff_ts, LynxError::CutoffNotReached);
        market.status = MarketStatus::CutOff;
        Ok(())
    }

    pub fn mint_lynx_snapshot(ctx: Context<MintLynxSnapshot>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(market.status == MarketStatus::CutOff || market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(!position.lynx_minted, LynxError::AlreadyClaimed);

        let amount = position.amount.checked_mul(LYNX_PER_POSITION_UNIT).ok_or(LynxError::MathOverflow)?;
        let lynx_account = &mut ctx.accounts.lynx_account;
        lynx_account.owner = position.owner;
        lynx_account.balance = lynx_account.balance.checked_add(amount).ok_or(LynxError::MathOverflow)?;
        lynx_account.bump = ctx.bumps.lynx_account;

        let config = &mut ctx.accounts.config;
        config.total_lynx_supply = config.total_lynx_supply.checked_add(amount).ok_or(LynxError::MathOverflow)?;
        position.lynx_minted = true;
        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, result: Outcome) -> Result<()> {
        require!(result == Outcome::Yes || result == Outcome::No || result == Outcome::Draw, LynxError::InvalidOutcome);
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::CutOff || market.status == MarketStatus::Active, LynxError::InvalidStatus);
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);

        market.status = MarketStatus::Resolved;
        market.result = result;
        market.resolved_ts = Clock::get()?.unix_timestamp;
        market.winning_total = match result {
            Outcome::Yes => market.yes_total,
            Outcome::No => market.no_total,
            Outcome::Draw => market.pool_total,
            Outcome::Unresolved => 0,
        };

        distribute_protocol_fee(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.founders_treasury.to_account_info(),
            &ctx.accounts.dividends_treasury.to_account_info(),
            &ctx.accounts.infra_treasury.to_account_info(),
            market.pool_total,
        )?;
        Ok(())
    }

    pub fn claim_market(ctx: Context<ClaimMarket>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        // 1. Validaciones de estado iniciales
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus); //
        require!(!position.claimed, LynxError::AlreadyClaimed); //
        require!(position.amount > 0, LynxError::InvalidAmount); //

        // 2. Lógica de elegibilidad mejorada (Incluye el escenario de EMPATE)
        // Si hay empate (Draw), todos son elegibles. Si no, solo los que acertaron el resultado.
        let is_draw = market.result == Outcome::Draw; //
        let is_winner = matches!(
            (market.result, position.outcome), 
            (Outcome::Yes, BinaryOutcome::Yes) | (Outcome::No, BinaryOutcome::No)
        ); //[cite: 9]

        require!(is_draw || is_winner, LynxError::LosingPosition); //[cite: 9]
        require!(market.winning_total > 0, LynxError::NoWinningPool); //[cite: 9]

        // 3. Cálculo del Pool Neto (Total apostado menos comisiones del protocolo)
        let payout_pool = market.pool_total
            .checked_mul(BPS_DENOMINATOR - SETTLEMENT_FEE_BPS).ok_or(LynxError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR).ok_or(LynxError::MathOverflow)?; //[cite: 9]
            
        // 4. Cálculo del Payout Individual
        // Nota: Si es Draw, winning_total es igual a pool_total (definido en resolve_market), 
        // por lo que cada usuario recupera su apuesta proporcional menos el fee.
        let payout = payout_pool
            .checked_mul(position.amount).ok_or(LynxError::MathOverflow)?
            .checked_div(market.winning_total).ok_or(LynxError::MathOverflow)?; //[cite: 9]

        // 5. Ejecución de la transferencia segura
        // Usamos la función de ayuda que protege el mínimo de renta de la bóveda
        transfer_from_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.claimant.to_account_info(),
            payout,
        )?; //[cite: 9]

        // 6. Marcamos como reclamado para evitar ataques de doble gasto
        position.claimed = true; //[cite: 9]
        
        Ok(())
    }

    pub fn place_order(ctx: Context<PlaceOrder>, order_nonce: u64, side: OrderSide, outcome: BinaryOutcome, amount: u64, price_lamports: u64) -> Result<()> {
        let _ = order_nonce;
        require!(amount > 0 && price_lamports > 0, LynxError::InvalidAmount);
        require!(ctx.accounts.market.status == MarketStatus::Active, LynxError::MarketClosed);

        let order = &mut ctx.accounts.order;
        order.market = ctx.accounts.market.key();
        order.owner = ctx.accounts.owner.key();
        order.side = side;
        order.outcome = outcome;
        order.amount = amount;
        order.remaining = amount;
        order.price_lamports = price_lamports;
        order.bump = ctx.bumps.order;
        Ok(())
    }

    pub fn take_order(ctx: Context<TakeOrder>, amount: u64) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        let order = &mut ctx.accounts.order;
        require!(order.remaining >= amount, LynxError::InvalidAmount);

        let gross = order.price_lamports.checked_mul(amount).ok_or(LynxError::MathOverflow)?;
        let fee = gross.checked_mul(TRADE_FEE_BPS).ok_or(LynxError::MathOverflow)?.checked_div(BPS_DENOMINATOR).ok_or(LynxError::MathOverflow)?;

        // Transferencia al creador de la orden (monto neto)[cite: 10]
        invoke(
            &system_instruction::transfer(&ctx.accounts.taker.key(), &ctx.accounts.owner.key(), gross.checked_sub(fee).ok_or(LynxError::MathOverflow)?),
            &[
                ctx.accounts.taker.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Transferencia del fee a la tesorería de infraestructura[cite: 10]
        invoke(
            &system_instruction::transfer(&ctx.accounts.taker.key(), &ctx.accounts.infra_treasury.key(), fee),
            &[
                ctx.accounts.taker.to_account_info(),
                ctx.accounts.infra_treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        order.remaining = order.remaining.checked_sub(amount).ok_or(LynxError::MathOverflow)?;

        // NUEVO: Si la orden se llena por completo, liberamos la renta
        if order.remaining == 0 {
            let dest = ctx.accounts.owner.to_account_info();
            let source = order.to_account_info();
            
            let dest_starting_lamports = dest.lamports();
            **dest.lamports.borrow_mut() = dest_starting_lamports
                .checked_add(source.lamports())
                .ok_or(LynxError::MathOverflow)?;
            **source.lamports.borrow_mut() = 0;
        }

        Ok(())
    }

    pub fn cancel_order(_ctx: Context<CancelOrder>) -> Result<()> {
        // Ya no necesitas lógica interna, 'close' hace el trabajo
        Ok(())
    }

    pub fn create_duel(ctx: Context<CreateDuel>, duel_id: u64, amount: u64, creator_outcome: BinaryOutcome, expires_ts: i64) -> Result<()> {
        let _ = duel_id;
        require!(amount > 0, LynxError::InvalidAmount);
        require!(expires_ts > Clock::get()?.unix_timestamp, LynxError::CutoffInPast);
        require!(ctx.accounts.parent_market.status == MarketStatus::Active || ctx.accounts.parent_market.status == MarketStatus::Open, LynxError::MarketClosed);

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
        duel.rival = Pubkey::default();
        duel.amount = amount;
        duel.creator_outcome = creator_outcome;
        duel.status = DuelStatus::Open;
        duel.expires_ts = expires_ts;
        duel.bump = ctx.bumps.duel;

        let vault = &mut ctx.accounts.duel_vault;
        vault.duel = duel.key();
        vault.bump = ctx.bumps.duel_vault;
        Ok(())
    }

    pub fn accept_duel(ctx: Context<AcceptDuel>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        require!(duel.status == DuelStatus::Open, LynxError::InvalidStatus);
        require!(Clock::get()?.unix_timestamp < duel.expires_ts, LynxError::DuelExpired);
        require_keys_neq!(duel.creator, ctx.accounts.rival.key(), LynxError::Unauthorized);

        invoke(
            &system_instruction::transfer(&ctx.accounts.rival.key(), &ctx.accounts.duel_vault.key(), duel.amount),
            &[
                ctx.accounts.rival.to_account_info(),
                ctx.accounts.duel_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        duel.rival = ctx.accounts.rival.key();
        duel.status = DuelStatus::Active;
        Ok(())
    }

    pub fn resolve_duel(ctx: Context<ResolveDuel>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        let market = &ctx.accounts.parent_market;
        let config = &ctx.accounts.config;

        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(duel.status == DuelStatus::Active, LynxError::InvalidStatus);

        let winner_key = match market.result {
            Outcome::Draw => config.infra_treasury, 
            Outcome::Yes if duel.creator_outcome == BinaryOutcome::Yes => duel.creator,
            Outcome::No if duel.creator_outcome == BinaryOutcome::No => duel.creator,
            Outcome::Yes | Outcome::No => duel.rival,
            Outcome::Unresolved => return err!(LynxError::InvalidOutcome),
        };

        require_keys_eq!(winner_key, ctx.accounts.winner.key(), LynxError::Unauthorized);

        duel.status = DuelStatus::Resolved;
        // Pot eliminado: 'close = winner' mueve el 100% del balance de la bóveda
        Ok(())
    }
}

fn distribute_protocol_fee<'info>(
    vault: &AccountInfo<'info>,
    founders: &AccountInfo<'info>,
    dividends: &AccountInfo<'info>,
    infra: &AccountInfo<'info>,
    pool_total: u64,
) -> Result<()> {
    let founders_fee = bps(pool_total, FOUNDERS_FEE_BPS)?;
    let dividends_fee = bps(pool_total, DIVIDENDS_FEE_BPS)?;
    let infra_fee = bps(pool_total, INFRA_FEE_BPS)?;
    transfer_from_program_vault(vault, founders, founders_fee)?;
    transfer_from_program_vault(vault, dividends, dividends_fee)?;
    transfer_from_program_vault(vault, infra, infra_fee)?;
    Ok(())
}

fn bps(amount: u64, bps: u64) -> Result<u64> {
    let multiplied = amount.checked_mul(bps).ok_or(LynxError::MathOverflow)?;
    let divided = multiplied
        .checked_div(BPS_DENOMINATOR)
        .ok_or(LynxError::MathOverflow)?;
    Ok(divided)
}

fn transfer_from_program_vault<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    
    let rent_exempt_minimal = Rent::get()?.minimum_balance(from.data_len());
    let current_balance = from.lamports();
    
    // Eliminado .unwrap() y añadida validación segura
    let total_required = amount.checked_add(rent_exempt_minimal)
        .ok_or(LynxError::MathOverflow)?;
        
    require!(current_balance >= total_required, LynxError::InvalidAmount); 

    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(init, payer = admin, space = ProtocolConfig::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: validated against known treasury address
    #[account(mut)]
    pub founders_treasury: UncheckedAccount<'info>,
    /// CHECK: validated against known treasury address
    #[account(mut)]
    pub dividends_treasury: UncheckedAccount<'info>,
    /// CHECK: validated against known treasury address
    #[account(mut)]
    pub infra_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(init, payer = admin, space = Market::LEN, seeds = [b"market", market_id.to_le_bytes().as_ref()], bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = admin, space = Vault::LEN, seeds = [b"vault", market.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(outcome: BinaryOutcome)]
pub struct BuyPosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), buyer.key().as_ref(), &[outcome as u8]],
        bump
    )]
    pub position: Account<'info, UserPosition>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CutOffMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct MintLynxSnapshot<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    // Validación de SEEDS añadida para máxima seguridad
    #[account(
        seeds = [b"market", market.id.to_le_bytes().as_ref()], 
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut, has_one = market)]
    pub position: Account<'info, UserPosition>,
    #[account(
        init_if_needed, 
        payer = payer, 
        space = LynxBalance::LEN, 
        seeds = [b"lynx", position.owner.as_ref()], 
        bump
    )]
    pub lynx_account: Account<'info, LynxBalance>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    pub admin: Signer<'info>,
    /// CHECK: Validamos manualmente contra la config del protocolo
    #[account(mut, address = config.founders_treasury)]
    pub founders_treasury: UncheckedAccount<'info>,
    /// CHECK: Validamos manualmente contra la config del protocolo
    #[account(mut, address = config.dividends_treasury)]
    pub dividends_treasury: UncheckedAccount<'info>,
    /// CHECK: Validamos manualmente contra la config del protocolo
    #[account(mut, address = config.infra_treasury)]
    pub infra_treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimMarket<'info> {
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut, 
        has_one = market, 
        constraint = position.owner == claimant.key(), // Validación directa
        close = claimant 
    )]
    pub position: Account<'info, UserPosition>,
    #[account(mut)] // La validación ocurre en el constraint de arriba
    pub claimant: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(order_nonce: u64)]
pub struct PlaceOrder<'info> {
    // MEJORA: Validación de seeds para el mercado
    #[account(
        seeds = [b"market", market.id.to_le_bytes().as_ref()], 
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(init, payer = owner, space = Order::LEN, seeds = [b"order", market.key().as_ref(), owner.key().as_ref(), order_nonce.to_le_bytes().as_ref()], bump)]
    pub order: Account<'info, Order>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TakeOrder<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>, // Necesario para validar la tesorería
    #[account(mut)]
    pub order: Account<'info, Order>,
    #[account(mut, address = order.owner)]
    pub owner: SystemAccount<'info>,
    #[account(mut)]
    pub taker: Signer<'info>,
    /// CHECK: Ahora Anchor verifica automáticamente que la dirección sea la de la config
    #[account(mut, address = config.infra_treasury)]
    pub infra_treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        mut, 
        has_one = owner,
        close = owner // <--- Ahora el usuario recupera su SOL al cancelar
    )]
    pub order: Account<'info, Order>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(duel_id: u64)]
pub struct CreateDuel<'info> {
    // MEJORA: Validación de seeds para el mercado padre
    #[account(
        seeds = [b"market", parent_market.id.to_le_bytes().as_ref()], 
        bump = parent_market.bump
    )]
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
    #[account(mut)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"duel_vault", duel.key().as_ref()], bump = duel_vault.bump)]
    pub duel_vault: Account<'info, DuelVault>,
    #[account(mut)]
    pub rival: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveDuel<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    pub parent_market: Account<'info, Market>,
    #[account(
        mut, 
        has_one = parent_market,
        close = winner // <--- MODIFICADO: Libera el SOL de la cuenta de estado del duelo[cite: 9]
    )]
    pub duel: Account<'info, Duel>,
    #[account(
        mut, 
        seeds = [b"duel_vault", duel.key().as_ref()], 
        bump = duel_vault.bump,
        close = winner // Cierra la bóveda y envía los fondos (+ renta) al ganador[cite: 10]
    )]
    pub duel_vault: Account<'info, DuelVault>,
    /// CHECK: Esta cuenta puede ser el creador, el rival o la tesorería (en caso de Draw)[cite: 10]
    #[account(mut)]
    pub winner: UncheckedAccount<'info>, 
}