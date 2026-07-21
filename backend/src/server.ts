// Sentry MUST be the very first import — instruments Express, Prisma, and async ops
import './instrument.js';
import { Sentry } from './instrument.js';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { readFileSync } from 'fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import morgan from 'morgan';
import compression from 'compression';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { DEV_WALLET, TREASURY_WALLET, SOLANA_RPC_URL } from './economy.js';
import { createPersistence } from './persistence.js';
import { redis } from './redisClient.js';
import { LynxState } from './state.js';
import type { Currency, OrderSide, OrderStatus, Position } from './types.js';
import { DomainError } from './errors.js';
import { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken, hashPassword, verifyPassword, extractToken } from './auth.js';
import { sendVerificationEmail, sendPasswordResetEmail, isEmailConfigured } from './email.js';
import { onchainRouter } from './onchainRoutes.js';
import { startChainIndexer, getIndexedMarket, listOpenOrdersForMarket, listPositionsForOwner, listOpenSpotOrders, fromOnChainOutcomeName, verifyOnChainMarketCreation, getIndexerStatus } from './chain.js';
import { proposeCredit, approveCredit, getCreditRequest, markExecuted, isReadyToExecute, listPendingCredits, checkAndRecordDailyCredit, proposeMarketResolution, approveMarketResolution, getMarketResolutionRequest, markResolutionExecuted, isResolutionReadyToExecute, listPendingMarketResolutions, loadPendingCreditApprovalsFromRedis, loadPendingMarketResolutionsFromRedis } from './creditApprovals.js';

// ── Distributed locking (BE-17) ───────────────────────────────────────────────
// Redis-based distributed lock using SET NX EX. Falls back to an in-memory map
// when Redis is not available (single-instance only).
const inMemoryLocks = new Map<string, number>(); // key → expiresAt

async function acquireLock(key: string, ttlMs: number): Promise<boolean> {
  if (redis) {
    try {
      const result = await redis.set(`lock:${key}`, '1', 'PX', ttlMs, 'NX');
      return result !== null;
    } catch (err) {
      console.error('[distributed-lock] redis error on acquire:', err instanceof Error ? err.message : err);
      // Fall through to in-memory fallback
    }
  }
  // WARNING: In-memory lock only works for a single instance. In multi-instance
  // deployments without Redis, concurrent mutations from different instances
  // are NOT serialized.
  const now = Date.now();
  const held = inMemoryLocks.get(key);
  if (held && held > now) return false;
  inMemoryLocks.set(key, now + ttlMs);
  return true;
}

async function releaseLock(key: string): Promise<void> {
  if (redis) {
    try {
      await (redis as any).del(`lock:${key}`);
    } catch (err) {
      console.error('[distributed-lock] redis error on release:', err instanceof Error ? err.message : err);
      // Fall through to in-memory cleanup
    }
  }
  inMemoryLocks.delete(key);
}

// Validate PROGRAM_ID format early (chain.ts parses it lazily)
if (process.env.PROGRAM_ID) {
  try {
    new PublicKey(process.env.PROGRAM_ID);
  } catch {
    throw new Error(`PROGRAM_ID "${process.env.PROGRAM_ID}" is not a valid Solana public key`);
  }
}

// Validate KEEPER_KEYPAIR_BS58 can be decoded if provided (catches corrupted values at startup)
if (process.env.KEEPER_KEYPAIR_BS58) {
  try {
    const raw = process.env.KEEPER_KEYPAIR_BS58.startsWith('/')
      ? readFileSync(process.env.KEEPER_KEYPAIR_BS58, 'utf-8').trim()
      : process.env.KEEPER_KEYPAIR_BS58;
    bs58.decode(raw); // will throw if invalid base58
  } catch {
    throw new Error('KEEPER_KEYPAIR_BS58 is set but cannot be decoded as valid base58. Check the value or file path.');
  }
}

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const port = Number(process.env.PORT || 4000);
const store = new LynxState();
const persistence = createPersistence();

/**
 * Reads a secret value that may be either a literal string or a file path.
 * If the value starts with "/", it is treated as a Docker/K8s secrets mount path
 * and the file contents are read. Otherwise the value is returned as-is.
 */
async function readSecret(value: string | undefined, name: string): Promise<string | undefined> {
  if (!value) return undefined;
  if (value.startsWith('/')) {
    try {
      const { readFileSync } = await import('fs');
      return readFileSync(value, 'utf-8').trim();
    } catch {
      throw new Error(`Secret file ${name} points to ${value} but the file cannot be read`);
    }
  }
  return value;
}

type SolWithdrawalResult = { ok: true; signature: string } | { ok: false; error: string };
type SolWithdrawalSender = (params: { toWallet: string; amountSol: number }) => Promise<SolWithdrawalResult>;
const REFRESH_COOKIE_NAME = 'lynx_refresh';

function parseDurationMs(value: string | undefined, fallbackMs: number) {
  if (!value) return fallbackMs;
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  return amount * multipliers[unit];
}

const refreshCookieOptions: express.CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/auth',
  maxAge: parseDurationMs(process.env.REFRESH_EXPIRY, 7 * 24 * 60 * 60 * 1000)
};

function setRefreshCookie(res: express.Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
}

function clearRefreshCookie(res: express.Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: refreshCookieOptions.httpOnly,
    secure: refreshCookieOptions.secure,
    sameSite: refreshCookieOptions.sameSite,
    path: refreshCookieOptions.path
  });
}

function getCookie(req: express.Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const found = cookies.find((cookie) => cookie.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : undefined;
}

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigins,
    credentials: true
  }
});

// BE-10: Require JWT authentication on all Socket.IO connections.
// The frontend must send: { auth: { token: jwtToken } } in the connection options.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error('Authentication required: send { auth: { token } } when connecting'));
  }
  const payload = verifyToken(token);
  if (!payload) {
    return next(new Error('Invalid or expired token'));
  }
  // Re-check against live users to invalidate banned/deleted sessions immediately
  if (!users.has(payload.userId)) {
    return next(new Error('Session invalidated'));
  }
  (socket.data as any).userId = payload.userId;
  next();
});

io.on('connection', (socket) => {
  socket.emit('lynx:hello', {
    ok: true,
    markets: store.listMarkets(true).length
  });
  // BE-10: Only allow joining rooms for the authenticated user's wallets.
  // The 'identify' event is removed — rooms are now auto-assigned based on JWT.
  const userId = (socket.data as any)?.userId as string | undefined;
  if (userId) {
    const user = users.get(userId);
    if (user) {
      if (user.walletAddress) socket.join(`wallet:${user.walletAddress}`);
      if (user.managedWalletAddress) socket.join(`wallet:${user.managedWalletAddress}`);
    }
  }
});

// Derived from SOLANA_RPC_URL (same env var / fallback already used for the
// actual Solana connection, see economy.ts) instead of hardcoding the devnet
// RPC host — otherwise running against mainnet would leave a stale, confusing
// devnet entry in the CSP instead of the RPC host actually being used.
const solanaRpcOrigin = (() => {
  try {
    return new URL(SOLANA_RPC_URL).origin;
  } catch {
    return 'https://api.devnet.solana.com';
  }
})();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", solanaRpcOrigin, "wss:"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginResourcePolicy: false
}));

// In production, TLS is terminated upstream (reverse proxy / platform load
// balancer) and the original protocol is forwarded via X-Forwarded-Proto.
// Reject/redirect anything that reaches us as plain HTTP so JWTs and wallet
// signatures can never travel unencrypted, even if the proxy is misconfigured
// or someone hits the origin port directly.
if (process.env.NODE_ENV === 'production') {
  // Enforce HTTPS: reject plain-HTTP requests that slip past the reverse proxy.
  // We use a configured APP_URL (not req.headers.host) to build the redirect
  // target, preventing Host-header injection attacks.
  const appHost = (process.env.APP_URL || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      if (appHost) {
        res.redirect(301, `https://${appHost}${req.originalUrl}`);
      } else {
        res.status(400).json({ error: 'HTTPS required' });
      }
      return;
    }
    next();
  });
}

// Gzip/brotli compression for all responses (reduces bandwidth ~70%)
app.use(compression());
app.use(cors({ origin: corsOrigins, credentials: true }));
// Note: Sentry auto-instruments HTTP in v8 via the init() call in instrument.ts.
// No manual middleware needed here — setupExpressErrorHandler() is called after routes.
// Auth and trading routes only ever need a handful of short string/number
// fields (email, password, signature, amounts, ids) — 1 MB is disproportionate
// there. A smaller limit reduces how much payload an attacker can push per
// request to these routes before the per-IP rate limiters kick in.
// This must be registered before the general express.json() below: body-parser
// skips re-parsing once a request's body has already been parsed, so the
// path-specific (smaller) limit only takes effect if it runs first.
const strictJsonLimitPaths = [
  '/auth/register',
  '/auth/login',
  '/auth/verify-email',
  '/auth/request-password-reset',
  '/auth/reset-password',
  '/auth/wallet-login',
  '/auth/refresh',
  '/api/markets/:id/trades',
  '/api/duels',
  '/api/orders',
  '/api/positions/:id/boost-with-lynx',
  '/api/staking/stake',
  '/api/staking/unstake',
  '/api/staking/claim'
];
app.use(strictJsonLimitPaths, express.json({ limit: '20kb' }));
// General limit for everything else (e.g. market/proposal creation, which
// carry a free-text `description` field and legitimately need more room).
app.use(express.json({ limit: '1mb' }));
// lightweight structured logger (no external dependency)
const logger = {
  info: (obj: any, msg?: string) => console.log(JSON.stringify({ level: 'info', msg: msg || '', ...obj })),
  error: (obj: any, msg?: string) => console.error(JSON.stringify({ level: 'error', msg: msg || '', ...obj }))
};

