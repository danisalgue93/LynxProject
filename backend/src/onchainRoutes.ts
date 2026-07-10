/**
 * onchainRoutes.ts
 *
 * Endpoints de solo lectura + sincronizacion sobre el indexador on-chain
 * (ver backend/src/chain.ts). El backend nunca firma ni mueve fondos de
 * trading de mercados de prediccion aqui: solo expone lo que ya esta en la
 * cadena para que el frontend lo muestre rapido.
 */

import { Router } from 'express';
import {
  listIndexedMarkets,
  getIndexedMarket,
  listOpenOrdersForMarket,
  listPositionsForOwner,
  listOpenSpotOrders,
  forceRefresh,
  getIndexerStatus,
} from './chain.js';

export const onchainRouter = Router();

onchainRouter.get('/api/onchain/status', (_req, res) => {
  res.json(getIndexerStatus());
});

onchainRouter.get('/api/onchain/markets', (_req, res) => {
  res.json({ data: listIndexedMarkets() });
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

// Llamado por el frontend justo despues de confirmar una transaccion propia,
// para refrescar el indexador ya (en vez de esperar al proximo poll
// periodico). No requiere autenticacion (no revela nada privado) pero
// si tiene throttle para evitar que un atacante fuerce llamadas RPC costosas.
// La autenticacion del frontend (JWT) ya protege contra uso anónimo masivo
// a traves de nginx; este es un segundo nivel de defensa.
let lastSyncAt = 0;
const SYNC_MIN_INTERVAL_MS = 3_000; // max 1 forced refresh per 3 seconds
onchainRouter.post('/api/onchain/sync', async (_req, res) => {
  const now = Date.now();
  if (now - lastSyncAt < SYNC_MIN_INTERVAL_MS) {
    res.status(429).json({ error: 'Sync too frequent, try again later' });
    return;
  }
  lastSyncAt = now;
  await forceRefresh();
  res.json({ ok: true });
});
