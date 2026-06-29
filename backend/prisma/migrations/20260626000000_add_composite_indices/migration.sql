-- Migration: add composite indices for common query patterns
-- AddIndex: UserPosition(wallet, claimed) — "unclaimed positions for wallet"
CREATE INDEX IF NOT EXISTS "UserPosition_wallet_claimed_idx" ON "UserPosition"("wallet", "claimed");

-- AddIndex: Duel(rival) — "find duels where I'm the rival"
CREATE INDEX IF NOT EXISTS "Duel_rival_idx" ON "Duel"("rival");

-- AddIndex: LedgerEntry(wallet, status) — "pending deposits for a wallet"
CREATE INDEX IF NOT EXISTS "LedgerEntry_wallet_status_idx" ON "LedgerEntry"("wallet", "status");
