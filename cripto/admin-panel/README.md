# Lynx Emergency Admin Panel

A secure Next.js admin interface for manual market resolution when the oracle fails.

## Security model

Access requires three independent factors:
1. **Admin password** — hashed with SHA-256, rate-limited to 5 attempts per 15 minutes per IP
2. **Telegram OTP** — 6-digit code sent to a private Telegram bot, expires in 5 minutes, maximum 3 verification attempts
3. **On-chain timeout** — the market's `oracle_deadline` must have passed; the server enforces this before signing the transaction

The admin keypair (`ADMIN_KEYPAIR_BS58`) never leaves the server. All Solana transactions are signed server-side.

## Running locally

```bash
cp .env.example .env.local
# Fill in ADMIN_KEYPAIR_BS58, ADMIN_PASSWORD, SESSION_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

npm install
npm run dev  # Binds to 127.0.0.1:3001 only
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | ✅ | Solana RPC endpoint |
| `PROGRAM_ID` | ✅ | Deployed Lynx program ID |
| `ADMIN_KEYPAIR_BS58` | ✅ | Base58 secret key of the ProtocolConfig admin wallet |
| `ADMIN_PASSWORD` | ✅ | Admin login password (use a strong random string) |
| `SESSION_SECRET` | ✅ | Iron-session encryption secret (≥32 chars) |
| `TELEGRAM_BOT_TOKEN` | ✅ | Telegram bot token for OTP delivery |
| `TELEGRAM_CHAT_ID` | ✅ | Telegram chat ID for OTP delivery |
| `ADMIN_ALLOWED_HOSTS` | Optional | Comma-separated allowed hosts (default: localhost:3001) |
| `ADMIN_DEV_MODE` | Dev only | Returns OTP in API response — never enable in production |
| `MOCK_MARKETS` | Dev only | Returns mock market data instead of fetching from chain |

## Production deployment

The admin panel should **never** be publicly accessible. Deploy it:

- On the same server as the backend, accessible only via localhost, **or**
- Behind a VPN or private tunnel (e.g., Tailscale, Cloudflare Access)

Set `ADMIN_ALLOWED_HOSTS` to only include the hosts from which the panel will be accessed.

## Market resolution flow

1. Log in with password + Telegram OTP
2. Panel shows markets with status `CutOff` whose `oracle_deadline` has passed
3. Select a market, choose the result, type `RESOLVE <result>` as confirmation
4. Server verifies all conditions on-chain before signing and broadcasting the transaction
5. Resolution is logged to Telegram
