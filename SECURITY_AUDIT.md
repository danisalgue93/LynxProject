# Security Audit — 2026-07-18

A from-scratch review of the money-handling surfaces: the Solana program
(line-by-line, every instruction and every `#[derive(Accounts)]` struct), the
admin panel's resolve flow, and the backend's auth / money / money-creation
paths. Each finding below is marked with its disposition.

Verification of every code fix: `cargo clippy` = 0 warnings, `cargo build-sbf`
ok, `cargo test --workspace` = 49 passed; backend `tsc` clean, `eslint` 0 errors,
`vitest` = 62 passed.

---

## Critical

### C-1 — Staking vault substitution → drain of all staked LYNX — **FIXED**

`StakeLynx` / `UnstakeLynx` validated `stake_vault` only by its mint, never
pinning it to `config.stake_vault`. Because `config` signs the unstake transfer,
an attacker could `stake_lynx(X)` into a LYNX account they control (inflating
`stake_position.amount` and `total_staked` without funding the real vault) and
then `unstake_lynx(X)` out of the real shared vault, taking other stakers' LYNX —
repeatable until empty.

**Fix:** `address = config.stake_vault` on both instructions, plus a regression
test (`staking_rejects_a_non_canonical_stake_vault`) proving the attack is blocked
at its root. Commit `a8ca7d2`.

### C-2 — Prisma Decimal balances string-concatenate → balance inflation → treasury drain — **FIXED**

`dbToWallet`, `dbToMarket` and `dbToLedger` returned Prisma `Decimal` columns
(`solBalance`, `lynxBalance`, pool amounts, …) **as Decimal objects, not
numbers** — unlike `dbToPosition` / `dbToOrder` / `dbToTrade`, which coerce with
`Number()`. `Decimal.valueOf()` is a string, so once a wallet is loaded from the
DB, `credit()`'s `wallet.solBalance + amount` **string-concatenates**: a 5 SOL
deposit onto a 10 SOL balance yields `"10" + 5` → `"105"` → `roundAmount` → 105.

In production (`STORE_DRIVER=prisma`, the default) this triggers on the first
credit — deposit, payout, reward — after **any restart/redeploy**: the balance
inflates, and `/api/ledger/withdraw` will send that inflated amount as real
on-chain SOL from the treasury. Verified empirically that `new
Prisma.Decimal('10') + 5 === "105"`.

**Fix:** coerce every Decimal field with `Number()` in the three mappers, matching
the ones that were already correct. Regression test added
(`tests/persistence.test.ts`) asserting the mappers return numbers that add
(`10 + 5 === 15`), not strings that concatenate.

---

## Medium

### M-1 — Limit-order keeper builds account lists the program rejects — **FIXED**

`backend/src/chain.ts`'s keeper built `execute_prediction_limit_order_sol` /
`_lynx` with account lists that did not match the on-chain structs: the SOL path
omitted `config` (added to the struct later); the LYNX path sent 12 accounts in
the wrong order, included a SOL vault and owner-ATA the struct has no slot for,
and derived the market LYNX vault from the seed `"market_lynx_vault"` instead of
the correct `"lynx_vault"`. Every keeper execution was rejected. Impact is
keeper-only — funds were never at risk, LYNX/SOL limit orders simply never filled
via the keeper.

**Fix:** both lists rebuilt to match `ExecutePredictionLimitOrderSol` (8 accounts)
and `ExecutePredictionLimitOrderLynx` (10 accounts) exactly, with the correct
vault seed.

> **Still needs devnet e2e.** A byte-correct account list is not proof the deployed
> program accepts the transaction. Submit a real limit order on devnet and let the
> keeper execute it before relying on this path.

---

## Low — fixed

### L-1 — `init_multisig` accepted duplicate / default signers — **FIXED**

A duplicate signer counted toward `signer_count` but could only ever approve
once, so a `[A, A]` / threshold-2 multisig could never reach threshold — bricked
governance. A `Pubkey::default()` signer is the empty-slot sentinel and could
never sign. Both are now rejected up front.

### L-2 — Withdrawal endpoint took no distributed lock — **FIXED**

`/api/ledger/withdraw` relied only on `store.withdraw()` being synchronous (safe
within one Node instance), while `/api/markets/:id/trades` and the credit-execute
path already took a Redis lock. The inconsistency would become a real double-spend
the moment the backend ran more than one instance. It now takes the same
per-`wallet:currency` lock.

---

## Low — accepted (fixing would add risk for negligible benefit)

### L-3 — Integer-division dust is left locked in market vaults — **ACCEPTED**

`claim_market_sol` / `claim_market_lynx` pay `floor(payout_pool * amount / total)`,
so the sum of winner payouts is a few lamports/micro-LYNX below the pool. The SOL
dust-sweep branch requires `total_claimed >= payout_pool`, which flooring makes
(almost) never true, and there is no LYNX dust sweep at all — so that dust stays
in the vault.

**Why not "fixed":** the strict condition is deliberately conservative. Loosening
it to sweep the vault's excess-above-rent before every winner has claimed would
sweep funds still owed to unclaimed winners — turning a few lamports of stranded
dust into a real theft path. There is no per-winner claim counter to detect
"everyone has claimed" safely. Stranded dust (rent-scale, per resolved market) is
the safe outcome; changing fund-movement logic here is not worth it.

### L-4 — Governance approvals are snapshots — **ACCEPTED (by design)**

A signer removed via `RemoveSigner` after approving an in-flight proposal still
counts toward that proposal's threshold. This is intentional snapshot semantics:
re-validating approvers at execute time would let a single removal silently
invalidate approvals already given and adds a foot-gun of its own. Documented so
it is a known property, not a surprise.

---

## Low — deferred (recommended, non-security)

