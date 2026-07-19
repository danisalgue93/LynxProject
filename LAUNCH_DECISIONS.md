# Lynx — Launch Decisions and Readiness Map

**Decisions recorded:** 2026-07-17. **Verified against the source:** 2026-07-17.

This document has two jobs. First, it records the operator's launch decisions —
answers that live nowhere in the code and would otherwise be lost. Second, for
each one it states what the code actually does today, checked against the source
on the date above rather than assumed. Re-verify rather than trust if you are
reading this much later.

Status vocabulary, used precisely:
- **DONE** — implemented and verified (test run or source read cited).
- **PARTIAL** — some of it exists; the gap is named.
- **DECISION** — a policy the operator has set; not a code task.
- **YOURS** — requires credentials, hardware, humans, or external parties. Cannot
  be done in code and is not claimed as done.

---

## 1. Money model and custody

| # | Decision | Code status |
|---|---|---|
| 1.1 | On-chain is the source of truth. The backend indexes, caches, serves, matches, notifies — it never decides balances. | **PARTIAL.** For prediction markets this is already true: `backend/src/chain.ts` and `onchainRoutes.ts` are read-only over indexed on-chain accounts, and the header states the backend no longer custodies prediction-market trading funds. The keeper only submits permissionless, on-chain-verified limit-order executions, paying gas from a keeper wallet that is not the treasury. **Gap:** the legacy off-chain engine in `state.ts` (deposit/withdraw, duels, staking, DAO) still moves balances. That is the "phase 5" migration — see §Remaining below. |
| 1.2 | Remove monetary mutation from `state.ts` entirely; the backend only invokes Anchor instructions. | **PARTIAL — same split as 1.1.** Prediction-market money paths are off `state.ts` already. `deposit`, `withdraw`, `placeOrder`, `createDuel`, `acceptDuel`, `stake`, `unstake`, `claimPosition` still exist in `state.ts` and are the migration target. This is a coordinated contract+backend+frontend change, sequenced deliberately, not a single edit. |
| 1.3 | Non-custodial. Never option B. No holding user funds. | **DECISION — and consistent with the code.** Keeping funds on Solana avoids the KYC/AML/custody liability. The on-chain model already matches this. |

## 2. Audit and dependencies

| # | Decision | Status |
|---|---|---|
| 2.1 | Do the maximum in-house audit possible. | **YOURS** (in progress). |
| 2.2 | Accept the documented `bigint-buffer` risk; it is a Solana-ecosystem dependency, not protocol code. | **DECISION — recorded here as the risk register entry.** `bigint-buffer` has a known buffer-overflow advisory; it arrives transitively via `@solana/web3.js`/SPL, not from Lynx code. Accepted because the protocol does not feed it attacker-controlled buffer lengths on any path we control, and it cannot be removed without the ecosystem moving off it. Re-evaluate when `@solana/web3.js` drops the dependency. |
| 2.3 | Bug bounty: not yet. | **DECISION.** Launch gate (§10) still lists it as required before/immediately after public open. |

## 3. Scope

| # | Decision | Status |
|---|---|---|
| 3.1 | Scope: everything. | **DECISION.** |
| 3.2 | Launch LYNX markets. | **DONE (code).** `claim_market_lynx` (`lib.rs:1128`), `init_market_lynx_vault`, `buy_position_lynx_with_burn`, and the LYNX withdrawal path all exist. Requires `LYNX_MINT` set in production. |
| 3.3 | Wire new instructions into deploy scripts, frontend, and docs now, not later. | **IN PROGRESS.** `init_protocol.cjs` covers `initialize_protocol` / `init_supply_twap` / `init_multisig` / `init_market_lynx_vault`. Remaining: confirm the frontend program client and docs cover every instruction a client must call. Tracked as an active task. |

## 4. Program and testing

