# Lynx Production Readiness

> **Last verified against the code:** 2026-07-17. Every claim below was checked
> against the source on that date, not carried over from a previous revision. If
> you are reading this long after that date, re-check rather than trust it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    BROWSER                          │
│  React 18 + Vite + TailwindCSS                     │
│  • Auth: modal-based (not a /login route)          │
│  • Wallet Adapter (Phantom, Backpack, Solflare)    │
│  • i18n (EN / ES)                                  │
│  • socket.io client (real-time updates)            │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS / WSS
┌────────────────────────▼────────────────────────────┐
│              Express.js Backend  :4000              │
│  Auth: email+password OR wallet signature           │
│  JWT (15 min) + refresh tokens (7 days)            │
│  Rate limiting, Zod validation, Helmet CSP          │
│  Sentry error tracking, Resend transactional email  │
│                                                     │
│  State: LynxState (in-memory) persisted via         │
│         Prisma → PostgreSQL when DATABASE_URL set   │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              PostgreSQL (via Prisma)                │
│  STORE_DRIVER=prisma (production default)           │
│  STORE_DRIVER=memory  (dev / test)                  │
└─────────────────────────────────────────────────────┘
```

---

## Key Architecture Decisions

| Decision | Detail |
|----------|--------|
| **State layer** | LynxState (in-memory JS Maps) with periodic Prisma persistence — fast reads, durable writes |
| **Auth** | Modal-based (no dedicated `/login` page). Routes: `/auth/register`, `/auth/login`, `/auth/wallet-login`, `/auth/refresh` |
| **JWT** | Access token: 15 min · Refresh token: 7 days · Silent rotation via `apiFetch` |
| **Email** | Resend (required for verification + password reset in production). Falls back to dev-token when `RESEND_API_KEY` unset |
| **Monitoring** | Sentry for backend and frontend errors |
| **Blockchain** | Anchor smart contract on Solana. Web app signs / submits on-chain deposits; resolution via backend or admin panel |

---

## Required Environment Variables

### Backend (`.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `JWT_SECRET` | ✅ | 64+ hex chars |
| `REFRESH_SECRET` | ✅ | Different from JWT_SECRET |
| `DATABASE_URL` | ✅ production | PostgreSQL connection string |
| `CORS_ORIGIN` | ✅ | Comma-separated allowed origins |
| `APP_URL` | ✅ | Used for HTTPS redirect and email links |
| `RESEND_API_KEY` | ✅ prod | Email verification + password reset |
| `EMAIL_FROM` | ✅ prod | Verified sender address |
| `TREASURY_WALLET` | ✅ prod | On-chain deposit target |
| `TREASURY_SECRET_KEY` | ✅ prod | For on-chain SOL withdrawals |
| `LYNX_MINT` | ✅ prod | SPL mint address. LYNX withdrawals return 501 while unset — the code path is implemented, it just has no mint to transfer |
| `SENTRY_DSN` | Recommended | Backend error tracking |
| `ADMIN_WALLETS` | ✅ prod | Comma-separated admin pubkeys |

### Frontend (`.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_API_URL` | ✅ | Backend base URL |
| `VITE_SOLANA_NETWORK` | ✅ | `mainnet-beta` or `devnet` |
| `VITE_TREASURY_WALLET` | ✅ | On-chain deposit target |
| `VITE_SENTRY_DSN` | Recommended | Frontend error tracking |

---

## Known Limitations (pending work)

| Item | Impact | Notes |
|------|--------|-------|
| **Magic-managed wallets** | Medium | `MAGIC:<hash>` identities are minted by the backend and are application-managed, not real wallets. Mapping them to custodial or non-custodial accounts is a custody/compliance decision that has not been made |
| **In-memory store at scale** | Med | Full `findMany()` loads are fine to ~10k records per type; use Prisma queries directly for larger datasets |

---

## Checklist: Before Mainnet

- [ ] `RESEND_API_KEY` configured — email verification gates registration
- [ ] `SENTRY_DSN` + `VITE_SENTRY_DSN` configured
- [ ] `DATABASE_URL` pointing to production PostgreSQL
- [ ] `APP_URL` set to production domain (required for HTTPS redirect + email links)
- [ ] TLS certificate obtained (`nginx/init-certs.sh`)
- [ ] Anchor program deployed to mainnet and `PROGRAM_ID` / `LYNX_MINT` updated
- [x] Anchor integration tests written and passing — 48 tests (`cargo test --workspace`, needs `SBF_OUT_DIR=cripto/target/deploy`), gated in CI
- [ ] Admin panel deployed to private network or behind VPN
- [ ] `ADMIN_KEYPAIR_BS58` rotated and stored in secrets manager
