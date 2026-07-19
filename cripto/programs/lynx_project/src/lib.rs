// Anchor's #[program]/#[derive(Accounts)] macros expand to code gated on cfgs
// (anchor-debug, custom-heap, custom-panic, solana) that this crate never
// declares, so rustc emits ~40 unexpected_cfgs warnings for generated code we
// do not own. Silence them here so a real cfg typo in our own code still stands
// out instead of being lost in the noise.
#![allow(unexpected_cfgs)]

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

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
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
        config.bump = ctx.bumps.config;
        config.rewards_vault_bump = ctx.bumps.rewards_vault;
        config.paused = false;
        config.multisig_initialized = false;
        config.protocol_duel_exposure = 0;
        config.max_protocol_duel_exposure = MAX_PROTOCOL_DUEL_EXPOSURE_LAMPORTS;
        ctx.accounts.rewards_vault.bump = ctx.bumps.rewards_vault;
        Ok(())
    }

    // Bootstrap del multisig de gobernanza (2-de-2, o el M-de-N que se elija).
    // Solo puede llamarse una vez, y solo por el admin unico original (el que
    // salio de initialize_protocol). A partir de este momento transfer_admin()
    // con clave unica queda deshabilitado: toda accion sensible (rotar admin,
    // pausar el protocolo, resolver un mercado por la via de fallback admin,
    // anadir/quitar firmantes) tiene que pasar por propose_action/approve_action/
    // execute_action con el umbral de aprobaciones del multisig.
    pub fn init_multisig(ctx: Context<InitMultisig>, signers: Vec<Pubkey>, threshold: u8) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);
        require!(!ctx.accounts.config.multisig_initialized, LynxError::Unauthorized);
        require!(!signers.is_empty(), LynxError::TooFewSigners);
        require!(signers.len() <= MAX_MULTISIG_SIGNERS, LynxError::TooManySigners);
        require!(threshold >= 1 && (threshold as usize) <= signers.len(), LynxError::InvalidThreshold);
        // A default pubkey is the empty-slot sentinel that is_multisig_signer
        // rejects, so it could never actually sign; and a duplicate would count
        // toward signer_count while only ever approving once, which can make the
        // threshold unreachable and brick governance. Reject both up front.
        for (i, s) in signers.iter().enumerate() {
            require!(*s != Pubkey::default(), LynxError::NotAMultisigSigner);
            for other in &signers[i + 1..] {
                require!(*s != *other, LynxError::SignerAlreadyPresent);
            }
        }

        let mut arr = [Pubkey::default(); MAX_MULTISIG_SIGNERS];
        for (i, s) in signers.iter().enumerate() {
            arr[i] = *s;
        }

        let ms = &mut ctx.accounts.multisig;
        ms.config = ctx.accounts.config.key();
        ms.signers = arr;
        ms.signer_count = signers.len() as u8;
        ms.threshold = threshold;
        ms.proposal_seq = 0;
        ms.bump = ctx.bumps.multisig;

        ctx.accounts.config.multisig_initialized = true;
        Ok(())
    }

    pub fn propose_action(ctx: Context<ProposeAction>, action: GovernanceAction) -> Result<()> {
        let multisig = &mut ctx.accounts.multisig;
        require!(is_multisig_signer(multisig, ctx.accounts.proposer.key()), LynxError::NotAMultisigSigner);

        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        proposal.multisig = multisig.key();
        proposal.proposer = ctx.accounts.proposer.key();
        proposal.proposal_id = multisig.proposal_seq;
        proposal.action = action;
        proposal.approvals = [Pubkey::default(); MAX_MULTISIG_SIGNERS];
        proposal.approvals[0] = ctx.accounts.proposer.key();
        proposal.approval_count = 1;
        proposal.threshold_reached_ts = if 1u8 >= multisig.threshold { now } else { 0 };
        proposal.executed = false;
        proposal.cancelled = false;
        proposal.created_ts = now;
        proposal.expires_ts = now.checked_add(PROPOSAL_TTL_SECONDS).ok_or(LynxError::MathOverflow)?;
        proposal.bump = ctx.bumps.proposal;

        multisig.proposal_seq = multisig.proposal_seq.checked_add(1).ok_or(LynxError::MathOverflow)?;
        Ok(())
    }

    pub fn approve_action(ctx: Context<ApproveAction>) -> Result<()> {
        let multisig = &ctx.accounts.multisig;
        require!(is_multisig_signer(multisig, ctx.accounts.signer.key()), LynxError::NotAMultisigSigner);

        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.executed, LynxError::ProposalAlreadyExecuted);
        require!(!proposal.cancelled, LynxError::ProposalCancelled);
        require!(now < proposal.expires_ts, LynxError::ProposalExpired);
        require!(
            !proposal.approvals.iter().any(|a| *a == ctx.accounts.signer.key()),
            LynxError::AlreadyApproved
        );

        let slot = proposal.approval_count as usize;
        require!(slot < MAX_MULTISIG_SIGNERS, LynxError::TooManySigners);
        proposal.approvals[slot] = ctx.accounts.signer.key();
        proposal.approval_count = proposal.approval_count.checked_add(1).ok_or(LynxError::MathOverflow)?;

        if proposal.threshold_reached_ts == 0 && proposal.approval_count >= multisig.threshold {
            proposal.threshold_reached_ts = now;
        }
        Ok(())
    }

    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.executed, LynxError::ProposalAlreadyExecuted);
        require!(!proposal.cancelled, LynxError::ProposalCancelled);
        let is_proposer = ctx.accounts.signer.key() == proposal.proposer;
        let is_expired = now >= proposal.expires_ts;
        require!(is_proposer || is_expired, LynxError::NotProposer);
        require!(
            is_proposer || is_multisig_signer(&ctx.accounts.multisig, ctx.accounts.signer.key()),
            LynxError::NotAMultisigSigner
        );
        proposal.cancelled = true;
        Ok(())
    }

    // Ejecuta una GovernanceProposal cuyo `action` es de las variantes que solo
    // tocan ProtocolConfig/Multisig (no requieren la cuenta Market). Para
    // ResolveMarketAdmin hay que usar execute_resolve_market_admin, que exige
    // ademas la cuenta Market/vault/treasury correctas.
    pub fn execute_action(ctx: Context<ExecuteAction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.executed, LynxError::ProposalAlreadyExecuted);
        require!(!proposal.cancelled, LynxError::ProposalCancelled);
        require!(now < proposal.expires_ts, LynxError::ProposalExpired);
        require!(proposal.threshold_reached_ts != 0, LynxError::ThresholdNotMet);
        require!(
            now >= proposal.threshold_reached_ts.checked_add(GOVERNANCE_EXECUTION_DELAY_SECONDS).ok_or(LynxError::MathOverflow)?,
            LynxError::TimelockNotElapsed
        );

        let config = &mut ctx.accounts.config;
        let multisig = &mut ctx.accounts.multisig;
        match proposal.action {
            GovernanceAction::TransferAdmin { new_admin } => {
                config.admin = new_admin;
            }
            GovernanceAction::SetPaused { paused } => {
                config.paused = paused;
            }
            GovernanceAction::AddSigner { signer } => {
                require!(!is_multisig_signer(multisig, signer), LynxError::SignerAlreadyPresent);
                let count = multisig.signer_count as usize;
                require!(count < MAX_MULTISIG_SIGNERS, LynxError::TooManySigners);
                multisig.signers[count] = signer;
                multisig.signer_count = multisig.signer_count.checked_add(1).ok_or(LynxError::MathOverflow)?;
            }
            GovernanceAction::RemoveSigner { signer } => {
                let count = multisig.signer_count as usize;
                require!((multisig.threshold as usize) < count, LynxError::TooFewSigners);
                let mut found = false;
                for i in 0..count {
                    if multisig.signers[i] == signer {
                        found = true;
                        for j in i..count - 1 {
                            multisig.signers[j] = multisig.signers[j + 1];
                        }
                        multisig.signers[count - 1] = Pubkey::default();
                        break;
                    }
                }
                require!(found, LynxError::NotAMultisigSigner);
                multisig.signer_count = multisig.signer_count.checked_sub(1).ok_or(LynxError::MathOverflow)?;
            }
            GovernanceAction::SetThreshold { threshold } => {
                require!(threshold >= 1 && threshold <= multisig.signer_count, LynxError::InvalidThreshold);
                multisig.threshold = threshold;
            }
            GovernanceAction::ResolveMarketAdmin { .. } => {
                return err!(LynxError::ActionMismatch);
            }
        }

        proposal.executed = true;
        Ok(())
    }

    // Variante de execute_action especifica para GovernanceAction::ResolveMarketAdmin,
    // que si necesita las cuentas Market/vault/rewards_vault/treasury para poder
    // mover fondos de verdad (via finalize_market_and_fees). Solo aplicable como
    // fallback cuando el oraculo nunca llamo a propose_resolution dentro de
    // ORACLE_TIMEOUT_SECONDS (ver require de mas abajo).
    pub fn execute_resolve_market_admin(ctx: Context<ExecuteResolveMarketAdmin>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        // `action` is Copy: read every field we need out of `proposal` under a
        // short-lived shared borrow, so the mutable borrow needed to mark it
        // executed below never overlaps with reading proposal.key().
        let action = {
            let proposal = &ctx.accounts.proposal;
            require!(!proposal.executed, LynxError::ProposalAlreadyExecuted);
            require!(!proposal.cancelled, LynxError::ProposalCancelled);
            require!(now < proposal.expires_ts, LynxError::ProposalExpired);
            require!(proposal.threshold_reached_ts != 0, LynxError::ThresholdNotMet);
            require!(
                now >= proposal.threshold_reached_ts.checked_add(GOVERNANCE_EXECUTION_DELAY_SECONDS).ok_or(LynxError::MathOverflow)?,
                LynxError::TimelockNotElapsed
            );
            proposal.action
        };

        let result = match action {
            GovernanceAction::ResolveMarketAdmin { market, result } => {
                require_keys_eq!(market, ctx.accounts.market.key(), LynxError::ActionMismatch);
                result
            }
            _ => return err!(LynxError::ActionMismatch),
        };

        require!(result_is_valid(result, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require!(now >= ctx.accounts.market.oracle_deadline, LynxError::OracleTimeoutNotReached);
        require!(
            ctx.accounts.market.status == MarketStatus::CutOff
                || ctx.accounts.market.status == MarketStatus::Active
                || ctx.accounts.market.status == MarketStatus::Open,
            LynxError::InvalidStatus
        );

        // CR-01: congela el ratio para la via de fallback admin, que se salta
        // propose_resolution. Igual que alli, el valor sale del TWAP y no del
        // supply instantaneo (SC-01): esta instruccion se ejecuta en un momento
        // conocido de antemano (tras el timelock), asi que un ratio instantaneo
        // seria trivialmente manipulable quemando LYNX en el mismo bloque.
        if ctx.accounts.market.currency == Currency::SOL && ctx.accounts.market.mint_ratio_snapshot_bps == 0 {
            ctx.accounts.market.mint_ratio_snapshot_bps =
                mint_ratio_bps_twap(&ctx.accounts.supply_twap, &ctx.accounts.config)?;
        }

        let proposal_key = ctx.accounts.proposal.key();
        finalize_market_and_fees(
            &mut ctx.accounts.config,
            &mut ctx.accounts.market,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.rewards_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            result,
            proposal_key,
        )?;

        ctx.accounts.proposal.executed = true;
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        // Una vez que el multisig esta inicializado, la unica via para rotar el
        // admin es una GovernanceAction::TransferAdmin aprobada por el umbral de
        // firmantes (ver execute_action). Esto evita que una sola clave admin
        // filtrada pueda seguir rotando el admin unilateralmente (C3 del informe).
        require!(!ctx.accounts.config.multisig_initialized, LynxError::Unauthorized);
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);
        ctx.accounts.config.admin = new_admin;
        Ok(())
    }

    // Instruction handlers take their inputs as flat args; grouping them into a
    // struct would only obscure the on-chain call interface.
    #[allow(clippy::too_many_arguments)]
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
        require!(resolve_ts > now, LynxError::CutoffInPast);
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
        // Set for real on the first LYNX purchase (buy_position_lynx_with_burn), which
        // inits the market_lynx_vault PDA and records its canonical bump here.
        market.lynx_vault_bump = 0;
        // Frozen at resolution time in finalize_market_and_fees; 0 means "not resolved yet".
        market.mint_ratio_bps = 0;
        market.swept = false;
        // proposed_result/proposed_ts/resolved_by quedan en su valor por
        // defecto de cuenta recien inicializada (zero-bytes = Outcome::Unresolved,
        // 0, Pubkey::default()), pero se dejan explicitos aqui por claridad.
        market.proposed_result = Outcome::Unresolved;
        market.proposed_ts = 0;
        market.mint_ratio_snapshot_bps = 0;
        market.total_claimed = 0;
        market.resolved_by = Pubkey::default();

        let vault = &mut ctx.accounts.vault;
        vault.market = market.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn buy_position_sol(ctx: Context<BuyPositionSol>, outcome: Outcome, lamports: u64) -> Result<()> {
        require!(lamports > 0, LynxError::InvalidAmount);
        require!(lamports >= MIN_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(lamports <= MAX_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
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

    // Bootstrap del ring buffer del TWAP de supply circulante (SC-01).
    // Una sola vez por deployment; PDA fija, sin parametros y sin discrecion
    // para el llamante, asi que es permissionless a proposito.
    pub fn init_supply_twap(ctx: Context<InitSupplyTwap>) -> Result<()> {
        let twap = &mut ctx.accounts.supply_twap;
        twap.config = ctx.accounts.config.key();
        twap.snapshots = [0u64; SUPPLY_SNAPSHOT_COUNT];
        twap.count = 0;
        twap.next_index = 0;
        twap.last_snapshot_ts = 0;
        twap.bump = ctx.bumps.supply_twap;
        Ok(())
    }

    // Crank permissionless que registra una muestra del supply circulante.
    //
    // Cualquiera puede llamarlo (nuestro keeper, o un bot de terceros): el valor
    // que escribe se lee integramente de ProtocolConfig on-chain, asi que quien
    // firma no puede influir en el dato. Lo unico que controla es CUANDO, y por
    // eso se exige SUPPLY_SNAPSHOT_INTERVAL_SECONDS entre muestras: sin ese
    // limite, un atacante podria llenar el buffer entero (24 muestras) con el
    // supply manipulado dentro de una sola transaccion y anular el TWAP —
    // reintroduciendo exactamente el ataque atomico que esto viene a cerrar.
    pub fn record_supply_snapshot(ctx: Context<RecordSupplySnapshot>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let twap = &mut ctx.accounts.supply_twap;
        require!(
            now >= twap
                .last_snapshot_ts
                .checked_add(SUPPLY_SNAPSHOT_INTERVAL_SECONDS)
                .ok_or(LynxError::MathOverflow)?,
            LynxError::SnapshotTooSoon
        );

        let circulating = instantaneous_circulating_supply(&ctx.accounts.config);
        let index = twap.next_index as usize;
        require!(index < SUPPLY_SNAPSHOT_COUNT, LynxError::MathOverflow);
        twap.snapshots[index] = circulating;
        twap.next_index = ((index + 1) % SUPPLY_SNAPSHOT_COUNT) as u8;
        if (twap.count as usize) < SUPPLY_SNAPSHOT_COUNT {
            twap.count = twap.count.checked_add(1).ok_or(LynxError::MathOverflow)?;
        }
        twap.last_snapshot_ts = now;
        Ok(())
    }

    // One-time creation of a LYNX market's token vault.
    //
    // This used to be an inline `init_if_needed` inside buy_position_lynx_with_burn
    // and execute_prediction_limit_order_lynx. Anchor's generated token-account
    // init code pushed those instructions' `try_accounts` frames past the
    // 4096-byte BPF stack limit, and they did not merely risk undefined
    // behaviour — they hard-faulted at runtime with "Access violation", so LYNX
    // markets could not be entered at all. Splitting vault creation out keeps the
    // hot paths inside the stack budget (see tests/lynx_buy_integration.rs).
    //
    // Permissionless by design: the vault address, its mint and its authority are
    // all derived from on-chain state, so the caller has no discretion over the
    // result — exactly like the SOL vault that create_market already initialises.
    // Must be called once per LYNX market before the first purchase.
    pub fn init_market_lynx_vault(ctx: Context<InitMarketLynxVault>) -> Result<()> {
        require!(ctx.accounts.market.currency == Currency::LYNX, LynxError::InvalidCurrency);
        ctx.accounts.market.lynx_vault_bump = ctx.bumps.market_lynx_vault;
        Ok(())
    }

    pub fn buy_position_lynx_with_burn(ctx: Context<BuyPositionLynxWithBurn>, outcome: Outcome, amount: u64) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(amount >= MIN_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(amount <= MAX_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
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
        // lynx_vault_bump is persisted once by init_market_lynx_vault; the vault is
        // pinned here via `bump = market.lynx_vault_bump` instead of being created
        // inline, which is what kept this instruction inside the BPF stack budget.

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

    // --- Ordenes limite de mercados de prediccion (100% on-chain, ver state.rs) ---
    pub fn create_prediction_limit_order_sol(
        ctx: Context<CreatePredictionLimitOrderSol>,
        order_id: u64,
        outcome: Outcome,
        lamports: u64,
        limit_price_bps: u64,
        expires_ts: i64,
    ) -> Result<()> {
        require!(lamports > 0, LynxError::InvalidAmount);
        require!(lamports >= MIN_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(lamports <= MAX_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        require!(limit_price_bps <= BPS_DENOMINATOR, LynxError::InvalidAmount);
        require!(outcome_is_tradeable(outcome, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require!(ctx.accounts.market.currency == Currency::SOL, LynxError::InvalidCurrency);

        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.market.status == MarketStatus::Open || ctx.accounts.market.status == MarketStatus::Active,
            LynxError::MarketClosed
        );
        require!(now < ctx.accounts.market.cutoff_ts, LynxError::MarketClosed);
        require!(now < expires_ts && expires_ts <= ctx.accounts.market.cutoff_ts, LynxError::InvalidExpiry);

        invoke(
            &system_instruction::transfer(&ctx.accounts.owner.key(), &ctx.accounts.escrow.key(), lamports),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let order = &mut ctx.accounts.order;
        order.id = order_id;
        order.owner = ctx.accounts.owner.key();
        order.market = ctx.accounts.market.key();
        order.outcome = outcome;
        order.amount = lamports;
        order.limit_price_bps = limit_price_bps;
        order.status = PredictionOrderStatus::Open;
        order.created_ts = now;
        order.expires_ts = expires_ts;
        order.bump = ctx.bumps.order;
        order.escrow_bump = ctx.bumps.escrow;

        ctx.accounts.escrow.order = order.key();
        ctx.accounts.escrow.bump = ctx.bumps.escrow;
        Ok(())
    }

    // Permissionless a proposito: cualquiera (nuestro backend como keeper, o
    // cualquier bot de terceros) puede intentar ejecutar una orden limite. El
    // programa valida la condicion de precio on-chain, asi que un keeper no
    // puede forzar un fill a mal precio ni robar el escrow: si la condicion no
    // se cumple, la instruccion simplemente falla.
    pub fn execute_prediction_limit_order_sol(ctx: Context<ExecutePredictionLimitOrderSol>) -> Result<()> {
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;
        {
            let order = &ctx.accounts.order;
            require!(order.status == PredictionOrderStatus::Open, LynxError::InvalidStatus);
            require!(now < order.expires_ts, LynxError::OrderExpired);
        }
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open || market.status == MarketStatus::Active,
            LynxError::MarketClosed
        );
        require!(market.pool_total > 0, LynxError::MarketNotFillable);

        let outcome = ctx.accounts.order.outcome;
        let current_price_bps = implied_price_bps(market, outcome)?;
        require!(current_price_bps < ctx.accounts.order.limit_price_bps, LynxError::LimitNotReached);

        let amount = ctx.accounts.order.amount;
        transfer_lamports(&ctx.accounts.escrow.to_account_info(), &ctx.accounts.vault.to_account_info(), amount)?;
        add_market_amounts(market, outcome, amount)?;
        write_position(
            &mut ctx.accounts.position,
            market.key(),
            ctx.accounts.order.owner,
            outcome,
            amount,
            ctx.bumps.position,
        )?;

        ctx.accounts.order.status = PredictionOrderStatus::Filled;
        Ok(())
    }

    // El propio dueno puede cancelar en cualquier momento mientras siga Open;
    // cualquiera puede "limpiar" (permissionless) una orden ya expirada, pero
    // el reembolso SIEMPRE va a order.owner, nunca a quien firma la tx.
    pub fn cancel_prediction_limit_order_sol(ctx: Context<CancelPredictionLimitOrderSol>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let order = &mut ctx.accounts.order;
        require!(order.status == PredictionOrderStatus::Open, LynxError::InvalidStatus);
        let is_owner = ctx.accounts.signer.key() == order.owner;
        let is_expired = now >= order.expires_ts;
        require!(is_owner || is_expired, LynxError::Unauthorized);

        let amount = order.amount;
        transfer_lamports(&ctx.accounts.escrow.to_account_info(), &ctx.accounts.owner.to_account_info(), amount)?;
        order.status = PredictionOrderStatus::Cancelled;
        Ok(())
    }

    pub fn create_prediction_limit_order_lynx(
        ctx: Context<CreatePredictionLimitOrderLynx>,
        order_id: u64,
        outcome: Outcome,
        amount: u64,
        limit_price_bps: u64,
        expires_ts: i64,
    ) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(amount >= MIN_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(amount <= MAX_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        require!(limit_price_bps <= BPS_DENOMINATOR, LynxError::InvalidAmount);
        require!(outcome_is_tradeable(outcome, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require!(ctx.accounts.market.currency == Currency::LYNX, LynxError::InvalidCurrency);

        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.market.status == MarketStatus::Open || ctx.accounts.market.status == MarketStatus::Active,
            LynxError::MarketClosed
        );
        require!(now < ctx.accounts.market.cutoff_ts, LynxError::MarketClosed);
        require!(now < expires_ts && expires_ts <= ctx.accounts.market.cutoff_ts, LynxError::InvalidExpiry);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_lynx_account.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let order = &mut ctx.accounts.order;
        order.id = order_id;
        order.owner = ctx.accounts.owner.key();
        order.market = ctx.accounts.market.key();
        order.outcome = outcome;
        order.amount = amount;
        order.limit_price_bps = limit_price_bps;
        order.status = PredictionOrderStatus::Open;
        order.created_ts = now;
        order.expires_ts = expires_ts;
        order.bump = ctx.bumps.order;
        order.escrow_bump = ctx.bumps.escrow;
        Ok(())
    }

    pub fn execute_prediction_limit_order_lynx(ctx: Context<ExecutePredictionLimitOrderLynx>) -> Result<()> {
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;
        {
            let order = &ctx.accounts.order;
            require!(order.status == PredictionOrderStatus::Open, LynxError::InvalidStatus);
            require!(now < order.expires_ts, LynxError::OrderExpired);
        }
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open || market.status == MarketStatus::Active,
            LynxError::MarketClosed
        );
        require!(market.pool_total > 0, LynxError::MarketNotFillable);

        let outcome = ctx.accounts.order.outcome;
        let current_price_bps = implied_price_bps(market, outcome)?;
        require!(current_price_bps < ctx.accounts.order.limit_price_bps, LynxError::LimitNotReached);

        let order_id_bytes = ctx.accounts.order.id.to_le_bytes();
        let order_owner = ctx.accounts.order.owner;
        // Bind the Pubkey to a local: `market.key()` returns a temporary that is
        // dropped at the end of the statement, leaving the seed slice dangling.
        let market_key = market.key();
        let order_seeds: &[&[u8]] = &[
            b"pred_order",
            market_key.as_ref(),
            order_owner.as_ref(),
            order_id_bytes.as_ref(),
            &[ctx.accounts.order.bump],
        ];

        let gross_amount = ctx.accounts.order.amount;
        let burn_amount = bps(gross_amount, LYNX_EVENT_BURN_BPS)?;
        if burn_amount > 0 {
            token::burn(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.lynx_mint.to_account_info(),
                        from: ctx.accounts.escrow.to_account_info(),
                        authority: ctx.accounts.order.to_account_info(),
                    },
                    &[order_seeds],
                ),
                burn_amount,
            )?;
        }
        // Vault is created once by init_market_lynx_vault and pinned via the stored
        // bump; creating it inline here overflowed the BPF stack frame.
        let net_amount = gross_amount.checked_sub(burn_amount).ok_or(LynxError::MathOverflow)?;
        if net_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.market_lynx_vault.to_account_info(),
                        authority: ctx.accounts.order.to_account_info(),
                    },
                    &[order_seeds],
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
            order_owner,
            outcome,
            net_amount,
            ctx.bumps.position,
        )?;

        ctx.accounts.order.status = PredictionOrderStatus::Filled;
        Ok(())
    }

    pub fn cancel_prediction_limit_order_lynx(ctx: Context<CancelPredictionLimitOrderLynx>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let is_owner = ctx.accounts.signer.key() == ctx.accounts.order.owner;
        let is_expired = now >= ctx.accounts.order.expires_ts;
        require!(ctx.accounts.order.status == PredictionOrderStatus::Open, LynxError::InvalidStatus);
        require!(is_owner || is_expired, LynxError::Unauthorized);
        require_keys_eq!(ctx.accounts.owner_lynx_account.owner, ctx.accounts.order.owner, LynxError::Unauthorized);

        let amount = ctx.accounts.order.amount;
        let order_id_bytes = ctx.accounts.order.id.to_le_bytes();
        let order_owner = ctx.accounts.order.owner;
        let order_bump = ctx.accounts.order.bump;
        // Same temporary-lifetime issue as in execute_prediction_limit_order_lynx.
        let market_key = ctx.accounts.market.key();
        let order_seeds: &[&[u8]] = &[
            b"pred_order",
            market_key.as_ref(),
            order_owner.as_ref(),
            order_id_bytes.as_ref(),
            &[order_bump],
        ];

        if amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.owner_lynx_account.to_account_info(),
                        authority: ctx.accounts.order.to_account_info(),
                    },
                    &[order_seeds],
                ),
                amount,
            )?;
        }
        ctx.accounts.order.status = PredictionOrderStatus::Cancelled;
        Ok(())
    }

    // --- Libro de ordenes LYNX/SOL on-chain (spot, ver state.rs) ---
    pub fn place_spot_order_buy(
        ctx: Context<PlaceSpotOrderBuy>,
        order_id: u64,
        amount: u64,
        price_scaled: u128,
        expires_ts: i64,
    ) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(price_scaled > 0, LynxError::InvalidAmount);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;
        require!(now < expires_ts, LynxError::InvalidExpiry);

        let sol_amount = spot_sol_amount(amount, price_scaled)?;
        require!(sol_amount >= MIN_ORDER_LAMPORTS, LynxError::InvalidAmount);
        require!(sol_amount <= MAX_ORDER_LAMPORTS, LynxError::InvalidAmount);
        invoke(
            &system_instruction::transfer(&ctx.accounts.owner.key(), &ctx.accounts.escrow.key(), sol_amount),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let order = &mut ctx.accounts.order;
        order.id = order_id;
        order.owner = ctx.accounts.owner.key();
        order.side = SpotOrderSide::Buy;
        order.price_scaled = price_scaled;
        order.amount = amount;
        order.remaining = amount;
        order.status = SpotOrderStatus::Open;
        order.created_ts = now;
        order.expires_ts = expires_ts;
        order.bump = ctx.bumps.order;
        order.escrow_bump = ctx.bumps.escrow;

        ctx.accounts.escrow.order = order.key();
        ctx.accounts.escrow.bump = ctx.bumps.escrow;
        Ok(())
    }

    pub fn place_spot_order_sell(
        ctx: Context<PlaceSpotOrderSell>,
        order_id: u64,
        amount: u64,
        price_scaled: u128,
        expires_ts: i64,
    ) -> Result<()> {
        require!(amount > 0, LynxError::InvalidAmount);
        require!(price_scaled > 0, LynxError::InvalidAmount);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        let now = Clock::get()?.unix_timestamp;
        require!(now < expires_ts, LynxError::InvalidExpiry);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_lynx_account.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let order = &mut ctx.accounts.order;
        order.id = order_id;
        order.owner = ctx.accounts.owner.key();
        order.side = SpotOrderSide::Sell;
        order.price_scaled = price_scaled;
        order.amount = amount;
        order.remaining = amount;
        order.status = SpotOrderStatus::Open;
        order.created_ts = now;
        order.expires_ts = expires_ts;
        order.bump = ctx.bumps.order;
        order.escrow_bump = ctx.bumps.escrow;
        Ok(())
    }

    // Permissionless: cualquiera (nuestro backend como keeper, un bot de
    // terceros, o uno de los dos dueños de las ordenes) puede cranquear un
    // match. El precio de ejecucion SIEMPRE es el de la orden mas antigua
    // (maker) de las dos, nunca lo elige quien envia la transaccion, y el
    // programa exige que los precios crucen antes de mover nada.
    pub fn match_spot_orders(ctx: Context<MatchSpotOrders>, fill_amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        require!(fill_amount > 0, LynxError::InvalidAmount);
        let now = Clock::get()?.unix_timestamp;
        {
            let buy = &ctx.accounts.buy_order;
            let sell = &ctx.accounts.sell_order;
            require!(buy.side == SpotOrderSide::Buy, LynxError::SameSide);
            require!(sell.side == SpotOrderSide::Sell, LynxError::SameSide);
            require!(buy.status == SpotOrderStatus::Open, LynxError::InvalidStatus);
            require!(sell.status == SpotOrderStatus::Open, LynxError::InvalidStatus);
            require!(now < buy.expires_ts, LynxError::OrderExpired);
            require!(now < sell.expires_ts, LynxError::OrderExpired);
            require!(fill_amount <= buy.remaining, LynxError::FillTooLarge);
            require!(fill_amount <= sell.remaining, LynxError::FillTooLarge);
            require!(buy.price_scaled >= sell.price_scaled, LynxError::PriceMismatch);
        }

        let maker_is_buy = ctx.accounts.buy_order.created_ts <= ctx.accounts.sell_order.created_ts;
        let exec_price = if maker_is_buy { ctx.accounts.buy_order.price_scaled } else { ctx.accounts.sell_order.price_scaled };
        let sol_amount = spot_sol_amount(fill_amount, exec_price)?;
        let fee = bps(sol_amount, GLOBAL_TRADE_FEE_BPS)?;
        let net_to_seller = sol_amount.checked_sub(fee).ok_or(LynxError::MathOverflow)?;

        // Monto que quedo reservado en buy_escrow para este fill, calculado al
        // precio LIMITE del comprador (buy_order.price_scaled), no al precio
        // de ejecucion. Como el escrow se llena en place_spot_order_buy al
        // precio propio del comprador, esta es la porcion exacta del escrow
        // que corresponde a este fill. Es >= sol_amount porque exec_price es
        // el precio del maker y buy.price_scaled >= sell.price_scaled esta
        // garantizado arriba (require de cruce de precios).
        let buyer_reserved_for_fill = spot_sol_amount(fill_amount, ctx.accounts.buy_order.price_scaled)?;
        // "Mejora de precio": si el maker es el vendedor con precio menor al
        // limite del comprador, esta es la diferencia que le pertenece al
        // comprador y debe volver a su wallet en la misma transaccion, no
        // quedarse varada en el escrow (antes no se devolvia nunca).
        let buyer_surplus = buyer_reserved_for_fill.checked_sub(sol_amount).ok_or(LynxError::MathOverflow)?;

        require_keys_eq!(ctx.accounts.seller_wallet.key(), ctx.accounts.sell_order.owner, LynxError::ActionMismatch);
        require_keys_eq!(ctx.accounts.buyer_wallet.key(), ctx.accounts.buy_order.owner, LynxError::ActionMismatch);
        require_keys_eq!(ctx.accounts.buyer_lynx_account.owner, ctx.accounts.buy_order.owner, LynxError::ActionMismatch);

        transfer_lamports(&ctx.accounts.buy_escrow.to_account_info(), &ctx.accounts.seller_wallet.to_account_info(), net_to_seller)?;
        if fee > 0 {
            transfer_lamports(&ctx.accounts.buy_escrow.to_account_info(), &ctx.accounts.treasury.to_account_info(), fee)?;
        }
        if buyer_surplus > 0 {
            transfer_lamports(&ctx.accounts.buy_escrow.to_account_info(), &ctx.accounts.buyer_wallet.to_account_info(), buyer_surplus)?;
        }

        let sell_order_id_bytes = ctx.accounts.sell_order.id.to_le_bytes();
        let sell_owner = ctx.accounts.sell_order.owner;
        let sell_order_seeds: &[&[u8]] = &[
            b"spot_order",
            sell_owner.as_ref(),
            sell_order_id_bytes.as_ref(),
            &[ctx.accounts.sell_order.bump],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sell_escrow.to_account_info(),
                    to: ctx.accounts.buyer_lynx_account.to_account_info(),
                    authority: ctx.accounts.sell_order.to_account_info(),
                },
                &[sell_order_seeds],
            ),
            fill_amount,
        )?;

        let buy_order = &mut ctx.accounts.buy_order;
        buy_order.remaining = buy_order.remaining.checked_sub(fill_amount).ok_or(LynxError::MathOverflow)?;
        if buy_order.remaining == 0 { buy_order.status = SpotOrderStatus::Filled; }

        let sell_order = &mut ctx.accounts.sell_order;
        sell_order.remaining = sell_order.remaining.checked_sub(fill_amount).ok_or(LynxError::MathOverflow)?;
        if sell_order.remaining == 0 { sell_order.status = SpotOrderStatus::Filled; }

        Ok(())
    }

    pub fn cancel_spot_order_buy(ctx: Context<CancelSpotOrderBuy>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let order = &mut ctx.accounts.order;
        require!(order.status == SpotOrderStatus::Open, LynxError::InvalidStatus);
        let is_owner = ctx.accounts.signer.key() == order.owner;
        let is_expired = now >= order.expires_ts;
        require!(is_owner || is_expired, LynxError::Unauthorized);
        require_keys_eq!(ctx.accounts.owner.key(), order.owner, LynxError::Unauthorized);

        let refund = spot_sol_amount(order.remaining, order.price_scaled)?;
        if refund > 0 {
            transfer_lamports(&ctx.accounts.escrow.to_account_info(), &ctx.accounts.owner.to_account_info(), refund)?;
        }
        order.remaining = 0;
        order.status = SpotOrderStatus::Cancelled;
        Ok(())
    }

    pub fn cancel_spot_order_sell(ctx: Context<CancelSpotOrderSell>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let is_owner = ctx.accounts.signer.key() == ctx.accounts.order.owner;
        let is_expired = now >= ctx.accounts.order.expires_ts;
        require!(ctx.accounts.order.status == SpotOrderStatus::Open, LynxError::InvalidStatus);
        require!(is_owner || is_expired, LynxError::Unauthorized);
        require_keys_eq!(ctx.accounts.owner_lynx_account.owner, ctx.accounts.order.owner, LynxError::Unauthorized);

        let remaining = ctx.accounts.order.remaining;
        let order_id_bytes = ctx.accounts.order.id.to_le_bytes();
        let order_owner = ctx.accounts.order.owner;
        let order_bump = ctx.accounts.order.bump;
        let order_seeds: &[&[u8]] = &[b"spot_order", order_owner.as_ref(), order_id_bytes.as_ref(), &[order_bump]];

        if remaining > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.owner_lynx_account.to_account_info(),
                        authority: ctx.accounts.order.to_account_info(),
                    },
                    &[order_seeds],
                ),
                remaining,
            )?;
        }
        ctx.accounts.order.remaining = 0;
        ctx.accounts.order.status = SpotOrderStatus::Cancelled;
        Ok(())
    }

    pub fn cut_off_market(ctx: Context<CutOffMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open || market.status == MarketStatus::Active, LynxError::InvalidStatus);
        require!(Clock::get()?.unix_timestamp >= market.cutoff_ts, LynxError::CutoffNotReached);
        market.status = MarketStatus::CutOff;
        Ok(())
    }

    // Antes: resolve_market_oracle movia los fondos en el mismo instante en que
    // el oraculo firmaba. Ahora solo registra la propuesta; los fondos no se
    // mueven hasta finalize_resolution(), y cualquier firmante del multisig
    // puede frenarla con dispute_resolution() dentro de DISPUTE_WINDOW_SECONDS.
    pub fn propose_resolution(ctx: Context<ProposeResolution>, result: Outcome) -> Result<()> {
        require!(result_is_valid(result, ctx.accounts.market.is_ternary), LynxError::InvalidOutcome);
        require_keys_eq!(ctx.accounts.oracle_authority.key(), ctx.accounts.market.oracle_authority, LynxError::Unauthorized);
        require!(ctx.accounts.config.multisig_initialized, LynxError::Unauthorized);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.market.resolve_ts, LynxError::ResolveTimeNotReached);

        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::CutOff || market.status == MarketStatus::PendingResolution,
            LynxError::InvalidStatus
        );
        market.status = MarketStatus::PendingResolution;
        market.proposed_result = result;
        market.proposed_ts = now;
        // Congela el ratio de minteo aqui (al proponer) para que no se pueda
        // manipular durante la ventana de disputa. El valor sale del TWAP, no
        // del supply instantaneo: de lo contrario bastaba con quemar LYNX en
        // esta misma transaccion para inflar el ratio congelado (SC-01).
        if market.currency == Currency::SOL {
            market.mint_ratio_snapshot_bps =
                mint_ratio_bps_twap(&ctx.accounts.supply_twap, &ctx.accounts.config)?;
        }
        Ok(())
    }

    // Cualquier firmante del multisig (no solo el admin) puede disputar una
    // resolucion propuesta mientras siga dentro de la ventana de disputa. Esto
    // devuelve el mercado a CutOff sin mover ningun fondo; a partir de ahi hace
    // falta una nueva propuesta del oraculo, o -si el timeout de oraculo ya
    // paso- el camino de fallback via governance (propose_action con
    // ResolveMarketAdmin + execute_resolve_market_admin).
    pub fn dispute_resolution(ctx: Context<DisputeResolution>) -> Result<()> {
        require!(is_multisig_signer(&ctx.accounts.multisig, ctx.accounts.signer.key()), LynxError::NotAMultisigSigner);
        let now = Clock::get()?.unix_timestamp;
        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::PendingResolution, LynxError::MarketNotPendingResolution);
        require!(
            now < market.proposed_ts.checked_add(DISPUTE_WINDOW_SECONDS).ok_or(LynxError::MathOverflow)?,
            LynxError::DisputeWindowElapsed
        );
        market.status = MarketStatus::CutOff;
        market.proposed_result = Outcome::Unresolved;
        market.proposed_ts = 0;
        Ok(())
    }

    // Permissionless a proposito: una vez que paso la ventana de disputa sin que
    // ningun firmante del multisig la frenara, cualquiera puede "cranquear" la
    // finalizacion real (mover fondos a treasury/rewards_vault segun las fees).
    // No hace falta que sea el oraculo ni el admin quien la dispare.
    pub fn finalize_resolution(ctx: Context<FinalizeResolution>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.market.status == MarketStatus::PendingResolution, LynxError::MarketNotPendingResolution);
        require!(
            now >= ctx.accounts.market.proposed_ts.checked_add(DISPUTE_WINDOW_SECONDS).ok_or(LynxError::MathOverflow)?,
            LynxError::DisputeWindowNotElapsed
        );
        let result = ctx.accounts.market.proposed_result;
        // resolved_by = quien PROPUSO el resultado (el oraculo del mercado), no
        // quien dispara esta instruccion permissionless — asi el registro
        // refleja quien realmente decidio el resultado, no quien pago el gas.
        let resolved_by = ctx.accounts.market.oracle_authority;
        finalize_market_and_fees(
            &mut ctx.accounts.config,
            &mut ctx.accounts.market,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.rewards_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            result,
            resolved_by,
        )
    }

    pub fn claim_market_sol(ctx: Context<ClaimMarketSol>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        // CR-02: defensive check — binary markets cannot resolve to Draw,
        // but if they somehow did, no claim should be allowed.
        require!(market.is_ternary || market.result != Outcome::Draw, LynxError::InvalidOutcome);
        let position = &mut ctx.accounts.position;
        require!(market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(!position.claimed, LynxError::AlreadyClaimed);
        require!(position_is_winner(market, position), LynxError::LosingPosition);

        let denominator = market.winning_total;
        require!(denominator > 0, LynxError::NoWinningPool);
        let payout_pool = bps(market.pool_total, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS)?;
        let payout = mul_div(payout_pool, position.amount, denominator)?;

        // MD-06: track total claimed so dust-sweep can detect completion.
        market.total_claimed = market.total_claimed.checked_add(payout).ok_or(LynxError::MathOverflow)?;

        transfer_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.claimant.to_account_info(), payout)?;
        position.claimed = true;
        Ok(())
    }

    // LYNX-currency counterpart of claim_market_sol. Previously missing entirely,
    // which meant winners of a LYNX-denominated market had no on-chain way to ever
    // withdraw their payout (funds were stuck in market_lynx_vault permanently).
    // Uses the same 90/10 split as the SOL path (BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS
    // to the winner, the remaining EVENT_PROTOCOL_FEE_BPS forwarded to treasury), computed
    // per-claim since resolve_market_oracle/resolve_market_admin never took a fee out of
    // market_lynx_vault the way they do for SOL vaults. Across all winning claims for a
    // market this sums to exactly the same 90%/10% split as the SOL flow.
    pub fn claim_market_lynx(ctx: Context<ClaimMarketLynx>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        require!(market.currency == Currency::LYNX, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(!position.claimed, LynxError::AlreadyClaimed);
        require!(position_is_winner(market, position), LynxError::LosingPosition);

        let denominator = market.winning_total;
        require!(denominator > 0, LynxError::NoWinningPool);

        let payout_pool = bps(market.pool_total, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS)?;
        let payout = mul_div(payout_pool, position.amount, denominator)?;
        let fee_pool = market.pool_total.checked_sub(payout_pool).ok_or(LynxError::MathOverflow)?;
        let fee_share = mul_div(fee_pool, position.amount, denominator)?;

        let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        if payout > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.market_lynx_vault.to_account_info(),
                        to: ctx.accounts.claimant_lynx_account.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                payout,
            )?;
        }
        if fee_share > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.market_lynx_vault.to_account_info(),
                        to: ctx.accounts.treasury_lynx_account.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                fee_share,
            )?;
        }

        position.claimed = true;
        Ok(())
    }

    // Companion to claim_market_sol/claim_market_lynx for the edge case they can never
    // handle: a market resolves but the winning side has 0 staked (winning_total == 0).
    // require!(denominator > 0, ...) in both claim instructions then permanently blocks
    // every claim for that market, so without this the pool sits in vault forever with
    // no on-chain path to recover it. The backend already does the SOL-equivalent of
    // this at resolveMarket() time (backend/src/state.ts) precisely to avoid that.
    // Split into _sol/_lynx (mirroring claim_market_sol/claim_market_lynx and
    // resolve_market_oracle/resolve_market_admin) instead of folding this into
    // finalize_market_and_fees, so the two existing resolve instructions don't have to
    // carry LYNX-only accounts (market_lynx_vault/treasury_lynx_account/token_program)
    // on every single resolution of a SOL market, and vice versa.
    // Callable by anyone once a market is Resolved with winning_total == 0: the
    // destination (treasury) and amount are fully deterministic from on-chain state,
    // there is no discretion for the caller to abuse, so this is intentionally
    // permissionless (a "crank") rather than gated to admin/oracle_authority.
    pub fn sweep_unclaimed_market_sol(ctx: Context<SweepUnclaimedMarketSol>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        // CR-02: defensive check — binary markets cannot resolve to Draw.
        require!(market.is_ternary || market.result != Outcome::Draw, LynxError::InvalidOutcome);
        require!(!market.swept, LynxError::AlreadySwept);

        if market.winning_total == 0 {
            // No winners: sweep the entire net pool to treasury.
            require!(market.pool_total > 0, LynxError::NothingToSweep);
            let net_pool = bps(market.pool_total, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS)?;
            transfer_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), net_pool)?;
        } else {
            // MD-06: Dust sweep. After all winners have claimed, integer-division
            // rounding may leave a few lamports in the vault. When total_claimed
            // reaches the payout pool, only rent-exempt dust remains.
            let payout_pool = bps(market.pool_total, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS)?;
            require!(market.total_claimed >= payout_pool, LynxError::NothingToSweep);
            let rent_minimum = Rent::get()?.minimum_balance(ctx.accounts.vault.to_account_info().data_len());
            let excess = ctx.accounts.vault.to_account_info().lamports().saturating_sub(rent_minimum);
            require!(excess > 0, LynxError::NothingToSweep);
            transfer_lamports(&ctx.accounts.vault.to_account_info(), &ctx.accounts.treasury.to_account_info(), excess)?;
        }

        market.swept = true;
        Ok(())
    }

    // LYNX counterpart of sweep_unclaimed_market_sol. Unlike the SOL path, no protocol
    // fee is taken out of market_lynx_vault at resolution time (see the comment on
    // claim_market_lynx), so the entire pool_total — not just a 90% share — is still
    // sitting in market_lynx_vault when winning_total == 0, and all of it goes to
    // treasury_lynx_account here.
    pub fn sweep_unclaimed_market_lynx(ctx: Context<SweepUnclaimedMarketLynx>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.currency == Currency::LYNX, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(market.winning_total == 0, LynxError::NoWinningPool);
        require!(!market.swept, LynxError::AlreadySwept);
        require!(market.pool_total > 0, LynxError::NothingToSweep);

        let sweep_amount = market.pool_total;
        let signer: &[&[&[u8]]] = &[&[b"config", &[ctx.accounts.config.bump]]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.market_lynx_vault.to_account_info(),
                    to: ctx.accounts.treasury_lynx_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            sweep_amount,
        )?;

        market.swept = true;
        Ok(())
    }

    pub fn mint_lynx_distribution(ctx: Context<MintLynxDistribution>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.currency == Currency::SOL, LynxError::InvalidCurrency);
        require!(market.status == MarketStatus::Resolved, LynxError::InvalidStatus);
        require!(!ctx.accounts.position.lynx_minted, LynxError::AlreadyClaimed);
        require!(market.pool_total > 0, LynxError::InvalidAmount);

        let base_micro_lynx = market
            .pool_total
            .checked_div(LAMPORTS_TO_MICRO_LYNX_DENOMINATOR)
            .ok_or(LynxError::MathOverflow)?;
        // Fixed at resolution time in finalize_market_and_fees — every winner of
        // this market uses the same ratio, regardless of claim order/timing.
        let ratio_bps = market.mint_ratio_bps;
        let total_micro_lynx = bps(base_micro_lynx, ratio_bps)?;
        let position_amount = ctx.accounts.position.amount;
        let participant_amount = prorated_bps(total_micro_lynx, LYNX_PARTICIPANT_BPS, position_amount, market.pool_total)?;
        let treasury_amount_base = prorated_bps(total_micro_lynx, LYNX_TREASURY_BPS, position_amount, market.pool_total)?;
        let sale_amount = prorated_bps(total_micro_lynx, LYNX_INITIAL_SALE_BPS, position_amount, market.pool_total)?;
        // Each of the three amounts above is independently rounded down. The remainder
        // ("dust") from that rounding is routed to treasury instead of being lost, so the
        // sum actually minted always equals total_micro_lynx exactly.
        let allocated_amount = participant_amount
            .checked_add(treasury_amount_base).ok_or(LynxError::MathOverflow)?
            .checked_add(sale_amount).ok_or(LynxError::MathOverflow)?;
        let dust_amount = total_micro_lynx.checked_sub(allocated_amount).ok_or(LynxError::MathOverflow)?;
        let treasury_amount = treasury_amount_base.checked_add(dust_amount).ok_or(LynxError::MathOverflow)?;

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
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
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

        // SC-03: enforce protocol duel exposure cap
        if duel_type == DuelType::OneVOneVProtocol {
            let new_exposure = ctx
                .accounts
                .config
                .protocol_duel_exposure
                .checked_add(amount)
                .ok_or(LynxError::MathOverflow)?;
            require!(
                new_exposure <= ctx.accounts.config.max_protocol_duel_exposure,
                LynxError::ProtocolDuelExposureExceeded
            );
            ctx.accounts.config.protocol_duel_exposure = new_exposure;
        }

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
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
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
            let base_payout_micro_lynx = duel
                .amount
                .checked_div(LAMPORTS_TO_MICRO_LYNX_DENOMINATOR)
                .ok_or(LynxError::MathOverflow)?;
            // SC-02 fix: use the mint_ratio_bps frozen on the Market at
            // resolve-time (finalize_market_and_fees) instead of calling
            // current_mint_ratio_bps() which reads the instantaneous
            // circulating supply and is manipulable (see SC-01).
            let ratio_bps = market.mint_ratio_bps;
            require!(ratio_bps > 0, LynxError::InvalidAmount);
            let payout_micro_lynx = bps(base_payout_micro_lynx, ratio_bps)?;
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
        // SC-03: release protocol exposure now that the duel is settled
        ctx.accounts.config.protocol_duel_exposure = ctx
            .accounts
            .config
            .protocol_duel_exposure
            .checked_sub(duel.amount)
            .ok_or(LynxError::MathOverflow)?;
        Ok(())
    }

    // Refund path for an unaccepted 1v1 duel. Before this, DuelStatus::Cancelled was defined
    // but never assigned anywhere, and there was no instruction that released duel_vault back
    // to the creator, so the creator's SOL stayed locked forever if no rival ever called
    // accept_duel. Mirrors the offchain cancelDuel() (backend/src/state.ts): only the duel's
    // creator can cancel, only while still Open, no expiry required — it's the creator's own
    // deposit and their call to walk away from it. Requiring their signature (via the `creator`
    // Signer + has_one check below) matters here specifically because there's no expiry gate:
    // without it, anyone could cancel someone else's open duel out from under them right before
    // a rival accepts. OneVOneVProtocol duels go straight to Active on creation and never sit
    // Open, so they can't reach this path.
    pub fn cancel_duel(ctx: Context<CancelDuel>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        require!(duel.duel_type == DuelType::OneVOne, LynxError::InvalidDuelType);
        require!(duel.status == DuelStatus::Open, LynxError::InvalidStatus);

        transfer_lamports(&ctx.accounts.duel_vault.to_account_info(), &ctx.accounts.creator.to_account_info(), duel.amount)?;
        duel.status = DuelStatus::Cancelled;
        Ok(())
    }

    // --- DAO on-chain (propuestas + voto ponderado por stake) ---
    // Crear propuestas queda restringido al admin del protocolo, igual que la
    // ruta off-chain /api/proposals (requireAdminSessionOnly). Votar es abierto
    // a cualquier staker; el peso es su LYNX apostado.
    pub fn create_dao_proposal(
        ctx: Context<CreateDaoProposal>,
        proposal_id: u64,
        title: String,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(title.len() <= DaoProposal::TITLE_MAX, LynxError::TextTooLong);
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.config.admin, LynxError::Unauthorized);
        require!(!ctx.accounts.config.paused, LynxError::ProtocolPaused);
        require!(
            (DAO_MIN_PROPOSAL_DURATION_SECONDS..=DAO_MAX_PROPOSAL_DURATION_SECONDS).contains(&duration_seconds),
            LynxError::InvalidProposalDuration
        );

        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        proposal.id = proposal_id;
        proposal.proposer = ctx.accounts.admin.key();
        proposal.title = title;
        proposal.created_ts = now;
        proposal.end_ts = now.checked_add(duration_seconds).ok_or(LynxError::MathOverflow)?;
        proposal.votes_yes = 0;
        proposal.votes_no = 0;
        proposal.status = DaoProposalStatus::Active;
        proposal.bump = ctx.bumps.proposal;
        Ok(())
    }

    pub fn cast_dao_vote(ctx: Context<CastDaoVote>, vote_yes: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.proposal.status == DaoProposalStatus::Active, LynxError::DaoProposalNotActive);
        require!(now < ctx.accounts.proposal.end_ts, LynxError::DaoVotingEnded);

        // Vote weight = the voter's currently staked LYNX, read on-chain. The
        // `init` on the DaoVote PDA (seeds = [b"dao_vote", proposal, voter]) makes
        // a second vote by the same wallet fail at account creation.
        let weight = ctx.accounts.stake_position.amount;
        require!(weight > 0, LynxError::NoStakeToVote);

        let vote = &mut ctx.accounts.vote;
        vote.proposal = ctx.accounts.proposal.key();
        vote.voter = ctx.accounts.voter.key();
        vote.vote_yes = vote_yes;
        vote.weight = weight;
        vote.bump = ctx.bumps.vote;

        let proposal = &mut ctx.accounts.proposal;
        if vote_yes {
            proposal.votes_yes = proposal.votes_yes.checked_add(weight).ok_or(LynxError::MathOverflow)?;
        } else {
            proposal.votes_no = proposal.votes_no.checked_add(weight).ok_or(LynxError::MathOverflow)?;
        }
        Ok(())
    }

    // Permissionless crank: once the window closes, anyone can finalize the
    // tally. The result is fully determined by on-chain votes, so the caller has
    // no discretion.
    pub fn finalize_dao_proposal(ctx: Context<FinalizeDaoProposal>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.status == DaoProposalStatus::Active, LynxError::DaoProposalNotActive);
        require!(now >= proposal.end_ts, LynxError::DaoVotingStillOpen);
        proposal.status = if proposal.votes_yes > proposal.votes_no {
            DaoProposalStatus::Passed
        } else {
            DaoProposalStatus::Rejected
        };
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
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
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
    #[account(mut, constraint = user_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub user_lynx_account: Box<Account<'info, TokenAccount>>,
    // PDA'd to this specific market so custody can never be mixed across LYNX markets.
    // Created up-front by init_market_lynx_vault rather than `init_if_needed` here:
    // the inline init codegen overflowed this instruction's BPF stack frame and made
    // it fault at runtime. Pinned by the bump stored on the market, which also means
    // a market whose vault was never initialised (lynx_vault_bump == 0) cannot be
    // bought into by accident.
    #[account(
        mut,
        seeds = [b"lynx_vault", market.key().as_ref()],
        bump = market.lynx_vault_bump,
        constraint = market_lynx_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency,
    )]
    pub market_lynx_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitSupplyTwap<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init,
        payer = payer,
        space = CirculatingSupplyTwap::LEN,
        seeds = [b"supply_twap", config.key().as_ref()],
        bump
    )]
    pub supply_twap: Box<Account<'info, CirculatingSupplyTwap>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordSupplySnapshot<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [b"supply_twap", config.key().as_ref()],
        bump = supply_twap.bump,
        has_one = config
    )]
    pub supply_twap: Box<Account<'info, CirculatingSupplyTwap>>,
}

