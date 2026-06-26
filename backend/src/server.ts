import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { createHash, randomBytes, randomUUID } from 'crypto';
import morgan from 'morgan';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { DEV_WALLET, TREASURY_WALLET, SOLANA_RPC_URL } from './economy.js';
import { createPersistence } from './persistence.js';
import { LynxState } from './state.js';
import type { Currency, OrderSide, Position } from './types.js';
import { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken, hashPassword, hashPasswordSync, verifyPassword, extractToken } from './auth.js';

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const port = Number(process.env.PORT || 4000);
const store = new LynxState();
const persistence = createPersistence();

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

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.devnet.solana.com", "wss:"],
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
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      return;
    }
    next();
  });
}

app.use(cors({ origin: corsOrigins, credentials: true }));
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
    (req as any).log.info({ query: req.query, body: safeBody }, 'request:received');
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
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'ADMIN_API_TOKEN is required in production' });
      return false;
    }
    return true;
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
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      if (attempts.size > 50_000) {
        for (const [k, v] of attempts) {
          if (v.resetAt <= now) attempts.delete(k);
        }
      }
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
  if (configuredToken && (bearerToken === configuredToken || headerToken === configuredToken)) {
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

function requireSignedIntent(req: express.Request, res: express.Response) {
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

  if (store.hasTransaction(signature)) {
    return { ok: false, error: 'This transaction signature has already been used' };
  }

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
    (req as any).log.info({
      email: user.email,
      verificationToken: process.env.NODE_ENV === 'production' ? '[redacted]' : user.emailVerificationToken
    }, 'auth:email-verification-required');
    return res.status(201).json({
      requiresEmailVerification: true,
      email: user.email,
      devVerificationToken: process.env.NODE_ENV === 'production' ? undefined : user.emailVerificationToken
    });
  }

  res.status(201).json({
    user: publicUser(user),
    token: generateToken({ userId, email: user.email, role: user.role }),
    refreshToken: generateRefreshToken(userId)
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

  res.json({
    user: publicUser(user),
    token: generateToken({ userId: user.id, email: user.email, role: user.role }),
    refreshToken: generateRefreshToken(user.id)
  });
}));

app.post('/auth/verify-email', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({
    token: z.string().min(12)
  }).parse(req.body);

  const user = [...users.values()].find((candidate) => candidate.emailVerificationToken === body.token);
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

  res.json({
    user: publicUser(user),
    token: generateToken({ userId: user.id, email: user.email, role: user.role }),
    refreshToken: generateRefreshToken(user.id)
  });
}));

app.post('/auth/request-password-reset', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const user = users.get(usersByEmail.get(body.email.toLowerCase()) ?? '');
  if (user && user.authMethod === 'email') {
    user.passwordResetToken = token('reset');
    user.passwordResetExpiresAt = Date.now() + 1000 * 60 * 30;
    await persistAuthUsers();
    (req as any).log.info({
      email: user.email,
      resetToken: process.env.NODE_ENV === 'production' ? '[redacted]' : user.passwordResetToken
    }, 'auth:password-reset-requested');
  }
  res.json({
    ok: true,
    devResetToken: process.env.NODE_ENV === 'production' ? undefined : user?.passwordResetToken
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

  if (!verifyWalletSignature(body.wallet, body.signatureMessage, body.signature)) {
    return res.status(401).json({ error: 'Wallet signature verification failed' });
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
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    user: publicUser(user),
    token,
    refreshToken,
  });
}));

