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