// assign a correlation ID to every request for distributed tracing
app.use((req: any, res, next) => {
  req.id = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

// attach a request-scoped logger that embeds the correlation ID in every log entry
app.use((req, _res, next) => {
  const requestId = (req as any).id;
  (req as any).log = {
    info: (obj: any, msg?: string) => logger.info({ requestId, ...obj }, msg),
    error: (obj: any, msg?: string) => logger.error({ requestId, ...obj }, msg)
  };
  next();
});

// keep morgan for dev-friendly output if desired
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// attach a simple request logger for body/query
app.use((req, _res, next) => {
  try {
    const safeBody = req.body && typeof req.body === 'object' ? { ...req.body } : req.body;
    if (safeBody && typeof safeBody === 'object') {
      for (const key of ['password', 'signature', 'signatureMessage']) {
        if (key in safeBody) safeBody[key] = '[REDACTED]';
      }
    }
    // Mask wallet query params to avoid leaking on-chain addresses into logs
    const safeQuery = req.query && typeof req.query === 'object' ? { ...req.query } : req.query;
    if (safeQuery && typeof safeQuery === 'object' && 'wallet' in safeQuery) {
      (safeQuery as any).wallet = '[REDACTED]';
    }
    (req as any).log.info({ query: safeQuery, body: safeBody }, 'request:received');
  } catch {
    // fallback
    logger.info({ requestId: (req as any).id, method: req.method, path: req.path }, 'request:received');
  }
  next();
});

// Legacy io.on('connection') removed — see the JWT-authenticated version above (line ~180)

// ── Persist mutex (BE-05/BE-13) ────────────────────────────────────────────────
// Prevents concurrent persists from overwriting each other. Serializes writes
// so a periodic persist never clobbers a more recent explicit persist.
let persistMutexBusy = false;
let persistMutexQueue: Array<() => void> = [];

async function persistAfterMutation() {
  if (persistMutexBusy) {
    // Another persist is already in flight — queue this one to run after it completes.
    return new Promise<void>((resolve) => {
      persistMutexQueue.push(async () => {
        try {
          await persistence.save(store);
        } catch (err) {
          console.error('[persist-after-mutation] queued persist failed:', err);
        }
        resolve();
      });
    });
  }
  persistMutexBusy = true;
  try {
    await persistence.save(store);
  } finally {
    persistMutexBusy = false;
    // Drain the queue: run at most one queued persist (the most recent state)
    // to avoid a thundering herd. Any further queued items are redundant since
    // `store` is mutable and always reflects the latest state.
    if (persistMutexQueue.length > 0) {
      const next = persistMutexQueue.pop()!;
      persistMutexQueue = []; // discard older entries — store is already up-to-date
      next();
    }
  }
}

async function persist() {
  await persistAfterMutation();
}

// Broadcast to EVERY connected client. Only for PUBLIC data (market/duel/
// orderbook/dao state) — never for a specific wallet's money activity, which
// must use emitToWallet so it only reaches that wallet's own authenticated
// sockets (see audit A-N2: ledger:deposit/withdrawal/approved and crypto:tx
// were being globally broadcast, leaking every user's amounts + tx signatures
// to any logged-in client).
function emit(event: string, payload: unknown) {
  io.emit(event, payload);
}

// Deliver a private, wallet-scoped event only to the sockets that authenticated
// as this wallet (rooms are JWT-auto-joined on connect; a client cannot join
// another wallet's room).
function emitToWallet(wallet: string, event: string, payload: unknown) {
  io.to(`wallet:${wallet}`).emit(event, payload);
}

function emitPortfolioUpdated(wallet: string, portfolio: unknown) {
  io.to(`wallet:${wallet}`).emit('portfolio:updated', { wallet, portfolio });
}

/**
 * A wallet identifier is valid if it is either:
 *   - a real Solana address: 32-44 base58 characters, or
 *   - a managed wallet id: `MAGIC:` + the 32 hex chars minted by
 *     managedWalletForUser().
 *
 * BE-M-12 tightened this to base58-only, which silently locked out every
 * managed wallet: `MAGIC:<hex>` contains ':' (not in the base58 alphabet) and
 * hex digits like '0' (deliberately excluded from base58). Because the POST
 * paths validate through requireWalletBody() — which never had that check —
 * email-registered users could still trade and spend, but every GET that reads
 * their state (portfolio, ledger, positions, notifications, transactions)
 * answered 400. They could move money and never see it.
 *
 * Keep both formats accepted, and keep rejecting anything else so the original
 * intent (no injection / no arbitrary identifiers) still holds.
 */
const MANAGED_WALLET_PATTERN = /^MAGIC:[0-9a-f]{32}$/;
const BASE58_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidWalletFormat(wallet: string): boolean {
  return BASE58_ADDRESS_PATTERN.test(wallet) || MANAGED_WALLET_PATTERN.test(wallet);
}

function walletFromQuery(req: express.Request, res: express.Response): string | null {
  const val = req.query.wallet;
  if (typeof val !== 'string' || !val.trim()) {
    res.status(400).json({ error: 'wallet query parameter is required' });
    return null;
  }
  const wallet = val.trim();
  if (!isValidWalletFormat(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address format' });
    return null;
  }
  return wallet;
}

function createSimpleRateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  // In-memory fallback — used ONLY when REDIS_URL is not configured (dev/test/single-instance).
  // When Redis is configured but fails mid-flight, the request is rejected (fail-closed).
  const attempts = new Map<string, { count: number; resetAt: number }>();

  // Purge expired entries on a fixed schedule rather than only when the map
  // grows past a size threshold — that made memory pressure depend on
  // traffic patterns (e.g. spoofed/varying IPs could inflate the map before
  // a purge ever triggered). A periodic purge gives a predictable ceiling
  // regardless of traffic shape.
  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of attempts) {
        if (v.resetAt <= now) attempts.delete(k);
      }
    }, 5 * 60_000).unref?.();
  }

  function applyMemoryLimit(key: string, now: number, res: express.Response, next: express.NextFunction) {
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (current.count >= max) {
      res.set('Retry-After', Math.ceil((current.resetAt - now) / 1000).toString());
      res.status(429).json({ error: 'Too many requests. Try again later.' });
      return;
    }
    current.count += 1;
    next();
  }

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // Distributed path: enforced across every backend instance/replica via Redis.
    // Required for any deployment with more than one instance — otherwise the
    // limit can be bypassed by spreading requests across replicas.
    if (redis) {
      const redisKey = `ratelimit:${windowMs}:${max}:${key}`;
      redis
        .multi()
        .incr(redisKey)
        .pttl(redisKey)
        .exec()
        .then((results: [Error | null, unknown][] | null) => {
          if (!results) throw new Error('redis multi returned null');
          const [[incrErr, count], [ttlErr, ttl]] = results as [
            [Error | null, number],
            [Error | null, number]
          ];
          if (incrErr || ttlErr) throw incrErr || ttlErr;
          if (ttl === -1) {
            // First hit for this key (or key survived without a TTL) — (re)arm expiry.
            redis!.pexpire(redisKey, windowMs).catch(() => {});
          }
          if (count > max) {
            const retryAfterMs = ttl && ttl > 0 ? ttl : windowMs;
            res.set('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
            res.status(429).json({ error: 'Too many requests. Try again later.' });
            return;
          }
          next();
        })
        .catch((err: unknown) => {
          // BE-07: Redis unreachable mid-flight — fail CLOSED (503).
          // Falling back to in-memory would allow bypassing distributed limits
          // by spreading requests across replicas after inducing a Redis failure.
          console.error('[rate-limit] redis error, rejecting request (fail-closed):', err instanceof Error ? err.message : err);
          res.status(503).json({ error: 'Service temporarily unavailable. Please retry later.' });
        });
      return;
    }

    applyMemoryLimit(key, now, res, next);
  };
}

const authRateLimit = createSimpleRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const maybeAuthRateLimit = process.env.NODE_ENV === 'test'
  ? (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
  : authRateLimit;
const passwordSchema = process.env.NODE_ENV === 'test'
  ? z.string().min(8, 'Minimum 8 characters')
  : z.string()
      .min(8, 'Minimum 8 characters')
      .regex(/[A-Z]/, 'Must contain uppercase')
      .regex(/[0-9]/, 'Must contain a number');
// 60 trading actions per minute per IP — prevents bot spam while allowing normal use.
// Tunable per environment: the whole test suite shares one IP, so a production
// limit throttles unrelated tests into 429s. Deployments keep the default.
const tradingRateLimit = createSimpleRateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.TRADING_RATE_LIMIT_MAX || 60)
});

// Per-wallet rate limiter: 120 wallet-level trading actions per minute.
// Applied AFTER the per-IP limiter in trading routes to prevent a single
// compromised wallet from flooding the system even if distributed across IPs.
// BE-H-04: Uses Redis when available for distributed enforcement.
const walletTradingRateLimit = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const wallet = req.body?.wallet || req.query?.wallet;
  if (typeof wallet !== 'string' || !wallet.trim()) {
    // No wallet in request — fall through to IP-only rate limit (already applied)
    return next();
  }
  const key = `wallet:${wallet.trim()}`;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 120;

  // BE-H-04: Use Redis for distributed wallet rate limiting
  if (redis) {
    const redisKey = `ratelimit:${windowMs}:${max}:${key}`;
    redis
      .multi()
      .incr(redisKey)
      .pttl(redisKey)
      .exec()
      .then((results: [Error | null, unknown][] | null) => {
        if (!results) { res.status(500).json({ error: 'Rate limit check failed' }); return; }
        const [[incrErr, count], [ttlErr, ttl]] = results as [
          [Error | null, number],
          [Error | null, number]
        ];
        if (incrErr || ttlErr) { res.status(500).json({ error: 'Rate limit check failed' }); return; }
        if (ttl === -1) {
          redis!.pexpire(redisKey, windowMs).catch(() => {});
        }
        if (count > max) {
          res.status(429).json({ error: 'Wallet trade rate limit exceeded. Please slow down.' });
          return;
        }
        next();
      })
      .catch(() => {
        res.status(503).json({ error: 'Service temporarily unavailable' });
      });
    return;
  }

  // In-memory fallback
  const attempts = (req.app.locals as any)._walletTradeAttempts ||
    ((req.app.locals as any)._walletTradeAttempts = new Map<string, { count: number; resetAt: number }>());
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (current.count >= max) {
    res.status(429).json({ error: 'Wallet trade rate limit exceeded. Please slow down.' });
    return;
  }
  current.count += 1;
  next();
};

// ==================== AUTH UTILITIES ====================

// Length-safe constant-time string compare. timingSafeEqual throws on unequal
// lengths, so guard first (a length mismatch already means "not equal"). Used
// for single-use email/reset tokens: they are high-entropy, so `===` was not a
// practical timing oracle, but constant-time comparison is the correct default.
function constantTimeEqual(a: string | undefined | null, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName?: string;
  role: 'admin' | 'user';
  authMethod: 'email' | 'wallet';
  emailVerified: boolean;
  walletAddress?: string;
  walletLinkedAt?: number;
  managedWalletAddress?: string;
  emailVerificationToken?: string;
  emailVerificationExpiresAt?: number;
  passwordResetToken?: string;
  passwordResetExpiresAt?: number;
  createdAt: number;
}

const users = new Map<string, AuthUser>();
const usersByEmail = new Map<string, string>(); // email.toLowerCase() → userId
const usersByWallet = new Map<string, string>(); // walletAddress → userId

// BE-14: Refresh token revocation — prevents reuse of a token after logout.
//
// Redis-backed, with an in-memory fallback for single-instance dev/test. The
// fallback is NOT sufficient in production, which is why start() requires
// REDIS_URL there: with more than one replica and a per-process Map, logging out
// on replica A leaves the token live on replica B. A stolen refresh token would
// survive the logout meant to kill it, and keep minting access tokens until it
// expired on its own.
const refreshBlacklist = new Map<string, number>(); // token → expiresAt (ms), fallback only
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [token, expiresAt] of refreshBlacklist) {
      if (expiresAt <= now) refreshBlacklist.delete(token);
    }
  }, 5 * 60_000).unref?.();
}

/** Key by a hash: refresh tokens are credentials and must not be stored raw. */
function refreshRevocationKey(token: string) {
  return `refresh:revoked:${createHash('sha256').update(token).digest('hex')}`;
}

async function revokeRefreshToken(token: string, ttlMs: number): Promise<void> {
  if (redis) {
    try {
      await redis.set(refreshRevocationKey(token), '1', 'PX', Math.max(ttlMs, 1));
      return;
    } catch (err) {
      console.error('[auth] redis error revoking refresh token, falling back to memory:', err instanceof Error ? err.message : err);
      // Fall through: a local revocation is better than none for this request.
    }
  }
  refreshBlacklist.set(token, Date.now() + ttlMs);
}

async function isRefreshTokenRevoked(token: string): Promise<boolean> {
  if (redis) {
    try {
      return (await redis.exists(refreshRevocationKey(token))) === 1;
    } catch (err) {
      // Fail CLOSED on a Redis error: treating an unknown token as valid is how
      // a revoked credential gets accepted. Refusing a refresh only costs the
      // user a re-login.
      console.error('[auth] redis error checking refresh revocation, denying:', err instanceof Error ? err.message : err);
      return true;
    }
  }
  const expiresAt = refreshBlacklist.get(token);
  return expiresAt !== undefined && expiresAt > Date.now();
}

const adminWallets = (process.env.ADMIN_WALLETS || '')
  .split(',')
  .map((wallet) => wallet.trim())
  .filter(Boolean);
const adminWalletSet = new Set(adminWallets);
const requireEmailVerification = process.env.NODE_ENV !== 'test' && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';
// BE-C-01: DEV_ADMIN_PASSWORD only effective in test mode — never in dev or production.
const configuredAdminPassword = process.env.ADMIN_PASSWORD
  ?? (process.env.NODE_ENV === 'test' ? process.env.DEV_ADMIN_PASSWORD : undefined);
if (configuredAdminPassword && process.env.NODE_ENV === 'test') {
  console.warn(
    '[security] DEV_ADMIN_PASSWORD or ADMIN_PASSWORD is set in test mode. ' +
    'This should NEVER be used with real funds. ' +
    'Use ADMIN_WALLETS (on-chain wallet auth) for admin operations instead.'
  );
}

if (process.env.NODE_ENV === 'production' && adminWallets.length < 2) {
  throw new Error('ADMIN_WALLETS must contain at least two admin wallets in production');
}
if (process.env.NODE_ENV === 'production' && configuredAdminPassword && !/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(configuredAdminPassword)) {
  throw new Error('ADMIN_PASSWORD must be at least 8 characters and include one uppercase letter and one number');
}

function token(prefix: string) {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

function managedWalletForUser(userId: string, email: string) {
  const digest = createHash('sha256').update(`${userId}:${email.toLowerCase()}`).digest('hex').slice(0, 32);
  return `MAGIC:${digest}`;
}

function isAdminWallet(wallet?: string): boolean {
  if (!wallet) return false;
  // Check env-var defined admin wallets first (always available, even before DB loads)
  if (adminWalletSet.has(wallet)) return true;
  // Check persisted user roles (allows promoting admins via DB without redeploy)
  const userId = usersByWallet.get(wallet);
  if (userId) {
    const user = users.get(userId);
    if (user?.role === 'admin') return true;
  }
  return false;
}

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: isAdminWallet(user.walletAddress) ? 'admin' : user.role,
    authMethod: user.authMethod,
    emailVerified: user.emailVerified,
    walletAddress: user.walletAddress,
    managedWalletAddress: user.managedWalletAddress
  };
}

// Admin accounts are created via ADMIN_WALLETS env var (on-chain wallet auth)
// or through the /auth/register + DB promotion path.
// No hardcoded admin credentials are ever created.

