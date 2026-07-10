# Lynx Market API Reference

> Complete REST API documentation for the Lynx backend (Express.js).

---

## Overview

- **Base URL**: `https://yourdomain.com` (or `http://localhost:4000` in development)
- **Authentication**: JWT bearer token (15 min lifetime) + refresh token (7 day lifetime, HTTP-only cookie)
- **Rate Limiting**: 100 requests per 15-minute window per IP (distributed via Redis in production)
- **Response Format**: JSON; all errors include an `error` message field
- **WebSocket**: Socket.IO at `wss://yourdomain.com` for real-time updates

---

## Authentication

### Register (email + password)

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "displayName": "Alice (optional)"
}
```

**Response (201 Created):**
- If `REQUIRE_EMAIL_VERIFICATION=true` (production default):
  ```json
  {
    "requiresEmailVerification": true,
    "email": "user@example.com",
    "devVerificationToken": null
  }
  ```
  In development (without Resend), token is exposed so the flow can be tested.

- If `REQUIRE_EMAIL_VERIFICATION=false` (dev only):
  ```json
  {
    "ok": true,
    "userId": "user_12345...",
    "displayName": "Alice",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

**Errors:**
- `400 Bad Request`: Invalid email format, password too short, user already exists
- `500 Internal Server Error`: Email send failed (registration still succeeds; user must try verification again)

### Verify Email Token

```http
POST /auth/verify-email
Content-Type: application/json

{
  "email": "user@example.com",
  "token": "abc123def456..."
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "userId": "user_12345...",
  "displayName": "Alice",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Login (email + password)

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "userId": "user_12345...",
  "displayName": "Alice",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Note**: Refresh token is also set as an HTTP-only cookie (`lynx_refresh`) for automatic session renewal.

### Login with Wallet (signature-based)

```http
POST /auth/wallet-login
Content-Type: application/json

{
  "wallet": "11111111112222222222333333333344",
  "message": "Sign in to Lynx Market\n\nNonce: 123456789\nTimestamp: 2026-07-10T00:00:00Z",
  "signature": "[base64-encoded-signature]"
}
```

**Note**: The frontend generates the message and signature using the Solana wallet adapter. The backend verifies the signature server-side.

**Response (200 OK):**
```json
{
  "ok": true,
  "userId": "wallet_11111111112222222222333333333344",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Refresh Token

```http
POST /auth/refresh
Cookie: lynx_refresh=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

New refresh token is set in the response cookie.

### Logout

```http
POST /auth/logout
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{ "ok": true }
```

Refresh token cookie is cleared server-side.

---

## Markets

All market endpoints require an authenticated session (JWT bearer token).

### List Markets

```http
GET /api/markets?open=true
Authorization: Bearer <token>
```

**Query Parameters:**
- `open` (boolean, optional): Filter to open markets only. Default: all statuses.

**Response (200 OK):**
```json
{
  "markets": [
    {
      "id": "market_abc123...",
      "title": "Will BTC exceed $100k by EOY 2026?",
      "description": "Bitcoin price target",
      "ternary": false,
      "currency": "SOL",
      "outcome": null,
      "poolYes": 500,
      "poolNo": 500,
      "poolA": 0,
      "poolB": 0,
      "poolDraw": 0,
      "status": "OPEN",
      "createdAt": 1718925600000,
      "cutoffAt": 1730000000000,
      "resolutionAt": 1735689600000,
      "createdBy": "wallet_11111111112222222222333333333344",
      "resolvedBy": null,
      "resolvedAt": null
    }
  ]
}
```

### Get Market Details

```http
GET /api/markets/market_abc123
Authorization: Bearer <token>
```

**Response (200 OK):** Same structure as single market object above.

**Errors:**
- `404 Not Found`: Market does not exist.

---

## Orders & Trading

### Place Limit Order (prediction)

```http
POST /api/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "marketId": "market_abc123...",
  "side": "BUY",
  "position": "YES",
  "amount": 100,
  "price": 0.6,
  "currency": "SOL"
}
```

**Request Fields:**
- `marketId` (string): Market to trade on.
- `side` (string): `"BUY"` or `"SELL"`.
- `position` (string): `"YES"`, `"NO"`, `"A"`, `"B"`, or `"DRAW"` (ternary only).
- `amount` (number): Position size.
- `price` (number): Limit price (0 to 1 for binary markets).
- `currency` (string): `"SOL"` or `"LYNX"`.

**Response (201 Created):**
```json
{
  "orderId": "order_def456...",
  "status": "OPEN",
  "filled": 0,
  "remaining": 100,
  "createdAt": 1718925600000
}
```

**Errors:**
- `400 Bad Request`: Market closed, cutoff passed, insufficient balance, invalid position
- `404 Not Found`: Market does not exist.

### Cancel Order

```http
POST /api/orders/order_def456/cancel
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "ok": true,
  "refunded": 60,
  "currency": "SOL"
}
```

### Get Portfolio

```http
GET /api/portfolio?wallet=11111111112222222222333333333344
Authorization: Bearer <token>
```

**Query Parameters:**
- `wallet` (string): Solana wallet address to get portfolio for.

**Response (200 OK):**
```json
{
  "wallet": "11111111112222222222333333333344",
  "balances": {
    "SOL": 500.5,
    "LYNX": 1000
  },
  "positions": [
    {
      "marketId": "market_abc123...",
      "position": "YES",
      "quantity": 100,
      "currency": "SOL",
      "value": 60
    }
  ],
  "unrealizedPnL": {
    "SOL": 10.5,
    "LYNX": 0
  }
}
```

---

## Duels (1v1 Markets)

### Create Duel

```http
POST /api/duels
Authorization: Bearer <token>
Content-Type: application/json

