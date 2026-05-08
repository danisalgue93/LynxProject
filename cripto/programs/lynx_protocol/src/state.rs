use anchor_lang::prelude::*;

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub founders_treasury: Pubkey,
    pub dividends_treasury: Pubkey,
    pub infra_treasury: Pubkey,
    pub emergency_delay: i64,
    pub total_lynx_supply: u64,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct Market {
    pub id: u64,
    pub admin: Pubkey,
    pub vault: Pubkey,
    pub title: String,
    pub oracle_id: String,
    pub currency: Currency,
    pub status: MarketStatus,
    pub cutoff_ts: i64,
    pub resolved_ts: i64,
    pub result: Outcome,
    pub pool_total: u64,
    pub yes_total: u64,
    pub no_total: u64,
    pub winning_total: u64,
    pub bump: u8,
}

impl Market {
    pub const TITLE_MAX: usize = 96;
    pub const ORACLE_MAX: usize = 64;
    pub const LEN: usize = 8
        + 8
        + 32
        + 32
        + 4 + Self::TITLE_MAX
        + 4 + Self::ORACLE_MAX
        + 1
        + 1
        + 8
        + 8
        + 1
        + 8
        + 8
        + 8
        + 8
        + 1;
}

#[account]
pub struct Vault {
    pub market: Pubkey,
    pub bump: u8,
}

impl Vault {
    pub const LEN: usize = 8 + 32 + 1;
}

#[account]
pub struct UserPosition {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub outcome: BinaryOutcome,
    pub amount: u64,
    pub claimed: bool,
    pub lynx_minted: bool,
    pub bump: u8,
}

impl UserPosition {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 1;
}

#[account]
pub struct LynxBalance {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
}

impl LynxBalance {
    pub const LEN: usize = 8 + 32 + 8 + 1;
}

#[account]
pub struct Order {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub side: OrderSide,
    pub outcome: BinaryOutcome,
    pub amount: u64,
    pub remaining: u64,
    pub price_lamports: u64,
    pub bump: u8,
}

impl Order {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Duel {
    pub parent_market: Pubkey,
    pub creator: Pubkey,
    pub rival: Pubkey,
    pub amount: u64,
    pub creator_outcome: BinaryOutcome,
    pub status: DuelStatus,
    pub expires_ts: i64,
    pub bump: u8,
}

impl Duel {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 8 + 1;
}

#[account]
pub struct DuelVault {
    pub duel: Pubkey,
    pub bump: u8,
}

impl DuelVault {
    pub const LEN: usize = 8 + 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Currency {
    Sol,
    Lynx,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MarketStatus {
    Open,
    Active,
    CutOff,
    Resolved,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BinaryOutcome {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Outcome {
    Unresolved,
    Yes,
    No,
    Draw,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DuelStatus {
    Open,
    Active,
    Resolved,
    Expired,
}
