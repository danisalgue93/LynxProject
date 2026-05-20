use anchor_lang::prelude::*;

#[error_code]
pub enum LynxError {
    #[msg("Text is too long")]
    TextTooLong,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Cutoff is in the past")]
    CutoffInPast,
    #[msg("Market is closed")]
    MarketClosed,
    #[msg("Invalid market status")]
    InvalidStatus,
    #[msg("Cutoff has not been reached")]
    CutoffNotReached,
    #[msg("Oracle resolution time has not been reached")]
    ResolveTimeNotReached,
    #[msg("Oracle fallback timeout has not been reached")]
    OracleTimeoutNotReached,
    #[msg("Invalid outcome")]
    InvalidOutcome,
    #[msg("Invalid currency for this instruction")]
    InvalidCurrency,
    #[msg("No winning pool")]
    NoWinningPool,
    #[msg("Losing position")]
    LosingPosition,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Duel has expired")]
    DuelExpired,
    #[msg("Duel has not expired")]
    DuelNotExpired,
    #[msg("Rival must choose a different outcome")]
    SameDuelOutcome,
    #[msg("Invalid duel type for this instruction")]
    InvalidDuelType,
}