app.post('/auth/refresh', maybeAuthRateLimit, asyncRoute(async (req, res) => {
  const body = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  const payload = verifyRefreshToken(body.refreshToken);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
  const user = users.get(payload.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({
    token: generateToken({ userId: user.id, email: user.email, role: user.role }),
    refreshToken: generateRefreshToken(user.id),
  });
}));

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
  res.json({
    status: 'ok',
    service: 'lynx-backend',
    store: persistence.driver,
    solanaCluster: process.env.SOLANA_CLUSTER || 'devnet',
    programId: process.env.PROGRAM_ID || null
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

app.get('/api/markets', (req, res) => {
  const includeFinished = req.query.includeFinished === 'true';
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const all = store.listMarkets(includeFinished);
  res.json({
    data: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset
  });
});

app.get('/api/markets/:id', (req, res) => {
  res.json(store.getMarket(req.params.id));
});

app.post('/api/markets', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;

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
    onChainMarket: z.string().optional()
  }).parse(req.body);

  if (!requireSignedIntent(req, res)) return;

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
    onChainMarket: body.onChainMarket || body.signature,
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

app.post('/api/markets/:id/trades', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    amount: z.number().positive(),
    position: positionSchema,
    tradeType: z.enum(['limit', 'swap', 'market']).default('swap'),
    limitPrice: z.number().positive().optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;

  const result = store.executePredictionTrade({
    wallet,
    marketId: req.params.id,
    amount: body.amount,
    position: body.position,
    tradeType: body.tradeType,
    limitPrice: body.limitPrice
  });
  await persist();
  emit('market:updated', 'market' in result ? result.market : store.getMarket(req.params.id));
  res.json(result);
}));

app.post('/api/admin/markets/:id/resolve', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const body = z.object({
    result: positionSchema,
    source: z.enum(['oracle', 'manual']).default('manual'),
    confirmation: z.string().optional()
  }).parse(req.body);

  if (body.source === 'manual' && body.confirmation !== `RESOLVE ${body.result}`) {
    res.status(400).json({ error: `Type RESOLVE ${body.result} to confirm` });
    return;
  }

  const market = store.resolveMarket({ marketId: req.params.id, result: body.result, source: body.source });
  await persist();
  emit('market:resolved', market);
  res.json({ ok: true, market });
}));

app.post('/api/admin/markets/:id/cutoff', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
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
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;

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
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const duel = store.acceptDuel({ wallet, duelId: req.params.id, side: body.side });
  await persist();
  emit('duel:accepted', duel);
  res.json(duel);
}));

app.delete('/api/duels/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const result = store.cancelDuel({ wallet, duelId: req.params.id });
  await persist();
  emit('duel:cancelled', result.duel);
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));


app.get('/api/orderbook', (req, res) => {
  const pair = typeof req.query.pair === 'string' ? req.query.pair : 'LYNX/SOL';
  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  res.json(store.getOrderBook(pair, marketId));
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
    tradeType: z.enum(['limit', 'market']).default('limit')
  }).refine((data) => data.tradeType === 'market' || typeof data.price === 'number', {
    message: 'price is required for limit orders',
    path: ['price']
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;

  const result = store.placeOrder({
    wallet,
    marketId: body.marketId,
    pair: body.pair,
    side: body.side as OrderSide,
    position: body.position as Position | undefined,
    amount: body.amount,
    price: body.price,
    currency: body.currency as Currency,
    tradeType: body.tradeType
  });
  await persist();
  emit('orderbook:updated', result.orderbook);
  res.status(201).json(result);
}));

app.get('/api/portfolio', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  res.json(store.getPortfolio(wallet));
});

app.get('/api/ledger', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
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
  if (!requireSignedIntent(req, res)) return;
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
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
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const isTestTreasuryFunding = process.env.NODE_ENV === 'test' && (wallet === (process.env.TREASURY_WALLET || 'LYNX_DEV_TREASURY'));
  if (!isTestTreasuryFunding && !requireApprovedWallet(res, wallet)) return;

  if (process.env.NODE_ENV !== 'test') {
    if (body.provider === 'EXTERNAL_WALLET') {
      // Real on-chain deposits must carry the confirmed transaction signature
      // and are verified against the Solana blockchain before crediting.
      if (!requireSignedIntent(req, res)) return;
      if (body.currency !== 'SOL') {
        res.status(400).json({ error: 'Only SOL deposits can currently be verified on-chain' });
        return;
      }
      const verification = await verifyOnChainSolDeposit({
        signature: body.signature!,
        fromWallet: wallet,
        amountSol: body.amount
      });
      if (!verification.ok) {
        res.status(400).json({ error: verification.error });
        return;
      }
    } else {
      // INTERNAL / CARD deposits have no on-chain proof attached to them, so
      // they must never be reachable by a regular authenticated user — only
      // trusted server-side flows (e.g. an admin grant or a verified payment
      // webhook) may credit a balance this way.
      if (!requireAdmin(req, res)) return;
    }
  }

  const result = store.deposit({
    wallet,
    currency: body.currency,
    amount: body.amount,
    provider: body.provider,
    reference: body.reference
  });
  if (body.signature) {
    store.addTransaction({ signature: body.signature, wallet, intent: { type: 'DEPOSIT', currency: body.currency, amount: body.amount, provider: body.provider } });
  }
  await persist();
  emit('ledger:deposit', { wallet, ledgerEntry: result.ledgerEntry });
  emitPortfolioUpdated(wallet, result.portfolio);
  res.status(201).json(result);
}));

