# Lynx Crypto — Solana / Anchor

## Architecture

```
cripto/
├── programs/lynx_project/   Anchor smart contract (Rust)
├── admin-panel/             Next.js emergency admin dashboard
├── migrations/              Protocol initialization scripts
└── scripts/                 CLI helpers (init_protocol.cjs)
```

---

## Smart Contract (`programs/lynx_project`)

**Program ID:** `CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu`

### Instructions

| Instruction | Who can call | Description |
|-------------|-------------|-------------|
| `initialize_protocol` | Admin (once) | Deploys config PDA, creates LYNX mint and vaults |
| `transfer_admin` | Admin | Rotates the protocol admin keypair |
| `create_market` | Admin | Creates a prediction market on-chain |
| `buy_position_sol` | Any user | Buys a YES/NO/DRAW position with SOL |
| `buy_position_lynx_with_burn` | Any user | Buys a position with LYNX (15% burned) |
| `cut_off_market` | Anyone | Permissionlessly advances market to CutOff status after `cutoff_ts` |
| `resolve_market_oracle` | Oracle authority | Resolves market after `resolve_ts` |
| `resolve_market_admin` | Admin | Resolves market after oracle timeout (`oracle_deadline`) |
| `claim_market_sol` | Winner | Claims SOL payout from resolved market |
| `mint_lynx_distribution` | Any participant | Claims LYNX participation reward after market resolves |
| `stake_lynx` | Any user | Stakes LYNX tokens for SOL rewards |
| `unstake_lynx` | Staker | Withdraws staked LYNX |
| `claim_staking_rewards` | Staker | Claims accumulated SOL rewards |
| `create_duel` | Any user | Creates a 1v1 or 1v1vProtocol duel |
| `accept_duel` | Any user | Accepts an open OneVOne duel |
| `resolve_duel_sol` | Anyone | Permissionlessly resolves a duel once market is resolved |
| `resolve_protocol_duel` | Anyone | Resolves a 1v1vProtocol duel |

### Fee structure

| Event | Fee |
|-------|-----|
| Market protocol fee | 10% of pool (5% stakers + 5% treasury) |
| LYNX buy burn | 15% of LYNX amount burned |
| Duel winner fee | 1% of total duel amount |
| Duel draw → treasury | 100% of duel amount |

### Security notes
- All math uses `checked_add/checked_sub/checked_mul/checked_div` — no overflow possible
- Market IDs in PDA seeds prevent collision
- `position_is_winner` enforced before SOL claim
- `lynx_minted` flag prevents double-minting
- Admin resolution only available after oracle timeout
- Oracle resolution only available after `resolve_ts`

---

## Admin Panel (`admin-panel`)

Emergency tool for manual market resolution when oracle fails.

**Authentication:** password + Telegram OTP (two-factor).

### Setup

```bash
cd cripto/admin-panel
cp .env.example .env.local
# Fill in .env.local with real values
npm install
npm run dev         # http://localhost:3001 only
```

### Production

The admin panel should NEVER be exposed publicly. Run it:
- On the same machine as your Solana validator/admin node
- Behind a VPN or SSH tunnel
- With `ADMIN_ALLOWED_HOSTS` set to specific IPs only

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | ✅ | Solana RPC endpoint |
| `PROGRAM_ID` | ✅ | Deployed program ID |
| `ADMIN_KEYPAIR_BS58` | ✅ | Base58 admin secret key |
| `ADMIN_PASSWORD` | ✅ | Admin login password (long, random) |
| `SESSION_SECRET` | ✅ | Iron-session encryption key (32+ chars) |
| `TELEGRAM_BOT_TOKEN` | ✅ | Telegram bot for OTP delivery |
| `TELEGRAM_CHAT_ID` | ✅ | Your private Telegram chat ID |
| `ADMIN_ALLOWED_HOSTS` | ✅ | Comma-separated allowed host:port values |
| `ADMIN_DEV_MODE` | dev only | `true` to skip Telegram OTP |
| `MOCK_MARKETS` | dev only | `true` to use mock market data |

---

## Initial Deployment

### 1 — Build the program

```bash
cd cripto
anchor build
```

### 2 — Deploy to devnet

```bash
anchor deploy --provider.cluster devnet
```

### 3 — Initialize the protocol

```bash
LYNX_TREASURY=<treasury_pubkey> node scripts/init_protocol.cjs
```

Or with the Anchor migration:

```bash
LYNX_TREASURY=<treasury_pubkey> anchor migrate
```

### 4 — Configure the admin panel

See `admin-panel/.env.example` and the Admin Panel section above.
