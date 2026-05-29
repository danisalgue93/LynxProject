pub const BPS_DENOMINATOR: u64 = 10_000;

pub const EVENT_PROTOCOL_FEE_BPS: u64 = 1_000;
pub const STAKER_REWARD_FEE_BPS: u64 = 500;
pub const TREASURY_EVENT_FEE_BPS: u64 = 500;
pub const GLOBAL_TRADE_FEE_BPS: u64 = 10;
pub const LYNX_EVENT_BURN_BPS: u64 = 1_500;

pub const LYNX_PARTICIPANT_BPS: u64 = 3_000;
pub const LYNX_TREASURY_BPS: u64 = 1_000;
pub const LYNX_INITIAL_SALE_BPS: u64 = 6_000;

// LYNX has 6 decimals. 1 SOL = 1_000_000_000 lamports should mint
// 1 LYNX = 1_000_000 micro-LYNX, so lamports / 1_000.
pub const LAMPORTS_TO_MICRO_LYNX_DENOMINATOR: u64 = 1_000;

pub const ORACLE_TIMEOUT_SECONDS: i64 = 3_600;
pub const REWARD_SCALE: u128 = 1_000_000_000_000;