function ensureConfiguredAdminWalletUsers() {
  for (const wallet of adminWallets) {
    const existingId = usersByWallet.get(wallet);
    const existing = existingId ? users.get(existingId) : undefined;
    if (existing) {
      existing.role = 'admin';
      existing.emailVerified = true;
      continue;
    }
    const id = `admin-wallet-${wallet.slice(0, 8)}`;
    const email = `${wallet.slice(0, 8)}@admin-wallet.lynx`;
    users.set(id, {
      id,
      email,
      passwordHash: '',
      displayName: `Admin ${wallet.slice(0, 4)}...${wallet.slice(-4)}`,
      role: 'admin',
      authMethod: 'wallet',
      emailVerified: true,
      walletAddress: wallet,
      walletLinkedAt: Date.now(),
      createdAt: Date.now()
    });
    usersByEmail.set(email.toLowerCase(), id);
    usersByWallet.set(wallet, id);
  }
}

async function persistAuthUser(user: AuthUser) {
  await persistence.saveAuthUser(user.id, user);
}

async function loadPersistedAuthUsers() {
  const persisted = await persistence.loadAuthUsers<AuthUser>();
  if (!persisted) return;
  users.clear();
  usersByEmail.clear();
  usersByWallet.clear();
  for (const [id, user] of persisted) {
    users.set(id, user);
    usersByEmail.set(user.email.toLowerCase(), id);
    if (user.walletAddress) usersByWallet.set(user.walletAddress, id);
  }
}

// Admin wallet users are configured during start() after persistence is loaded

// Extract JWT from request
app.use((req: any, _res, next) => {
  const token = extractToken(req.headers.authorization);
  if (token) {
    const auth = verifyToken(token);
    if (auth) {
      req.user = auth;
    }
  }
  next();
});

// Test-only authentication bypass.
//
// This used to be four copy-pasted `NODE_ENV === 'test' && header` checks spread
// across requireAuth / requireAuthMatchesWallet / requireAdmin /
// requireAdminSessionOnly — one of which handed out admin identity. A single
// mis-set NODE_ENV in a deployment would have turned an HTTP header into a full
// authentication *and* authorization bypass on a system that moves money.
//
// Now it is: (a) defined once, (b) fails closed — it additionally requires
// ALLOW_TEST_AUTH_BYPASS=true, which no production config sets, and (c) is
// asserted at boot (see start()) to be impossible outside NODE_ENV=test.
function isTestAuthBypass(req: any): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.ALLOW_TEST_AUTH_BYPASS === 'true' &&
    req.headers['x-test-bypass-auth'] === 'true'
  );
}

function requireAuth(req: any, res: express.Response) {
  if (isTestAuthBypass(req)) return true;
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    return false;
  }
  // The JWT role/identity is fixed at login time. Re-check against the live
  // users Map so that a banned/deleted account's still-valid (unexpired)
  // token stops working immediately, instead of remaining usable until expiry.
  if (!users.has(req.user.userId)) {
    res.status(401).json({ error: 'Session invalidated' });
    return false;
  }
  return true;
}

/** Ensures the authenticated user owns (or is admin of) the requested wallet address */
function requireAuthMatchesWallet(req: any, res: express.Response, wallet: string): boolean {
  if (isTestAuthBypass(req)) return true;
  if (!requireAuth(req, res)) return false;
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  // Admins can inspect any wallet
  if (user.role === 'admin' || isAdminWallet(user.walletAddress)) return true;
  const allowedWallets = new Set([user.walletAddress, user.managedWalletAddress].filter(Boolean));
  if (!allowedWallets.has(wallet)) {
    res.status(403).json({ error: 'Forbidden: wallet does not match authenticated user' });
    return false;
  }
  return true;
}

function currentUser(req: any) {
  const user = req.user ? users.get(req.user.userId) : undefined;
  if (user && isAdminWallet(user.walletAddress)) {
    user.role = 'admin';
  }
  return user;
}

function requireAdmin(req: any, res: express.Response) {
  if (isTestAuthBypass(req)) return true;
  if (!requireAuth(req, res)) return false;
  const user = currentUser(req);
  if (user?.role !== 'admin' && !isAdminWallet(user?.walletAddress)) {
    res.status(403).json({ error: 'Admin role required' });
    return false;
  }
  return true;
}

// Version estricta de requireAdmin SIN bypass de ADMIN_API_TOKEN: nunca debe
// usarse para nada que pueda crear o mover dinero (ver A1/A2 de la auditoria
// — un token estatico compartido no debe poder por si solo acreditar saldo).
// Devuelve el userId del admin autenticado (para exigir aprobacion dual con
// una cuenta DISTINTA), o null si la request no esta autorizada.
function requireAdminSessionOnly(req: any, res: express.Response): string | null {
  if (isTestAuthBypass(req)) return 'test-admin-bypass';
  if (!requireAuth(req, res)) return null;
  const user = currentUser(req);
  if (user?.role !== 'admin' && !isAdminWallet(user?.walletAddress)) {
    res.status(403).json({ error: 'Admin role required (session-based, API tokens are not accepted for money-moving actions)' });
    return null;
  }
  return req.user.userId as string;
}

function requireWalletBody(req: express.Request, res: express.Response, wallet?: string) {
  const normalized = typeof wallet === 'string' ? wallet.trim() : '';
  if (!normalized || normalized === DEV_WALLET) {
    res.status(400).json({ error: 'A real wallet or managed wallet id is required' });
    return null;
  }
  // The GET paths have validated the wallet format since BE-M-12 but the POST
  // paths never did, so the two disagreed about what a wallet even is: an
  // arbitrary identifier like 'TRADE_USER' was accepted here and rejected there.
  // Share one definition (see isValidWalletFormat) so money-moving routes cannot
  // mint state under identifiers the read paths can never surface.
  if (!isValidWalletFormat(normalized)) {
    res.status(400).json({ error: 'Invalid wallet address format' });
    return null;
  }
  return normalized;
}

function verifyWalletSignature(wallet: string, signatureMessage: string, signature: string) {
  try {
    const pubkey = bs58.decode(wallet);
    const messageBytes = new TextEncoder().encode(signatureMessage);
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkey);
  } catch {
    return false;
  }
}

// In-memory fallback for consumeWalletLoginSignature() — used when REDIS_URL is
// not configured, and as a fail-open path if Redis is temporarily unreachable.
const usedWalletLoginSignatures = new Map<string, number>(); // signature -> expiresAt
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [sig, expiresAt] of usedWalletLoginSignatures) {
      if (expiresAt <= now) usedWalletLoginSignatures.delete(sig);
    }
  }, 5 * 60_000).unref?.();
}

/**
 * Ensures a wallet-login signature can only be consumed once within `ttlMs`.
 * Ed25519 signatures are deterministic for a given key + message, so the raw
 * signature string is a reliable one-time-use nonce — the same idea as
 * store.hasTransaction()/addTransaction() for on-chain signatures, but kept
 * separate from that on-chain transaction registry since this isn't one.
 * Returns true if this is the first use (now consumed), false if it was
 * already used (a replay attempt — e.g. a signature captured via a MITM
 * proxy or leaked in logs).
 */
async function consumeWalletLoginSignature(signature: string, ttlMs: number): Promise<boolean> {
  if (redis) {
    try {
      const key = `walletlogin:used:${signature}`;
      const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
      return result !== null;
    } catch (err) {
      console.error('[wallet-login] redis error, falling back to memory:', err instanceof Error ? err.message : err);
      // fall through to in-memory check below
    }
  }
  const now = Date.now();
  const expiresAt = usedWalletLoginSignatures.get(signature);
  if (expiresAt && expiresAt > now) {
    return false;
  }
  usedWalletLoginSignatures.set(signature, now + ttlMs);
  return true;
}

/**
 * Checks that a non-empty `signature` field is present in the request body.
 * NOTE: This does NOT cryptographically verify the signature — it only asserts
 * the field was provided. Actual cryptographic verification is done by
 * verifyWalletSignature() or verifyOnChainSolDeposit() at each call site.
 */
function requireNonEmptySignature(req: express.Request, res: express.Response) {
  const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
  if (!signature) {
    res.status(400).json({ error: 'A wallet signature or on-chain transaction signature is required' });
    return false;
  }
  return true;
}

let solanaConnection: Connection | null = null;
function getSolanaConnection() {
  if (!solanaConnection) {
    solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed');
  }
  return solanaConnection;
}

// Lamports tolerance to account for rounding when converting a decimal SOL
// amount to lamports. Deliberately small (well under 0.000001 SOL).
const LAMPORTS_TOLERANCE = 10;

/**
 * Verifies a claimed SOL deposit against the Solana blockchain before any
 * balance is credited. This is the server-side check that was previously
 * missing entirely: without it, any authenticated+approved account could
 * call /api/ledger/deposit with an arbitrary amount and have it accepted
 * as real money with no on-chain transaction ever happening.
 *
 * Verifies:
 *  - the transaction exists and is confirmed on-chain
 *  - it did not fail
 *  - the signature has not already been used to credit a deposit (replay)
 *  - the destination account is the protocol treasury wallet
 *  - the source account is the wallet claiming the deposit
 *  - the SOL amount that actually moved matches the claimed amount
 */
async function verifyOnChainSolDeposit(params: {
  signature: string;
  fromWallet: string;
  amountSol: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { signature, fromWallet, amountSol } = params;

  // Note: signature replay check is performed by the caller (atomically, before this
  // async function is invoked) to prevent TOCTOU race conditions. This function
  // only validates the on-chain transaction details.
  let treasuryPubkey: PublicKey;
  let senderPubkey: PublicKey;
  try {
    treasuryPubkey = new PublicKey(TREASURY_WALLET);
    senderPubkey = new PublicKey(fromWallet);
  } catch {
    return { ok: false, error: 'Invalid treasury or sender wallet address' };
  }

  let tx;
  try {
    tx = await getSolanaConnection().getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
  } catch (err: any) {
    return { ok: false, error: `Unable to verify transaction on-chain: ${err?.message || 'RPC error'}` };
  }

  if (!tx) {
    return { ok: false, error: 'Transaction not found or not yet confirmed on-chain' };
  }
  if (tx.meta?.err) {
    return { ok: false, error: 'On-chain transaction failed' };
  }

  const accountKeys = (() => {
    try {
      return tx.transaction.message.getAccountKeys
        ? tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).staticAccountKeys
        : tx.transaction.message.staticAccountKeys;
    } catch (err) {
      return { ok: false, error: `Failed to parse transaction account keys: ${err instanceof Error ? err.message : 'unknown error'}` };
    }
  })();
  if (!accountKeys) {
    return { ok: false, error: 'Failed to parse transaction account keys' };
  }
  const keys = (accountKeys as PublicKey[]).map((k: PublicKey) => k.toBase58());

  const fromIndex = keys.indexOf(senderPubkey.toBase58());
  const toIndex = keys.indexOf(treasuryPubkey.toBase58());
  if (fromIndex === -1 || toIndex === -1) {
    return { ok: false, error: 'Transaction does not transfer between the claimed wallet and the treasury' };
  }

  const preBalances = tx.meta?.preBalances ?? [];
  const postBalances = tx.meta?.postBalances ?? [];
  const treasuryDelta = (postBalances[toIndex] ?? 0) - (preBalances[toIndex] ?? 0);
  const senderDelta = (preBalances[fromIndex] ?? 0) - (postBalances[fromIndex] ?? 0);

  const expectedLamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  if (treasuryDelta <= 0 || treasuryDelta + LAMPORTS_TOLERANCE < expectedLamports) {
    return { ok: false, error: 'On-chain transfer amount does not match the requested deposit amount' };
  }
  if (senderDelta < treasuryDelta) {
    return { ok: false, error: 'Sender balance change does not account for the treasury deposit' };
  }

  return { ok: true };
}

let treasuryKeypairPromise: Promise<Keypair> | null = null;
async function getTreasuryKeypair(): Promise<Keypair> {
  if (!treasuryKeypairPromise) {
    treasuryKeypairPromise = (async () => {
      const secret = await readSecret(process.env.TREASURY_SECRET_KEY, 'TREASURY_SECRET_KEY');
      if (!secret) {
        throw new Error('TREASURY_SECRET_KEY must be set to send on-chain SOL withdrawals.');
      }
      // BE-06: Warn if treasury key is loaded from a plain env var rather than a file/secret manager.
      if (!process.env.TREASURY_SECRET_KEY?.startsWith('/')) {
        console.warn(
          '[security] TREASURY_SECRET_KEY is loaded from a plain environment variable. ' +
          'For production, use Docker secrets or an external secrets manager to avoid exposure via `docker inspect`.'
        );
      }
      return Keypair.fromSecretKey(bs58.decode(secret));
    })();
  }
  return treasuryKeypairPromise;
}

/**
 * Managed accounts (email/Magic logins) are identified internally by a
 * `MAGIC:<digest>` string (see managedWalletForUser), which is not a real
 * Solana address and cannot receive an on-chain transfer. To let these
 * accounts withdraw real SOL or LYNX, we deterministically derive a real
 * Solana keypair from that same managed id using a server-only seed, so the
 * same managed id always resolves to the same on-chain address.
 */
