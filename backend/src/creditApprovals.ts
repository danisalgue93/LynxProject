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
 * Almacenamiento intencionalmente en memoria (no se persiste a Prisma): son
 * solicitudes de corta vida y de bajo riesgo si se pierden en un reinicio
 * (el admin simplemente vuelve a proponer). El credito real, una vez
 * ejecutado, se aplica via store.deposit() y SI queda persistido con el resto
 * del ledger/wallets como siempre.
 */

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
const REQUIRED_APPROVALS = 2; // incluyendo al proponente => 1 propuesta + 1 aprobacion de OTRO admin
export const MAX_MANUAL_CREDIT_AMOUNT = {
  SOL: Number(process.env.MAX_MANUAL_CREDIT_SOL || 5),
  LYNX: Number(process.env.MAX_MANUAL_CREDIT_LYNX || 50_000),
};

const requests = new Map<string, CreditRequest>();

function purgeExpired() {
  const now = Date.now();
  for (const [id, req] of requests) {
    if (!req.executed && req.expiresAt < now) requests.delete(id);
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

function purgeExpiredResolutions() {
  const now = Date.now();
  for (const [id, req] of marketResolutions) {
    if (!req.executed && req.expiresAt < now) marketResolutions.delete(id);
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
    console.log(`[creditApprovals] MARKET RESOLUTION EXECUTED ${id}`);
  }
}

export function listPendingMarketResolutions(): MarketResolutionRequest[] {
  purgeExpiredResolutions();
  return Array.from(marketResolutions.values()).filter((r) => !r.executed);
}