{
  "marketId": "market_abc123...",
  "position": "YES",
  "amount": 100,
  "currency": "SOL",
  "expiresIn": 3600000
}
```

**Request Fields:**
- `marketId` (string): Underlying market.
- `position` (string): Your position (`"YES"` or `"NO"` for binary).
- `amount` (number): Stake amount.
- `currency` (string): `"SOL"` or `"LYNX"`.
- `expiresIn` (number, milliseconds): How long the duel stays open for acceptance. Default: 24 hours.

**Response (201 Created):**
```json
{
  "duelId": "duel_ghi789...",
  "status": "OPEN",
  "creatorWallet": "11111111112222222222333333333344",
  "creatorPosition": "YES",
  "creatorAmount": 100,
  "rivalry": null,
  "createdAt": 1718925600000,
  "expiresAt": 1718929200000
}
```

**Errors:**
- `400 Bad Request`: Market not open, creator and rival are the same wallet, market cutoff passed.

### Accept Duel

```http
POST /api/duels/duel_ghi789/accept
Authorization: Bearer <token>
Content-Type: application/json

{
  "position": "NO",
  "amount": 100,
  "currency": "SOL"
}
```

**Response (200 OK):**
```json
{
  "duelId": "duel_ghi789...",
  "status": "ACCEPTED",
  "rivalWallet": "55555555556666666666777777777788",
  "rivalPosition": "NO",
  "rivalAmount": 100,
  "acceptedAt": 1718925700000
}
```

**Errors:**
- `400 Bad Request`: Duel not open, amounts don't match, insufficient balance, self-acceptance.
- `404 Not Found`: Duel does not exist.

### Get Duel Details

```http
GET /api/duels/duel_ghi789
Authorization: Bearer <token>
```

**Response (200 OK):** Full duel object with outcome, resolution timestamp, and payout if resolved.

### List My Duels

```http
GET /api/duels?wallet=11111111112222222222333333333344&status=OPEN
Authorization: Bearer <token>
```

**Query Parameters:**
- `wallet` (string): Your wallet address.
- `status` (string, optional): Filter by status (`OPEN`, `ACCEPTED`, `RESOLVED`, etc.).

**Response (200 OK):**
```json
{
  "duels": [ /* array of duel objects */ ]
}
```

---

## Staking & Governance

### List Proposals

```http
GET /api/proposals?status=ACTIVE
Authorization: Bearer <token>
```

**Query Parameters:**
- `status` (string, optional): `ACTIVE`, `PASSED`, `REJECTED`, `CANCELLED`.

**Response (200 OK):**
```json
{
  "proposals": [
    {
      "id": "proposal_jkl012...",
      "title": "Increase protocol fee to 0.5%",
      "description": "Vote on new fee structure",
      "category": "FEES",
      "status": "ACTIVE",
      "votesFor": 10000,
      "votesAgainst": 5000,
      "createdAt": 1718925600000,
      "expiresAt": 1719030600000,
      "voted": true
    }
  ]
}
```

### Vote on Proposal

```http
POST /api/proposals/proposal_jkl012/vote
Authorization: Bearer <token>
Content-Type: application/json

{
  "wallet": "11111111112222222222333333333344",
  "vote": "FOR"
}
```

**Request Fields:**
- `wallet` (string): Your wallet.
- `vote` (string): `"FOR"` or `"AGAINST"`.

**Response (201 Created):**
```json
{
  "ok": true,
  "voteWeight": 1000
}
```

**Errors:**
- `400 Bad Request`: Duplicate vote from same wallet, proposal not active.

---

## Notifications

### Mark Notification as Read

```http
POST /api/notifications/read
Authorization: Bearer <token>
Content-Type: application/json

