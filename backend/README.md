# Lynx Backend

Express API for Lynx Market. The backend owns the off-chain order book, portfolio state, staking accounting, DAO proposals, notifications, chart candles and admin resolution endpoints.

## Development

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

By default `STORE_DRIVER=memory` seeds development markets and wallets so the frontend can be tested immediately.

## PostgreSQL + Prisma

Set a real `DATABASE_URL`, then run:

```bash
npm run prisma:generate
npm run prisma:push
npm run seed
STORE_DRIVER=prisma npm run dev
```

The Prisma schema is ready for PostgreSQL. The current API uses the same data model as the in-memory development store, so the production migration path is straightforward.
When `STORE_DRIVER=prisma`, the backend loads and saves the live Lynx state through Prisma in the `AppState` table. The normalized tables are included for the later indexer/reporting layer.

## Deployment & TLS

This process serves plain HTTP and does not terminate TLS itself. In production it must run behind a TLS-terminating reverse proxy or platform load balancer (e.g. Nginx, Caddy, or your hosting provider's managed HTTPS) that forwards the original protocol via the `X-Forwarded-Proto` header.

When `NODE_ENV=production`, the app rejects/redirects any request that doesn't arrive as HTTPS (based on `X-Forwarded-Proto`), so misconfigured proxies fail safely instead of silently allowing plaintext JWTs and wallet signatures. Make sure your proxy is configured to set that header.

## Main Endpoints

- `GET /api/markets`
- `GET /api/markets/:id`
- `POST /api/markets/:id/trades`
- `GET /api/orderbook`
- `POST /api/orders`
- `GET /api/duels`
- `POST /api/duels`
- `POST /api/duels/:id/accept`
- `GET /api/portfolio?wallet=...`
- `POST /api/staking/stake`
- `POST /api/staking/unstake`
- `POST /api/staking/claim`
- `GET /api/proposals`
- `POST /api/proposals/:id/vote`
- `GET /api/chart/klines`
- `GET /api/notifications?wallet=...`
- `POST /api/admin/markets/:id/resolve`