async function deriveManagedWalletKeypair(managedId: string): Promise<Keypair> {
  const seed = await readSecret(process.env.MANAGED_WALLET_SEED, 'MANAGED_WALLET_SEED');
  if (!seed) {
    throw new Error('MANAGED_WALLET_SEED must be set to send on-chain withdrawals for managed accounts.');
  }
  const seedBytes = createHash('sha256').update(`${seed}:${managedId}`).digest();
  return Keypair.fromSeed(seedBytes);
}

/**
 * Sends a real on-chain SOL transfer from the treasury wallet to the
 * withdrawing user's wallet and waits for confirmation. This is the
 * server-side action that was previously missing entirely: without it,
 * /api/ledger/withdraw only decremented the internal balance and marked
 * the ledger entry COMPLETED, with no SOL ever leaving the treasury.
 */
async function sendOnChainSolWithdrawal(params: {
  toWallet: string;
  amountSol: number;
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const { toWallet, amountSol } = params;

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = toWallet.startsWith('MAGIC:')
      ? (await deriveManagedWalletKeypair(toWallet)).publicKey
      : new PublicKey(toWallet);
  } catch (err: any) {
    return { ok: false, error: toWallet.startsWith('MAGIC:') ? (err?.message || 'Managed wallet is not configured for on-chain withdrawals') : 'SOL withdrawals require a connected on-chain wallet address' };
  }

  let payer: Keypair;
  try {
    payer = await getTreasuryKeypair();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Treasury wallet is not configured' };
  }

  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const connection = getSolanaConnection();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipientPubkey,
      lamports
    })
  );

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
    return { ok: true, signature };
  } catch (err: any) {
    return { ok: false, error: `Unable to send on-chain withdrawal: ${err?.message || 'RPC error'}` };
  }
}

const sendOnChainLynxWithdrawal: SolWithdrawalSender = async ({ toWallet, amountSol }) => {
  let secretKey: string | undefined;
  try {
    secretKey = await readSecret(process.env.TREASURY_SECRET_KEY, 'TREASURY_SECRET_KEY');
  } catch (err: any) {
    return { ok: false, error: err?.message || 'TREASURY_SECRET_KEY file cannot be read' };
  }
  if (!secretKey) return { ok: false, error: 'TREASURY_SECRET_KEY not configured' };
  const lynxMintStr = process.env.LYNX_MINT;
  if (!lynxMintStr) return { ok: false, error: 'LYNX_MINT not configured' };

  try {
    const { Keypair, PublicKey, Transaction } = await import('@solana/web3.js');
    const { getAssociatedTokenAddress, createTransferInstruction } = await import('@solana/spl-token');
    const bs58Mod = await import('bs58');

    const treasuryKp = Keypair.fromSecretKey(bs58Mod.default.decode(secretKey));
    const lynxMint = new PublicKey(lynxMintStr);
    const toPubkey = toWallet.startsWith('MAGIC:')
      ? (await deriveManagedWalletKeypair(toWallet)).publicKey
      : new PublicKey(toWallet);
    const connection = getSolanaConnection();

    const treasuryAta = await getAssociatedTokenAddress(lynxMint, treasuryKp.publicKey);
    const userAta = await getAssociatedTokenAddress(lynxMint, toPubkey);

    // amountSol here is actually LYNX amount (6 decimals)
    const amountMicroLynx = BigInt(Math.round(amountSol * 1_000_000));

    const ix = createTransferInstruction(treasuryAta, userAta, treasuryKp.publicKey, amountMicroLynx);
    const tx = new Transaction().add(ix);
    tx.feePayer = treasuryKp.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    const signature = await sendAndConfirmTransaction(connection, tx, [treasuryKp], { commitment: 'confirmed' });
    return { ok: true, signature };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
};

function requireApprovedWallet(res: express.Response, wallet: string) {
  if (!store.isWalletApproved(wallet)) {
    res.status(400).json({ error: 'Wallet must complete initial approve before trading' });
    return false;
  }
  return true;
}

function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const positionSchema = z.enum(['YES', 'NO', 'A', 'B', 'DRAW']);
const currencySchema = z.enum(['SOL', 'LYNX']);
const sideSchema = z.enum(['BUY', 'SELL']);

// ==================== AUTH ENDPOINTS ====================

app.post('/auth/register', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    password: passwordSchema,
    displayName: z.string().optional()
  }).parse(req.body);

  // Check if user already exists
  const exists = usersByEmail.has(body.email.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: 'User already exists' });
  }

  // Hash password
  const passwordHash = await hashPassword(body.password);

  // Create user
  const userId = `user-${randomUUID()}`;
  const user: AuthUser = {
    id: userId,
    email: body.email,
    passwordHash,
    displayName: body.displayName || body.email.split('@')[0],
    role: 'user',
    authMethod: 'email',
    emailVerified: !requireEmailVerification,
    emailVerificationToken: requireEmailVerification ? token('verify') : undefined,
    emailVerificationExpiresAt: requireEmailVerification ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
    managedWalletAddress: requireEmailVerification ? undefined : managedWalletForUser(userId, body.email),
    createdAt: Date.now()
  };

  users.set(userId, user);
  usersByEmail.set(user.email.toLowerCase(), userId);
  if (user.managedWalletAddress) {
    store.approveWallet(user.managedWalletAddress);
    await persist();
  }
  await persistAuthUser(user);

  if (requireEmailVerification) {
    (req as any).log.info({ email: user.email }, 'auth:email-verification-required');
    // Send verification email (non-blocking — failure is logged but doesn't block registration)
    if (isEmailConfigured()) {
      sendVerificationEmail({
        to: user.email,
        token: user.emailVerificationToken!,
        displayName: user.displayName,
      }).catch((err) => {
        logger.error({ email: user.email, err: err?.message }, 'email:verification-send-failed');
      });
    } else {
      // Dev mode: no Resend configured — log token to console for testing
      console.log(`[dev-email] Verification token for ${user.email}: ${user.emailVerificationToken}`);
    }
    return res.status(201).json({
      requiresEmailVerification: true,
      email: user.email,
    });
  }

  setRefreshCookie(res, generateRefreshToken(userId));
  res.status(201).json({
    user: publicUser(user),
    token: generateToken({ userId, email: user.email, role: user.role })
  });
}));

app.post('/auth/login', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string()
  }).parse(req.body);

  // Find user by email
  const user = users.get(usersByEmail.get(body.email.toLowerCase()) ?? '');
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Verify password
  const isValid = await verifyPassword(body.password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'Email confirmation required before signing in',
      requiresEmailVerification: true
    });
  }

  setRefreshCookie(res, generateRefreshToken(user.id));
  res.json({
    user: publicUser(user),
    token: generateToken({ userId: user.id, email: user.email, role: user.role })
  });
}));

app.post('/auth/verify-email', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    token: z.string().min(12)
  }).parse(req.body);

  const now = Date.now();
  const user = [...users.values()].find(
    (candidate) =>
      constantTimeEqual(candidate.emailVerificationToken, body.token) &&
      (candidate.emailVerificationExpiresAt === undefined || candidate.emailVerificationExpiresAt > now)
  );
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }

  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  if (!user.managedWalletAddress) {
    user.managedWalletAddress = managedWalletForUser(user.id, user.email);
  }
  store.approveWallet(user.managedWalletAddress);
  await persist();
  await persistAuthUser(user);

  setRefreshCookie(res, generateRefreshToken(user.id));
  res.json({
    user: publicUser(user),
    token: generateToken({ userId: user.id, email: user.email, role: user.role })
  });
}));

app.post('/auth/request-password-reset', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const user = users.get(usersByEmail.get(body.email.toLowerCase()) ?? '');
  if (user && user.authMethod === 'email') {
    user.passwordResetToken = token('reset');
    user.passwordResetExpiresAt = Date.now() + 1000 * 60 * 30;
    await persistAuthUser(user);
    (req as any).log.info({ email: user.email }, 'auth:password-reset-requested');
    if (isEmailConfigured()) {
      sendPasswordResetEmail({ to: user.email, token: user.passwordResetToken }).catch((err) => {
        logger.error({ email: user.email, err: err?.message }, 'email:reset-send-failed');
      });
    } else {
      console.log(`[dev-email] Password reset token for ${user.email}: ${user.passwordResetToken}`);
    }
  }
  // Always return 200 to avoid user enumeration (don't reveal whether email exists)
  res.json({
    ok: true,
  });
}));

app.post('/auth/reset-password', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    token: z.string().min(12),
    password: passwordSchema
  }).parse(req.body);

  const user = [...users.values()].find((candidate) =>
    constantTimeEqual(candidate.passwordResetToken, body.token) &&
    (candidate.passwordResetExpiresAt || 0) > Date.now()
  );
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired password reset token' });
  }

  user.passwordHash = await hashPassword(body.password);
  user.passwordResetToken = undefined;
  user.passwordResetExpiresAt = undefined;
  await persistAuthUser(user);
  res.json({ ok: true });
}));

app.post('/auth/change-password', maybeAuthRateLimit, asyncRoute(async (req: any, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema
  }).parse(req.body);

  const user = users.get(req.user.userId);
  if (!user || user.authMethod !== 'email') {
    return res.status(400).json({ error: 'Password changes are only available for email accounts' });
  }
  const valid = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  user.passwordHash = await hashPassword(body.newPassword);
  await persistAuthUser(user);
  res.json({ ok: true });
}));

// Login or auto-register via Phantom/Solflare wallet signature
app.post('/auth/wallet-login', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    wallet: z.string().min(32),
    signatureMessage: z.string().min(1),
    signature: z.string().min(1),
  }).parse(req.body);

  // Validate signatureMessage content to prevent replay attacks.
  // A captured signature would otherwise be valid indefinitely because only the
  // signature's mathematical validity was checked, not the message's intent or freshness.
  // BE-15: Reduced to 60 seconds to narrow the replay window.
  const WALLET_LOGIN_WINDOW_MS = 60 * 1000; // 60 seconds
  let parsedMsg: { app?: string; action?: string; wallet?: string; issuedAt?: string } | null;
  try {
    parsedMsg = JSON.parse(body.signatureMessage) as {
      app?: string;
      action?: string;
      wallet?: string;
      issuedAt?: string;
    };
  } catch {
    parsedMsg = null;
  }
  if (
    !parsedMsg ||
    parsedMsg.action !== 'LYNX_LOGIN' ||
    parsedMsg.wallet !== body.wallet ||
    !parsedMsg.issuedAt ||
    Date.now() - new Date(parsedMsg.issuedAt).getTime() > WALLET_LOGIN_WINDOW_MS
  ) {
    return res.status(401).json({ error: 'Wallet login message is invalid or expired. Please try again.' });
  }

  if (!verifyWalletSignature(body.wallet, body.signatureMessage, body.signature)) {
    return res.status(401).json({ error: 'Wallet signature verification failed' });
  }

  // Reject replay of a previously used signature — a captured signature+message
  // pair (e.g. via a MITM proxy on a non-TLS hop, or leaked in logs) would
  // otherwise remain valid to log in repeatedly until WALLET_LOGIN_WINDOW_MS expires.
  if (!(await consumeWalletLoginSignature(body.signature, WALLET_LOGIN_WINDOW_MS))) {
    return res.status(401).json({ error: 'Wallet login message has already been used. Please sign a new message.' });
  }

  // Find existing user by wallet or create one
  let user = users.get(usersByWallet.get(body.wallet) ?? '');

  if (!user) {
    const userId = `wallet-${randomUUID()}`;
    user = {
      id: userId,
      email: `${body.wallet.slice(0, 8)}@wallet.lynx`,
      passwordHash: '',
      displayName: `${body.wallet.slice(0, 4)}...${body.wallet.slice(-4)}`,
      role: isAdminWallet(body.wallet) ? 'admin' : 'user',
      authMethod: 'wallet',
      emailVerified: true,
      walletAddress: body.wallet,
      walletLinkedAt: Date.now(),
      createdAt: Date.now()
    };
    users.set(userId, user);
    usersByEmail.set(user.email.toLowerCase(), userId);
    usersByWallet.set(body.wallet, userId);
    store.approveWallet(user.walletAddress!);
    await persist();
  } else if (isAdminWallet(body.wallet)) {
    user.role = 'admin';
  }
  await persistAuthUser(user);

  const token = generateToken({ userId: user.id, email: user.email, role: user.role });
  setRefreshCookie(res, generateRefreshToken(user.id));

  res.json({
    user: publicUser(user),
    token,
  });
}));

app.post('/auth/refresh', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
  if (!refreshToken) {
    return res.status(401).json({ error: 'Missing refresh token' });
  }
  // BE-14: Check if the refresh token has been revoked (logout)
  if (await isRefreshTokenRevoked(refreshToken)) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Refresh token has been revoked' });
  }
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  const user = users.get(payload.userId);
  if (!user) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'User not found' });
  }
  setRefreshCookie(res, generateRefreshToken(user.id));
  res.json({
    token: generateToken({ userId: user.id, email: user.email, role: user.role }),
    user: publicUser(user),
  });
}));