app.post('/api/ledger/withdraw', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    currency: currencySchema,
    amount: z.number().positive(),
    reference: z.string().optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  let withdrawalSignature: string | undefined;
  if (process.env.NODE_ENV !== 'test' && body.currency === 'SOL') {
    // Real SOL withdrawals must actually leave the treasury on-chain before
    // the internal balance is debited — without this, the withdrawal was
    // only ever an internal bookkeeping entry with no funds ever sent.
    if (store.getWallet(wallet).solBalance < body.amount) {
      res.status(400).json({ error: 'Insufficient SOL balance' });
      return;
    }
    const onChainResult = await sendOnChainSolWithdrawal({ toWallet: wallet, amountSol: body.amount });
    if (!onChainResult.ok) {
      res.status(400).json({ error: onChainResult.error });
      return;
    }
    withdrawalSignature = onChainResult.signature;
  }
  const result = store.withdraw({
    wallet,
    currency: body.currency,
    amount: body.amount,
    reference: body.reference
  });
  if (withdrawalSignature) {
    store.addTransaction({ signature: withdrawalSignature, wallet, intent: { type: 'WITHDRAWAL', currency: body.currency, amount: body.amount } });
  }
  await persist();
  emit('ledger:withdrawal', { wallet, ledgerEntry: result.ledgerEntry, signature: withdrawalSignature });
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json({ ...result, signature: withdrawalSignature });
}));

app.get('/api/positions', (req: any, res) => {
  const wallet = walletFromQuery(req, res);
  if (!wallet) return;
  if (!requireAuthMatchesWallet(req, res, wallet)) return;
  res.json(store.listPositions(wallet));
});

app.post('/api/positions/:id/claim', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const result = store.claimPosition(wallet, req.params.id);
  await persist();
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));

app.delete('/api/orders/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const result = store.cancelOrder(wallet, req.params.id);
  await persist();
  emit('orderbook:updated', store.getOrderBook('LYNX/SOL'));
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));

app.post('/api/staking/stake', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const portfolio = store.stake(wallet, body.amount);
  await persist();
  emitPortfolioUpdated(wallet, portfolio);
  res.json(portfolio);
}));

app.post('/api/staking/unstake', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const portfolio = store.unstake(wallet, body.amount);
  await persist();
  emitPortfolioUpdated(wallet, portfolio);
  res.json(portfolio);
}));

app.post('/api/staking/claim', tradingRateLimit, asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const result = store.claimRewards(wallet);
  await persist();
  emitPortfolioUpdated(wallet, result.portfolio);
  res.json(result);
}));

app.get('/api/proposals', (_req, res) => {
  res.json(store.listProposals());
});

app.post('/api/proposals', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV !== 'test' && !requireAdmin(req, res)) return;
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
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
  const proposal = store.castVote({ wallet, proposalId: req.params.id, voteType: body.voteType });
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
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
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
  if (process.env.NODE_ENV !== 'test' && !requireAuth(req, res)) return;
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
  if (process.env.NODE_ENV !== 'test' && !requireAuthMatchesWallet(req, res, wallet)) return;
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
  if (process.env.NODE_ENV !== 'test' && !requireAdmin(req, res)) return;
  store.seed();
  await persist();
  emit('dev:reset', { ok: true });
  res.json({ ok: true });
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const normalizedMessage = message.toLowerCase();
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
  res.status(status).json({ error: message });
});

async function start() {
  if (process.env.NODE_ENV === 'production') {
    const required = ['TREASURY_WALLET', 'TREASURY_SECRET_KEY', 'MANAGED_WALLET_SEED',
                      'JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGIN'];
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
