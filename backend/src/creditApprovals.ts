/**
 * creditApprovals.ts
 *
 * Aprobacion dual (2 admins DISTINTOS) para cualquier acreditacion manual de
 * saldo (depositos INTERNAL/CARD sin prueba on-chain). Antes, un solo admin
 * -o el ADMIN_API_TOKEN compartido- podia acreditar cualquier monto a
 * cualquier wallet sin mas control (hallazgo A2 de la auditoria). Ahora hace
 * falta que DOS cuentas de admin distintas (nunca el token compartido)
 * propongan y aprueben antes de que el credito se ejecute de verdad, con
 * limite por solicitud y caducidad — el mismo espiritu que el multisig
 * on-chain para resolver mercados (ver AUDIT_REPORT / auditoria del
 * proyecto), aplicado aqui al lado off-chain.
 *
 * Pending credit approval requests and market resolutions are persisted in
 * Redis with a TTL of 24 hours so they survive server restarts.
 */

import { redis } from './redisClient.js';

export type CreditRequest = {
  id: string;
  wallet: string;
  currency: 'SOL' | 'LYNX';
  amount: number;
  reason: string;
  proposedBy: string; // user id del admin que propone
  approvals: string[]; // user ids de admins que aprobaron (nunca incluye al proponente)
  createdAt: number;
  expiresAt: number;
  executed: boolean;
  executedAt?: number;
};

const REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h para juntar la segunda aprobacion
const REQUEST_TTL_SECONDS = 24 * 60 * 60; // Redis TTL in seconds
const REQUIRED_APPROVALS = 2; // incluyendo al proponente => 1 propuesta + 1 aprobacion de OTRO admin
export const MAX_MANUAL_CREDIT_AMOUNT = {
  SOL: Number(process.env.MAX_MANUAL_CREDIT_SOL || 5),
  LYNX: Number(process.env.MAX_MANUAL_CREDIT_LYNX || 50_000),
};

// BE-19: Per-wallet daily credit limits to prevent incremental abuse.
// Tracks cumulative credited amounts per (wallet, currency, date).
const MAX_DAILY_CREDIT = {
  SOL: Number(process.env.MAX_DAILY_CREDIT_SOL || 10),
  LYNX: Number(process.env.MAX_DAILY_CREDIT_LYNX || 100_000),
};
const dailyCreditTracker = new Map<string, number>(); // "wallet:currency:YYYY-MM-DD" → cumulative amount

function getTodayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getDailyCreditKey(wallet: string, currency: string): string {
  return `${wallet}:${currency}:${getTodayDateKey()}`;
}

function purgeDailyCreditTracker() {
  const todayPrefix = getTodayDateKey();
  for (const key of dailyCreditTracker.keys()) {
    // Remove entries from previous days (they won't contain today's date prefix at the end)
    const datePart = key.split(':').slice(-2).join(':');
    if (datePart !== getTodayDateKey()) {
      dailyCreditTracker.delete(key);
    }
  }
}

export function checkAndRecordDailyCredit(wallet: string, currency: 'SOL' | 'LYNX', amount: number): void {
  purgeDailyCreditTracker();
  const key = getDailyCreditKey(wallet, currency);
  const currentTotal = dailyCreditTracker.get(key) || 0;
  const newTotal = currentTotal + amount;
  const dailyLimit = MAX_DAILY_CREDIT[currency];
  if (newTotal > dailyLimit) {
    const remaining = dailyLimit - currentTotal;
    throw new Error(
      `Daily credit limit for ${currency} exceeded. ` +
      `Wallet ${wallet.slice(0, 4)}...${wallet.slice(-4)} has received ${currentTotal.toFixed(2)}/${dailyLimit} ${currency} today. ` +
      `${remaining > 0 ? `Only ${remaining.toFixed(2)} ${currency} remaining.` : 'No more credits can be issued today.'}`
    );
  }
  dailyCreditTracker.set(key, newTotal);
  console.log(`[creditApprovals] BE-19: Daily credit tracker: ${key} = ${newTotal}/${dailyLimit}`);
}

// ── Redis-backed credit request storage ────────────────────────────────────────

const CREDIT_REDIS_PREFIX = 'credit_approval:';
const RESOLUTION_REDIS_PREFIX = 'market_resolution:';

// In-memory fallback for when Redis is not available (same as before)
const requests = new Map<string, CreditRequest>();

async function saveCreditRequestToRedis(req: CreditRequest): Promise<void> {
  if (!redis) return;
  try {
    const remainingTtl = Math.max(0, Math.ceil((req.expiresAt - Date.now()) / 1000));
    if (remainingTtl <= 0) return;
    await redis.set(
      `${CREDIT_REDIS_PREFIX}${req.id}`,
      JSON.stringify(req),
      'EX',
      remainingTtl
    );
  } catch (err) {
    console.error('[creditApprovals] redis save error:', err instanceof Error ? err.message : err);
  }
}

