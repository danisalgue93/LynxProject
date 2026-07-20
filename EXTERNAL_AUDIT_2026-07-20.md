# External audit review — 2026-07-20

An external bug report (`LynxProject_informe_bugs`) flagged 7 issues (2 high, 1
medium, 4 low). Each was re-verified directly against the source before any
change. **All 7 were real**; all 7 are now fixed. One (BAJA-2) was partly a false
positive and is documented as such below.

Verification of the fixes: frontend `tsc` clean + `vitest` (all suites) green;
backend `tsc` clean + `vitest` green; on-chain `cargo build` ok, `cargo clippy
--all-targets -D warnings` = 0 warnings, `cargo test -p lynx_project` green.

---

## ALTA-1 — Market creation from the admin UI was always failing (400) — **FIXED**

`useProgram.createMarket` only signed an **off-chain** message (`signAction`) and
POSTed to `/api/markets`; there was no `buildCreateMarket*` on the client at all.
But the backend (hardened in a prior audit) rejects any non-`legacy` market that
doesn't carry a real `onChainMarket` pubkey + a confirmed transaction signature
it verifies against the RPC. The UI never set either, so **every** create returned
`400 "onChainMarket is required…"`. A core product feature was unusable.

**Fix:** implemented the real on-chain flow.
- `frontend/src/lib/lynxProgram.ts`: new `buildCreateMarketTx` (discriminator
  `create_market`, Market/vault PDAs, Borsh args: `market_id`, `title`,
  `oracle_authority`, `cutoff_ts`, `resolve_ts`, `currency`, `is_ternary`), plus
  `marketPda` and a `MARKET_TITLE_MAX` guard.
- `frontend/src/hooks/useProgram.ts`: `createMarket` now builds and sends
  `create_market` with the admin's wallet, waits for confirmation, and only then
  POSTs `{ onChainMarket, signature, … }` — which `verifyOnChainMarketCreation`
  checks (account owned by the program, discriminator, title match, tx touches
  the program and didn't fail). Also aligned `CreateMarketParams` with the modal
  (`resolveAt`, previously a silent `resolvedAt`/`resolveAt` name mismatch).
- Test: `frontend/src/lib/lynxProgram.createMarket.test.ts` locks the
  discriminator, byte layout, account order and title guard.

## ALTA-2 — Market buys had no slippage protection — **FIXED**

`buy_position_sol` / `buy_position_lynx_with_burn` took no price bound; only limit
orders did. Between seeing the price and confirming in the wallet, the pool can
shift. (This is a parimutuel design, so the classic AMM front-run framing is
imprecise — the real risk is the payout ratio of the chosen side worsening — but
the user-protection gap is real.)

**Fix:** added a `max_price_bps` parameter to both instructions.
- `cripto/…/lib.rs`: new `enforce_market_slippage(market, outcome, max_price_bps)`
  — if the pool has liquidity, requires `implied_price_bps(outcome) <=
  max_price_bps` (same numerator/denominator as limit orders); reverts with the
  new `SlippageExceeded`. Empty pool (first buyer) has no reference price, so the
  guard is skipped. `max_price_bps` must be `1..=10000`; `10000` disables it.
- `cripto/…/error.rs`: new `InvalidSlippage`, `SlippageExceeded`.
- Frontend: `buildBuyPositionSolTx` / `buildBuyPositionLynxTx` take `maxPriceBps`;
  `useProgram.executeTrade` computes it from the current pool with a default
  band (`maxPriceBpsWithSlippage`, `DEFAULT_SLIPPAGE_BPS = 1000`).
- Tests: `lynxProgram.buy.test.ts` (byte layout + slippage math); the on-chain
  `full_market_lifecycle` test now asserts a 4000-bps buy is rejected with
  `SlippageExceeded` at a 5000-bps pool.
- **Requires a redeploy** (instruction signatures changed).

## MEDIA-1 — Misleading "Est. Win Reward" ROI on market cards — **FIXED**

`MarketCard.tsx` showed `Math.max(roiYes, roiNo)` as one generic figure. In an
unbalanced pool that maximum is the **minority** side's ROI, but the card implied
it applied to any choice.

**Fix:** show the ROI of each side explicitly (YES/NO, plus Draw for ternary);
a side with nothing staked shows `—` (no quantifiable multiple yet).

## BAJA-1 — Point-patched decimals in CreateDuelModal — **FIXED**

`toFixed(amount === 0.25 ? 2 : 1)` special-cased one amount. Replaced with a
general `toLocaleString(…, { maximumFractionDigits: 2 })`.

## BAJA-2 — "Dead" status values in the type unions — **FIXED (partly a false positive)**

- **Markets `EXPIRED`:** NOT dead. It's a real variant of the on-chain
  `MarketStatus` enum, mapped by the indexer (`server.ts` statusMap) and styled by
  the UI. Kept, with a comment so it isn't "cleaned" by mistake. (The report only
  grepped `state.ts`, missing the indexer path.)
- **Duels `ACCEPTED` / `EXPIRED`:** genuinely dead — not in the on-chain
  `DuelStatus` enum, never assigned, never mapped. Removed from the backend
  `DuelStatus` type, which now matches both the on-chain enum and the frontend.

## BAJA-3 — Error→HTTP status mapped by matching message text — **FIXED**

The global error handler inferred status by `.includes()` on English prose
("FRAGILE BY DESIGN", already flagged in-code).

**Fix:** new `backend/src/errors.ts` `DomainError` (+ `BadRequest/NotFound/…`
subclasses) carrying an explicit `statusCode`; the handler now honours it first
and falls back to the legacy text-matching only for the existing string throws.
New code should throw `DomainError`.

## BAJA-4 — Dust in the backend's LYNX emission split — **FIXED**

`mintLynxForSolvedSolMarket` rounded only each wallet's running balance, never the
per-position `minted`, and never reconciled the total against `participantEmission`.

**Fix:** round each `minted` and give the last participant the exact remainder, so
the credited total equals `participantEmission` to the cent.