{
  "wallet": "11111111112222222222333333333344",
  "notificationId": "notif_mno345..."
}
```

**Response (200 OK):**
```json
{ "ok": true }
```

To mark all as read for a wallet:
```http
POST /api/notifications/read-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "wallet": "11111111112222222222333333333344"
}
```

### Get Notifications

```http
GET /api/notifications?wallet=11111111112222222222333333333344
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "notifications": [
    {
      "id": "notif_mno345...",
      "wallet": "11111111112222222222333333333344",
      "type": "DUEL_ACCEPTED",
      "title": "Your duel was accepted!",
      "message": "Your duel on 'Will BTC exceed $100k?' was accepted.",
      "read": false,
      "createdAt": 1718925600000
    }
  ]
}
```

---

## Chart Data

### Get Klines (candlesticks)

```http
GET /api/chart/klines?marketId=market_abc123&interval=1h
Authorization: Bearer <token>
```

**Query Parameters:**
- `marketId` (string): Market ID.
- `interval` (string): `1m`, `5m`, `15m`, `1h`, `4h`, `1d`. Default: `1h`.

**Response (200 OK):**
```json
{
  "klines": [
    {
      "timestamp": 1718921600000,
      "open": 0.55,
      "high": 0.65,
      "low": 0.55,
      "close": 0.60,
      "volume": 1000
    }
  ]
}
```

---

## WebSocket Events (Socket.IO)

Connect to the backend WebSocket at `wss://yourdomain.com`:

```javascript
import io from 'socket.io-client';

const socket = io('wss://yourdomain.com', {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

// Identify yourself to receive private updates
socket.emit('identify', 'your-wallet-address');

// Listen for public updates
socket.on('portfolio:updated', ({ wallet }) => {
  console.log('Portfolio updated for', wallet);
});

// Listen for your private portfolio updates
socket.on('portfolio:updated:private', ({ wallet, portfolio }) => {
  console.log('Your portfolio:', portfolio);
});

// Market-wide events
socket.on('trade:executed', (trade) => {
  console.log('New trade:', trade);
});

socket.on('order:filled', (order) => {
  console.log('Your order filled:', order);
});

socket.on('duel:resolved', (duel) => {
  console.log('Duel resolved:', duel);
});
```

---

## Error Responses

All error responses include an `error` field:

```json
{
  "error": "Market is not open"
}
```

**Common HTTP Status Codes:**
- `200 OK`: Success.
- `201 Created`: Resource created.
- `400 Bad Request`: Validation error, business rule violation (e.g., insufficient balance).
- `401 Unauthorized`: Missing or invalid JWT.
- `403 Forbidden`: Admin-only endpoint accessed without `ADMIN_API_TOKEN`.
- `404 Not Found`: Resource not found.
- `429 Too Many Requests`: Rate limit exceeded.
- `500 Internal Server Error`: Unexpected error (message is generic; check Sentry logs for details).

---

## Rate Limiting

All authenticated endpoints are rate-limited to **100 requests per 15-minute window** per IP (or per wallet in some cases).

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1718926500
```

When exceeded:
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Retry-After: 60

{
  "error": "Rate limit exceeded. Retry after 60 seconds."
}
```

---

## Admin Endpoints

Admin endpoints require either a valid JWT with `role: admin` OR the `ADMIN_API_TOKEN`:

```http
POST /api/admin/markets/market_abc123/resolve
Authorization: Bearer <admin-api-token>
Content-Type: application/json

{
  "outcome": "YES"
}
```

Or:
```http
POST /api/admin/markets/market_abc123/resolve
X-Admin-API-Token: <admin-api-token>
Content-Type: application/json

{
  "outcome": "YES"
}
```

### Resolve Market (Admin)

```http
POST /api/admin/markets/market_abc123/resolve
Authorization: Bearer <admin-api-token>
Content-Type: application/json

{
  "outcome": "YES"
}
```

**Response (200 OK):**
```json
{
  "marketId": "market_abc123...",
  "outcome": "YES",
  "resolvedAt": 1718926500000
}
```

---

## Health & Diagnostics

### Health Check

```http
GET /api/health
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "uptime": 3600000,
  "timestamp": "2026-07-10T12:00:00Z"
}
```

### Development Reset (dev/test only)

```http
POST /api/dev/reset
Authorization: Bearer <admin-api-token>
```

Clears all state (markets, orders, positions, trades, users). **Disabled in production.**

---

## Best Practices

### Token Management

1. Store JWT in memory (never localStorage for sensitive environments).
2. Refresh token before expiry using the `/auth/refresh` endpoint.
3. Use automatic refresh via the `apiFetch` helper (frontend) or JWT library (backend).
4. On token expiry (401 response), redirect to login.

### Error Handling

1. Catch Zod validation errors (400) and display specific field errors to the user.
2. Catch business-rule errors (400) and show context (e.g., "Market closed").
3. Catch network errors (503, 504) and retry with exponential backoff.
4. Log all 500 errors to Sentry for investigation.

### Wallet Identification

1. Use the wallet address as the unique user identifier (not email or userId).
2. Validate wallet ownership via signature on login.
3. Include wallet in all portfolio/order/trade queries for isolation.

### WebSocket Connection

1. Emit `identify` with your wallet after connecting.
2. Use exponential backoff for reconnection.
3. Refresh portfolio state on reconnection (don't rely on cached state).

---

## Support

For API issues:
1. Check the error message in the response.
2. Validate your request against this documentation.
3. Check Sentry logs for backend errors.
4. Verify your `CORS_ORIGIN` includes your client domain.
