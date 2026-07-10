-- Add compound index for user position lookups by market and wallet
CREATE INDEX IF NOT EXISTS "UserPosition_marketId_wallet_idx" ON "UserPosition" ("marketId", "wallet");

-- Enforce uniqueness for ledger references to prevent duplicate ledger rows from retries or replays
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_reference_key" ON "LedgerEntry" ("reference") WHERE "reference" IS NOT NULL;