| # | Decision | Status |
|---|---|---|
| 4.1 | Upgrade authority: 2 admins, 2 wallets (2-of-2). | **DECISION.** Enforced on-chain (`init_multisig`, threshold 2). Keys are **YOURS** to generate and place in a Squads multisig. |
| 4.2 | Devnet first, multi-user testing. | **YOURS** — ≥4 weeks, external time (§10 gate). |
| 4.3 | Exposure limits, governance-configurable. Launch caps: **€50,000 / user, €250,000 / market, €1,000,000 TVL**, raised progressively after demonstrated stability + external audit. | **DECISION + PARTIAL.** The on-chain mechanism exists: `config.protocol_duel_exposure` is checked on duel creation and released on settlement (fix SC-03), and markets refuse positions past their cap (RUNBOOK §6). **Nuance to resolve:** these caps are denominated in EUR, but on-chain limits are in lamports / native units — there is no EUR on-chain. Enforcing EUR caps needs either a price feed or an operator who sets the native-unit cap from the current rate. Do not assume the EUR figure maps to a config field directly. |
| 4.4 | Tests required before launch, especially staking and spot orders. | **DONE.** `staking_integration.rs` (5 tests) and `spot_orders_integration.rs` (8 tests) pass under `cargo test --workspace` with `SBF_OUT_DIR=cripto/target/deploy`. 48 program tests total. |
| 4.5 | IDL must be resolved; the whole Anchor ecosystem depends on it. | **DONE.** Anchor 0.31.1 emits the IDL (42 instructions, address matches `declare_id!`). Verified 2026-07-17. |

## 5. Admin security

| # | Decision | Status |
|---|---|---|
| 5.1 | Two distinct admins, two devices, two locations. Never two keys on one machine. | **DECISION** (human/physical). RUNBOOK §4 encodes the operational rule; the program rejects a second approval from the same key (`AlreadyApproved`). |
| 5.2 | Admin panel never public: VPN / WireGuard / Tailscale / SSH tunnel only. | **YOURS** (infra). The panel is intentionally single-instance in-memory (documented AP-20), which is consistent with a private, non-scaled deployment. |
| 5.3 | Primary 2FA: TOTP. Remove Telegram. | **DONE.** Committed 2026-07-17; the Telegram OTP path and its in-memory store are gone. 24 admin-panel tests pass. |

## 6. Keeper and bootstrap

| # | Decision | Status |
|---|---|---|
| 6.1 | A dedicated keeper service with monitoring, alerts, retries. No manual runs. | **PARTIAL.** `twap_keeper.cjs` exists: permissionless, fail-safe, idempotent, with an optional `HEALTHCHECK_URL` dead-man's-switch. Running it as a monitored service (systemd/ECS/k8s) is **YOURS**. |
| 6.2 | Start the TWAP ~24h before the first market. Part of the deploy checklist. | **DONE (documented).** `init_protocol.cjs` and RUNBOOK §7 both put the 24h keeper warm-up before any real-value resolution, with the SC-01 rationale. |

## 7. Operations

| # | Decision | Status |
|---|---|---|
| 7.1 | Hosting: likely AWS. | **YOURS.** |
| 7.2 | Backups are not validated until a restore has succeeded. | **DECISION + PARTIAL.** `scripts/pre-migration-backup.sh` takes backups and blocks migration if the backup fails; RUNBOOK §2 has the restore procedure. The restore **rehearsal** is YOURS and is an explicit launch gate. |
| 7.3 | Monitoring: at minimum Sentry + email alert, with named owners. | **YOURS** (accounts). Sentry hooks exist in the app; wiring DSNs and owners is operator config. |
| 7.4 | A rehearsed rollback document must exist. | **DONE.** RUNBOOK §1 (stop traffic → restore version → validate DB → verify indexer → reopen). Rehearsal itself is YOURS (rehearsal log in RUNBOOK). |
| 7.5 | Secrets never in permanent `.env`; use AWS Secrets Manager. | **YOURS.** The code already supports file-mounted secrets (`chain.ts` `loadEnvSecret` reads a path if the env value starts with `/`), which is compatible with mounted-secret managers. |

## 8. Scaling

| # | Decision | Status |
|---|---|---|
| 8.1 | Redis mandatory; without it, race conditions return at scale. | **DONE (backend).** Rate limiting is enforced across instances via Redis and fails closed if Redis errors mid-flight (`server.ts:424`). The in-memory path is explicitly dev/single-instance only. |
| 8.2 | All shared state (OTP, rate limits, sessions, locks) out of memory so the backend scales horizontally. | **DONE for the backend; N/A for the admin panel.** The backend uses Redis for the shared paths. The admin panel is deliberately single-instance behind a VPN (§5.2), so its in-memory state is a documented architectural choice, not a scaling defect. |