app.post('/auth/logout', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  // BE-14: Blacklist the refresh token so it cannot be reused
  const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
  if (refreshToken) {
    const payload = verifyRefreshToken(refreshToken);
    if (payload) {
      // Use the configured refresh expiry as the blacklist TTL
      await revokeRefreshToken(refreshToken, refreshCookieOptions.maxAge ?? 0);
    }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

app.get('/auth/me', (req: any, res) => {
  if (!requireAuth(req, res)) return;

  const user = users.get(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(publicUser(user));
});

app.post('/auth/link-wallet', maybeAuthRateLimit, asyncRoute(async (req: any, res) => {
  if (!requireAuth(req, res)) return;

  const body = z.object({
    wallet: z.string().min(32),
    signatureMessage: z.string().min(20),
    signature: z.string().min(1)
  }).parse(req.body);

  const currentUser = users.get(req.user.userId);
  if (!currentUser) {
    return res.status(404).json({ error: 'Authenticated user not found' });
  }

  const parsed = (() => {
    try {
      return JSON.parse(body.signatureMessage) as { wallet?: string; action?: string };
    } catch {
      return null;
    }
  })();

  if (!parsed || parsed.wallet !== body.wallet || parsed.action !== 'LINK_WALLET') {
    return res.status(400).json({ error: 'Invalid wallet signature message' });
  }

  if (!verifyWalletSignature(body.wallet, body.signatureMessage, body.signature)) {
    return res.status(400).json({ error: 'Wallet signature verification failed' });
  }

  const takenById = usersByWallet.get(body.wallet);
  const walletTaken = takenById !== undefined && takenById !== currentUser.id;
  if (walletTaken) {
    return res.status(400).json({ error: 'Wallet already linked to another account' });
  }

  currentUser.walletAddress = body.wallet;
  currentUser.walletLinkedAt = Date.now();
  usersByWallet.set(body.wallet, currentUser.id);
  if (isAdminWallet(body.wallet)) currentUser.role = 'admin';
  store.approveWallet(body.wallet);
  await persist();
  await persistAuthUser(currentUser);

  res.json(publicUser(currentUser));
}));

app.delete('/auth/unlink-wallet', (req: any, res) => {
  if (!requireAuth(req, res)) return;
  res.status(400).json({ error: 'Wallet unlink is disabled. Log out to use another wallet.' });
});

// ==================== API ENDPOINTS ====================

app.get('/api/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    service: 'lynx-backend',
    version: process.env.npm_package_version || '0.0.0',
    store: persistence.driver,
    solanaCluster: process.env.SOLANA_CLUSTER || 'devnet',
    programId: process.env.PROGRAM_ID || null,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1_048_576),
      heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
      rssMB: Math.round(mem.rss / 1_048_576),
    },
    chain: getIndexerStatus(),
  });
});


app.get('/api/config', (_req, res) => {
  res.json({
    solanaCluster: process.env.SOLANA_CLUSTER || 'devnet',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    programId: process.env.PROGRAM_ID || null,
    lynxMint: process.env.LYNX_MINT || null
  });
});

app.use(onchainRouter);

// Superpone el estado real on-chain (pool/status/resultado) sobre un mercado
// legacy cuando tiene onChainMarket asociado y el indexador ya lo vio. Nunca
// lanza: si el indexador no tiene el dato todavia (recien creado, o
// PROGRAM_ID no configurado en este entorno), se devuelve el mercado tal
// cual venia del store off-chain, sin romper la respuesta.
function overlayOnChainMarket<T extends { onChainMarket?: string; poolAmount: number; yesAmount: number; noAmount: number; drawAmount?: number; status: string; result?: string }>(market: T): T {
  if (!market.onChainMarket) return market;
  const onChain = getIndexedMarket(market.onChainMarket);
  if (!onChain) return market;
  const factor = onChain.currency === 'SOL' ? 1_000_000_000 : 1_000_000;
  const statusMap: Record<string, string> = { Open: 'OPEN', Active: 'ACTIVE', CutOff: 'CUT_OFF', PendingResolution: 'CUT_OFF', Resolved: 'RESOLVED', Expired: 'EXPIRED' };
  return {
    ...market,
    poolAmount: Number(onChain.poolTotal) / factor,
    yesAmount: Number(onChain.yesTotal) / factor,
    noAmount: Number(onChain.noTotal) / factor,
    drawAmount: Number(onChain.drawTotal) / factor,
    status: statusMap[onChain.status] ?? market.status,
    result: fromOnChainOutcomeName(onChain.result) ?? market.result,
  };
}

app.get('/api/markets', (req, res) => {
  const includeFinished = req.query.includeFinished === 'true';
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const all = store.listMarkets(includeFinished).map(overlayOnChainMarket);
  res.json({
    data: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset
  });
});

app.get('/api/markets/:id', (req, res) => {
  res.json(overlayOnChainMarket(store.getMarket(req.params.id)));
});

app.post('/api/markets', asyncRoute(async (req, res) => {
  if (!requireAdminSessionOnly(req, res)) return;

  const body = z.object({
    id: z.string().optional(),
    title: z.string().min(4),
    description: z.string().default(''),
    category: z.string().default('General'),
    currency: currencySchema.default('SOL'),
    isTernary: z.boolean().default(false),
    oracleId: z.string().default('manual:dev'),
    cutoffAt: z.number().optional(),
    resolveAt: z.number().optional(),
    signature: z.string().min(8),
    onChainMarket: z.string().optional(),
    // Antes, onChainMarket/signature se aceptaban como texto libre sin
    // verificar nada contra la blockchain (hallazgo A3 de la auditoria).
    // Ahora, cualquier mercado que no marque legacy=true DEBE traer un
    // onChainMarket real y se verifica contra el RPC antes de crearse. Usa
    // legacy=true solo para el flujo de transicion off-chain que se esta
    // retirando progresivamente.
    legacy: z.boolean().default(false),
  }).parse(req.body);

  if (!requireNonEmptySignature(req, res)) return;

  let onChainMarket: string | undefined;
  if (!body.legacy) {
    if (!body.onChainMarket) {
      res.status(400).json({ error: 'onChainMarket is required unless legacy=true is explicitly set. Create the market on-chain first via create_market, then pass its account pubkey here.' });
      return;
    }
    const verification = await verifyOnChainMarketCreation({ marketPubkey: body.onChainMarket, signature: body.signature, expectedTitle: body.title });
    if (!verification.ok) {
      res.status(400).json({ error: `On-chain market verification failed: ${verification.error}` });
      return;
    }
    onChainMarket = body.onChainMarket;
  }

  const now = Date.now();
  const cutoffAt = body.cutoffAt || now + 1000 * 60 * 60 * 24;
  const resolveAt = body.resolveAt || now + 1000 * 60 * 60 * 30;
  if (cutoffAt <= now) {
    res.status(400).json({ error: 'Market cutoff must be in the future' });
    return;
  }
  if (resolveAt <= cutoffAt) {
    res.status(400).json({ error: 'Market resolve time must be after cutoff' });
    return;
  }

  const market = {
    id: body.id || `market_${randomUUID()}`,
    title: body.title,
    description: body.description,
    category: body.category,
    status: 'OPEN' as const,
    poolAmount: 0,
    yesAmount: 0,
    noAmount: 0,
    drawAmount: body.isTernary ? 0 : undefined,
    burnedAmount: 0,
    isTernary: body.isTernary,
    currency: body.currency,
    oracleId: body.oracleId,
    oracleMode: 'MANUAL_DEV',
    onChainMarket,
    onChainSignature: body.signature,
    createdBy: currentUser(req)?.id || 'admin-api-token',
    createdAt: now,
    cutoffAt,
    resolveAt,
    oracleDeadline: resolveAt + 1000 * 60 * 60
  };
  store.addMarket(market);
  await persist();
  emit('market:created', market);
  res.status(201).json(market);
}));

// Cache de idempotencia simple para /api/markets/:id/trades (M6 de la
// auditoria): un doble-click o un reintento automatico del cliente ante un
// timeout podia ejecutar executePredictionTrade() dos veces. Si el cliente
// manda un clientRequestId, una segunda request con el mismo id dentro de la
// ventana devuelve el resultado ya calculado en vez de repetir la operacion.
// En memoria a proposito: el peor caso de perderlo en un reinicio es que un
// reintento MUY tardio no se deduplique, no que se pierda ni se duplique
// dinero silenciosamente (executePredictionTrade sigue siendo la unica
// fuente de verdad para el propio movimiento).
const tradeIdempotencyCache = new Map<string, { result: any; expiresAt: number }>();
const TRADE_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
function purgeTradeIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of tradeIdempotencyCache) {
    if (entry.expiresAt < now) tradeIdempotencyCache.delete(key);
  }
}

app.post('/api/markets/:id/trades', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    amount: z.number().positive(),
    position: positionSchema,
    tradeType: z.enum(['limit', 'swap', 'market']).default('swap'),
    limitPrice: z.number().positive().optional(),
    clientRequestId: z.string().max(100).optional(),
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  purgeTradeIdempotencyCache();
  const idempotencyKey = body.clientRequestId ? `${wallet}:${req.params.id}:${body.clientRequestId}` : undefined;
  if (idempotencyKey) {
    const cached = tradeIdempotencyCache.get(idempotencyKey);
    if (cached) { res.json(cached.result); return; }
  }

  // BE-17: Acquire distributed lock for trading mutation
  const tradeLockKey = `trade:${wallet}:${req.params.id}`;
  if (!(await acquireLock(tradeLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent trade in progress. Please retry.' });
    return;
  }
  try {
  const result = store.executePredictionTrade({
    wallet,
    marketId: req.params.id,
    amount: body.amount,
    position: body.position,
    tradeType: body.tradeType,
    limitPrice: body.limitPrice
  });
  if (idempotencyKey) {
    tradeIdempotencyCache.set(idempotencyKey, { result, expiresAt: Date.now() + TRADE_IDEMPOTENCY_TTL_MS });
  }
  await persist();
  emit('market:updated', 'market' in result ? result.market : store.getMarket(req.params.id));
  // A swap/market trade can move the pool price into range of resting
  // prediction limit orders (see matchPredictionOrders), so the book for
  // this market may have changed even though this wasn't a limit order.
  emit('orderbook:updated', store.getOrderBook(req.params.id, req.params.id));
  res.json(result);
  } finally {
    await releaseLock(tradeLockKey);
  }
}));