#[derive(Accounts)]
pub struct InitMarketLynxVault<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(address = config.lynx_mint)]
    pub lynx_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        seeds = [b"lynx_vault", market.key().as_ref()],
        bump,
        token::mint = lynx_mint,
        token::authority = config,
    )]
    pub market_lynx_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, outcome: Outcome)]
pub struct CreatePredictionLimitOrderSol<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = owner,
        space = PredictionOrder::LEN,
        seeds = [b"pred_order", market.key().as_ref(), owner.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, PredictionOrder>,
    #[account(
        init,
        payer = owner,
        space = PredictionOrderEscrowSol::LEN,
        seeds = [b"pred_order_escrow_sol", order.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, PredictionOrderEscrowSol>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
// Boxed to keep try_accounts within the 4096-byte BPF stack limit (see
// MintLynxDistribution). Adding the `config` account pushed this frame 16 bytes
// over; heap-allocating the accounts brings it back under.
pub struct ExecutePredictionLimitOrderSol<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Box<Account<'info, MarketVault>>,
    #[account(
        mut,
        seeds = [b"pred_order", market.key().as_ref(), order.owner.as_ref(), order.id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub order: Box<Account<'info, PredictionOrder>>,
    #[account(mut, seeds = [b"pred_order_escrow_sol", order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: Box<Account<'info, PredictionOrderEscrowSol>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), order.owner.as_ref(), &[order.outcome.as_seed()]],
        bump
    )]
    pub position: Box<Account<'info, UserPosition>>,
    // Cualquiera puede pagar por la ejecucion (un keeper); el fill en si le
    // pertenece siempre a order.owner, nunca a quien paga esta transaccion.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelPredictionLimitOrderSol<'info> {
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"pred_order", market.key().as_ref(), order.owner.as_ref(), order.id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, PredictionOrder>,
    #[account(mut, seeds = [b"pred_order_escrow_sol", order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: Account<'info, PredictionOrderEscrowSol>,
    /// CHECK: debe ser igual a order.owner; es quien recibe el reembolso.
    #[account(mut, address = order.owner)]
    pub owner: UncheckedAccount<'info>,
    // Quien firma y paga la tx: puede ser el propio owner, o cualquiera si la
    // orden ya expiro (ver require en cancel_prediction_limit_order_sol).
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, outcome: Outcome)]
pub struct CreatePredictionLimitOrderLynx<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init,
        payer = owner,
        space = PredictionOrder::LEN,
        seeds = [b"pred_order", market.key().as_ref(), owner.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Box<Account<'info, PredictionOrder>>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = user_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub user_lynx_account: Box<Account<'info, TokenAccount>>,
    // Token account cuya AUTHORITY es la propia cuenta `order` (PDA), no el
    // usuario ni config: solo execute_/cancel_prediction_limit_order_lynx,
    // firmando con las seeds de `order`, pueden mover estos fondos.
    #[account(
        init,
        payer = owner,
        seeds = [b"pred_order_escrow_lynx", order.key().as_ref()],
        bump,
        token::mint = lynx_mint,
        token::authority = order,
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecutePredictionLimitOrderLynx<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        seeds = [b"pred_order", market.key().as_ref(), order.owner.as_ref(), order.id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub order: Box<Account<'info, PredictionOrder>>,
    #[account(mut, seeds = [b"pred_order_escrow_lynx", order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Box<Account<'info, Mint>>,
    // Created once by init_market_lynx_vault, not inline — see BuyPositionLynxWithBurn.
    #[account(
        mut,
        seeds = [b"lynx_vault", market.key().as_ref()],
        bump = market.lynx_vault_bump,
        constraint = market_lynx_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency,
    )]
    pub market_lynx_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = UserPosition::LEN,
        seeds = [b"position", market.key().as_ref(), order.owner.as_ref(), &[order.outcome.as_seed()]],
        bump
    )]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelPredictionLimitOrderLynx<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"pred_order", market.key().as_ref(), order.owner.as_ref(), order.id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, PredictionOrder>,
    #[account(mut, seeds = [b"pred_order_escrow_lynx", order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: Account<'info, TokenAccount>,
    // Debe ser la token account del propio order.owner; se valida en la
    // instruccion (require_keys_eq! sobre owner_lynx_account.owner).
    #[account(mut, constraint = owner_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub owner_lynx_account: Account<'info, TokenAccount>,
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct PlaceSpotOrderBuy<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = owner,
        space = SpotOrder::LEN,
        seeds = [b"spot_order", owner.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, SpotOrder>,
    #[account(
        init,
        payer = owner,
        space = SpotOrderEscrowSol::LEN,
        seeds = [b"spot_order_escrow_sol", order.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, SpotOrderEscrowSol>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct PlaceSpotOrderSell<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        init,
        payer = owner,
        space = SpotOrder::LEN,
        seeds = [b"spot_order", owner.key().as_ref(), order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Box<Account<'info, SpotOrder>>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = user_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub user_lynx_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = owner,
        seeds = [b"spot_order_escrow_lynx", order.key().as_ref()],
        bump,
        token::mint = lynx_mint,
        token::authority = order,
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MatchSpotOrders<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(
        mut,
        seeds = [b"spot_order", buy_order.owner.as_ref(), buy_order.id.to_le_bytes().as_ref()],
        bump = buy_order.bump
    )]
    pub buy_order: Box<Account<'info, SpotOrder>>,
    #[account(mut, seeds = [b"spot_order_escrow_sol", buy_order.key().as_ref()], bump = buy_order.escrow_bump)]
    pub buy_escrow: Box<Account<'info, SpotOrderEscrowSol>>,
    #[account(
        mut,
        seeds = [b"spot_order", sell_order.owner.as_ref(), sell_order.id.to_le_bytes().as_ref()],
        bump = sell_order.bump
    )]
    pub sell_order: Box<Account<'info, SpotOrder>>,
    #[account(mut, seeds = [b"spot_order_escrow_lynx", sell_order.key().as_ref()], bump = sell_order.escrow_bump)]
    pub sell_escrow: Box<Account<'info, TokenAccount>>,
    // Wallet del vendedor (sell_order.owner), destino del SOL neto. Validado
    // en la instruccion con require_keys_eq!.
    /// CHECK: validado contra sell_order.owner dentro de la instruccion
    #[account(mut)]
    pub seller_wallet: UncheckedAccount<'info>,
    // Wallet del comprador (buy_order.owner), destino inmediato de la "mejora
    // de precio" (surplus) cuando el precio de ejecucion es mejor que su
    // limite. Validado en la instruccion con require_keys_eq!.
    /// CHECK: validado contra buy_order.owner dentro de la instruccion
    #[account(mut)]
    pub buyer_wallet: UncheckedAccount<'info>,
    // Token account de LYNX del comprador (buy_order.owner), destino del LYNX
    // comprado. Validado en la instruccion con require_keys_eq! sobre .owner.
    #[account(mut, constraint = buyer_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub buyer_lynx_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelSpotOrderBuy<'info> {
    #[account(
        mut,
        seeds = [b"spot_order", order.owner.as_ref(), order.id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, SpotOrder>,
    #[account(mut, seeds = [b"spot_order_escrow_sol", order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: Account<'info, SpotOrderEscrowSol>,
    /// CHECK: debe ser igual a order.owner; recibe el reembolso
    #[account(mut, address = order.owner)]
    pub owner: UncheckedAccount<'info>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelSpotOrderSell<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        mut,
        seeds = [b"spot_order", order.owner.as_ref(), order.id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub order: Account<'info, SpotOrder>,
    #[account(mut, seeds = [b"spot_order_escrow_lynx", order.key().as_ref()], bump = order.escrow_bump)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, constraint = owner_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub owner_lynx_account: Account<'info, TokenAccount>,
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CutOffMarket<'info> {
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ProposeResolution<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    // Fuente del ratio de minteo congelado en el mercado (SC-01). Anclada al
    // PDA y a este config, asi que el oraculo no puede pasar un TWAP falso.
    #[account(seeds = [b"supply_twap", config.key().as_ref()], bump = supply_twap.bump, has_one = config)]
    pub supply_twap: Box<Account<'info, CirculatingSupplyTwap>>,
    pub oracle_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DisputeResolution<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"multisig", config.key().as_ref()], bump = multisig.bump)]
    pub multisig: Account<'info, Multisig>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeResolution<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut, seeds = [b"rewards_vault"], bump = rewards_vault.bump)]
    pub rewards_vault: Account<'info, RewardsVault>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitMultisig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(init, payer = admin, space = Multisig::LEN, seeds = [b"multisig", config.key().as_ref()], bump)]
    pub multisig: Account<'info, Multisig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeAction<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"multisig", config.key().as_ref()], bump = multisig.bump)]
    pub multisig: Account<'info, Multisig>,
    #[account(
        init,
        payer = proposer,
        space = GovernanceProposal::LEN,
        seeds = [b"gov_proposal", multisig.key().as_ref(), multisig.proposal_seq.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, GovernanceProposal>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveAction<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"multisig", config.key().as_ref()], bump = multisig.bump)]
    pub multisig: Account<'info, Multisig>,
    #[account(mut, has_one = multisig)]
    pub proposal: Account<'info, GovernanceProposal>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(seeds = [b"multisig", config.key().as_ref()], bump = multisig.bump)]
    pub multisig: Account<'info, Multisig>,
    #[account(mut, has_one = multisig)]
    pub proposal: Account<'info, GovernanceProposal>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteAction<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"multisig", config.key().as_ref()], bump = multisig.bump)]
    pub multisig: Account<'info, Multisig>,
    #[account(mut, has_one = multisig)]
    pub proposal: Account<'info, GovernanceProposal>,
}