async function removeCreditRequestFromRedis(id: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${CREDIT_REDIS_PREFIX}${id}`, '', 'PX', 1); // effectively delete
  } catch (err) {
    console.error('[creditApprovals] redis remove error:', err instanceof Error ? err.message : err);
  }
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, req] of requests) {
    if (!req.executed && req.expiresAt < now) requests.delete(id);
  }
}

export async function loadPendingCreditApprovalsFromRedis(): Promise<void> {
  if (!redis) return;
  try {
    const RedisClient = (await import('ioredis')).default;
    const compatibleRedis = redis as unknown as { keys(pattern: string): Promise<string[]>; get(key: string): Promise<string | null> };
    const keys = await compatibleRedis.keys(`${CREDIT_REDIS_PREFIX}*`);
    let loaded = 0;
    for (const key of keys) {
      try {
        const raw = await compatibleRedis.get(key);
        if (raw) {
          const req = JSON.parse(raw) as CreditRequest;
          if (!req.executed && req.expiresAt > Date.now()) {
            requests.set(req.id, req);
            loaded++;
          } else {
            // Clean up expired or executed entries
            await removeCreditRequestFromRedis(req.id);
          }
        }
      } catch {
        // Skip malformed entries
      }
    }
    if (loaded > 0) {
      console.log(`[creditApprovals] Loaded ${loaded} pending credit approval(s) from Redis`);
    }
  } catch (err) {
    console.error('[creditApprovals] Failed to load from Redis:', err instanceof Error ? err.message : err);
  }
}

export function proposeCredit(input: { wallet: string; currency: 'SOL' | 'LYNX'; amount: number; reason: string; proposedBy: string }): CreditRequest {
  purgeExpired();
  if (input.amount <= 0) throw new Error('amount must be positive');
  const cap = MAX_MANUAL_CREDIT_AMOUNT[input.currency];
  if (input.amount > cap) {
    throw new Error(`Manual credits are capped at ${cap} ${input.currency} per request. For larger amounts, split into multiple requests or use a verified on-chain deposit instead.`);
  }
  if (!input.reason || !input.reason.trim()) {
    throw new Error('A reason is required for every manual credit (audit trail).');
  }
  // BE-19: Enforce per-wallet daily credit limit
  checkAndRecordDailyCredit(input.wallet, input.currency, input.amount);

  const id = `credit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const request: CreditRequest = {
    id,
    wallet: input.wallet,
    currency: input.currency,
    amount: input.amount,
    reason: input.reason.trim(),
    proposedBy: input.proposedBy,
    approvals: [],
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    executed: false,
  };
  requests.set(id, request);
  saveCreditRequestToRedis(request).catch(() => {});
  console.log(`[creditApprovals] PROPOSED ${id}: ${input.amount} ${input.currency} -> ${input.wallet} by admin=${input.proposedBy} reason="${request.reason}"`);
  return request;
}

export function approveCredit(id: string, approverUserId: string): CreditRequest {
  purgeExpired();
  const request = requests.get(id);
  if (!request) throw new Error('Credit request not found or expired');
  if (request.executed) throw new Error('Credit request already executed');
  if (request.proposedBy === approverUserId) {
    throw new Error('The proposer cannot also approve their own credit request — a different admin must approve.');
  }
  if (!request.approvals.includes(approverUserId)) {
    request.approvals.push(approverUserId);
  }
  saveCreditRequestToRedis(request).catch(() => {});
  console.log(`[creditApprovals] APPROVED ${id} by admin=${approverUserId} (${request.approvals.length + 1}/${REQUIRED_APPROVALS} total)`);
  return request;
}

// El "+1" de abajo cuenta al proponente como la primera aprobacion implicita.
export function isReadyToExecute(request: CreditRequest): boolean {
  return 1 + request.approvals.length >= REQUIRED_APPROVALS;
}

export function getCreditRequest(id: string): CreditRequest | undefined {
  purgeExpired();
  return requests.get(id);
}

export function markExecuted(id: string) {
  const request = requests.get(id);
  if (request) {
    request.executed = true;
    request.executedAt = Date.now();
    requests.delete(id);
    removeCreditRequestFromRedis(id).catch(() => {});
    console.log(`[creditApprovals] EXECUTED ${id}`);
  }
}

export function listPendingCredits(): CreditRequest[] {
  purgeExpired();
  return Array.from(requests.values()).filter((r) => !r.executed);
}

