import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import morgan from 'morgan';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { DEV_WALLET } from './economy.js';
import { createPersistence } from './persistence.js';
import { LynxState } from './state.js';
import type { Currency, OrderSide, Position } from './types.js';
import { generateToken, verifyToken, hashPassword, hashPasswordSync, verifyPassword, extractToken } from './auth.js';
import { calculateSettlement, validateSettlement } from './settlement.js';

const app = express();
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

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
// lightweight structured logger (no external dependency)
const logger = {
  info: (obj: any, msg?: string) => console.log(JSON.stringify({ level: 'info', msg: msg || '', ...obj })),
  error: (obj: any, msg?: string) => console.error(JSON.stringify({ level: 'error', msg: msg || '', ...obj }))
};

// attach logger to request for handlers
app.use((req, _res, next) => {
  (req as any).log = logger;
  next();
});

// keep morgan for dev-friendly output if desired
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// attach a simple request logger for body/query
app.use((req, _res, next) => {
  try {
    (req as any).log.info({ query: req.query, body: req.body }, 'request:received');
  } catch (e) {
    // fallback
    logger.info({ method: req.method, path: req.path }, 'request:received');
  }
  next();
});

io.on('connection', (socket) => {
  socket.emit('lynx:hello', {
    ok: true,
    markets: store.listMarkets().length
  });
});

function emit(event: string, payload: unknown) {
  io.emit(event, payload);
}

async function persist() {
  await persistence.save(store);
}

function walletFromQuery(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : DEV_WALLET;
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

// ==================== AUTH UTILITIES ====================

// In-memory user store (replace with Prisma DB later)
interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName?: string;
  role: 'admin' | 'user';
}

const users = new Map<string, AuthUser>();

// Add default admin user for testing
const adminUser: AuthUser = {
  id: 'admin-1',
  email: 'admin@lynx.local',
  passwordHash: hashPasswordSync(process.env.DEV_ADMIN_PASSWORD || 'admin123'),
  displayName: 'Admin',
  role: 'admin'
};
users.set(adminUser.id, adminUser);

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
  return true;
}

function currentUser(req: any) {
  return req.user ? users.get(req.user.userId) : undefined;
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
  if (currentUser(req)?.role !== 'admin') {
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

function requireSignedIntent(req: express.Request, res: express.Response) {
  const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
  if (!signature) {
    res.status(400).json({ error: 'A wallet signature or on-chain transaction signature is required' });
    return false;
  }
  return true;
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

app.post('/auth/register', asyncRoute(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    displayName: z.string().optional()
  }).parse(req.body);

  // Check if user already exists
  const exists = [...users.values()].some(u => u.email === body.email);
  if (exists) {
    return res.status(400).json({ error: 'User already exists' });
  }

  // Hash password
  const passwordHash = await hashPassword(body.password);

  // Create user
  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user: AuthUser = {
    id: userId,
    email: body.email,
    passwordHash,
    displayName: body.displayName || body.email.split('@')[0],
    role: 'user'
  };

  users.set(userId, user);

  // Generate token
  const token = generateToken({ userId, email: user.email, role: user.role });

  res.status(201).json({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    token
  });
}));

app.post('/auth/login', asyncRoute(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string()
  }).parse(req.body);

  // Find user by email
  const user = [...users.values()].find(u => u.email === body.email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Verify password
  const isValid = await verifyPassword(body.password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Generate token
  const token = generateToken({ userId: user.id, email: user.email, role: user.role });

  res.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    token
  });
}));

app.get('/auth/me', (req: any, res) => {
  if (!requireAuth(req, res)) return;

  const user = users.get(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role
  });
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

app.get('/api/markets', (_req, res) => {
  res.json(store.listMarkets());
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
    id: body.id || `market-${Date.now()}`,
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

app.post('/api/markets/:id/trades', asyncRoute(async (req, res) => {
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
  res.json(store.listDuels(parentMarketId));
});

app.post('/api/duels', asyncRoute(async (req, res) => {
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
  const duel = store.acceptDuel({ wallet, duelId: req.params.id, side: body.side });
  await persist();
  emit('duel:accepted', duel);
  res.json(duel);
}));

app.get('/api/orderbook', (req, res) => {
  const pair = typeof req.query.pair === 'string' ? req.query.pair : 'LYNX/SOL';
  const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  res.json(store.getOrderBook(pair, marketId));
});

app.post('/api/orders', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    wallet: z.string(),
    marketId: z.string().optional(),
    pair: z.string().default('LYNX/SOL'),
    side: sideSchema,
    position: positionSchema.optional(),
    amount: z.number().positive(),
    price: z.number().positive(),
    currency: currencySchema.default('LYNX')
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;

  const result = store.placeOrder({
    wallet,
    marketId: body.marketId,
    pair: body.pair,
    side: body.side as OrderSide,
    position: body.position as Position | undefined,
    amount: body.amount,
    price: body.price,
    currency: body.currency as Currency
  });
  await persist();
  emit('orderbook:updated', result.orderbook);
  res.status(201).json(result);
}));

app.get('/api/portfolio', (req, res) => {
  res.json(store.getPortfolio(walletFromQuery(req.query.wallet)));
});

app.get('/api/ledger', (req, res) => {
  res.json(store.listLedger(walletFromQuery(req.query.wallet)));
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
    reference: z.string().optional()
  }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet) return;
  const result = store.deposit({
    wallet,
    currency: body.currency,
    amount: body.amount,
    provider: body.provider,
    reference: body.reference
  });
  await persist();
  emit('ledger:deposit', { wallet, result });
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
  const result = store.withdraw({
    wallet,
    currency: body.currency,
    amount: body.amount,
    reference: body.reference
  });
  await persist();
  emit('ledger:withdrawal', { wallet, result });
  res.json(result);
}));

