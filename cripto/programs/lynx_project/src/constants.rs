pub const BPS_DENOMINATOR: u64 = 10_000;

pub const EVENT_PROTOCOL_FEE_BPS: u64 = 1_000;
pub const STAKER_REWARD_FEE_BPS: u64 = 500;
pub const TREASURY_EVENT_FEE_BPS: u64 = 500;
pub const GLOBAL_TRADE_FEE_BPS: u64 = 10;
pub const LYNX_EVENT_BURN_BPS: u64 = 1_500;

// Minting split for LYNX emitted on resolved SOL markets:
// 85% to the participant (user), 15% sold on the order book at the
// initial listing price (see INITIAL_SALE_PRICE_LAMPORTS below).
pub const LYNX_PARTICIPANT_BPS: u64 = 8_500;
pub const LYNX_TREASURY_BPS: u64 = 0;
pub const LYNX_INITIAL_SALE_BPS: u64 = 1_500;

// LYNX has 6 decimals. 1 SOL = 1_000_000_000 lamports should mint
// 1 LYNX = 1_000_000 micro-LYNX, so lamports / 1_000.
pub const LAMPORTS_TO_MICRO_LYNX_DENOMINATOR: u64 = 1_000;

pub const ORACLE_TIMEOUT_SECONDS: i64 = 3_600;
pub const REWARD_SCALE: u128 = 1_000_000_000_000;

pub const MICRO_LYNX_PER_LYNX: u64 = 1_000_000;

pub const TIER_1_MAX_LYNX: u64 = 500_000;
pub const TIER_2_MAX_LYNX: u64 = 1_000_000;
pub const TIER_3_MAX_LYNX: u64 = 1_500_000;
pub const TIER_4_MAX_LYNX: u64 = 2_000_000;
pub const TIER_5_MAX_LYNX: u64 = 2_500_000;
pub const TIER_6_MAX_LYNX: u64 = 3_000_000;
pub const TIER_7_MAX_LYNX: u64 = 3_500_000;
pub const TIER_8_MAX_LYNX: u64 = 4_000_000;
pub const TIER_9_MAX_LYNX: u64 = 4_500_000;
pub const TIER_10_MAX_LYNX: u64 = 5_000_000;

pub const RATIO_TIER_1_BPS: u64 = 10_000;
pub const RATIO_TIER_2_BPS: u64 = 8_000;
pub const RATIO_TIER_3_BPS: u64 = 7_000;
pub const RATIO_TIER_4_BPS: u64 = 6_000;
pub const RATIO_TIER_5_BPS: u64 = 5_000;
pub const RATIO_TIER_6_BPS: u64 = 4_000;
pub const RATIO_TIER_7_BPS: u64 = 3_000;
pub const RATIO_TIER_8_BPS: u64 = 2_000;
pub const RATIO_TIER_9_BPS: u64 = 1_000;
pub const RATIO_TIER_10_BPS: u64 = 500;
pub const RATIO_FLOOR_BPS: u64 = 250;
