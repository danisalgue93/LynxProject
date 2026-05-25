# LynxProject audit report

Audit date: 2026-05-23

## Scope reviewed

- Backend API and in-memory economy engine.
- Frontend duel creation flow.
- Admin panel authentication/session basics.
- Anchor program economy logic at source level.

## Fixes applied

1. Ternary market positions are now normalized consistently.
   - `YES` maps to `A` and `NO` maps to `B` for ternary markets.
   - Binary markets reject `DRAW`.
   - Manual/oracle resolution uses the same validation.

2. LYNX burn accounting no longer inflates market pools.
   - Backend LYNX trades now add only the net amount after burn to pool/side totals.
   - User positions for LYNX special markets now store the net pool amount.
   - Anchor `buy_position_lynx_with_burn` now applies the same net accounting.

3. Failed duel acceptance no longer mutates balances.
   - Rival side validation now happens before debiting funds.

4. API validation errors now return client errors.
   - Zod validation errors return HTTP 400 instead of generic 500.
   - Common business-rule failures such as closed markets, cutoff, insufficient balance, duplicate claim and invalid side now map to 400/404 where appropriate.

5. Frontend duel creation no longer offers unsupported markets.
   - Duel creation now filters to open/active SOL markets only, matching backend rules.

6. Admin session secret is safer for production.
   - Production now fails explicitly if `SESSION_SECRET` is missing instead of using a fixed development fallback.

7. MoonPay integration was hardened.
   - The frontend now requests a widget URL from `frontend/server.ts`.
   - The server signs MoonPay widget URLs when `MOONPAY_SECRET_KEY` is configured.
   - The client no longer opens MoonPay with a hardcoded test fallback.

8. Magic Link email login was made real instead of simulated.
   - The Magic SDK is loaded in `frontend/index.html`.
   - Email magic link login stores a managed auth session after successful Magic authentication.
   - Missing Magic config now shows an error instead of pretending the user logged in.
   - Managed Magic sessions now use a stable `MAGIC:<issuer/email>` wallet id in frontend API calls instead of falling back to the shared demo wallet.

9. Notification read state now uses the active wallet.
   - The frontend sends the current wallet when marking notifications read.
   - The backend can mark one notification or all notifications as read.

10. Solana provider now respects environment configuration.
   - `VITE_SOLANA_NETWORK` selects mainnet/devnet/testnet.
   - `VITE_SOLANA_RPC_URL` overrides the default cluster RPC endpoint.

11. Final verification cleanup.
   - Removed remaining mojibake from touched UI/config files.
   - Removed remaining `@ts-ignore` instances found in reviewed code.
   - Confirmed the improved desktop project folder is the active working copy.

12. Second-pass economy and security fixes.
   - Prediction limit orders now lock stake and refund only the locked remainder on cancellation.
   - LYNX/SOL orders track locked/spent balances so cancellation returns unused funds and filled buy orders release price-improvement leftovers.
   - Duels now require the parent market to still be open and before cutoff when created or accepted.
   - Duel creators can no longer accept their own duel.
   - Backend `1v1vP` duels now lock the protocol side before activation, and duel payouts use the configured global trade fee instead of an unexplained fixed multiplier.
   - DAO proposals now reject repeated votes from the same wallet.
   - Admin market creation/resolution supports `ADMIN_API_TOKEN`, and production rejects admin calls if the token is missing.
   - `/api/dev/reset` is disabled in production.
   - Frontend `npm run dev` now runs the Express+Vite server required for signed MoonPay URLs.
   - Frontend duel status typing now uses duel statuses instead of market statuses.
   - Anchor LYNX position buys now transfer the unburned net LYNX into a config-owned token vault account.
   - Anchor duel creation/acceptance now validates parent-market status, cutoff, outcome compatibility, expiry and self-acceptance.
   - `cripto/.gitignore` now ignores `.env*` files except `.env.example`.

13. Final audit pass.
   - Backend reset now clears indexed transactions as well as markets, wallets and orders.
   - Backend `1v1vP` creation now checks creator and protocol balances before debiting either side, so a failed protocol-funded duel cannot mutate the creator balance.
   - Cleaned remaining UI/comment encoding artifacts and obvious unused frontend imports.
   - Corrected this report to distinguish backend protocol-stake locking from the still-pending Anchor on-chain escrow design.

## Tests added

Backend API tests now cover:

- LYNX burn reducing pool and position amount.
- Ternary `YES` input becoming position `A`.
- Binary `DRAW` rejection.
- Failed duel acceptance preserving rival balance.
- Prediction limit order lock/refund behavior.
- Duel creation after cutoff rejection.
- Duplicate DAO vote rejection.
- Protocol-side stake locking for `1v1vP` duels.
- Failed protocol-funded `1v1vP` creation preserving creator balance.
- Development reset clearing transaction history.

## Verification performed

- Node syntax checks passed for modified backend files and admin session file.
- Node syntax checks passed for modified frontend server/helper files.
- Final source scan found no remaining `pk_test_key`, simulated-login fallback, `@ts-ignore`, `eval`, dangerous HTML injection patterns, or mojibake markers in reviewed frontend/backend/admin code. The admin session development fallback remains present, but production throws if `SESSION_SECRET` is missing.
- Direct TSX syntax check was not available with the bundled runtime.
- Full test/build execution was blocked because this environment has no accessible `npm`, `cargo`, `rustc`, or `anchor` binaries, and dependencies were not installed in the extracted project.

## Remaining risks before production/mainnet

1. Anchor LYNX claim flow still needs a full implementation pass.
   - LYNX buys now transfer the unburned amount into a token vault, but the reviewed program still does not include a matching LYNX claim instruction for resolved LYNX-denominated markets.

2. Anchor account/client compatibility needs rebuilding.
   - The `buy_position_lynx_with_burn` and `accept_duel` account contexts were strengthened, so any Anchor IDL/client code must be regenerated and adjusted.

3. Managed Magic wallets are now separated from the demo wallet, but they are still application-managed identities.
   - For production, Magic users should eventually be mapped to real custodial/non-custodial wallet accounts depending on the intended compliance and custody model.

4. Full CI is currently not reproducible from the ZIP alone.
   - `node_modules` are absent and no package manager/runtime for Rust was available in this session.

5. Anchor `1v1vP` protocol-side stake is not escrowed on-chain yet.
   - The backend simulation now locks the protocol side, but the Anchor program still needs a treasury signer or PDA funding design before it can truly escrow the protocol-funded side on-chain.

## Final desktop audit

- Active audited project verified at: C:\Users\onixm\Documents\Codex\LynxProject-fixes-ready
- Earlier desktop copy reference retained only as historical context: C:\Users\onixm\Desktop\LynxProject-mejorado\LynxProject
- Desktop apply helper prepared at: C:\Users\onixm\Documents\Codex\LynxProject-fixes-ready\APPLY_FIXES_TO_DESKTOP.ps1
- Backend syntax checks passed for server, state, persistence, and API tests.
- Frontend syntax checks passed for server, Vite config, and auth helper.
- Placeholder scan found no hardcoded MoonPay test key, simulated Magic login, @ts-ignore, eval, or dangerous HTML injection patterns.
- Remaining development session fallback is blocked in production by an explicit SESSION_SECRET check.