#[derive(Accounts)]
pub struct ExecuteResolveMarketAdmin<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [b"multisig", config.key().as_ref()], bump = multisig.bump)]
    pub multisig: Box<Account<'info, Multisig>>,
    #[account(mut, has_one = multisig)]
    pub proposal: Box<Account<'info, GovernanceProposal>>,
    // Fuente del ratio de minteo para la via de fallback admin (SC-01).
    #[account(seeds = [b"supply_twap", config.key().as_ref()], bump = supply_twap.bump, has_one = config)]
    pub supply_twap: Box<Account<'info, CirculatingSupplyTwap>>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut, seeds = [b"rewards_vault"], bump = rewards_vault.bump)]
    pub rewards_vault: Account<'info, RewardsVault>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimMarketSol<'info> {
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    #[account(mut, has_one = market, constraint = position.owner == claimant.key() @ LynxError::Unauthorized)]
    pub position: Account<'info, UserPosition>,
    #[account(mut)]
    pub claimant: Signer<'info>,
}

#[derive(Accounts)]
// Boxed to keep try_accounts inside the 4096-byte BPF stack frame. Unboxed, this
// struct's frame was 4168 bytes and the program did not merely risk undefined
// behaviour — it hard-faulted at runtime with "Access violation in unknown
// section at address 0x8", meaning NO winner of a LYNX-denominated market could
// ever claim their payout. See tests/lynx_paths_integration.rs.
pub struct ClaimMarketLynx<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, has_one = market, constraint = position.owner == claimant.key() @ LynxError::Unauthorized)]
    pub position: Box<Account<'info, UserPosition>>,
    // Same PDA derivation as in BuyPositionLynxWithBurn, pinned to this market via seeds
    // instead of being validated only by mint+owner.
    #[account(
        mut,
        seeds = [b"lynx_vault", market.key().as_ref()],
        bump = market.lynx_vault_bump,
        constraint = market_lynx_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency,
    )]
    pub market_lynx_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = claimant_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub claimant_lynx_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency,
        constraint = treasury_lynx_account.owner == config.treasury @ LynxError::Unauthorized
    )]
    pub treasury_lynx_account: Box<Account<'info, TokenAccount>>,
    pub claimant: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SweepUnclaimedMarketSol<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, MarketVault>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury @ LynxError::Unauthorized)]
    pub treasury: UncheckedAccount<'info>,
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct SweepUnclaimedMarketLynx<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [b"lynx_vault", market.key().as_ref()],
        bump = market.lynx_vault_bump,
        constraint = market_lynx_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency,
    )]
    pub market_lynx_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency,
        constraint = treasury_lynx_account.owner == config.treasury @ LynxError::Unauthorized
    )]
    pub treasury_lynx_account: Account<'info, TokenAccount>,
    pub caller: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
