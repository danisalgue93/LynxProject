// Sentry MUST be the very first import — instruments Express, Prisma, and async ops
import './instrument.js';
import { Sentry } from './instrument.js';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
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
import type { Currency, OrderSide, Position } from './types.js';
import { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken, hashPassword, hashPasswordSync, verifyPassword, extractToken } from './auth.js';
import { sendVerificationEmail, sendPasswordResetEmail, isEmailConfigured } from './email.js';
import { onchainRouter } from './onchainRoutes.js';
import { startChainIndexer, getIndexedMarket, listOpenOrdersForMarket, listPositionsForOwner, listOpenSpotOrders, fromOnChainOutcomeName, verifyOnChainMarketCreation } from './chain.js';
import { proposeCredit, approveCredit, getCreditRequest, markExecuted, isReadyToExecute, listPendingCredits, proposeMarketResolution, approveMarketResolution, getMarketResolutionRequest, markResolutionExecuted, isResolutionReadyToExecute, listPendingMarketResolutions } from './creditApprovals.js';

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const port = Number(process.env.PORT || 4000);
const store = new LynxState();
const persistence = createPersistence();

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
  } catch (e) {
    // fallback
    logger.info({ requestId: (req as any).id, method: req.method, path: req.path }, 'request:received');
  }
  next();
});

io.on('connection', (socket) => {
  socket.emit('lynx:hello', {
    ok: true,
    markets: store.listMarkets(true).length
  });
  socket.on('identify', (wallet: unknown) => {
    if (typeof wallet === 'string' && wallet.trim()) {
      socket.join(`wallet:${wallet.trim()}`);
    }
  });
});

function emit(event: string, payload: unknown) {
  io.emit(event, payload);
}

function emitPortfolioUpdated(wallet: string, portfolio: unknown) {
  io.emit('portfolio:updated', { wallet });
  io.to(`wallet:${wallet}`).emit('portfolio:updated:private', { wallet, portfolio });
}

async function persist() {
  await persistence.save(store);
}

function walletFromQuery(req: express.Request, res: express.Response): string | null {
  const val = req.query.wallet;
  if (typeof val !== 'string' || !val.trim()) {
    res.status(400).json({ error: 'wallet query parameter is required' });
    return null;
  }
  return val.trim();
}

function requireAdminApiToken(req: express.Request, res: express.Response) {
  const configuredToken = process.env.ADMIN_API_TOKEN;
  if (!configuredToken) {
    // Fail closed by default. Only `test` is exempted — any other environment
    // (dev, staging, or a misconfigured/missing NODE_ENV in a real deployment)
    // must require the token, otherwise this opens admin routes to anyone
    // whenever NODE_ENV isn't exactly 'production'.
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    res.status(403).json({ error: 'ADMIN_API_TOKEN is required' });
    return false;
  }

  const auth = req.headers.authorization;
  const bearerToken = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : undefined;
  const headerToken = typeof req.headers['x-admin-api-token'] === 'string' ? req.headers['x-admin-api-token'] : undefined;
  if (bearerToken !== configuredToken && headerToken !== configuredToken) {
    res.status(401).json({ error: 'Unauthorized admin request' });
    return false;
  }
  return true;
}

function createSimpleRateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  // In-memory fallback — used when REDIS_URL is not configured (dev/test/single-instance)
  // and as a fail-open path if Redis is temporarily unreachable.
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
        .then((results) => {
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
        .catch((err) => {
          // Redis unreachable mid-flight — fail open to the in-memory limiter
          // rather than blocking all traffic on a transient infra issue.
          console.error('[rate-limit] redis error, falling back to memory:', err instanceof Error ? err.message : err);
          applyMemoryLimit(key, now, res, next);
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
// 60 trading actions per minute per IP — prevents bot spam while allowing normal use
const tradingRateLimit = createSimpleRateLimit({ windowMs: 60 * 1000, max: 60 });

// ==================== AUTH UTILITIES ====================

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
const adminWallets = (process.env.ADMIN_WALLETS || '')
  .split(',')
  .map((wallet) => wallet.trim())
  .filter(Boolean);
const adminWalletSet = new Set(adminWallets);
const requireEmailVerification = process.env.NODE_ENV !== 'test' && process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';
const configuredAdminPassword = process.env.ADMIN_PASSWORD
  ?? (process.env.NODE_ENV === 'production' ? undefined : process.env.DEV_ADMIN_PASSWORD);
const adminPassword = configuredAdminPassword ?? (process.env.NODE_ENV === 'test' ? 'admin123' : undefined);

if (process.env.NODE_ENV === 'production' && adminWallets.length < 2) {
  throw new Error('ADMIN_WALLETS must contain at least two admin wallets in production');
}
if (process.env.NODE_ENV === 'production' && adminPassword && !/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(adminPassword)) {
  throw new Error('ADMIN_PASSWORD must be at least 8 characters and include one uppercase letter and one number');
}

function token(prefix: string) {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

function managedWalletForUser(userId: string, email: string) {
  const digest = createHash('sha256').update(`${userId}:${email.toLowerCase()}`).digest('hex').slice(0, 32);
  return `MAGIC:${digest}`;
}

function isAdminWallet(wallet?: string) {
  return Boolean(wallet && adminWalletSet.has(wallet));
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

if (adminPassword) {
  const adminUser: AuthUser = {
    id: 'admin-1',
    email: 'admin@lynx.local',
    passwordHash: hashPasswordSync(adminPassword),
    displayName: 'Admin',
    role: 'admin',
    authMethod: 'email',
    emailVerified: true,
    managedWalletAddress: managedWalletForUser('admin-1', 'admin@lynx.local'),
    createdAt: Date.now()
  };
  users.set(adminUser.id, adminUser);
  usersByEmail.set(adminUser.email.toLowerCase(), adminUser.id);
}

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

async function persistAuthUsers() {
  await persistence.saveAuthUsers([...users.entries()]);
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

function requireAuth(req: any, res: express.Response) {
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
  if (req.app?.locals?.testBypassAuth === true) return true;
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
  const configuredToken = process.env.ADMIN_API_TOKEN;
  const auth = req.headers.authorization;
  const bearerToken = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : undefined;
  const headerToken = typeof req.headers['x-admin-api-token'] === 'string' ? req.headers['x-admin-api-token'] : undefined;
  // Use constant-time comparison to prevent timing attacks on the admin token
  const safeEqual = (a: string, b: string) => {
    try {
      return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch { return false; }
  };
  if (configuredToken && ((bearerToken !== undefined && safeEqual(bearerToken, configuredToken)) || (headerToken !== undefined && safeEqual(headerToken, configuredToken)))) {
    return true;
  }
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
  return normalized;
}

function verifyWalletSignature(wallet: string, signatureMessage: string, signature: string) {
  try {
    const pubkey = bs58.decode(wallet);
    const messageBytes = new TextEncoder().encode(signatureMessage);
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkey);
  } catch (err) {
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

  const accountKeys = tx.transaction.message.getAccountKeys
    ? tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).staticAccountKeys
    : (tx.transaction.message as any).accountKeys;
  const keys = accountKeys.map((k: PublicKey) => k.toBase58());

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

let treasuryKeypair: Keypair | null = null;
function getTreasuryKeypair(): Keypair {
  if (!treasuryKeypair) {
    const secret = process.env.TREASURY_SECRET_KEY;
    if (!secret) {
      throw new Error('TREASURY_SECRET_KEY must be set to send on-chain SOL withdrawals.');
    }
    treasuryKeypair = Keypair.fromSecretKey(bs58.decode(secret));
  }
  return treasuryKeypair;
}

/**
 * Managed accounts (email/Magic logins) are identified internally by a
 * `MAGIC:<digest>` string (see managedWalletForUser), which is not a real
 * Solana address and cannot receive an on-chain transfer. To let these
 * accounts withdraw real SOL, we deterministically derive a real Solana
 * keypair from that same managed id using a server-only seed, so the same
 * managed id always resolves to the same on-chain address.
 */
function deriveManagedWalletKeypair(managedId: string): Keypair {
  const seed = process.env.MANAGED_WALLET_SEED;
  if (!seed) {
    throw new Error('MANAGED_WALLET_SEED must be set to send on-chain SOL withdrawals for managed accounts.');
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
      ? deriveManagedWalletKeypair(toWallet).publicKey
      : new PublicKey(toWallet);
  } catch (err: any) {
    return { ok: false, error: toWallet.startsWith('MAGIC:') ? (err?.message || 'Managed wallet is not configured for on-chain withdrawals') : 'SOL withdrawals require a connected on-chain wallet address' };
  }

  let payer: Keypair;
  try {
    payer = getTreasuryKeypair();
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
  await persistAuthUsers();

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
      // Dev mode: no Resend configured — expose token in response so the flow can be tested
      logger.info({ email: user.email, verificationToken: user.emailVerificationToken }, 'email:no-resend-dev-token');
    }
    return res.status(201).json({
      requiresEmailVerification: true,
      email: user.email,
      // Only expose the token in development when Resend is not configured
      devVerificationToken: isEmailConfigured() ? undefined : user.emailVerificationToken,
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
      candidate.emailVerificationToken === body.token &&
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
  await persistAuthUsers();

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
    await persistAuthUsers();
    (req as any).log.info({ email: user.email }, 'auth:password-reset-requested');
    if (isEmailConfigured()) {
      sendPasswordResetEmail({ to: user.email, token: user.passwordResetToken }).catch((err) => {
        logger.error({ email: user.email, err: err?.message }, 'email:reset-send-failed');
      });
    } else {
      logger.info({ email: user.email, resetToken: user.passwordResetToken }, 'email:no-resend-dev-token');
    }
  }
  // Always return 200 to avoid user enumeration (don't reveal whether email exists)
  res.json({
    ok: true,
    // Only expose the token in development when Resend is not configured
    devResetToken: isEmailConfigured() ? undefined : user?.passwordResetToken,
  });
}));

app.post('/auth/reset-password', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    token: z.string().min(12),
    password: passwordSchema
  }).parse(req.body);

  const user = [...users.values()].find((candidate) =>
    candidate.passwordResetToken === body.token &&
    (candidate.passwordResetExpiresAt || 0) > Date.now()
  );
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired password reset token' });
  }

  user.passwordHash = await hashPassword(body.password);
  user.passwordResetToken = undefined;
  user.passwordResetExpiresAt = undefined;
  await persistAuthUsers();
  res.json({ ok: true });
}));

app.post('/auth/change-password', asyncRoute(async (req: any, res) => {
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
  await persistAuthUsers();
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
  const WALLET_LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  let parsedMsg: { app?: string; action?: string; wallet?: string; issuedAt?: string } | null = null;
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
  await persistAuthUsers();

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

app.post('/auth/logout', (_req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
});

app.get('/auth/me', (req: any, res) => {
  if (!requireAuth(req, res)) return;

  const user = users.get(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(publicUser(user));
});

app.post('/auth/link-wallet', asyncRoute(async (req: any, res) => {
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
  await persistAuthUsers();

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

app.post('/api/markets/:id/trades', tradingRateLimit, asyncRoute(async (req, res) => {
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
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

  purgeTradeIdempotencyCache();
  const idempotencyKey = body.clientRequestId ? `${wallet}:${req.params.id}:${body.clientRequestId}` : undefined;
  if (idempotencyKey) {
    const cached = tradeIdempotencyCache.get(idempotencyKey);
    if (cached) { res.json(cached.result); return; }
  }

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

  const market = store.resolveMarket({ marketId: req.params.id, result: request.result as any, source: 'manual' });
  markResolutionExecuted(request.id);
  await persist();
  emit('market:resolved', market);
  res.json({ ok: true, market, request });
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

app.post('/api/duels', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    marketId: z.string(),
    side: positionSchema,
    amount: z.number().positive(),
    type: z.enum(['1v1', '1v1vP']).optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

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
}));

app.post('/api/duels/:id/accept', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    side: positionSchema.optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const duel = store.acceptDuel({ wallet, duelId: req.params.id, side: body.side });
  await persist();
  emit('duel:accepted', duel);
  res.json(duel);
}));

app.delete('/api/duels/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const result = store.cancelDuel({ wallet, duelId: req.params.id });
  await persist();
  emit('duel:cancelled', result.duel);
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));


app.get('/api/orderbook', (req, res) => {
  const pair = typeof req.query.pair === 'string' ? req.query.pair : 'LYNX/SOL';
  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  const book = store.getOrderBook(pair, marketId);

  if (pair === 'LYNX/SOL' && !marketId) {
    const onChainSpotOrders = listOpenSpotOrders().map((o) => ({
      id: o.pubkey,
      owner: o.owner,
      side: o.side === 'Buy' ? 'BUY' : 'SELL',
      amount: Number(o.remaining) / 1_000_000,
      price: Number(o.priceScaled) / 1e12, // ver server.ts/frontend lynxProgram.ts: priceScaled -> SOL por LYNX
      createdAt: o.createdTs * 1000,
      onChain: true,
      onChainOrderPubkey: o.pubkey,
      currency: 'LYNX',
    }));
    book.bids = [...(book.bids || []), ...onChainSpotOrders.filter((o) => o.side === 'BUY')];
    book.asks = [...(book.asks || []), ...onChainSpotOrders.filter((o) => o.side === 'SELL')];
  }

  if (marketId) {
    const market = store.getMarket(marketId);
    if (market?.onChainMarket) {
      const onChainOrders = listOpenOrdersForMarket(market.onChainMarket).map((o) => ({
        id: o.pubkey,
        owner: o.owner,
        position: fromOnChainOutcomeName(o.outcome),
        amount: Number(o.amount) / (market.currency === 'LYNX' ? 1_000_000 : 1_000_000_000),
        price: o.limitPriceBps / 10_000,
        status: 'OPEN',
        createdAt: o.createdTs * 1000,
        onChain: true,
        onChainOrderPubkey: o.pubkey,
        onChainMarket: market.onChainMarket,
        currency: market.currency,
      }));
      // Las ordenes on-chain de mercados de prediccion no distinguen "bid/ask"
      // como el CLOB de LYNX/SOL (no hay contraparte, se llenan contra el pool):
      // las mostramos todas en bids para YES/A y asks para NO/B, que es lo que
      // consume el resto de la UI del orderbook para pintar dos columnas.
      book.bids = [...(book.bids || []), ...onChainOrders.filter((o: any) => o.position === 'YES' || o.position === 'DRAW')];
      book.asks = [...(book.asks || []), ...onChainOrders.filter((o: any) => o.position === 'NO')];
    }
  }

  res.json(book);
});

app.post('/api/orders', tradingRateLimit, asyncRoute(async (req, res) => {
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
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;

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
  const result = store.approveWallet(wallet, body.externalWallet);
  await persist();
  store.addTransaction({ signature: body.signature, wallet, intent: { type: 'APPROVE', message: body.signatureMessage } });
  emit('ledger:approved', { wallet, result });
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
  emit('ledger:deposit', { wallet, ledgerEntry: result.ledgerEntry });
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
    const request = proposeCredit({ wallet, currency: body.currency, amount: body.amount, reason: body.reason, proposedBy: adminId });
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

  const result = store.deposit({
    wallet: request.wallet,
    currency: request.currency,
    amount: request.amount,
    provider: 'INTERNAL',
    reference: `dual-approved:${request.id}:${request.reason}`,
  });
  markExecuted(request.id);
  await persist();
  emit('ledger:deposit', { wallet: request.wallet, ledgerEntry: result.ledgerEntry });
  emitPortfolioUpdated(request.wallet, result.portfolio);
  res.status(201).json({ request, result });
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
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  // On-chain LYNX (SPL) withdrawals are not yet implemented — only SOL is supported.
  // Blocking explicitly prevents an internal debit without an on-chain movement.
  if (body.currency === 'LYNX') {
    return res.status(501).json({ error: 'LYNX withdrawals are not yet available. Only SOL withdrawals are currently supported.' });
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
    emit('ledger:withdrawal', { wallet, ledgerEntry: withdrawalResult.ledgerEntry, signature: withdrawalSignature });
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
}));

app.get('/api/positions', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  const offChainPositions = store.listPositions(wallet);

  const onChainPositions = listPositionsForOwner(wallet)
    .filter((p) => !p.claimed)
    .map((p) => {
      const market = store.listMarkets(true).find((m: any) => m.onChainMarket === p.market);
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
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const result = store.claimPosition(wallet, req.params.id);
  await persist();
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));

app.post('/api/positions/:id/boost-with-lynx', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), lynxAmount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const result = store.boostPositionWithLynxBurn(wallet, req.params.id, body.lynxAmount);
  await persist();
  emit('market:updated', result.market);
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));

app.delete('/api/orders/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const result = store.cancelOrder(wallet, req.params.id);
  await persist();
  const cancelledOrder = store.orders.get(req.params.id);
  emit('orderbook:updated', store.getOrderBook(cancelledOrder?.pair ?? 'LYNX/SOL', cancelledOrder?.marketId));
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));

app.post('/api/staking/stake', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const portfolio = store.stake(wallet, body.amount);
  await persist();
  emitPortfolioUpdated(wallet, portfolio);
  res.json(portfolio);
}));

app.post('/api/staking/unstake', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const portfolio = store.unstake(wallet, body.amount);
  await persist();
  emitPortfolioUpdated(wallet, portfolio);
  res.json(portfolio);
}));

app.post('/api/staking/claim', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const result = store.claimRewards(wallet);
  await persist();
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
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
  if (!wallet) { res.status(400).json({ error: 'wallet is required' }); return; }
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  if (!requireApprovedWallet(res, wallet)) return;
  const proposal = await store.castVote({ wallet, proposalId: req.params.id, voteType: body.voteType }, persistence.recordVote);
  await persist();
  emit('dao:proposal-updated', proposal);
  res.json(proposal);
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
  try { (req as any).log && (req as any).log.info({ intent }, 'tx:intent'); } catch (e) { logger.info({ requestId: (req as any).id, intent }, 'tx:intent'); }
  if (intent.signature) {
    const link = `https://explorer.solana.com/tx/${intent.signature}?cluster=${process.env.SOLANA_CLUSTER || 'devnet'}`;
    try { (req as any).log && (req as any).log.info({ signature: intent.signature, link }, 'tx:signature'); } catch (e) { logger.info({ requestId: (req as any).id, signature: intent.signature, link }, 'tx:signature'); }
    // persist signature in store and emit socket event
    try {
      store.addTransaction({ signature: intent.signature, wallet: typeof intent.wallet === 'string' ? intent.wallet : undefined, intent });
      emit('crypto:tx', { signature: intent.signature, wallet: intent.wallet, link, timestamp: Date.now() });
      await persist();
    } catch (e) {
      try { (req as any).log && (req as any).log.error({ err: e }, 'Failed to persist tx'); } catch (err2) { logger.error({ requestId: (req as any).id, err: e }, 'Failed to persist tx'); }
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
    const list = store.listTransactions().filter((tx) => tx.wallet === wallet);
    res.json(list);
  } catch (e) {
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
  const rawMessage = error instanceof Error ? error.message : 'Internal Server Error';
  const normalizedMessage = rawMessage.toLowerCase();
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
          normalizedMessage.includes('expired')
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
  if (process.env.NODE_ENV === 'production') {
    const required = ['TREASURY_WALLET', 'TREASURY_SECRET_KEY', 'MANAGED_WALLET_SEED',
                      'JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGIN', 'APP_URL'];
    for (const key of required) {
      if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
    }
  }
  if (process.env.NODE_ENV === 'production' && persistence.driver !== 'prisma') {
    throw new Error('STORE_DRIVER must be "prisma" in production');
  }
  await persistence.load(store);
  await loadPersistedAuthUsers();
  ensureConfiguredAdminWalletUsers();
  await persistAuthUsers();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Lynx backend listening on http://0.0.0.0:${port}`);
  });
  startChainIndexer();

  // Periodic backup every 5 minutes — limits data loss window if the process dies unexpectedly
  const PERSIST_INTERVAL_MS = 5 * 60 * 1000;
  const periodicPersist = setInterval(async () => {
    try {
      await persist();
      await persistAuthUsers();
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
      await persistAuthUsers();
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

export { app, httpServer, store };
