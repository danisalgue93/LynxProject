import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import morgan from 'morgan';
import { Server } from 'socket.io';
import { z } from 'zod';
import { DEV_WALLET } from './economy.js';
import { createPersistence } from './persistence.js';
import { LynxState } from './state.js';
import type { Currency, OrderSide, Position } from './types.js';

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

function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const positionSchema = z.enum(['YES', 'NO', 'A', 'B', 'DRAW']);
const currencySchema = z.enum(['SOL', 'LYNX']);
const sideSchema = z.enum(['BUY', 'SELL']);

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
  const body = z.object({
    id: z.string().optional(),
    title: z.string().min(4),
    description: z.string().default(''),
    category: z.string().default('General'),
    currency: currencySchema.default('SOL'),
    isTernary: z.boolean().default(false),
    oracleId: z.string().default('manual:dev'),
    cutoffAt: z.number().optional(),
    resolveAt: z.number().optional()
  }).parse(req.body);

  const now = Date.now();
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
    createdAt: now,
    cutoffAt: body.cutoffAt || now + 1000 * 60 * 60 * 24,
    resolveAt: body.resolveAt || now + 1000 * 60 * 60 * 30,
    oracleDeadline: (body.resolveAt || now + 1000 * 60 * 60 * 30) + 1000 * 60 * 60
  };
  store.addMarket(market);
  await persist();
  emit('market:created', market);
  res.status(201).json(market);
}));

app.post('/api/markets/:id/trades', asyncRoute(async (req, res) => {
  const body = z.object({
    wallet: z.string().optional(),
    amount: z.number().positive(),
    position: positionSchema,
    tradeType: z.enum(['limit', 'swap', 'market']).default('swap'),
    limitPrice: z.number().positive().optional()
  }).parse(req.body);

  const result = store.executePredictionTrade({
    wallet: body.wallet || DEV_WALLET,
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

app.get('/api/duels', (req, res) => {
  const parentMarketId = typeof req.query.marketId === 'string' ? req.query.marketId : undefined;
  res.json(store.listDuels(parentMarketId));
});

app.post('/api/duels', asyncRoute(async (req, res) => {
  const body = z.object({
    wallet: z.string().optional(),
    marketId: z.string(),
    side: positionSchema,
    amount: z.number().positive(),
    type: z.enum(['1v1', '1v1vP']).optional()
  }).parse(req.body);

  const duel = store.createDuel({
    wallet: body.wallet || DEV_WALLET,
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
  const body = z.object({
    wallet: z.string().optional(),
    side: positionSchema.optional()
  }).parse(req.body);
  const duel = store.acceptDuel({ wallet: body.wallet || DEV_WALLET, duelId: req.params.id, side: body.side });
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
  const body = z.object({
    wallet: z.string().optional(),
    marketId: z.string().optional(),
    pair: z.string().default('LYNX/SOL'),
    side: sideSchema,
    position: positionSchema.optional(),
    amount: z.number().positive(),
    price: z.number().positive(),
    currency: currencySchema.default('LYNX')
  }).parse(req.body);

  const result = store.placeOrder({
    wallet: body.wallet || DEV_WALLET,
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

app.post('/api/staking/stake', asyncRoute(async (req, res) => {
  const body = z.object({ wallet: z.string().optional(), amount: z.number().positive() }).parse(req.body);
  const portfolio = store.stake(body.wallet || DEV_WALLET, body.amount);
  await persist();
  emit('portfolio:updated', { wallet: body.wallet || DEV_WALLET, portfolio });
  res.json(portfolio);
}));

app.post('/api/staking/unstake', asyncRoute(async (req, res) => {
  const body = z.object({ wallet: z.string().optional(), amount: z.number().positive() }).parse(req.body);
  const portfolio = store.unstake(body.wallet || DEV_WALLET, body.amount);
  await persist();
  emit('portfolio:updated', { wallet: body.wallet || DEV_WALLET, portfolio });
  res.json(portfolio);
}));

app.post('/api/staking/claim', asyncRoute(async (req, res) => {
  const body = z.object({ wallet: z.string().optional() }).parse(req.body);
  const result = store.claimRewards(body.wallet || DEV_WALLET);
  await persist();
  emit('portfolio:updated', { wallet: body.wallet || DEV_WALLET, portfolio: result.portfolio });
  res.json(result);
}));

app.get('/api/proposals', (_req, res) => {
  res.json(store.listProposals());
});

app.post('/api/proposals', asyncRoute(async (req, res) => {
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
  const body = z.object({
    wallet: z.string().optional(),
    voteType: z.enum(['yes', 'no'])
  }).parse(req.body);
  const proposal = store.castVote({ wallet: body.wallet || DEV_WALLET, proposalId: req.params.id, voteType: body.voteType });
  await persist();
  emit('dao:proposal-updated', proposal);
  res.json(proposal);
}));

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
  const wallet = typeof req.body.wallet === 'string' ? req.body.wallet : DEV_WALLET;
  const notifications = store.markNotificationsRead(wallet);
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
  store.seed();
  await persist();
  emit('dev:reset', { ok: true });
  res.json({ ok: true });
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const status = message.includes('not found') ? 404 : message.includes('Insufficient') || message.includes('closed') ? 400 : 500;
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
