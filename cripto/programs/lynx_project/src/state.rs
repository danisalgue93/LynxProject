use anchor_lang::prelude::*;

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub lynx_mint: Pubkey,
    pub stake_vault: Pubkey,
    pub rewards_vault: Pubkey,
    pub total_lynx_supply: u64,
    pub total_lynx_burned: u64,
    pub total_staked: u64,
    pub reward_per_token_scaled: u128,
    pub emergency_delay: i64,
    pub bump: u8,
    pub stake_vault_bump: u8,
    pub rewards_vault_bump: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + 32 * 5 + 8 * 4 + 16 + 1 * 3 + 32;
}

#[account]
pub struct RewardsVault {
    pub bump: u8,
}

impl RewardsVault {
    pub const LEN: usize = 8 + 1 + 16;
}

#[account]
pub struct Market {
    pub id: u64,
    pub admin: Pubkey,
    pub vault: Pubkey,
    pub oracle_authority: Pubkey,
    pub title: String,
    pub currency: Currency,
    pub status: MarketStatus,
    pub is_ternary: bool,
    pub cutoff_ts: i64,
    pub resolve_ts: i64,
    pub oracle_deadline: i64,
    pub resolved_ts: i64,
    pub result: Outcome,
    pub pool_total: u64,
    pub yes_total: u64,
    pub no_total: u64,
    pub draw_total: u64,
    pub winning_total: u64,
    pub burned_lynx: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub const TITLE_MAX: usize = 128;
    pub const LEN: usize = 8
        + 8
        + 32 * 3
        + (4 + Self::TITLE_MAX)
        + 1
        + 1
        + 1
        + 8 * 4
        + 1
        + 8 * 6
        + 1
        + 1
        + 32;
}

#[account]
pub struct MarketVault {
    pub market: Pubkey,
    pub bump: u8,
}

impl MarketVault {
    pub const LEN: usize = 8 + 32 + 1 + 16;
}

#[account]
pub struct UserPosition {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub outcome: Outcome,
    pub amount: u64,
    pub claimed: bool,
    pub lynx_minted: bool,
    pub bump: u8,
}

impl UserPosition {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 1 + 16;
}

#[account]
pub struct StakePosition {
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt_scaled: u128,
    pub pending_rewards: u64,
    pub bump: u8,
}

impl StakePosition {
    pub const LEN: usize = 8 + 32 + 8 + 16 + 8 + 1 + 16;
}

#[account]
pub struct Duel {
    pub parent_market: Pubkey,
    pub creator: Pubkey,
    pub rival: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub creator_outcome: Outcome,
    pub rival_outcome: Outcome,
    pub duel_type: DuelType,
    pub status: DuelStatus,
    pub expires_ts: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Duel {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1 + 1 + 8 + 1 + 1 + 16;
}

#[account]
pub struct DuelVault {
    pub duel: Pubkey,
    pub bump: u8,
}

impl DuelVault {
    pub const LEN: usize = 8 + 32 + 1 + 16;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Currency {
    SOL,
    LYNX,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Active,
    CutOff,
    Resolved,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Unresolved,
    Yes,
    No,
    Draw,
}

impl Outcome {
    pub fn as_seed(self) -> u8 {
        match self {
            Outcome::Unresolved => 0,
            Outcome::Yes => 1,
            Outcome::No => 2,
            Outcome::Draw => 3,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DuelType {
    OneVOne,
    OneVOneVProtocol,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DuelStatus {
    Open,
    Active,
    Resolved,
    Cancelled,
}