// Accounts are Boxed to keep the generated `try_accounts` off the BPF stack.
// With bare `Account<'info, _>` fields this struct's deserialization frame was
// 4736 bytes — 336 over Solana's 4096-byte stack limit — which the SBF linker
// flagged as "may cause undefined behavior during execution". Box moves each
// account onto the heap so the frame stays within bounds.
pub struct MintLynxDistribution<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,
    #[account(seeds = [b"market", market.id.to_le_bytes().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, has_one = market, constraint = position.owner == payer.key() @ LynxError::Unauthorized)]
    pub position: Box<Account<'info, UserPosition>>,
    #[account(mut, address = config.lynx_mint)]
    pub lynx_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = holder_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub holder_lynx_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency,
        constraint = treasury_lynx_account.owner == config.treasury @ LynxError::Unauthorized
    )]
    pub treasury_lynx_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = initial_sale_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency,
        constraint = initial_sale_lynx_account.owner == config.treasury @ LynxError::Unauthorized
    )]
    pub initial_sale_lynx_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct StakeLynx<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    // MUST be the canonical stake vault recorded at init. Without pinning it to
    // config.stake_vault, a caller could stake into a token account they control
    // (inflating stake_position/total_staked without funding the real vault) and
    // then unstake the same amount out of the real shared vault — draining every
    // staker's LYNX. The mint check alone is not enough.
    #[account(mut, address = config.stake_vault @ LynxError::Unauthorized,
        constraint = stake_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = StakePosition::LEN,
        seeds = [b"stake", owner.key().as_ref()],
        bump
    )]
    pub stake_position: Account<'info, StakePosition>,
    #[account(mut, constraint = user_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
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
    // Pinned to the canonical vault: config signs the withdrawal, so any
    // config-owned LYNX account passed here (the real stake vault, a market's
    // LYNX vault, …) would otherwise be drained regardless of what was staked.
    #[account(mut, address = config.stake_vault @ LynxError::Unauthorized,
        constraint = stake_vault.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
    pub stake_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"stake", owner.key().as_ref()], bump = stake_position.bump, has_one = owner)]
    pub stake_position: Account<'info, StakePosition>,
    #[account(mut, constraint = user_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency)]
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
    #[account(mut, seeds = [b"config"], bump = config.bump)]
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
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
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
    // The LYNX prize is minted here. This instruction is permissionless (anyone
    // may crank a settled duel), so without an owner constraint the caller could
    // pass their own token account and steal the winner's minted LYNX while the
    // SOL leg still went to duel.creator. Pin it to the creator, mirroring the
    // `position.owner == claimant.key()` check ClaimMarketLynx already enforces.
    #[account(
        mut,
        constraint = recipient_lynx_account.mint == config.lynx_mint @ LynxError::InvalidCurrency,
        constraint = recipient_lynx_account.owner == duel.creator @ LynxError::Unauthorized
    )]
    pub recipient_lynx_account: Account<'info, TokenAccount>,
    /// CHECK: checked against config.treasury
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelDuel<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        has_one = creator @ LynxError::Unauthorized,
        seeds = [b"duel", duel.parent_market.as_ref(), duel.creator.as_ref(), duel.id.to_le_bytes().as_ref()],
        bump = duel.bump
    )]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"duel_vault", duel.key().as_ref()], bump = duel_vault.bump)]
    pub duel_vault: Account<'info, DuelVault>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CreateDaoProposal<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = admin,
        space = DaoProposal::LEN,
        seeds = [b"dao_proposal", proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, DaoProposal>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastDaoVote<'info> {
    #[account(mut, seeds = [b"dao_proposal", proposal.id.to_le_bytes().as_ref()], bump = proposal.bump)]
    pub proposal: Account<'info, DaoProposal>,
    // The voter's stake position supplies the vote weight. The seeds pin it to
    // the signer (the PDA is derived from `voter`), and the constraint re-checks
    // its stored owner as belt-and-suspenders.
    #[account(
        seeds = [b"stake", voter.key().as_ref()],
        bump = stake_position.bump,
        constraint = stake_position.owner == voter.key() @ LynxError::Unauthorized
    )]
    pub stake_position: Account<'info, StakePosition>,
    // init: a second vote by the same wallet on the same proposal collides on
    // this PDA and fails, so one staker can vote at most once.
    #[account(
        init,
        payer = voter,
        space = DaoVote::LEN,
        seeds = [b"dao_vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, DaoVote>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeDaoProposal<'info> {
    #[account(mut, seeds = [b"dao_proposal", proposal.id.to_le_bytes().as_ref()], bump = proposal.bump)]
    pub proposal: Account<'info, DaoProposal>,
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
    resolved_by: Pubkey,
) -> Result<()> {
    // CR-02: Binary markets must never resolve to Draw — it permanently locks
    // funds because no position can be a winner (Draw positions don't exist
    // for binary markets).
    require!(
        market.is_ternary || result != Outcome::Draw,
        LynxError::InvalidOutcome
    );

    require!(
        market.status == MarketStatus::CutOff
            || market.status == MarketStatus::Active
            || market.status == MarketStatus::Open
            || market.status == MarketStatus::PendingResolution,
        LynxError::InvalidStatus
    );
    market.status = MarketStatus::Resolved;
    market.result = result;
    market.resolved_ts = Clock::get()?.unix_timestamp;
    market.resolved_by = resolved_by;
    market.winning_total = match result {
        Outcome::Yes => market.yes_total,
        Outcome::No => market.no_total,
        Outcome::Draw => {
            if market.is_ternary { market.draw_total } else { market.pool_total }
        }
        Outcome::Unresolved => 0,
    };

    // CR-01/SC-01: el ratio SIEMPRE viene del snapshot congelado por
    // propose_resolution o execute_resolve_market_admin, ambos derivados del
    // TWAP. Antes habia un fallback silencioso a current_mint_ratio_bps() para
    // el caso "sin snapshot", que reintroducia justo la lectura instantanea
    // manipulable que el TWAP viene a eliminar — y ademas se ejecutaba en el
    // momento mas predecible posible (finalize es permissionless y cranqueable
    // por cualquiera en cuanto pasa la ventana de disputa).
    //
    // Ambos caminos hacia Resolved fijan el snapshot para mercados en SOL, asi
    // que su ausencia significa que el estado es incoherente: fallar es la
    // unica respuesta segura, y nunca puede atrapar fondos porque el mercado no
    // llega a marcarse Resolved (la tx entera revierte).
    if market.currency == Currency::SOL {
        require!(market.mint_ratio_snapshot_bps > 0, LynxError::MissingMintRatioSnapshot);
        market.mint_ratio_bps = market.mint_ratio_snapshot_bps;
    }

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

// Precio implicito del pool para un outcome, en basis points (0..10000),
// igual que estimatePositionPrice() calculaba en el backend off-chain. El
// llamador debe comprobar market.pool_total > 0 antes de invocar esto (un
// pool vacio no tiene un precio implicito significativo).
fn implied_price_bps(market: &Market, outcome: Outcome) -> Result<u64> {
    let numerator = match outcome {
        Outcome::Yes => market.yes_total,
        Outcome::No => market.no_total,
        Outcome::Draw => market.draw_total,
        Outcome::Unresolved => return err!(LynxError::InvalidOutcome),
    };
    numerator
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(LynxError::MathOverflow)?
        .checked_div(market.pool_total)
        .ok_or_else(|| error!(LynxError::MathOverflow))
}

// Convierte una cantidad de micro-LYNX a lamports al precio dado (escalado
// por PRICE_SCALE). Usa u128 internamente para evitar overflow con
// cantidades grandes antes de volver a u64.
//
// ⚠️  PRECISION NOTE (SC-04):
// The return value is in **lamports** (integer). All internal accounting
// (escrow deposits, fee calculation, transfer amounts) MUST use this raw
// lamport value. Conversion to human-readable SOL (÷ LAMPORTS_PER_SOL)
// should happen ONLY at the final display/UI layer — never in intermediate
// calculations — to avoid truncation/rounding drift.
fn spot_sol_amount(micro_lynx: u64, price_scaled: u128) -> Result<u64> {
    let product = (micro_lynx as u128).checked_mul(price_scaled).ok_or(LynxError::MathOverflow)?;
    let lamports = product.checked_div(PRICE_SCALE).ok_or(LynxError::MathOverflow)?;
    u64::try_from(lamports).map_err(|_| error!(LynxError::MathOverflow))
}

// Comprueba si `key` es uno de los signer_count firmantes activos del multisig.
// No usamos simplemente `.contains()` sobre el array completo porque los huecos
// no usados estan a Pubkey::default(), que nunca debe considerarse un firmante
// valido (evita que una cuenta "vacia"/system-program-owned cuele como firmante).
fn is_multisig_signer(multisig: &Multisig, key: Pubkey) -> bool {
    if key == Pubkey::default() {
        return false;
    }
    let count = multisig.signer_count as usize;
    multisig.signers[..count].contains(&key)
}

fn result_is_valid(outcome: Outcome, is_ternary: bool) -> bool {
    outcome_is_tradeable(outcome, is_ternary)
}

fn position_is_winner(market: &Account<Market>, position: &Account<UserPosition>) -> bool {
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
        // MD-05 (known limitation): integer division truncates downward, so each
        // settle_staker call may lose up to (REWARD_SCALE - 1) micro-lamports of
        // rewards. With REWARD_SCALE = 10^12 this is at most ~1 nano-lamport per
        // settle — economically insignificant but documented for completeness.
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

// SC-01 (resuelto): el ratio de minteo ya NO se deriva del supply circulante
// instantaneo, sino del promedio de la ventana TWAP (ver mint_ratio_bps_twap).
//
// El riesgo era una manipulacion ATOMICA: como `total_lynx_burned` se movia en
// la misma transaccion que la quema, un atacante podia quemar una posicion
// grande e inmediatamente resolver/reclamar un mercado de valor alto en ese
// mismo instante, saltando de RATIO_FLOOR_BPS (250) a RATIO_TIER_1_BPS (10_000)
// — hasta 40x mas LYNX — sin exposicion temporal ni riesgo de precio.
//
// Esta funcion queda como la lectura instantanea "cruda". Solo debe usarse para
// alimentar el crank de snapshots; ninguna ruta que decida cuanto LYNX se
// acuña puede llamarla directamente.
fn instantaneous_circulating_supply(config: &ProtocolConfig) -> u64 {
    // MD-03: saturating_sub evita underflow si total_lynx_burned superara a
    // total_lynx_supply por un bug en otro sitio. Suelo en 1 para no dividir
    // por cero mas abajo.
    config
        .total_lynx_supply
        .saturating_sub(config.total_lynx_burned)
        .max(1)
}

/// Ratio de minteo (bps) para un supply circulante dado, en micro-LYNX.
/// Funcion pura: la busqueda de tramo, aislada de DONDE sale el supply.
fn ratio_for_circulating(circulating: u64) -> u64 {
    let circulating_lynx = circulating.max(1) / MICRO_LYNX_PER_LYNX;

    if circulating_lynx < TIER_1_MAX_LYNX {
        RATIO_TIER_1_BPS
    } else if circulating_lynx < TIER_2_MAX_LYNX {
        RATIO_TIER_2_BPS
    } else if circulating_lynx < TIER_3_MAX_LYNX {
        RATIO_TIER_3_BPS
    } else if circulating_lynx < TIER_4_MAX_LYNX {
        RATIO_TIER_4_BPS
    } else if circulating_lynx < TIER_5_MAX_LYNX {
        RATIO_TIER_5_BPS
    } else if circulating_lynx < TIER_6_MAX_LYNX {
        RATIO_TIER_6_BPS
    } else if circulating_lynx < TIER_7_MAX_LYNX {
        RATIO_TIER_7_BPS
    } else if circulating_lynx < TIER_8_MAX_LYNX {
        RATIO_TIER_8_BPS
    } else if circulating_lynx < TIER_9_MAX_LYNX {
        RATIO_TIER_9_BPS
    } else if circulating_lynx < TIER_10_MAX_LYNX {
        RATIO_TIER_10_BPS
    } else {
        RATIO_FLOOR_BPS
    }
}

/// Ratio de minteo derivado del TWAP del supply circulante — la unica via
/// permitida para fijar cuanto LYNX se acuña (SC-01).
///
/// Una quema de ultimo minuto solo altera 1 de las `count` muestras, asi que su
/// efecto sobre el promedio es ~1/24: insuficiente para saltar de tramo. Mover
/// el TWAP de verdad exige sostener la reduccion de supply durante horas, de
/// forma publica y afectando a todas las resoluciones de la ventana.
///
/// Bootstrap: mientras el crank no haya tomado ninguna muestra (`count == 0`),
/// cae al valor instantaneo. Es una ventana conocida y acotada — los operadores
/// deben cranquear record_supply_snapshot antes de que resuelva ningun mercado
/// con valor real.
fn mint_ratio_bps_twap(twap: &CirculatingSupplyTwap, config: &ProtocolConfig) -> Result<u64> {
    let circulating = match twap.average() {
        Some(avg) => avg,
        None => instantaneous_circulating_supply(config),
    };
    Ok(ratio_for_circulating(circulating))
}

fn prorated_bps(total: u64, basis_points: u64, numerator: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, LynxError::InvalidAmount);
    // Same u64-overflow hazard as claim_market_sol: bps(total, ..) can be ~1e9
    // micro-LYNX and `numerator` a position of ~1e11 lamports, whose product
    // exceeds u64::MAX and previously reverted mint_lynx_distribution outright.
    mul_div(bps(total, basis_points)?, numerator, denominator)
}

fn bps(amount: u64, basis_points: u64) -> Result<u64> {
    // basis_points <= BPS_DENOMINATOR at every call site, so the result always
    // fits back into u64; u128 is only needed to survive the intermediate product.
    mul_div(amount, basis_points, BPS_DENOMINATOR)
}

/// Computes `a * b / c` with a u128 intermediate, then narrows back to u64.
///
/// Doing this in u64 overflows for realistic lamport values: two amounts of
/// ~1e10 lamports (10 SOL) multiply to ~1e20, well past u64::MAX (~1.8e19).
/// Before this helper, `claim_market_sol` computed `payout_pool * position.amount`
/// directly in u64, so `checked_mul` returned None and every claim on a market
/// with a pool above ~4.5 SOL reverted with MathOverflow — permanently locking
/// the vault, since no other instruction can release winner funds.
///
/// The product cannot overflow u128: u64::MAX^2 < u128::MAX. The final
/// `try_from` is what legitimately fails if a caller passes a ratio > 1.
fn mul_div(a: u64, b: u64, c: u64) -> Result<u64> {
    require!(c > 0, LynxError::MathOverflow);
    let product = (a as u128).checked_mul(b as u128).ok_or(LynxError::MathOverflow)?;
    let quotient = product.checked_div(c as u128).ok_or(LynxError::MathOverflow)?;
    u64::try_from(quotient).map_err(|_| error!(LynxError::MathOverflow))
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

#[cfg(test)]
mod math_tests {
    use super::*;

    const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

    /// Reproduces the exact computation claim_market_sol performs, to pin the
    /// bug that made every non-trivial market unpayable.
    fn claim_payout(pool_sol: u64, position_sol: u64, winning_sol: u64) -> Result<u64> {
        let pool_total = pool_sol * LAMPORTS_PER_SOL;
        let payout_pool = bps(pool_total, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS).unwrap();
        mul_div(payout_pool, position_sol * LAMPORTS_PER_SOL, winning_sol * LAMPORTS_PER_SOL)
    }

    /// The regression that matters: the old code computed `payout_pool *
    /// position.amount` in u64. For a 20 SOL pool that product is ~1.8e20,
    /// past u64::MAX (~1.8e19), so checked_mul returned None and the claim
    /// reverted forever. Anything above ~4.5 SOL was affected.
    #[test]
    fn claim_does_not_overflow_on_realistic_pools() {
        // Sole winner takes the whole 90% payout pool.
        assert_eq!(claim_payout(20, 10, 10).unwrap(), 18 * LAMPORTS_PER_SOL);
        assert_eq!(claim_payout(1_000, 100, 100).unwrap(), 900 * LAMPORTS_PER_SOL);
        // Confirms the old u64 product really would have overflowed.
        let payout_pool = bps(20 * LAMPORTS_PER_SOL, 9_000).unwrap();
        assert!(payout_pool.checked_mul(10 * LAMPORTS_PER_SOL).is_none());
    }

    /// Winners split the 90% pool in proportion to their stake; losers' SOL
    /// funds the winners, and the sum never exceeds the payout pool.
    #[test]
    fn claim_splits_pool_pro_rata_without_overpaying() {
        // 100 SOL pool, winning side staked 40 total: two winners of 30 and 10.
        let big = claim_payout(100, 30, 40).unwrap();
        let small = claim_payout(100, 10, 40).unwrap();
        assert_eq!(big, 675 * LAMPORTS_PER_SOL / 10); // 67.5 SOL
        assert_eq!(small, 225 * LAMPORTS_PER_SOL / 10); // 22.5 SOL
        let payout_pool = bps(100 * LAMPORTS_PER_SOL, 9_000).unwrap();
        assert!(big + small <= payout_pool, "winners must never drain more than the payout pool");
    }

    #[test]
    fn mul_div_rejects_zero_denominator_instead_of_panicking() {
        assert!(mul_div(1, 1, 0).is_err());
    }

    #[test]
    fn mul_div_errors_when_result_exceeds_u64() {
        // a*b/c genuinely larger than u64::MAX must error, not wrap.
        assert!(mul_div(u64::MAX, u64::MAX, 1).is_err());
    }

    #[test]
    fn bps_is_exact_at_boundaries() {
        assert_eq!(bps(1_000, 0).unwrap(), 0);
        assert_eq!(bps(1_000, BPS_DENOMINATOR).unwrap(), 1_000);
        // The 10% protocol fee split must leave exactly 90%.
        assert_eq!(bps(1_000, BPS_DENOMINATOR - EVENT_PROTOCOL_FEE_BPS).unwrap(), 900);
    }

    /// prorated_bps feeds mint_lynx_distribution; a 1000 SOL market previously
    /// overflowed here too.
    #[test]
    fn prorated_bps_survives_large_markets() {
        let pool_total = 1_000 * LAMPORTS_PER_SOL;
        let base_micro_lynx = pool_total / LAMPORTS_TO_MICRO_LYNX_DENOMINATOR;
        let position = 100 * LAMPORTS_PER_SOL;
        let got = prorated_bps(base_micro_lynx, LYNX_PARTICIPANT_BPS, position, pool_total).unwrap();
        // 10% of the pool, 85% participant share of 1e9 micro-LYNX.
        assert_eq!(got, 85_000_000);
    }

    /// The three-way LYNX split must never mint more than the computed total.
    #[test]
    fn lynx_distribution_split_never_exceeds_total() {
        assert_eq!(LYNX_PARTICIPANT_BPS + LYNX_TREASURY_BPS + LYNX_INITIAL_SALE_BPS, BPS_DENOMINATOR);
    }
}
