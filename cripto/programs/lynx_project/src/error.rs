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
    #[msg("Rival must choose a different outcome")]
    SameDuelOutcome,
    #[msg("Invalid duel type for this instruction")]
    InvalidDuelType,
    #[msg("Market has already been swept")]
    AlreadySwept,
    #[msg("There is nothing to sweep for this market")]
    NothingToSweep,

    // --- Gobernanza / multisig / disputa ---
    #[msg("Signer is not part of the multisig")]
    NotAMultisigSigner,
    #[msg("This signer has already approved this proposal")]
    AlreadyApproved,
    #[msg("Approval threshold has not been met yet")]
    ThresholdNotMet,
    #[msg("Proposal has expired")]
    ProposalExpired,
    #[msg("Proposal was already executed")]
    ProposalAlreadyExecuted,
    #[msg("Proposal was cancelled")]
    ProposalCancelled,
    #[msg("Invalid multisig threshold")]
    InvalidThreshold,
    #[msg("Too many signers for this multisig")]
    TooManySigners,
    #[msg("Too few signers for this multisig")]
    TooFewSigners,
    #[msg("Signer is already part of the multisig")]
    SignerAlreadyPresent,
    #[msg("Timelock has not elapsed since threshold was reached")]
    TimelockNotElapsed,
    #[msg("Protocol is currently paused")]
    ProtocolPaused,
    #[msg("Market is not in PendingResolution status")]
    MarketNotPendingResolution,
    #[msg("The dispute window has not elapsed yet")]
    DisputeWindowNotElapsed,
    #[msg("The dispute window has already elapsed")]
    DisputeWindowElapsed,
    #[msg("Proposal action does not match the accounts provided")]
    ActionMismatch,
    #[msg("Only the proposer can cancel before expiry")]
    NotProposer,

    // --- Ordenes limite de mercados de prediccion ---
    #[msg("Invalid order expiry")]
    InvalidExpiry,
    #[msg("Order has expired")]
    OrderExpired,
    #[msg("The market's current implied price has not crossed the order's limit yet")]
    LimitNotReached,
    #[msg("Market has no liquidity yet to compute an implied price")]
    MarketNotFillable,

    // --- Libro de ordenes LYNX/SOL on-chain ---
    #[msg("Orders must be on opposite sides (one Buy, one Sell) to match")]
    SameSide,
    #[msg("Order prices do not cross, cannot match")]
    PriceMismatch,
    #[msg("Fill amount exceeds an order's remaining amount")]
    FillTooLarge,
    #[msg("Order has no remaining amount left")]
    OrderFullyFilled,
}
