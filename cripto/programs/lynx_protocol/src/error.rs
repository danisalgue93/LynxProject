use anchor_lang::prelude::*;

#[error_code]
pub enum LynxError {
    #[msg("The provided text exceeds the protocol limit.")]
    TextTooLong,
    #[msg("The market cut-off must be in the future.")]
    CutoffInPast,
    #[msg("The market is closed for this action.")]
    MarketClosed,
    #[msg("The market cut-off has not been reached.")]
    CutoffNotReached,
    #[msg("The account is not authorized for this action.")]
    Unauthorized,
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Invalid market, duel, or order status.")]
    InvalidStatus,
    #[msg("Invalid outcome.")]
    InvalidOutcome,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Snapshot, claim, or burn has already been processed.")]
    AlreadyClaimed,
    #[msg("This position did not win the market.")]
    LosingPosition,
    #[msg("The winning side has no pool.")]
    NoWinningPool,
    #[msg("The duel has expired.")]
    DuelExpired,
}