### L-5 — Order / escrow accounts are not closed on cancel or fill — **DEFERRED**

Prediction- and spot-order accounts and their escrows are never closed, so their
rent (~0.002 SOL/order) is not reclaimed to the owner when an order is cancelled
or fully filled. It leaks no user funds (only the order creator's own rent, and
only their own) and is not a security issue, but it is wasteful. A proper fix adds
`close = owner` to the marker accounts and a `token::close_account` CPI for the
LYNX escrows across the cancel/fill instructions — a sizable, well-testable change
best done as its own pass, not folded into a security fix.

---

## Hardening applied (no live vulnerability)

### H-1 — JWT verification pinned to HS256 — **DONE**

`verifyToken` / `verifyRefreshToken` now pass `algorithms: ['HS256']` to
`jwt.verify`. jsonwebtoken v9 already rejects `alg:none`, so this closed no live
hole, but an explicit allowlist is the defensive default against any future
algorithm-confusion class.

---

## Reviewed and found correct

- **Off-chain money engine (`state.ts`):** `executePredictionTrade` debits the
  full amount before crediting the pool and tracks the LYNX burn; `resolveMarket`
  / `claimPosition` conserve the pool exactly (10% fee + 90% winner payouts, with
  the no-winner pool swept to treasury); `distributeStakingRewards` routes the fee
  to treasury when there are no stakers; `mintLynxForSolvedSolMarket` never mints
  beyond `pool * ratio` and its 85/0/15 split sums to 100%; `castVote` blocks
  double votes (in-memory + a DB UNIQUE constraint) and stake snapshots block
  flash-stake voting.
- **`economy.ts`:** fee/tier/split constants match the on-chain program exactly;
  `roundAmount` rounds to 9 decimals (lamport precision = `Decimal(28,9)`), so app
  and DB precision agree; `assertPositiveAmount` rejects NaN/Infinity/≤0.
- **`auth.ts`:** separate access/refresh secrets (required in production), refresh
  token carries only `userId` (role re-derived), `verify` never throws, bcrypt
  `compare` is constant-time, algorithm pinned (H-1).
- **Admin-panel decoders (`lib/solana.ts`):** every field offset and enum index
  (`decodeConfig` / `decodeMarket` / `decodeMultisig` / `decodeProposal`,
  `statusName` / `outcomeName` / `GOVERNANCE_ACTION_VARIANT`) matches the Rust
  structs; the Borsh compact-enum payload is skipped by exact variant size. Prior
  offset bugs are fixed and documented.
- **Admin-panel session/middleware:** iron-session cookie is `httpOnly` +
  `sameSite:'strict'` + `secure` in prod; middleware enforces a host allowlist, a
  per-client rate limit, a 30-min inactivity timeout, and a strict CSP
  (`frame-ancestors 'none'`, `connect-src 'self'`) + HSTS.
- **Frontend transaction hooks:** deposits transfer to `TREASURY_WALLET`; every
  on-chain transaction is signed by the user through the wallet adapter
  (`sendTransaction`, `skipPreflight:false`) — no hidden destinations, no
  auto-approval.
- **Claims / resolution:** payouts conserve the pool exactly; the 5% + 5% + 90%
  fee split matches between `finalize_market_and_fees` and the claim paths; all
  arithmetic goes through `mul_div` with a u128 intermediate (no overflow).
- **Spot matching:** `match_spot_orders` validates `seller_wallet`,
  `buyer_wallet` and `buyer_lynx_account.owner` against the order owners, so a
  permissionless keeper cannot redirect funds; escrow draw-down conserves exactly.
- **Duels:** `resolve_duel_sol` pins `recipient` to the computed winner;
  `resolve_protocol_duel` pins `recipient_lynx_account.owner` to `duel.creator`.
- **Account bindings:** every other money path pins `vault` / `treasury` /
  `position` / `proposal` by PDA seeds, `has_one`, or `address` — `stake_vault`
  (C-1) was the only gap.
- **Admin panel `/api/resolve`:** session-gated, rate-limited, confirmation
  strings, server-side deadline check; real fund movement is protected by the
  on-chain 2-of-2 multisig + timelock + dispute window, so a compromised panel is
  not sufficient.
- **Backend money paths:** deposits are verified against the chain (amount +
  sender + recipient) and replay-protected; INTERNAL/CARD self-crediting is
  removed; withdrawals debit synchronously before the async send and reverse on
  failure; `STARTING_SOL/LYNX = 0` (no free balance); `debit` rejects overdraft;
  manual credits require two distinct admin identities with a per-request cap,
  atomic daily limit, and a distributed execute-lock; the test auth bypass needs
  `NODE_ENV=test` + an env flag + a request header (inert in production).
- **Frontend auth/identity:** the access token lives only in an in-memory module
  variable (never localStorage) and is sent as an `Authorization: Bearer` header,
  never in a URL; the refresh token is an httpOnly cookie (`credentials:
  'include'`). localStorage holds only non-sensitive UI hints (id, displayName,
  authMethod) — never role or wallet, so it cannot be tampered to escalate:
  `requireAuthMatchesWallet` binds every money request to the server-side user
  record and `role` is re-derived server-side. No `dangerouslySetInnerHTML` /
  `innerHTML` / `eval`, no secrets in the bundle, no unguarded `postMessage`, and
  the one `window.open` uses a backend-signed URL with `noopener,noreferrer`.

---

## Fully audited

Solana program, backend (`server.ts`, `state.ts`, `creditApprovals.ts`,
`chain.ts`, `persistence.ts`), admin panel resolve flow, and frontend
(token/session handling, wallet-signature binding, XSS sinks, embedded secrets).
`persistence.ts` produced C-2 above; everything else is recorded with its
disposition.