## 9. Quality

| # | Decision | Status |
|---|---|---|
| 9.1 | Tests across all components, prioritizing money-moving paths, wallet, orders, resolution. | **PARTIAL — strong.** 164 tests pass today: 48 Solana program, 62 backend, 30 frontend, 24 admin panel. Money-moving on-chain paths (claim/overflow/fees/staking/spot orders) are covered. Gaps track the phase-5 migration. |
| 9.2 | Accessibility audit before launch (forms, buttons, keyboard nav, screen readers). | **YOURS** (pre-launch process; can be assisted). |

## 10. Launch gate (criteria, not a date)

Launch only when **all** hold. This mirrors RUNBOOK §7 launch gates.

- [ ] External audit complete; critical/high findings fixed — **YOURS**
- [ ] Program test coverage adequate, incl. staking + spot orders — **DONE**
- [ ] ≥4 weeks stable on devnet with test users — **YOURS**
- [ ] Monitoring, backups, restore, rollback **rehearsed** — procedures DONE, rehearsals YOURS
- [ ] Upgrade authority in a multisig — mechanism DONE, keys YOURS
- [ ] TWAP keeper running and supervised — code DONE, ops YOURS
- [ ] Exposure limits configured — mechanism PARTIAL (see 4.3 EUR nuance)
- [ ] Bug bounty live before/at public open — **YOURS**

---

## Remaining code work, honestly

The one large engineering item left is **phase 5: moving the off-chain `state.ts`
economy (deposit/withdraw, duels, staking, DAO) onto the same on-chain-is-truth
model the prediction markets already use.** It is deliberately sequenced, not
one-shot, because ripping those functions out breaks every frontend flow that
currently calls them until the frontend is rewired to sign and submit the
corresponding Anchor instructions. It is planned as verifiable slices, each
proven end-to-end before the next, the same discipline used for the Anchor 0.31
upgrade.

The operator has confirmed (2026-07-19): **everything on-chain, the backend
becomes a pure indexer** (like the prediction-market path already is). Exposure
limits are to be enforced **in SOL / native units** (no EUR price feed).

Progress:
- **Staking — MIGRATED (frontend), 2026-07-19.** `useProgram.stakeLynx/unstakeLynx/
  claimRewards` now build+sign the on-chain instructions; `readStakePosition` and
  `readLynxBalance` are the display source; `PortfolioView`/`GovernanceView` are
  wired to them. Off-chain `/api/staking/*` left in place (unused) until DEV-
  verified, then removed. Unit-tested (readers + builders), typechecks, builds.
  **NEEDS DEV E2E** before the off-chain routes are deleted.
- **Duel client half — built and unit-tested** (`buildCreateDuelTx` /
  `buildAcceptDuelTx` / `buildCancelDuelTx`). Not yet wired: duels depend on the
  parent market's on-chain pubkey and on listing on-chain `Duel` accounts, so the
  wiring needs the **backend Duel indexer** first (index `Duel` accounts → expose
  `/api/onchain/duels`), then the frontend reads pubkeys from there and switches
  create/accept/cancel to on-chain. Deliberately not done blind — it is entangled
  with market state and must be verified in DEV.
- **DAO — needs new program code + a design decision (open question).** There is
  no on-chain user-proposal/voting instruction today (only the admin 2-of-2
  multisig governance). Building it on-chain means new instructions (create
  proposal, cast vote) + accounts (Proposal, VoteRecord to block double votes) +
  a tally. The voting-weight model is a real decision: mirror the off-chain
  stake-weighted majority (weight = staked LYNX, simple majority at endTime), or
  something with quorum / on-chain execution of passed proposals? Flagged for the
  operator; not built speculatively.
- **deposit/withdraw** stay as on/off-ramp bridges (fiat + on-chain SOL), verified
  against the chain — they are the boundary, not off-chain balance mutation.
- **Backend → indexer:** the prediction-market path is already indexer-only. The
  remaining work is to index StakePosition/Duel (and DAO once built) and retire
  the `state.ts` money mutation for those, once each slice is DEV-verified.

Everything marked YOURS above is not a gap in the code — it is work that requires
your credentials, hardware, external parties, or elapsed time, and cannot honestly
be marked done by anyone but you.