app.get('/api/positions', (req, res) => {
  res.json(store.listPositions(walletFromQuery(req.query.wallet)));
});

app.post('/api/positions/:id/claim', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  const result = store.claimPosition(wallet, req.params.id);
  await persist();
  emit('portfolio:updated', { wallet, portfolio: result.portfolio });
  res.json(result);
}));

app.delete('/api/orders/:id', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const wallet = walletFromQuery(req.query.wallet);
  if (!requireApprovedWallet(res, wallet)) return;
  const result = store.cancelOrder(wallet, req.params.id);
  await persist();
  emit('orderbook:updated', store.getOrderBook('LYNX/SOL'));
  emit('portfolio:updated', { wallet, portfolio: result.portfolio });
  res.json(result);
}));

app.post('/api/staking/stake', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  const portfolio = store.stake(wallet, body.amount);
  await persist();
  emit('portfolio:updated', { wallet, portfolio });
  res.json(portfolio);
}));

app.post('/api/staking/unstake', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string(), amount: z.number().positive() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  const portfolio = store.unstake(wallet, body.amount);
  await persist();
  emit('portfolio:updated', { wallet, portfolio });
  res.json(portfolio);
}));

app.post('/api/staking/claim', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({ wallet: z.string() }).parse(req.body);
  const wallet = requireWalletBody(req, res, body.wallet);
  if (!wallet || !requireApprovedWallet(res, wallet)) return;
  const result = store.claimRewards(wallet);
  await persist();
  emit('portfolio:updated', { wallet, portfolio: result.portfolio });
  res.json(result);
}));

app.get('/api/proposals', (_req, res) => {
  res.json(store.listProposals());
});

app.post('/api/proposals', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = z.object({
    title: z.string().min(4),
    description: z.string().optional(),
    category: z.string().optional(),
    author: z.string().optional()
  }).parse(req.body);
  const proposal = store.createProposal({ title: body.title, description: body.description, category: body.category, author: body.author });
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
  const proposal = store.castVote({ wallet, proposalId: req.params.id, voteType: body.voteType });
  await persist();
  emit('dao:proposal-updated', proposal);
  res.json(proposal);
}));

// ==================== ADMIN ENDPOINTS ====================

app.get('/api/chart/klines', (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'LYNX';
  const interval = typeof req.query.interval === 'string' ? req.query.interval : '1d';
  const limit = Number(req.query.limit || 100);
  res.json(store.klines(symbol, interval, limit));
});

app.get('/api/notifications', (req, res) => {
  res.json(store.listNotifications(walletFromQuery(req.query.wallet)));
});

app.post('/api/notifications/read', asyncRoute(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const wallet = typeof req.body.wallet === 'string' ? req.body.wallet : DEV_WALLET;
  const id = typeof req.body.id === 'string' ? req.body.id : undefined;
  const notifications = store.markNotificationsRead(wallet, id);
  await persist();
  res.json(notifications);
}));

app.post('/api/transactions', asyncRoute(async (req, res) => {
  const intent = req.body || {};
  try { (req as any).log && (req as any).log.info({ intent }, 'tx:intent'); } catch (e) { logger.info({ intent }, 'tx:intent'); }
  if (intent.signature) {
    const link = `https://explorer.solana.com/tx/${intent.signature}?cluster=${process.env.SOLANA_CLUSTER || 'devnet'}`;
    try { (req as any).log && (req as any).log.info({ signature: intent.signature, link }, 'tx:signature'); } catch (e) { logger.info({ signature: intent.signature, link }, 'tx:signature'); }
    // persist signature in store and emit socket event
    try {
      store.addTransaction({ signature: intent.signature, wallet: typeof intent.wallet === 'string' ? intent.wallet : undefined, intent });
      emit('crypto:tx', { signature: intent.signature, wallet: intent.wallet, link, timestamp: Date.now() });
      await persist();
    } catch (e) {
      try { (req as any).log && (req as any).log.error({ err: e }, 'Failed to persist tx'); } catch (err2) { logger.error({ err: e }, 'Failed to persist tx'); }
    }
  }
  res.json({
    success: true,
    mode: 'registered-intent',
    message: 'Transaction intent registered in the Lynx backend indexer.',
    intent
  });
}));

app.get('/api/transactions', (req, res) => {
  try {
    const list = store.listTransactions();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list transactions' });
  }
});

app.post('/api/dev/reset', asyncRoute(async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Development reset is disabled in production' });
    return;
  }
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
  await persistence.load(store);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Lynx backend listening on http://0.0.0.0:${port}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((error) => {
    console.error('Failed to start Lynx backend:', error);
    process.exit(1);
  });
}

export { app, httpServer, store };