// Antes esta ruta resolvia el mercado al instante con una sola sesion de
// admin (o el ADMIN_API_TOKEN compartido) — el mismo problema de fondo que
// C3 en el informe de auditoria, aqui para mercados LEGACY (sin respaldo
// on-chain). Ahora es un flujo de 3 pasos igual que /api/admin/credits/*:
// proponer -> que un admin DISTINTO apruebe -> ejecutar. Nunca acepta el
// token compartido (requireAdminSessionOnly).
app.post('/api/admin/markets/:id/resolve', asyncRoute(async (req, res) => {
  const adminId = requireAdminSessionOnly(req, res);
  if (!adminId) return;

  const body = z.object({
    action: z.enum(['propose', 'approve', 'execute']).default('propose'),
    result: positionSchema.optional(),
    source: z.enum(['oracle', 'manual']).default('manual'),
    confirmation: z.string().optional(),
    requestId: z.string().optional(),
  }).parse(req.body);

  if (body.action === 'propose') {
    if (!body.result) { res.status(400).json({ error: 'result is required to propose a resolution' }); return; }
    if (body.source === 'manual' && body.confirmation !== `RESOLVE ${body.result}`) {
      res.status(400).json({ error: `Type RESOLVE ${body.result} to confirm` });
      return;
    }
    const request = proposeMarketResolution({ marketId: req.params.id, result: body.result, proposedBy: adminId });
    res.status(201).json({ request });
    return;
  }

  if (body.action === 'approve') {
    if (!body.requestId) { res.status(400).json({ error: 'requestId is required' }); return; }
    try {
      const request = approveMarketResolution(body.requestId, adminId);
      res.json({ request, readyToExecute: isResolutionReadyToExecute(request) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
    return;
  }

  // execute
  if (!body.requestId) { res.status(400).json({ error: 'requestId is required' }); return; }
  const request = getMarketResolutionRequest(body.requestId);
  if (!request) { res.status(404).json({ error: 'Resolution request not found or expired' }); return; }
  if (request.marketId !== req.params.id) { res.status(400).json({ error: 'requestId does not match this market' }); return; }
  if (request.executed) { res.status(400).json({ error: 'Already executed' }); return; }
  if (!isResolutionReadyToExecute(request)) {
    res.status(400).json({ error: `Needs approval from a second admin before it can be executed (${1 + request.approvals.length}/2 so far).` });
    return;
  }

  // BE-09: Validate that the stored result is a legitimate Position value
  const validPositions = ['YES', 'NO', 'DRAW', 'A', 'B'] as const;
  if (!validPositions.includes(request.result as any)) {
    res.status(400).json({ error: `Invalid resolution result: "${request.result}". Must be one of: ${validPositions.join(', ')}` });
    return;
  }

  // BE-17: Distributed lock for market resolution
  const resolveLockKey = `resolve:${req.params.id}`;
  if (!(await acquireLock(resolveLockKey, 15_000))) {
    res.status(409).json({ error: 'Concurrent resolution in progress. Please retry.' });
    return;
  }
  try {
  const market = store.resolveMarket({ marketId: req.params.id, result: request.result as any, source: 'manual' });
  markResolutionExecuted(request.id);
  await persist();
  emit('market:resolved', market);
  res.json({ ok: true, market, request });
  } finally {
    await releaseLock(resolveLockKey);
  }
}));

app.get('/api/admin/markets/:id/resolve/pending', (req, res) => {
  const adminId = requireAdminSessionOnly(req, res);
  if (!adminId) return;
  res.json({ data: listPendingMarketResolutions().filter((r) => r.marketId === req.params.id) });
});

app.post('/api/admin/markets/:id/cutoff', asyncRoute(async (req, res) => {
  if (!requireAdminSessionOnly(req, res)) return;
  const body = z.object({
    force: z.boolean().default(false),
    signature: z.string().optional()
  }).parse(req.body);
  const market = store.cutOffMarket(req.params.id, body.force);
  await persist();
  emit('market:updated', market);
  res.json({ ok: true, market });
}));

app.get('/api/duels', (req, res) => {
  const parentMarketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  const includeFinished = req.query.includeFinished === 'true';
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const all = store.listDuels(parentMarketId, includeFinished);
  res.json({
    data: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset
  });
});

app.post('/api/duels', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    marketId: z.string(),
    side: positionSchema,
    amount: z.number().positive(),
    type: z.enum(['1v1', '1v1vP']).optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  // BE-17: Distributed lock for duel creation
  const duelLockKey = `duel:create:${body.marketId}`;
  if (!(await acquireLock(duelLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent duel operation in progress. Please retry.' });
    return;
  }
  try {
  const duel = store.createDuel({
    wallet,
    marketId: body.marketId,
    side: body.side,
    amount: body.amount,
    type: body.type
  });
  await persist();
  emit('duel:created', duel);
  res.status(201).json(duel);
  } finally {
    await releaseLock(duelLockKey);
  }
}));

app.post('/api/duels/:id/accept', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    side: positionSchema.optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // BE-17: Distributed lock for duel acceptance
  const acceptLockKey = `duel:accept:${req.params.id}`;
  if (!(await acquireLock(acceptLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent duel operation in progress. Please retry.' });
    return;
  }
  try {
  const duel = store.acceptDuel({ wallet, duelId: req.params.id, side: body.side });
  await persist();
  emit('duel:accepted', duel);
  res.json(duel);
  } finally {
    await releaseLock(acceptLockKey);
  }
}));

app.delete('/api/duels/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // Distributed lock (audit BUG-1): cancelDuel reads duel.status==OPEN, refunds
  // the creator and flips to CANCELLED. Two replicas could both refund the same
  // open duel before either writes CANCELLED — double refund.
  const cancelDuelLockKey = `cancel-duel:${req.params.id}`;
  if (!(await acquireLock(cancelDuelLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent cancel in progress. Please retry.' });
    return;
  }
  try {
    const result = store.cancelDuel({ wallet, duelId: req.params.id });
    await persist();
    emit('duel:cancelled', result.duel);
    emitPortfolioUpdated(wallet, result.portfolio);
    res.json(result);
  } finally {
    await releaseLock(cancelDuelLockKey);
  }
}));


app.get('/api/orderbook', (req, res) => {
  const pair = typeof req.query.pair === 'string' ? req.query.pair : 'LYNX/SOL';
  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  const book = store.getOrderBook(pair, marketId);

  if (pair === 'LYNX/SOL' && !marketId) {
    const onChainSpotOrders = listOpenSpotOrders().map((o) => {
      const amount = Number(o.remaining) / 1_000_000;
      return {
        id: o.pubkey,
        pair: 'LYNX/SOL',
        owner: o.owner,
        side: (o.side === 'Buy' ? 'BUY' : 'SELL') as OrderSide,
        amount,
        remaining: amount,
        price: Number(o.priceScaled) / 1e12, // ver server.ts/frontend lynxProgram.ts: priceScaled -> SOL por LYNX
        status: 'OPEN' as OrderStatus,
        createdAt: o.createdTs * 1000,
        onChain: true,
        onChainOrderPubkey: o.pubkey,
        currency: 'LYNX' as Currency,
      };
    });
    book.bids = [...(book.bids || []), ...onChainSpotOrders.filter((o) => o.side === 'BUY')];
    book.asks = [...(book.asks || []), ...onChainSpotOrders.filter((o) => o.side === 'SELL')];
  }

  if (marketId) {
    const market = store.getMarket(marketId);
    if (market?.onChainMarket) {
      const onChainOrders = listOpenOrdersForMarket(market.onChainMarket).map((o) => {
        const amount = Number(o.amount) / (market.currency === 'LYNX' ? 1_000_000 : 1_000_000_000);
        return {
          id: o.pubkey,
          pair: marketId,
          owner: o.owner,
          // Las ordenes on-chain de mercados de prediccion no tienen un "side"
          // BUY/SELL real (se llenan contra el pool, no contra una
          // contraparte) — se guarda como BUY por convencion para encajar en
          // el tipo Order comun; la UI las distingue por `position` en su lugar.
          side: 'BUY' as OrderSide,
          position: fromOnChainOutcomeName(o.outcome) ?? undefined,
          amount,
          remaining: amount,
          price: o.limitPriceBps / 10_000,
          status: 'OPEN' as OrderStatus,
          createdAt: o.createdTs * 1000,
          onChain: true,
          onChainOrderPubkey: o.pubkey,
          onChainMarket: market.onChainMarket,
          currency: market.currency,
        };
      });
      // Las ordenes on-chain de mercados de prediccion no distinguen "bid/ask"
      // como el CLOB de LYNX/SOL (no hay contraparte, se llenan contra el pool):
      // las mostramos todas en bids para YES/A y asks para NO/B, que es lo que
      // consume el resto de la UI del orderbook para pintar dos columnas.
      book.bids = [...(book.bids || []), ...onChainOrders.filter((o) => o.position === 'YES' || o.position === 'DRAW')];
      book.asks = [...(book.asks || []), ...onChainOrders.filter((o) => o.position === 'NO')];
    }
  }

  res.json(book);
});

app.post('/api/orders', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    marketId: z.string().optional(),
    pair: z.string().default('LYNX/SOL'),
    side: sideSchema,
    position: positionSchema.optional(),
    amount: z.number().positive(),
    price: z.number().positive().optional(),
    currency: currencySchema.default('LYNX'),
    tradeType: z.enum(['limit', 'market']).default('limit'),
    maxPrice: z.number().positive().optional(),
    minPrice: z.number().positive().optional()
  }).refine((data) => data.tradeType === 'market' || typeof data.price === 'number', {
    message: 'price is required for limit orders',
    path: ['price']
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  // Distributed lock (audit BUG-1 / endpoint×lock sweep): placeOrder reads the
  // wallet's balance and escrows (locks/debits) part of it. Two concurrent order
  // creations from the same wallet on different replicas could both read the same
  // balance and both escrow it — over-committing more than the wallet holds.
  const placeOrderLockKey = `place-order:${wallet}`;
  if (!(await acquireLock(placeOrderLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent order placement in progress. Please retry.' });
    return;
  }
  try {
    const result = store.placeOrder({
      wallet,
      marketId: body.marketId,
      pair: body.pair,
      side: body.side as OrderSide,
      position: body.position as Position | undefined,
      amount: body.amount,
      price: body.price,
      currency: body.currency as Currency,
      tradeType: body.tradeType,
      maxPrice: body.maxPrice,
      minPrice: body.minPrice
    });
    await persist();
    emit('orderbook:updated', result.orderbook);
    // A prediction limit order (pair === marketId, not LYNX/SOL) can match
    // immediately against the pool in placeOrder -> matchPredictionOrders,
    // changing the market's pool/yes/no right away. Mirror the same
    // market:updated emission used by /api/markets/:id/trades so connected
    // clients see the price/pool change in real time.
    if (body.marketId && body.pair !== 'LYNX/SOL') {
      const updatedMarket = store.getMarket(body.marketId);
      if (updatedMarket) emit('market:updated', updatedMarket);
    }
    res.status(201).json(result);
  } finally {
    await releaseLock(placeOrderLockKey);
  }
}));

app.get('/api/portfolio', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  res.json(store.getPortfolio(wallet));
});

app.get('/api/ledger', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  res.json(store.listLedger(wallet));
});

app.post('/api/ledger/approve', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    externalWallet: z.string().optional(),
    signature: z.string().min(8),
    signatureMessage: z.string().optional()
  }).parse(req.body);
  if (!requireNonEmptySignature(req, res)) return;
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;

  // Linking an external Solana wallet must prove control of its private key.
  //
  // This route demanded a `signature`, stored it in the transaction log as an
  // APPROVE intent, and recorded `externalWallet` in wallet.connectedWallets —
  // but never verified the signature against anything. Any string of 8+ chars
  // passed, so a caller could attach an arbitrary address to their account and
  // the audit trail would show a "signed" approval that proved nothing.
  //
  // It grants no privilege today (connectedWallets is display-only and appears
  // in no authorization check), which is the only reason this was not
  // exploitable — but the frontend already signs a real message for this call
  // (see signAction('APPROVE_INTERNAL_LEDGER') in useProgram.ts), so the intent
  // was always to verify it. Doing so now closes the gap before anything starts
  // treating connectedWallets as a list of *verified* wallets.
  if (body.externalWallet) {
    if (!body.signatureMessage) {
      res.status(400).json({ error: 'signatureMessage is required when linking an external wallet' });
      return;
    }
    if (!verifyWalletSignature(body.externalWallet, body.signatureMessage, body.signature)) {
      res.status(400).json({ error: 'Wallet signature verification failed for the external wallet' });
      return;
    }
    // The signed message must name the same wallet it is being used to link,
    // so a signature captured for one purpose cannot be replayed to attach a
    // different address.
    let parsed: { wallet?: string; action?: string } | null;
    try {
      parsed = JSON.parse(body.signatureMessage) as { wallet?: string; action?: string };
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.action !== 'APPROVE_INTERNAL_LEDGER' || parsed.wallet !== body.externalWallet) {
      res.status(400).json({ error: 'Signature message does not authorise linking this wallet' });
      return;
    }
  }

  const result = store.approveWallet(wallet, body.externalWallet);
  await persist();
  store.addTransaction({ signature: body.signature, wallet, intent: { type: 'APPROVE', message: body.signatureMessage } });
  emitToWallet(wallet, 'ledger:approved', { wallet, result });
  res.json(result);
}));

app.post('/api/ledger/deposit', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    currency: currencySchema,
    amount: z.number().positive(),
    provider: z.enum(['CARD', 'EXTERNAL_WALLET', 'INTERNAL']).default('INTERNAL'),
    reference: z.string().optional(),
    signature: z.string().optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  if (body.provider === 'EXTERNAL_WALLET') {
      // Real on-chain deposits must carry the confirmed transaction signature
      // and are verified against the Solana blockchain before crediting.
      if (!requireNonEmptySignature(req, res)) return;
      if (body.currency !== 'SOL') {
        res.status(400).json({ error: 'Only SOL deposits can currently be verified on-chain' });
        return;
      }
      // REPLAY / RACE-CONDITION FIX: Register the signature synchronously BEFORE
      // the async RPC verification. Without this, two concurrent requests with the
      // same signature could both pass hasTransaction() before either records it.
      // store.hasTransaction() is O(1) synchronous, so this is atomic within Node.
      if (store.hasTransaction(body.signature!)) {
        res.status(400).json({ error: 'This transaction signature has already been used' });
        return;
      }
      // Pre-register to block concurrent duplicates; removed on verification failure
      store.addTransaction({ signature: body.signature!, wallet, intent: { type: 'DEPOSIT_PENDING', currency: body.currency, amount: body.amount, provider: body.provider } });

      const verification = await verifyOnChainSolDeposit({
        signature: body.signature!,
        fromWallet: wallet,
        amountSol: body.amount
      });
      if (!verification.ok) {
        // Remove the pre-registration so the user can retry with a valid signature
        store.removeTransaction(body.signature!);
        res.status(400).json({ error: verification.error });
        return;
      }
  } else {
      // INTERNAL / CARD deposits have no on-chain proof attached to them.
      // A single admin (or worse, a leaked shared ADMIN_API_TOKEN) crediting
      // an arbitrary amount here was flagged as a critical finding (A2 in the
      // audit): it's the shortest path to "printing" spendable balance. This
      // endpoint no longer accepts that path at all — manual credits must go
      // through the dual-admin-approval flow below
      // (POST /api/admin/credits/propose -> approve -> execute), which
      // requires two DIFFERENT admin accounts and never accepts the shared
      // API token.
      res.status(410).json({
        error: 'Manual INTERNAL/CARD crediting via this endpoint has been removed. Use POST /api/admin/credits/propose (requires approval from a second admin) instead.'
      });
      return;
  }

  const result = store.deposit({
    wallet,
    currency: body.currency,
    amount: body.amount,
    provider: body.provider,
    reference: body.reference
  });
  // Only record the final transaction if not already pre-registered (EXTERNAL_WALLET flow)
  if (body.signature && !store.hasTransaction(body.signature)) {
    store.addTransaction({ signature: body.signature, wallet, intent: { type: 'DEPOSIT', currency: body.currency, amount: body.amount, provider: body.provider } });
  } else if (body.signature) {
    // Update the pre-registered DEPOSIT_PENDING entry to DEPOSIT
    const existing = store.getTransaction(body.signature);
    if (existing) existing.intent = { type: 'DEPOSIT', currency: body.currency, amount: body.amount, provider: body.provider };
  }
  await persist();
  emitToWallet(wallet, 'ledger:deposit', { wallet, ledgerEntry: result.ledgerEntry });
  emitPortfolioUpdated(wallet, result.portfolio);
  res.status(201).json(result);
}));

