/**
 * onchainRoutes.ts
 *
 * Endpoints de solo lectura + sincronizacion sobre el indexador on-chain
 * (ver backend/src/chain.ts). El backend nunca firma ni mueve fondos de
 * trading de mercados de prediccion aqui: solo expone lo que ya esta en la
 * cadena para que el frontend lo muestre rapido.
 */

import { Router } from 'express';
import { redis } from './redisClient.js';
import {
  listIndexedMarkets,
  getIndexedMarket,
  listOpenOrdersForMarket,
  listPositionsForOwner,
  listOpenSpotOrders,
  listIndexedDuels,
  listIndexedDaoProposals,
  forceRefresh,
  getIndexerStatus,
} from './chain.js';

export const onchainRouter = Router();

/**
 * True once an indexed market's betting window has closed.
 *
 * Mirrors Store.isPastCutoff() for the on-chain side, and for the same reason:
 * the program refuses every entry once `now >= cutoff_ts`, so anything past it
 * must stop being advertised as bettable. The clock is checked directly rather
 * than trusting `status`, because the on-chain status only advances when
 * somebody cranks the permissionless cut_off_market() — which may never
 * happen, leaving markets reading `Active` months after they closed.
 */
function indexedMarketIsPastCutoff(market: { status: string; cutoffTs: number }, nowSec: number) {
  return (
    nowSec >= market.cutoffTs ||
    market.status === 'CutOff' ||
    market.status === 'PendingResolution' ||
    market.status === 'Resolved' ||
    market.status === 'Expired'
  );
}

onchainRouter.get('/api/onchain/status', (_req, res) => {
  res.json(getIndexerStatus());
});

// `includeFinished=true` returns the raw index (used for lookups and by the
// admin panel); the default is the bettable listing.
onchainRouter.get('/api/onchain/markets', (req, res) => {
  const all = listIndexedMarkets();
  if (req.query.includeFinished === 'true') { res.json({ data: all }); return; }
  const nowSec = Math.floor(Date.now() / 1000);
  res.json({ data: all.filter((m) => !indexedMarketIsPastCutoff(m, nowSec)) });
});

onchainRouter.get('/api/onchain/markets/:pubkey', (req, res) => {
  const market = getIndexedMarket(req.params.pubkey);
  if (!market) { res.status(404).json({ error: 'Market not found in on-chain index' }); return; }
  res.json(market);
});

onchainRouter.get('/api/onchain/markets/:pubkey/orders', (req, res) => {
  res.json({ data: listOpenOrdersForMarket(req.params.pubkey) });
});

onchainRouter.get('/api/onchain/positions', (req, res) => {
  const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  if (!owner) { res.status(400).json({ error: 'owner query param is required' }); return; }
  res.json({ data: listPositionsForOwner(owner) });
});

onchainRouter.get('/api/onchain/spot-orders', (_req, res) => {
  res.json({ data: listOpenSpotOrders() });
});

// This is the endpoint the duels UI actually reads (useProgram.fetchDuels
// prefers it and only falls back to /api/duels), so the cutoff filter has to
// live here too — filtering only the off-chain store would leave the grid
// showing Accept buttons for duels the program can no longer accept.
onchainRouter.get('/api/onchain/duels', (req, res) => {
  const all = listIndexedDuels();
  if (req.query.includeFinished === 'true') { res.json({ data: all }); return; }
  const nowSec = Math.floor(Date.now() / 1000);
  res.json({
    data: all.filter((d) => {
      if (d.status === 'Resolved' || d.status === 'Cancelled') return false;
      // A duel also dies on its own expiry, independently of its market.
      if (nowSec >= d.expiresTs) return false;
      const market = getIndexedMarket(d.parentMarket);
      if (!market) return false;
      return !indexedMarketIsPastCutoff(market, nowSec);
    }),
  });
});

onchainRouter.get('/api/onchain/dao-proposals', (_req, res) => {
  res.json({ data: listIndexedDaoProposals() });
});

// Llamado por el frontend justo despues de confirmar una transaccion propia,
// para refrescar el indexador ya (en vez de esperar al proximo poll
// periodico). No requiere autenticacion (no revela nada privado) pero
// si tiene throttle para evitar que un atacante fuerce llamadas RPC costosas.
// La autenticacion del frontend (JWT) ya protege contra uso anónimo masivo
// a traves de nginx; este es un segundo nivel de defensa.
// BE-H-05: Use Redis SET NX EX for distributed sync throttle.
const SYNC_MIN_INTERVAL_MS = 3_000; // max 1 forced refresh per 3 seconds
const SYNC_LOCK_KEY = 'onchain:sync:lock';

// In-memory fallback throttle — only effective within a single process, so it
// does NOT protect a multi-replica deployment (that needs REDIS_URL, see the
// BE-H-05 comment above). Used when Redis isn't configured, or when a Redis
// error prevents us from acquiring the distributed lock.
let lastSyncAt = 0;
function tryAcquireInMemorySyncLock(): boolean {
  const now = Date.now();
  if (now - lastSyncAt < SYNC_MIN_INTERVAL_MS) return false;
  lastSyncAt = now;
  return true;
}

onchainRouter.post('/api/onchain/sync', async (_req, res) => {
  // Try to acquire a distributed lock via Redis
  if (redis) {
    try {
      const result = await redis.set(SYNC_LOCK_KEY, '1', 'PX', SYNC_MIN_INTERVAL_MS, 'NX');
      if (!result) {
        res.status(429).json({ error: 'Sync too frequent, try again later' });
        return;
      }
    } catch {
      // Fall through to in-memory check below
      if (!tryAcquireInMemorySyncLock()) {
        res.status(429).json({ error: 'Sync too frequent, try again later' });
        return;
      }
    }
  } else {
    if (!tryAcquireInMemorySyncLock()) {
      res.status(429).json({ error: 'Sync too frequent, try again later' });
      return;
    }
  }
  // Express 4 does not catch rejections from async handlers, and this router is
  // mounted without the asyncRoute wrapper server.ts uses — an unhandled
  // rejection here would leave the request hanging with no response.
  try {
    await forceRefresh();
    res.json({ ok: true });
  } catch (err) {
    console.error('[onchain] forced refresh failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'On-chain refresh unavailable' });
  }
});