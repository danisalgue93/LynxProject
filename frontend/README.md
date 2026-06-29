# Lynx Frontend

React + Vite SPA for [Lynx Market](../README.md).

## Development

```bash
cp .env.example .env   # set VITE_API_URL and Solana network
npm install
npm run dev            # starts Express proxy + Vite HMR on :3000
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Express proxy + Vite HMR |
| `npm run build` | Production build (Vite SPA + Express server bundle) |
| `npm start` | Start production server from `dist/` |
| `npm test` | Run Vitest unit tests |
| `npm run lint` | TypeScript type-check |

## Environment Variables

See `.env.example` for the full list.

Key variables:

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend base URL (no trailing slash) |
| `VITE_SOLANA_NETWORK` | `mainnet-beta` \| `devnet` |
| `VITE_SOLANA_RPC_URL` | Optional custom RPC endpoint |
| `VITE_TREASURY_WALLET` | Treasury wallet public key (for on-chain deposits) |
| `VITE_PROGRAM_ID` | Anchor program ID |
| `VITE_MAGIC_PUBLISHABLE_KEY` | Magic Link publishable key |
| `VITE_MOONPAY_API_KEY` | MoonPay publishable key |
| `MOONPAY_SECRET_KEY` | Server-only MoonPay secret (never expose as VITE_) |

## Architecture

```
src/
├── components/
│   ├── auth/          AuthModal (email + wallet login)
│   ├── common/        ErrorBoundary, RequiresLoginModal
│   ├── dao/           Governance / proposals
│   ├── docs/          Documentation view
│   ├── duels/         1v1 duel system
│   ├── layout/        Header, Sidebar, ToastContainer
│   ├── markets/       Markets grid, market detail, order book
│   └── portfolio/     Portfolio, staking, deposits
├── context/           AuthContext, ToastContext
├── hooks/             useProgram, useSolanaTransaction, useBlockchainTransaction
├── lib/               api, auth, eventBus, explorer, utils
├── locales/           en.json, es.json (i18n)
├── pages/             Dashboard, PublicPage
├── providers/         SolanaProvider
└── types.ts           Frontend type definitions
```

## Testing

Uses [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/).

Test files live in `src/__tests__/`. Run:

```bash
npm test
```
