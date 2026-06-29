# LYNX MARKET

> Decentralized P2P prediction markets and 1v1 duels on Solana.

---

## Architecture

```
lynx/
├── backend/          Express + Socket.IO API (Node.js / TypeScript)
├── frontend/         React + Vite SPA (TypeScript)
├── cripto/
│   ├── programs/     Anchor smart contract (Rust / Solana)
│   ├── admin-panel/  Emergency market resolution panel (Next.js)
│   └── scripts/      Deployment & initialization scripts
├── nginx/
│   ├── nginx.conf    Production reverse proxy (TLS, gzip, rate limiting)
│   └── init-certs.sh Let's Encrypt certificate bootstrap
├── docker-compose.yml
└── .env.example      Root env for Docker Compose deployment
```

**Stack:** Node.js 20 · Express · Socket.IO · Prisma · PostgreSQL · React 18 · Vite · Tailwind · Solana / Anchor 0.30.1 · TypeScript E2E

---

## Quick Start (Development)

### Backend
```bash
cd backend
cp .env.example .env      # fill in required values
npm install
npm run prisma:generate
npm run prisma:push
npm run dev               # http://localhost:4000
```

### Frontend
```bash
cd frontend
cp .env.example .env      # set VITE_API_URL=http://localhost:4000
npm install
npm run dev               # http://localhost:3000
```

### Admin Panel (optional)
```bash
cd cripto/admin-panel
cp .env.example .env.local  # fill in all secrets
npm install
npm run dev               # http://localhost:3001 (127.0.0.1 only)
```

---

## Production Deployment

### 1 — Fill in environment variables

```bash
cp .env.example .env
# Edit .env — all CHANGE_ME values are required
```

### 2 — Obtain TLS certificates (first deploy only)

```bash
chmod +x nginx/init-certs.sh
DOMAIN=yourdomain.com EMAIL=admin@yourdomain.com ./nginx/init-certs.sh
```

### 3 — Start all services

```bash
docker compose up -d
```

Services: nginx (443/80) → frontend (3000) + backend (4000) + postgres (internal).
Migrations run automatically via the `migrate` service before backend starts.

### 4 — Renew TLS (add to cron)

```bash
0 12 * * * cd /opt/lynx && docker compose run --rm certbot certbot renew --quiet && docker compose exec nginx nginx -s reload
```

---

## Smart Contract

See `cripto/CRYPTO_GUIDE.md` for full deployment and instruction documentation.

The Anchor program is deployed at:
- **Devnet:** `CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu`
- **Mainnet:** _Set `PROGRAM_ID` in environment after production deploy_

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL password |
| `JWT_SECRET` | ✅ | 64+ char hex (access tokens) |
| `REFRESH_SECRET` | ✅ | 64+ char hex (refresh tokens, different from JWT_SECRET) |
| `CORS_ORIGIN` | ✅ | Production domain, e.g. `https://lynxmarket.io` |
| `APP_URL` | ✅ | Same as CORS_ORIGIN (used for email links and HTTPS redirect) |
| `ADMIN_WALLETS` | ✅ | Comma-separated admin Solana wallet addresses |
| `ADMIN_API_TOKEN` | ✅ | Secret for backend admin scripts |
| `TREASURY_WALLET` | ✅ | Solana public key of the protocol treasury |
| `TREASURY_SECRET_KEY` | ✅ | Base58 secret key of treasury (server-only) |
| `MANAGED_WALLET_SEED` | ✅ | Seed for managed wallet derivation |
| `RESEND_API_KEY` | ✅* | Resend API key for email (verification + password reset) |
| `SENTRY_DSN` | Optional | Sentry DSN for backend error tracking |
| `VITE_SENTRY_DSN` | Optional | Sentry DSN for frontend error tracking |

See `.env.example` for the full reference.

---

## Services

### Email (Resend)
Sign up at [resend.com](https://resend.com). Set `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_URL`.

### Error Monitoring (Sentry)
Create two projects at [sentry.io](https://sentry.io) (Node.js + React). Set `SENTRY_DSN` and `VITE_SENTRY_DSN`.

### Admin Panel
See `cripto/admin-panel/README.md`. Never expose publicly — run behind VPN or localhost tunnel only.

---

## Security

| Control | Status |
|---------|--------|
| JWT access tokens (15 min) + refresh rotation | ✅ |
| Wallet signature verification (Ed25519) | ✅ |
| Helmet.js: CSP, HSTS, X-Frame-Options | ✅ |
| Rate limiting: auth (10/15min), trading (60/min) | ✅ |
| Zod validation on every endpoint | ✅ |
| bcrypt password hashing (10 rounds) | ✅ |
| On-chain deposit verification | ✅ |
| Admin panel: password + Telegram OTP + on-chain timeout | ✅ |
| All Anchor math uses checked arithmetic | ✅ |
| HTTPS TLS 1.2+, OCSP stapling, HSTS preload | ✅ |

---

## License

Apache 2.0
