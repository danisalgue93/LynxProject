-- Migration: BE-21 — CHECK constraints for non-negative amounts & default fixes
-- ──────────────────────────────────────────────────────────────────────────────
-- Adds CHECK constraints to prevent negative balances / amounts that could
-- arise from application-level bugs or concurrent race conditions.  Also
-- fixes the WalletState defaults from the incorrect 100 / 10 000 to 0 / 0.
-- NOTE: Enum migrations for BE-16 are handled in a separate migration to
-- avoid conflicts.

-- ── 1. CHECK constraints: prevent negative amounts ───────────────────────────

-- WalletState
ALTER TABLE "WalletState" ADD CONSTRAINT "WalletState_solBalance_nonneg" CHECK ("solBalance" >= 0);
ALTER TABLE "WalletState" ADD CONSTRAINT "WalletState_lynxBalance_nonneg" CHECK ("lynxBalance" >= 0);
ALTER TABLE "WalletState" ADD CONSTRAINT "WalletState_stakedLynx_nonneg" CHECK ("stakedLynx" >= 0);

-- Market pools
ALTER TABLE "Market" ADD CONSTRAINT "Market_poolAmount_nonneg" CHECK ("poolAmount" >= 0);
ALTER TABLE "Market" ADD CONSTRAINT "Market_yesAmount_nonneg" CHECK ("yesAmount" >= 0);
ALTER TABLE "Market" ADD CONSTRAINT "Market_noAmount_nonneg" CHECK ("noAmount" >= 0);

-- Orders
ALTER TABLE "Order" ADD CONSTRAINT "Order_amount_nonneg" CHECK (amount >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_remaining_nonneg" CHECK (remaining >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_price_nonneg" CHECK (price >= 0);

-- ── 2. Fix WalletState defaults from 100/10000 to 0/0 ───────────────────────

ALTER TABLE "WalletState" ALTER COLUMN "solBalance" SET DEFAULT 0;
ALTER TABLE "WalletState" ALTER COLUMN "lynxBalance" SET DEFAULT 0;

-- Back-patch existing rows that still carry the old default values
UPDATE "WalletState" SET "solBalance" = 0 WHERE "solBalance" = 100;
UPDATE "WalletState" SET "lynxBalance" = 0 WHERE "lynxBalance" = 10000;