// --- Acreditacion manual de saldo (INTERNAL/CARD) con aprobacion dual ---
// Ver backend/src/creditApprovals.ts. Ningun paso de este flujo acepta el
// ADMIN_API_TOKEN compartido: requiere sesiones reales de DOS admins
// distintos. El credito real solo se aplica en /execute, una vez juntadas
// las 2 aprobaciones.
app.post('/api/admin/credits/propose', asyncRoute(async (req, res) => {
  const adminId = requireAdminSessionOnly(req, res);
  if (!adminId) return;
  const body = z.object({
    wallet: z.string(),
    currency: currencySchema,
    amount: z.number().positive(),
    reason: z.string().min(3),
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return;
  try {
    const request = await proposeCredit({ wallet, currency: body.currency, amount: body.amount, reason: body.reason, proposedBy: adminId });
    res.status(201).json(request);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}));

app.post('/api/admin/credits/:id/approve', asyncRoute(async (req, res) => {
  const adminId = requireAdminSessionOnly(req, res);
  if (!adminId) return;
  try {
    const request = approveCredit(req.params.id, adminId);
    res.json({ request, readyToExecute: isReadyToExecute(request) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}));

app.post('/api/admin/credits/:id/execute', asyncRoute(async (req, res) => {
  const adminId = requireAdminSessionOnly(req, res);
  if (!adminId) return;
  const request = getCreditRequest(req.params.id);
  if (!request) { res.status(404).json({ error: 'Credit request not found or expired' }); return; }
  if (request.executed) { res.status(400).json({ error: 'Already executed' }); return; }
  if (!isReadyToExecute(request)) {
    res.status(400).json({ error: `Needs approval from a second admin before it can be executed (${1 + request.approvals.length}/2 so far).` });
    return;
  }

  // Distributed lock so two near-simultaneous executions of the same
  // requestId (e.g. from different backend replicas) can't both credit the
  // wallet before markExecuted() propagates — same pattern as the market
  // resolution execute lock above.
  const creditExecuteLockKey = `credit-execute:${request.id}`;
  if (!(await acquireLock(creditExecuteLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent execution in progress. Please retry.' });
    return;
  }
  try {
    // BE-19: el cupo diario se consume aqui, al ejecutar de verdad (no al
    // proponer) — ver comentario en checkAndRecordDailyCredit.
    await checkAndRecordDailyCredit(request.wallet, request.currency, request.amount);
    const result = store.deposit({
      wallet: request.wallet,
      currency: request.currency,
      amount: request.amount,
      provider: 'INTERNAL',
      reference: `dual-approved:${request.id}:${request.reason}`,
    });
    markExecuted(request.id);
    await persist();
    emitToWallet(request.wallet, 'ledger:deposit', { wallet: request.wallet, ledgerEntry: result.ledgerEntry });
    emitPortfolioUpdated(request.wallet, result.portfolio);
    res.status(201).json({ request, result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    await releaseLock(creditExecuteLockKey);
  }
}));

app.get('/api/admin/credits/pending', (req, res) => {
  const adminId = requireAdminSessionOnly(req, res);
  if (!adminId) return;
  res.json({ data: listPendingCredits() });
});

app.post('/api/ledger/withdraw', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    currency: currencySchema,
    amount: z.number().positive(),
    reference: z.string().optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  // Serialize withdrawals per wallet+currency. store.withdraw() debits
  // synchronously (atomic within one Node instance), but the trade and
  // credit-execute paths already take a distributed lock and this one did not —
  // an inconsistency that becomes a real double-spend the moment the backend
  // runs more than one instance. Same lock as those paths.
  const withdrawLockKey = `withdraw:${wallet}:${body.currency}`;
  if (!(await acquireLock(withdrawLockKey, 20_000))) {
    res.status(409).json({ error: 'Concurrent withdrawal in progress. Please retry.' });
    return;
  }
  try {
  if (body.currency === 'LYNX') {
    if (!process.env.LYNX_MINT) {
      return res.status(501).json({ error: 'LYNX withdrawals require LYNX_MINT to be configured.' });
    }
    let withdrawalResult: ReturnType<typeof store.withdraw>;
    try {
      withdrawalResult = store.withdraw({ wallet, currency: body.currency, amount: body.amount });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
    await persist();
    const onChainResult = await sendOnChainLynxWithdrawal({ toWallet: wallet, amountSol: body.amount });
    if (!onChainResult.ok) {
      store.deposit({ wallet, currency: body.currency, amount: body.amount, provider: 'INTERNAL',
        reference: `reversal:${withdrawalResult.ledgerEntry.id}` });
      await persist();
      res.status(400).json({ error: onChainResult.error });
      return;
    }
    const withdrawalSignature = onChainResult.signature;
    withdrawalResult.ledgerEntry.reference = withdrawalSignature;
    store.addTransaction({ signature: withdrawalSignature, wallet, intent: { type: 'WITHDRAWAL', currency: body.currency, amount: body.amount } });
    await persist();
    emitToWallet(wallet, 'ledger:withdrawal', { wallet, ledgerEntry: withdrawalResult.ledgerEntry, signature: withdrawalSignature });
    emitPortfolioUpdated(wallet, withdrawalResult.portfolio);
    res.json({ portfolio: withdrawalResult.portfolio, ledgerEntry: withdrawalResult.ledgerEntry, signature: withdrawalSignature });
    return;
  }

  if (body.currency === 'SOL') {
    // RACE-CONDITION FIX: Deduct the internal balance synchronously BEFORE the
    // async on-chain transfer. If the on-chain send fails we restore the balance.
    // Without this, two concurrent withdrawal requests could both pass the balance
    // check before either one debited it — a classic TOCTOU double-spend.
    //
    // store.withdraw() is synchronous and therefore atomic within Node's event loop.
    // Any subsequent concurrent request will see the already-debited balance.
    let withdrawalResult: ReturnType<typeof store.withdraw>;
    try {
      withdrawalResult = store.withdraw({ wallet, currency: body.currency, amount: body.amount });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
    // CRASH-DURABILITY FIX: persist the in-memory debit BEFORE sending the
    // on-chain transfer, not just after. If the process died between the
    // on-chain send being confirmed and the persist() further below, a
    // restart would reload the last persisted (still-credited) balance while
    // the SOL had already left the treasury wallet — letting the same amount
    // be withdrawn again. Persisting here closes that window: the only
    // remaining crash window is before/during the on-chain send itself,
    // which just leaves the internal balance debited with no on-chain
    // movement yet (recoverable by support/reconciliation), instead of a
    // real, repeatable fund leak.
    await persist();
    const sendSolWithdrawal = (req.app.locals.solWithdrawalSender as SolWithdrawalSender | undefined) ?? sendOnChainSolWithdrawal;
    const onChainResult = await sendSolWithdrawal({ toWallet: wallet, amountSol: body.amount });
    if (!onChainResult.ok) {
      // On-chain failed — reverse the internal debit so the user isn't stuck.
      // Must persist() before responding so a server restart doesn't leave the
      // balance permanently deducted (funds lost).
      store.deposit({ wallet, currency: body.currency, amount: body.amount, provider: 'INTERNAL',
        reference: `reversal:${withdrawalResult.ledgerEntry.id}` });
      await persist();
      res.status(400).json({ error: onChainResult.error });
      return;
    }
    const withdrawalSignature = onChainResult.signature;
    // Update the already-created ledger entry with the on-chain signature
    withdrawalResult.ledgerEntry.reference = withdrawalSignature;
    // Record the TX and persist BEFORE returning — otherwise a server restart
    // would restore the balance and allow a second withdrawal.
    store.addTransaction({ signature: withdrawalSignature, wallet, intent: { type: 'WITHDRAWAL', currency: body.currency, amount: body.amount } });
    await persist();
    emitToWallet(wallet, 'ledger:withdrawal', { wallet, ledgerEntry: withdrawalResult.ledgerEntry, signature: withdrawalSignature });
    emitPortfolioUpdated(wallet, withdrawalResult.portfolio);
    res.json({ portfolio: withdrawalResult.portfolio, ledgerEntry: withdrawalResult.ledgerEntry, signature: withdrawalSignature });
    return;
  }
  // `body.currency` is exhaustively 'SOL' | 'LYNX' (currencySchema). LYNX is
  // rejected with 501 above and SOL is fully handled and returns above, so
  // this point should be unreachable. Kept as an explicit exhaustiveness
  // guard so that adding a third currency to currencySchema without updating
  // this route fails at compile time (and loudly at runtime) instead of
  // silently falling through to an unintended withdrawal path.
  const _exhaustiveCurrencyCheck: never = body.currency;
  throw new Error(`Unreachable: unhandled withdrawal currency ${_exhaustiveCurrencyCheck}`);
  } finally {
    await releaseLock(withdrawLockKey);
  }
}));

app.get('/api/positions', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  const offChainPositions = store.listPositions(wallet);

  // BE-H-02: Build index of markets by onChainMarket for O(1) lookups
  const marketByOnChain = new Map<string, any>();
  for (const m of store.listMarkets(true)) {
    if (m.onChainMarket) marketByOnChain.set(m.onChainMarket, m);
  }

  const onChainPositions = listPositionsForOwner(wallet)
    .filter((p) => !p.claimed)
    .map((p) => {
      const market = marketByOnChain.get(p.market);
      const onChainMarket = getIndexedMarket(p.market);
      const currency = market?.currency ?? onChainMarket?.currency ?? 'SOL';
      const factor = currency === 'LYNX' ? 1_000_000 : 1_000_000_000;
      const amount = Number(p.amount) / factor;
      let estimatedPayout: number | undefined;
      if (onChainMarket && onChainMarket.status === 'Resolved') {
        const winningTotal = onChainMarket.result === 'Yes' ? BigInt(onChainMarket.yesTotal)
          : onChainMarket.result === 'No' ? BigInt(onChainMarket.noTotal)
          : onChainMarket.result === 'Draw' ? BigInt(onChainMarket.drawTotal) : 0n;
        if (winningTotal > 0n) {
          const payoutPool = (BigInt(onChainMarket.poolTotal) * 9_000n) / 10_000n; // 90% (EVENT_PROTOCOL_FEE_BPS = 10%)
          estimatedPayout = Number((payoutPool * BigInt(p.amount)) / winningTotal) / factor;
        }
      }
      return {
        id: p.pubkey,
        marketId: market?.id ?? p.market,
        onChainMarket: p.market,
        currency,
        position: fromOnChainOutcomeName(p.outcome),
        amount,
        claimed: p.claimed,
        estimatedPayout,
      };
    });

  res.json([...offChainPositions, ...onChainPositions]);
});

app.post('/api/positions/:id/claim', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // Distributed lock (audit BUG-1): claimPosition reads position.claimed, then
  // pays out and sets it true. Without this, two replicas could both read
  // claimed=false and pay the same winning position twice.
  const claimLockKey = `claim-position:${req.params.id}`;
  if (!(await acquireLock(claimLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent claim in progress. Please retry.' });
    return;
  }
  try {
    const result = store.claimPosition(wallet, req.params.id);
    await persist();
    emitPortfolioUpdated(wallet, result.portfolio);
    res.json(result);
  } finally {
    await releaseLock(claimLockKey);
  }
}));

app.post('/api/positions/:id/boost-with-lynx', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), lynxAmount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  // Distributed lock so two near-simultaneous boosts on the same position
  // (e.g. from different backend replicas) can't both read remainingCap
  // before either one writes position.lynxBoostSolEquivalent — same pattern
  // as the market resolution / credit execute locks above.
  const boostLockKey = `boost-position:${req.params.id}`;
  if (!(await acquireLock(boostLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent boost in progress. Please retry.' });
    return;
  }
  try {
    const result = store.boostPositionWithLynxBurn(wallet, req.params.id, body.lynxAmount);
    await persist();
    emit('market:updated', result.market);
    emitPortfolioUpdated(wallet, result.portfolio);
    res.json(result);
  } finally {
    await releaseLock(boostLockKey);
  }
}));

app.delete('/api/orders/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // Distributed lock (audit BUG-1): cancelOrder reads order.status, refunds the
  // locked amount and flips it to CANCELLED. Two replicas cancelling the same
  // order could both refund before either writes CANCELLED — double refund.
  const cancelOrderLockKey = `cancel-order:${req.params.id}`;
  if (!(await acquireLock(cancelOrderLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent cancel in progress. Please retry.' });
    return;
  }
  try {
    const result = store.cancelOrder(wallet, req.params.id);
    await persist();
    const cancelledOrder = store.orders.get(req.params.id);
    emit('orderbook:updated', store.getOrderBook(cancelledOrder?.pair ?? 'LYNX/SOL', cancelledOrder?.marketId));
    emitPortfolioUpdated(wallet, result.portfolio);
    res.json(result);
  } finally {
    await releaseLock(cancelOrderLockKey);
  }
}));

app.post('/api/staking/stake', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // Distributed lock (audit BUG-1): stake/unstake/claim all read-modify-write the
  // same wallet's staked/rewards balance, so they share one lock per wallet.
  const stakeLockKey = `staking:${wallet}`;
  if (!(await acquireLock(stakeLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent staking operation in progress. Please retry.' });
    return;
  }
  try {
    const portfolio = store.stake(wallet, body.amount);
    await persist();
    emitPortfolioUpdated(wallet, portfolio);
    res.json(portfolio);
  } finally {
    await releaseLock(stakeLockKey);
  }
}));

app.post('/api/staking/unstake', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const unstakeLockKey = `staking:${wallet}`;
  if (!(await acquireLock(unstakeLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent staking operation in progress. Please retry.' });
    return;
  }
  try {
    const portfolio = store.unstake(wallet, body.amount);
    await persist();
    emitPortfolioUpdated(wallet, portfolio);
    res.json(portfolio);
  } finally {
    await releaseLock(unstakeLockKey);
  }
}));

app.post('/api/staking/claim', tradingRateLimit, walletTradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const claimRewardsLockKey = `staking:${wallet}`;
  if (!(await acquireLock(claimRewardsLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent staking operation in progress. Please retry.' });
    return;
  }
  try {
    const result = store.claimRewards(wallet);
    await persist();
    emitPortfolioUpdated(wallet, result.portfolio);
    res.json(result);
  } finally {
    await releaseLock(claimRewardsLockKey);
  }
}));

app.get('/api/proposals', (_req, res) => {
  res.json(store.listProposals());
});

app.post('/api/proposals', asyncRoute(async (req, res) => {
  if (!requireAdminSessionOnly(req, res)) return;
  const body = z.object({
    title: z.string().min(4),
    description: z.string().optional(),
    category: z.enum(['protocol', 'markets', 'fees', 'community', 'general']).optional(),
    author: z.string().optional()
  }).parse(req.body);
  // 'general' is a legacy alias for 'community'
  const category = body.category === 'general' ? 'community' : body.category;
  const proposal = store.createProposal({ title: body.title, description: body.description, category, author: body.author });
  await persist();
  emit('dao:proposal-created', proposal);
  res.status(201).json(proposal);
}));

app.get('/api/daostats', (_req, res) => {
  res.json(store.getDaoStats());
});

app.post('/api/proposals/:id/vote', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    voteType: z.enum(['yes', 'no'])
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return; // requireWalletBody already sent the 400
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // Distributed lock (audit BUG-1): serialize a wallet's vote on a proposal so a
  // double-submit from two replicas can't both pass the "already voted" check.
  const voteLockKey = `vote:${req.params.id}:${wallet}`;
  if (!(await acquireLock(voteLockKey, 10_000))) {
    res.status(409).json({ error: 'Concurrent vote in progress. Please retry.' });
    return;
  }
  try {
    const proposal = await store.castVote({ wallet, proposalId: req.params.id, voteType: body.voteType }, persistence.recordVote);
    await persist();
    emit('dao:proposal-updated', proposal);
    res.json(proposal);
  } finally {
    await releaseLock(voteLockKey);
  }
}));

// ==================== ADMIN ENDPOINTS ====================

app.get('/api/chart/klines', (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'LYNX';
  const interval = typeof req.query.interval === 'string' ? req.query.interval : '1d';
  const rawLimit = parseInt(req.query.limit as string, 10);
  const limit = isNaN(rawLimit) ? 100 : Math.min(Math.max(rawLimit, 1), 500);
  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  res.json(store.klines(symbol, interval, limit, marketId));
});

app.get('/api/notifications', (req, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  res.json(store.listNotifications(wallet));
});

app.post('/api/notifications/read', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const user = currentUser(req as any);
  const wallet = user?.walletAddress ?? user?.managedWalletAddress;
  if (!wallet) {
    res.status(400).json({ error: 'No wallet associated with this account' });
    return;
  }
  const id = typeof req.body.id === 'string' ? req.body.id : undefined;
  const notifications = store.markNotificationsRead(wallet, id);
  await persist();
  res.json(notifications);
}));

app.post('/api/transactions', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const intent = req.body || {};
  try { if ((req as any).log) (req as any).log.info({ intent }, 'tx:intent'); } catch { logger.info({ requestId: (req as any).id, intent }, 'tx:intent'); }
  if (intent.signature) {
    const link = `https://explorer.solana.com/tx/${intent.signature}?cluster=${process.env.SOLANA_CLUSTER || 'devnet'}`;
    try { if ((req as any).log) (req as any).log.info({ signature: intent.signature, link }, 'tx:signature'); } catch { logger.info({ requestId: (req as any).id, signature: intent.signature, link }, 'tx:signature'); }
    // persist signature in store and emit socket event
    try {
      store.addTransaction({ signature: intent.signature, wallet: typeof intent.wallet === 'string' ? intent.wallet : undefined, intent });
      emitToWallet(intent.wallet, 'crypto:tx', { signature: intent.signature, wallet: intent.wallet, link, timestamp: Date.now() });
      await persist();
    } catch (e) {
      try { if ((req as any).log) (req as any).log.error({ err: e }, 'Failed to persist tx'); } catch { logger.error({ requestId: (req as any).id, err: e }, 'Failed to persist tx'); }
    }
  }
  res.json({
    success: true,
    mode: 'registered-intent',
    message: 'Transaction intent registered in the Lynx backend indexer.',
    intent
  });
}));

app.get('/api/transactions', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  try {
    const list = store.listTransactionsForWallet(wallet);
    res.json(list);
  } catch {
    res.status(500).json({ error: 'Failed to list transactions' });
  }
});

app.post('/api/dev/reset', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Development reset is disabled in production' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  store.seed();
  await persist();
  emit('dev:reset', { ok: true });
  res.json({ ok: true });
}));

