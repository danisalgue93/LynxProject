import { defineConfig } from 'vitest/config';

// Deterministic ed25519 keypairs derived from fixed 32-byte seeds (see
// tests/api.test.ts, which re-derives the secret keys from the same seeds and
// produces real signatures for /auth/wallet-login).
//
// Admin identity comes from ADMIN_WALLETS — there are no hardcoded admin
// credentials any more. Two distinct admins are required because the manual
// credit flow (propose -> approve -> execute) deliberately refuses to let one
// admin approve their own proposal.
const TEST_ADMIN_WALLET_1 = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB'; // seed: 32 x 0x07
const TEST_ADMIN_WALLET_2 = 'J2xccRtuG43drESLYznHhLhQkLTdfepcKYbiQ9BsJVaf'; // seed: 32 x 0x09

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      ADMIN_WALLETS: `${TEST_ADMIN_WALLET_1},${TEST_ADMIN_WALLET_2}`,
      // The HTTP-header auth bypass used by the suite (x-test-bypass-auth) now
      // fails closed: it requires this flag in addition to NODE_ENV=test, and
      // start() refuses to boot if the flag is set without NODE_ENV=test.
      // Setting it here — rather than in the `test` npm script — keeps the
      // bypass scoped to the test runner and avoids a cross-env dependency
      // (which was not installed, so a `cross-env ...` script would have broken CI).
      ALLOW_TEST_AUTH_BYPASS: 'true',
      // Manual credits are capped per-request and per-wallet-per-day in
      // production (5 SOL / 10 SOL per day by default) to limit the blast radius
      // of a compromised admin. Those caps are env-tunable by design; tests need
      // to fund larger balances to exercise pool maths, so raise them here only.
      // Production keeps the safe defaults.
      MAX_MANUAL_CREDIT_SOL: '1000000',
      MAX_MANUAL_CREDIT_LYNX: '100000000',
      MAX_DAILY_CREDIT_SOL: '1000000',
      MAX_DAILY_CREDIT_LYNX: '100000000',
      // economy.ts falls back to the placeholder id 'LYNX_DEV_TREASURY' when
      // unset, which is not a valid wallet format and is rejected by the shared
      // validation. Production *requires* TREASURY_WALLET (start() enforces it),
      // so set a real base58 address here too rather than loosening validation
      // to accommodate a dev-only placeholder.
      TREASURY_WALLET: '7v54NWdBtkjuAFJrLGsS2SXnuk8nKam81mZJeeYxVFi9',
      // Every test hits the API from the same address, so the per-IP trading
      // limit (60/min in production) counts the whole suite as one abusive
      // client and 429s unrelated tests. Raise it for the runner only.
      TRADING_RATE_LIMIT_MAX: '100000',
    },
  },
});
