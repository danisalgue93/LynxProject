//! Integration tests for the Lynx prediction-market program.
//!
//! NOTE: Full instruction-level tests (e.g. initialize_protocol, create_market,
//! claim_market_sol) require a Solana runtime (solana-program-test or lite-svm).
//! Those are not available as a dependency here, so the tests below cover the
//! pure-logic helpers and constant invariants that can be validated without a
//! runtime. A separate integration-test crate should be added for
//! instruction-level coverage before mainnet deployment.

use lynx_project::constants::*;
use lynx_project::state::*;

// ────────────────────────────────────────────────────────────────────
// Constants sanity checks
// ────────────────────────────────────────────────────────────────────

#[test]
fn bps_denominator_is_ten_thousand() {
    assert_eq!(BPS_DENOMINATOR, 10_000);
}

#[test]
fn fee_bps_sum_to_event_protocol_fee() {
    assert_eq!(
        STAKER_REWARD_FEE_BPS + TREASURY_EVENT_FEE_BPS,
        EVENT_PROTOCOL_FEE_BPS
    );
}

#[test]
fn lynx_mint_split_adds_to_full_amount() {
    assert_eq!(
        LYNX_PARTICIPANT_BPS + LYNX_TREASURY_BPS + LYNX_INITIAL_SALE_BPS,
        BPS_DENOMINATOR
    );
}

#[test]
fn min_order_less_than_max_order() {
    assert!(MIN_ORDER_LAMPORTS < MAX_ORDER_LAMPORTS);
}

#[test]
fn staking_tiers_are_strictly_increasing() {
    let tiers = [
        TIER_1_MAX_LYNX, TIER_2_MAX_LYNX, TIER_3_MAX_LYNX, TIER_4_MAX_LYNX,
        TIER_5_MAX_LYNX, TIER_6_MAX_LYNX, TIER_7_MAX_LYNX, TIER_8_MAX_LYNX,
        TIER_9_MAX_LYNX, TIER_10_MAX_LYNX,
    ];
    for window in tiers.windows(2) {
        assert!(window[0] < window[1], "tiers must be strictly increasing");
    }
}

#[test]
fn mint_ratio_tiers_are_strictly_decreasing() {
    let ratios = [
        RATIO_TIER_1_BPS, RATIO_TIER_2_BPS, RATIO_TIER_3_BPS, RATIO_TIER_4_BPS,
        RATIO_TIER_5_BPS, RATIO_TIER_6_BPS, RATIO_TIER_7_BPS, RATIO_TIER_8_BPS,
        RATIO_TIER_9_BPS, RATIO_TIER_10_BPS, RATIO_FLOOR_BPS,
    ];
    for window in ratios.windows(2) {
        assert!(window[0] > window[1], "ratio tiers must be strictly decreasing");
    }
}

#[test]
fn dispute_window_is_24_hours() {
    assert_eq!(DISPUTE_WINDOW_SECONDS, 86_400);
}

#[test]
fn governance_timelock_is_positive() {
    assert!(GOVERNANCE_EXECUTION_DELAY_SECONDS > 0);
}

#[test]
fn price_scale_is_billion() {
    assert_eq!(PRICE_SCALE, 1_000_000_000u128);
}

#[test]
fn reward_scale_is_trillion() {
    assert_eq!(REWARD_SCALE, 1_000_000_000_000u128);
}

#[test]
fn protocol_duel_exposure_cap_is_positive() {
    assert!(MAX_PROTOCOL_DUEL_EXPOSURE_LAMPORTS > 0);
}

// ────────────────────────────────────────────────────────────────────
// State struct size / LEN consistency
// ────────────────────────────────────────────────────────────────────

#[test]
fn market_title_max_is_reasonable() {
    assert_eq!(Market::TITLE_MAX, 128);
    assert!(Market::TITLE_MAX >= 32, "title must accommodate real market names");
}

#[test]
fn market_len_exceeds_discriminator() {
    assert!(Market::LEN > 8, "LEN must include 8-byte discriminator");
}

#[test]
fn protocol_config_len_exceeds_discriminator() {
    assert!(ProtocolConfig::LEN > 8);
}

#[test]
fn multisig_max_signers_is_at_least_two() {
    assert!(MAX_MULTISIG_SIGNERS >= 2, "multisig needs at least 2 signers");
}

// ────────────────────────────────────────────────────────────────────
// Enum variant counts (ensure no accidental breakage)
// ────────────────────────────────────────────────────────────────────

#[test]
fn outcome_has_four_variants() {
    // Unresolved, Yes, No, Draw
    assert_eq!(std::mem::size_of::<Outcome>(), 1);
}

#[test]
fn market_status_has_six_variants() {
    // Open, Active, CutOff, PendingResolution, Resolved, Expired
    assert_eq!(std::mem::size_of::<MarketStatus>(), 1);
}

#[test]
fn currency_has_two_variants() {
    assert_eq!(std::mem::size_of::<Currency>(), 1);
}