// --- Mismo patron de aprobacion dual, para resolver mercados LEGACY (los que
// no tienen respaldo on-chain — ver overlayOnChainMarket en server.ts). Los
// mercados con onChainMarket ya pasan por la gobernanza multisig on-chain
// (propose_resolution/dispute_resolution/finalize_resolution, o
// propose_action+approve_action+execute_resolve_market_admin); esto cubre el
// mismo riesgo (C3 del informe de auditoria) para los que aun no la tienen.
export type MarketResolutionRequest = {
  id: string;
  marketId: string;
  result: string;
  proposedBy: string;
  approvals: string[];
  createdAt: number;
  expiresAt: number;
  executed: boolean;
  executedAt?: number;
};

const marketResolutions = new Map<string, MarketResolutionRequest>();

async function saveResolutionToRedis(req: MarketResolutionRequest): Promise<void> {
  if (!redis) return;
  try {
    const remainingTtl = Math.max(0, Math.ceil((req.expiresAt - Date.now()) / 1000));
    if (remainingTtl <= 0) return;
    await redis.set(
      `${RESOLUTION_REDIS_PREFIX}${req.id}`,
      JSON.stringify(req),
      'EX',
      remainingTtl
    );
  } catch (err) {
    console.error('[creditApprovals] redis save resolution error:', err instanceof Error ? err.message : err);
  }
}

async function removeResolutionFromRedis(id: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(`${RESOLUTION_REDIS_PREFIX}${id}`, '', 'PX', 1);
  } catch (err) {
    console.error('[creditApprovals] redis remove resolution error:', err instanceof Error ? err.message : err);
  }
}

function purgeExpiredResolutions() {
  const now = Date.now();
  for (const [id, req] of marketResolutions) {
    if (!req.executed && req.expiresAt < now) marketResolutions.delete(id);
  }
}

export async function loadPendingMarketResolutionsFromRedis(): Promise<void> {
  if (!redis) return;
  try {
    const compatibleRedis = redis as unknown as { keys(pattern: string): Promise<string[]>; get(key: string): Promise<string | null> };
    const keys = await compatibleRedis.keys(`${RESOLUTION_REDIS_PREFIX}*`);
    let loaded = 0;
    for (const key of keys) {
      try {
        const raw = await compatibleRedis.get(key);
        if (raw) {
          const req = JSON.parse(raw) as MarketResolutionRequest;
          if (!req.executed && req.expiresAt > Date.now()) {
            marketResolutions.set(req.id, req);
            loaded++;
          } else {
            await removeResolutionFromRedis(req.id);
          }
        }
      } catch {
        // Skip malformed entries
      }
    }
    if (loaded > 0) {
      console.log(`[creditApprovals] Loaded ${loaded} pending market resolution(s) from Redis`);
    }
  } catch (err) {
    console.error('[creditApprovals] Failed to load resolutions from Redis:', err instanceof Error ? err.message : err);
  }
}

export function proposeMarketResolution(input: { marketId: string; result: string; proposedBy: string }): MarketResolutionRequest {
  purgeExpiredResolutions();
  const id = `resolve_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const request: MarketResolutionRequest = {
    id,
    marketId: input.marketId,
    result: input.result,
    proposedBy: input.proposedBy,
    approvals: [],
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    executed: false,
  };
  marketResolutions.set(id, request);
  saveResolutionToRedis(request).catch(() => {});
  console.log(`[creditApprovals] MARKET RESOLUTION PROPOSED ${id}: market=${input.marketId} result=${input.result} by admin=${input.proposedBy}`);
  return request;
}

export function approveMarketResolution(id: string, approverUserId: string): MarketResolutionRequest {
  purgeExpiredResolutions();
  const request = marketResolutions.get(id);
  if (!request) throw new Error('Resolution request not found or expired');
  if (request.executed) throw new Error('Resolution request already executed');
  if (request.proposedBy === approverUserId) {
    throw new Error('The proposer cannot also approve their own resolution — a different admin must approve.');
  }
  if (!request.approvals.includes(approverUserId)) {
    request.approvals.push(approverUserId);
  }
  saveResolutionToRedis(request).catch(() => {});
  console.log(`[creditApprovals] MARKET RESOLUTION APPROVED ${id} by admin=${approverUserId}`);
  return request;
}

export function isResolutionReadyToExecute(request: MarketResolutionRequest): boolean {
  return 1 + request.approvals.length >= REQUIRED_APPROVALS;
}

export function getMarketResolutionRequest(id: string): MarketResolutionRequest | undefined {
  purgeExpiredResolutions();
  return marketResolutions.get(id);
}

export function markResolutionExecuted(id: string) {
  const request = marketResolutions.get(id);
  if (request) {
    request.executed = true;
    request.executedAt = Date.now();
    marketResolutions.delete(id);
    removeResolutionFromRedis(id).catch(() => {});
    console.log(`[creditApprovals] MARKET RESOLUTION EXECUTED ${id}`);
  }
}

export function listPendingMarketResolutions(): MarketResolutionRequest[] {
  purgeExpiredResolutions();
  return Array.from(marketResolutions.values()).filter((r) => !r.executed);
}