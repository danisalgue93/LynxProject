use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount, mint_to, MintTo, Burn};

declare_id!("YourProgramIDHere");

pub mod state;
pub mod instructions;
pub mod errors;

use instructions::*;

#[program]
pub mod lynx_protocol {
    use super::*;

    pub fn create_event(
        ctx: Context<CreateEvent>,
        cut_off_ts: i64,
    ) -> Result<()> {
        create_event::handler(ctx, cut_off_ts)
    }

    pub fn buy_yes(ctx: Context<Buy>, amount: u64) -> Result<()> {
        buy::buy_yes(ctx, amount)
    }

    pub fn buy_no(ctx: Context<Buy>, amount: u64) -> Result<()> {
        buy::buy_no(ctx, amount)
    }

    pub fn resolve_event(ctx: Context<ResolveEvent>, outcome: u8) -> Result<()> {
        resolve_event::handler(ctx, outcome)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        claim::handler(ctx)
    }
}