// Sentry v8: register error handler after all routes, before the generic Express error handler
Sentry.setupExpressErrorHandler(app);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Camino explícito y NO frágil: un error que declara su propio código HTTP
  // (ver backend/src/errors.ts). El código nuevo debe lanzar un DomainError en
  // vez de confiar en el match por texto de más abajo. Informe BAJA-3.
  if (error instanceof DomainError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error.message }, 'unhandled-error');
      res.status(error.statusCode).json({ error: error.expose ? error.message : 'Internal Server Error' });
      return;
    }
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  const rawMessage = error instanceof Error ? error.message : 'Internal Server Error';
  const normalizedMessage = rawMessage.toLowerCase();
  // Fallback LEGACY: infiere el status del texto del mensaje. Frágil por diseño
  // (ver comentario y errors.ts); se mantiene solo para los muchos throws de
  // string ya existentes y debería ir retirándose a favor de DomainError.
  const status = error instanceof ZodError
    ? 400
    : normalizedMessage.includes('not found')
      ? 404
      : normalizedMessage.includes('insufficient') ||
          normalizedMessage.includes('closed') ||
          normalizedMessage.includes('not open') ||
          normalizedMessage.includes('cutoff') ||
          normalizedMessage.includes('only available') ||
          normalizedMessage.includes('must choose') ||
          normalizedMessage.includes('already') ||
          normalizedMessage.includes('does not belong') ||
          normalizedMessage.includes('did not win') ||
          normalizedMessage.includes('required') ||
          normalizedMessage.includes('invalid currency') ||
          normalizedMessage.includes('requires a') ||
          normalizedMessage.includes('cannot') ||
          normalizedMessage.includes('expired') ||
          // Business rules that previously fell through to 500 because their
          // wording happened to miss every pattern above: the LYNX burn-boost
          // path throws 'Not enough recent LYNX/SOL trading activity…' and
          // 'This position has no tracked SOL principal and is not eligible…'.
          // Both are ordinary user-facing rejections, but a 500 hid the reason
          // behind a generic 'Internal Server Error' and told the user nothing.
          //
          // FRAGILE BY DESIGN: mapping domain errors to HTTP status by grepping
          // their English prose means any new (or reworded) throw silently
          // becomes a 500. Two of the seven boost messages already fell through
          // that way. This should become an explicit DomainError type carrying
          // its own status; until then, every new throw must be checked against
          // this list.
          normalizedMessage.includes('not enough') ||
          normalizedMessage.includes('not eligible')
        ? 400
        : 500;
  // For 500s: log full details server-side, send only generic message to client
  // to avoid leaking Prisma/RPC internals to potential attackers.
  if (status === 500) {
    logger.error({ err: rawMessage }, 'unhandled-error');
    res.status(500).json({ error: 'Internal Server Error' });
    return;
  }
  res.status(status).json({ error: rawMessage });
});

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is required in production. Email verification and password reset cannot function without it.');
  }
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
    throw new Error(
      'REDIS_URL is required in production. Without it, distributed locks (market resolution, ' +
      'credit approvals, wallet-login signature replay protection, rate limiting) silently fall ' +
      'back to per-instance memory, reopening the exact race conditions they were built to close ' +
      'as soon as more than one backend replica is running.'
    );
  }
  // Fail fast, loudly, at boot rather than silently serving requests with an
  // HTTP-header auth bypass reachable. Belt-and-braces with isTestAuthBypass():
  // that helper already requires NODE_ENV==='test', but a process that has the
  // flag set while claiming to be anything other than a test run is misconfigured
  // badly enough that refusing to start is the only safe response.
  if (process.env.ALLOW_TEST_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'ALLOW_TEST_AUTH_BYPASS=true requires NODE_ENV=test. This flag enables an ' +
      'HTTP-header authentication bypass and must never be set outside the test suite.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const required = ['TREASURY_WALLET', 'TREASURY_SECRET_KEY', 'MANAGED_WALLET_SEED',
                      'JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGIN', 'APP_URL',
                      'ADMIN_WALLETS', 'REFRESH_SECRET'];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
    }
    // Validate ADMIN_WALLETS contains at least 2 valid base58 pubkeys
    const adminWalletsList = (process.env.ADMIN_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean);
    if (adminWalletsList.length < 2) {
      throw new Error('ADMIN_WALLETS must contain at least 2 comma-separated Solana wallet addresses in production');
    }
    for (const w of adminWalletsList) {
      try { new PublicKey(w); } catch {
        throw new Error(`ADMIN_WALLETS contains invalid Solana address: "${w.slice(0, 8)}..."`);
      }
    }
  }
  if (process.env.NODE_ENV === 'production' && persistence.driver !== 'prisma') {
    throw new Error('STORE_DRIVER must be "prisma" in production');
  }
  await persistence.load(store);
  await loadPersistedAuthUsers();
  await loadPendingCreditApprovalsFromRedis();
  await loadPendingMarketResolutionsFromRedis();
  ensureConfiguredAdminWalletUsers();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Lynx backend listening on http://0.0.0.0:${port}`);
  });
  startChainIndexer();

  // Periodic backup every 30 seconds — limits data loss window if the process dies unexpectedly
  const PERSIST_INTERVAL_MS = 30 * 1000;
  const periodicPersist = setInterval(async () => {
    try {
      await persist();
    } catch (err) {
      console.error('[periodic-persist] failed:', err);
    }
  }, PERSIST_INTERVAL_MS);
  periodicPersist.unref(); // don't block process exit

  // Graceful shutdown: flush state before the process exits
  const gracefulShutdown = async (signal: string) => {
    console.log(`[${signal}] Flushing state before exit...`);
    clearInterval(periodicPersist);
    try {
      await persist();
      console.log('[shutdown] State persisted.');
    } catch (err) {
      console.error('[shutdown] Failed to persist state:', err);
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref(); // force-exit after 5 s
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT',  () => gracefulShutdown('SIGINT'));
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((error) => {
    console.error('Failed to start Lynx backend:', error);
    process.exit(1);
  });
}

export { app, httpServer, store, emitToWallet };
