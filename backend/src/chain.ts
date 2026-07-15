/**
 * chain.ts
 *
 * Indexador de solo lectura + "keeper" para el programa Anchor de mercados
 * de prediccion (ver cripto/programs/lynx_project/src/lib.rs). El backend ya
 * NO custodia el dinero de trading de mercados de prediccion: este modulo
 * solo LEE cuentas on-chain (Market, PredictionOrder, UserPosition) para que
 * la UI cargue rapido, y opcionalmente ejecuta ordenes limite ya cumplidas
 * (execute_prediction_limit_order_sol/lynx) pagando el gas desde una wallet
 * de "keeper" separada — nunca desde la tesoreria, y la instruccion en si es
 * permissionless/verificada on-chain, asi que un keeper comprometido como
 * mucho deja de ejecutar ordenes, nunca puede robar fondos.
 *
 * Es intencionalmente independiente de backend/src/state.ts (el motor
 * off-chain legacy para LYNX/SOL, duelos, staking y DAO, que sigue existiendo
 * por ahora — ver auditoria_lynx_project.md, fase 5 pendiente).
 */

import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { readFileSync } from 'fs';

/**
 * If an env var value starts with "/", treat it as a file path (Docker/K8s
 * secrets mount) and return the file contents. Otherwise return the value as-is.
 */
const chainLog = {
  info: (msg: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', module: 'chain', msg, ...data })),
  warn: (msg: string, data?: Record<string, unknown>) => console.warn(JSON.stringify({ level: 'warn', module: 'chain', msg, ...data })),
  error: (msg: string, data?: Record<string, unknown>) => console.error(JSON.stringify({ level: 'error', module: 'chain', msg, ...data })),
};

function loadEnvSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('/')) {
    try {
      return readFileSync(value, 'utf-8').trim();
    } catch {
      console.error(`[chain] Secret file referenced by env var cannot be read: ${value}`);
      return undefined;
    }
  }
  return value;
}


const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID ? new PublicKey(process.env.PROGRAM_ID) : null;
const REFRESH_INTERVAL_MS = Number(process.env.CHAIN_INDEXER_INTERVAL_MS || 8_000);
const KEEPER_INTERVAL_MS = Number(process.env.CHAIN_KEEPER_INTERVAL_MS || 6_000);

let connection: Connection | null = null;
function withRpcTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 15000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: RPC call timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

function getConnection(): Connection {
  if (!connection) connection = new Connection(RPC_URL, 'confirmed');
  return connection;
}

function getKeeperKeypair(): Keypair | null {
  const raw = loadEnvSecret(process.env.KEEPER_KEYPAIR_BS58);
  if (!raw) return null;
  return Keypair.fromSecretKey(bs58.decode(raw));
}

// --- Discriminadores (ver cripto/admin-panel/lib/solana.ts para como se calculan) ---
const ACCOUNT_DISC = {
  market: Buffer.from([219, 190, 213, 55, 0, 227, 198, 154]),
  predictionOrder: Buffer.from([143, 114, 109, 86, 201, 242, 189, 215]),
  userPosition: Buffer.from([251, 248, 209, 245, 83, 234, 17, 27]),
  spotOrder: Buffer.from([136, 35, 83, 247, 161, 60, 47, 233]),
};

// Discriminadores calculados como sha256("global:<nombre_instruccion>")[:8],
// igual que en cripto/admin-panel/lib/solana.ts. Recalcular si cambian los
// nombres de instruccion en lib.rs.
const IX = {
  executePredictionLimitOrderSol: Buffer.from([56, 177, 97, 204, 12, 178, 243, 17]),
  executePredictionLimitOrderLynx: Buffer.from([247, 237, 45, 14, 53, 85, 90, 40]),
  matchSpotOrders: Buffer.from([65, 14, 80, 122, 12, 6, 136, 178]),
};

export type OnChainOutcome = 'Unresolved' | 'Yes' | 'No' | 'Draw';
export type OnChainMarketStatus = 'Open' | 'Active' | 'CutOff' | 'PendingResolution' | 'Resolved' | 'Expired';

export type IndexedMarket = {
  pubkey: string;
  id: string;
  title: string;
  currency: 'SOL' | 'LYNX';
  status: OnChainMarketStatus;
  isTernary: boolean;
  cutoffTs: number;
  resolveTs: number;
  poolTotal: string;
  yesTotal: string;
  noTotal: string;
  drawTotal: string;
  result: OnChainOutcome;
};

export type IndexedPredictionOrder = {
  pubkey: string;
  id: string;
  owner: string;
  market: string;
  outcome: OnChainOutcome;
  amount: string;
  limitPriceBps: number;
  status: 'Open' | 'Filled' | 'Cancelled';
  createdTs: number;
  expiresTs: number;
};

export type IndexedPosition = {
  pubkey: string;
  market: string;
  owner: string;
  outcome: OnChainOutcome;
  amount: string;
  claimed: boolean;
  lynxMinted: boolean;
};

export type IndexedSpotOrder = {
  pubkey: string;
  id: string;
  owner: string;
  side: 'Buy' | 'Sell';
  priceScaled: string; // u128 como string decimal
  amount: string;
  remaining: string;
  status: 'Open' | 'Filled' | 'Cancelled';
  createdTs: number;
  expiresTs: number;
};

export function fromOnChainOutcomeName(outcome: OnChainOutcome): 'YES' | 'NO' | 'DRAW' | null {
  if (outcome === 'Yes') return 'YES';
  if (outcome === 'No') return 'NO';
  if (outcome === 'Draw') return 'DRAW';
  return null;
}

class Reader {
  offset = 8;
  constructor(private readonly data: Buffer) {}
  pubkey() { const v = new PublicKey(this.data.subarray(this.offset, this.offset + 32)); this.offset += 32; return v; }
  u8() { return this.data[this.offset++]; }
  bool() { return this.u8() === 1; }
  u64() { const v = this.data.readBigUInt64LE(this.offset); this.offset += 8; return v; }
  u128() {
    const lo = this.data.readBigUInt64LE(this.offset);
    const hi = this.data.readBigUInt64LE(this.offset + 8);
    this.offset += 16;
    return (hi << 64n) | lo;
  }
  i64() { const v = this.data.readBigInt64LE(this.offset); this.offset += 8; return v; }
  string() {
    const len = this.data.readUInt32LE(this.offset); this.offset += 4;
    const v = this.data.subarray(this.offset, this.offset + len).toString('utf8'); this.offset += len; return v;
  }
}

function outcomeName(v: number): OnChainOutcome {
  return (['Unresolved', 'Yes', 'No', 'Draw'][v] ?? 'Unresolved') as OnChainOutcome;
}

function statusName(v: number): OnChainMarketStatus {
  return (['Open', 'Active', 'CutOff', 'PendingResolution', 'Resolved', 'Expired'][v] ?? 'Open') as OnChainMarketStatus;
}

function decodeMarket(pubkey: PublicKey, data: Buffer): IndexedMarket {
  const r = new Reader(data);
  const id = r.u64();
  r.pubkey(); // admin
  r.pubkey(); // vault
  r.pubkey(); // oracle_authority
  const title = r.string();
  const currency = r.u8() === 0 ? 'SOL' : 'LYNX';
  const status = statusName(r.u8());
  const isTernary = r.bool();
  const cutoffTs = Number(r.i64());
  const resolveTs = Number(r.i64());
  r.i64(); // oracle_deadline
  r.i64(); // resolved_ts
  const result = outcomeName(r.u8());
  const poolTotal = r.u64();
  const yesTotal = r.u64();
  const noTotal = r.u64();
  const drawTotal = r.u64();
  return {
    pubkey: pubkey.toBase58(), id: id.toString(), title, currency: currency as 'SOL' | 'LYNX', status, isTernary,
    cutoffTs, resolveTs, poolTotal: poolTotal.toString(), yesTotal: yesTotal.toString(),
    noTotal: noTotal.toString(), drawTotal: drawTotal.toString(), result,
  };
}

function decodePredictionOrder(pubkey: PublicKey, data: Buffer): IndexedPredictionOrder {
  const r = new Reader(data);
  const id = r.u64();
  const owner = r.pubkey();
  const market = r.pubkey();
  const outcome = outcomeName(r.u8());
  const amount = r.u64();
  const limitPriceBps = Number(r.u64());
  const status = (['Open', 'Filled', 'Cancelled'][r.u8()] ?? 'Open') as 'Open' | 'Filled' | 'Cancelled';
  const createdTs = Number(r.i64());
  const expiresTs = Number(r.i64());
  return {
    pubkey: pubkey.toBase58(), id: id.toString(), owner: owner.toBase58(), market: market.toBase58(),
    outcome, amount: amount.toString(), limitPriceBps, status, createdTs, expiresTs,
  };
}

function decodePosition(pubkey: PublicKey, data: Buffer): IndexedPosition {
  const r = new Reader(data);
  const market = r.pubkey();
  const owner = r.pubkey();
  const outcome = outcomeName(r.u8());
  const amount = r.u64();
  const claimed = r.bool();
  const lynxMinted = r.bool();
  return { pubkey: pubkey.toBase58(), market: market.toBase58(), owner: owner.toBase58(), outcome, amount: amount.toString(), claimed, lynxMinted };
}

function decodeSpotOrder(pubkey: PublicKey, data: Buffer): IndexedSpotOrder {
  const r = new Reader(data);
  const id = r.u64();
  const owner = r.pubkey();
  const side = r.u8() === 0 ? 'Buy' : 'Sell';
  const priceScaled = r.u128();
  const amount = r.u64();
  const remaining = r.u64();
  const status = (['Open', 'Filled', 'Cancelled'][r.u8()] ?? 'Open') as 'Open' | 'Filled' | 'Cancelled';
  const createdTs = Number(r.i64());
  const expiresTs = Number(r.i64());
  return {
    pubkey: pubkey.toBase58(), id: id.toString(), owner: owner.toBase58(), side: side as 'Buy' | 'Sell',
    priceScaled: priceScaled.toString(), amount: amount.toString(), remaining: remaining.toString(),
    status, createdTs, expiresTs,
  };
}

// --- Cache en memoria (se reconstruye desde RPC cada REFRESH_INTERVAL_MS; es
// un espejo de solo lectura, nunca la fuente de verdad, asi que es seguro
// correr varias instancias del backend sin ningun riesgo de doble gasto: la
// cadena es la unica autoridad sobre el dinero). ---
const marketsByPubkey = new Map<string, IndexedMarket>();
const ordersByPubkey = new Map<string, IndexedPredictionOrder>();
const positionsByPubkey = new Map<string, IndexedPosition>();
const spotOrdersByPubkey = new Map<string, IndexedSpotOrder>();
let lastRefreshError: string | null = null;
let lastRefreshAt = 0;

async function refreshOnce() {
  if (!PROGRAM_ID) return;
  const conn = getConnection();
  try {
    const [marketAccounts, orderAccounts, positionAccounts, spotOrderAccounts] = await Promise.all([
      conn.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ACCOUNT_DISC.market) } }] }),
      withRpcTimeout(conn.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ACCOUNT_DISC.predictionOrder) } }] }), 'refresh:getProgramAccounts:predictionOrder'),
      withRpcTimeout(conn.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ACCOUNT_DISC.userPosition) } }] }), 'refresh:getProgramAccounts:userPosition'),
      withRpcTimeout(conn.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ACCOUNT_DISC.spotOrder) } }] }), 'refresh:getProgramAccounts:spotOrder'),
    ]);

    marketsByPubkey.clear();
    for (const { pubkey, account } of marketAccounts) {
      try { marketsByPubkey.set(pubkey.toBase58(), decodeMarket(pubkey, account.data)); } catch { /* ignora cuentas con formato inesperado */ }
    }
    ordersByPubkey.clear();
    for (const { pubkey, account } of orderAccounts) {
      try { ordersByPubkey.set(pubkey.toBase58(), decodePredictionOrder(pubkey, account.data)); } catch { /* ignora */ }
    }
    positionsByPubkey.clear();
    for (const { pubkey, account } of positionAccounts) {
      try { positionsByPubkey.set(pubkey.toBase58(), decodePosition(pubkey, account.data)); } catch { /* ignora */ }
    }
    spotOrdersByPubkey.clear();
    for (const { pubkey, account } of spotOrderAccounts) {
      try { spotOrdersByPubkey.set(pubkey.toBase58(), decodeSpotOrder(pubkey, account.data)); } catch { /* ignora */ }
    }

    lastRefreshError = null;
    lastRefreshAt = Date.now();
  } catch (err: any) {
    lastRefreshError = err?.message || String(err);
    chainLog.error('refresh failed', { error: lastRefreshError });
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let keeperTimer: ReturnType<typeof setInterval> | null = null;
let keeperConsecutiveErrors = 0;
const KEEPER_MAX_CONSECUTIVE_ERRORS = 5;
const KEEPER_COOLDOWN_MS = 60_000; // 1 minute cooldown after circuit breaks
let keeperPausedUntil = 0;

export function startChainIndexer() {
  if (!PROGRAM_ID) {
    chainLog.warn('PROGRAM_ID not set — on-chain indexer disabled');
    return;
  }
  refreshOnce();
  if (!refreshTimer) refreshTimer = setInterval(refreshOnce, REFRESH_INTERVAL_MS);
  if (!keeperTimer && getKeeperKeypair()) {
    keeperTimer = setInterval(() => {
      runKeeperOnce()
        .then(() => { keeperConsecutiveErrors = 0; })
        .catch((err) => {
          keeperConsecutiveErrors++;
          chainLog.error('keeper loop error', { error: err?.message, consecutive: keeperConsecutiveErrors });
          if (keeperConsecutiveErrors >= KEEPER_MAX_CONSECUTIVE_ERRORS) {
            keeperPausedUntil = Date.now() + KEEPER_COOLDOWN_MS;
            chainLog.warn('keeper circuit breaker tripped', { pausedMs: KEEPER_COOLDOWN_MS });
          }
        });
    }, KEEPER_INTERVAL_MS);
  } else if (!getKeeperKeypair()) {
    chainLog.warn('KEEPER_KEYPAIR_BS58 not set — keeper disabled');
  }
}

export function stopChainIndexer() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (keeperTimer) { clearInterval(keeperTimer); keeperTimer = null; }
}

// Fuerza un refresco inmediato (usado por POST /api/onchain/sync tras una tx
// confirmada del cliente, para no esperar al siguiente poll periodico).
export async function forceRefresh() {
  await refreshOnce();
}

// Verificacion "en caliente" (no depende de la cache del indexador, que
// puede tardar hasta REFRESH_INTERVAL_MS en ver una cuenta recien creada):
// confirma contra el RPC que `marketPubkey` es de verdad una cuenta Market
// valida, propiedad de nuestro programa, y que `signature` es una
// transaccion confirmada que la toca. Antes, /api/markets aceptaba estos dos
// campos como texto libre sin comprobar nada (hallazgo A3 de la auditoria).
export async function verifyOnChainMarketCreation(params: { marketPubkey: string; signature: string; expectedTitle?: string }): Promise<{ ok: true; onChainTitle: string } | { ok: false; error: string }> {
  if (!PROGRAM_ID) return { ok: false, error: 'PROGRAM_ID is not configured on this backend — cannot verify on-chain markets' };
  let marketPk: PublicKey;
  try {
    marketPk = new PublicKey(params.marketPubkey);
  } catch {
    return { ok: false, error: 'onChainMarket is not a valid Solana public key' };
  }

  const conn = getConnection();
  const info = await withRpcTimeout(conn.getAccountInfo(marketPk, 'confirmed'), 'verifyOnChainMarket:getAccountInfo:market', 15000);
  if (!info) return { ok: false, error: 'No account found on-chain at onChainMarket — has create_market actually been sent yet?' };
  if (!info.owner.equals(PROGRAM_ID)) return { ok: false, error: 'onChainMarket account is not owned by the Lynx program' };
  if (!info.data.subarray(0, 8).equals(ACCOUNT_DISC.market)) return { ok: false, error: 'onChainMarket account is not a Market account (wrong discriminator)' };

  let onChainTitle: string;
  try {
    onChainTitle = decodeMarket(marketPk, info.data).title;
  } catch {
    return { ok: false, error: 'Failed to decode the on-chain Market account' };
  }
  if (params.expectedTitle && onChainTitle.trim() !== params.expectedTitle.trim()) {
    return { ok: false, error: `Title mismatch: on-chain market says "${onChainTitle}", request says "${params.expectedTitle}"` };
  }

  const tx = await withRpcTimeout(conn.getTransaction(params.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }), 'verifyOnChainMarket:getTransaction', 15000);
  if (!tx) return { ok: false, error: 'Transaction signature not found or not yet confirmed on-chain' };
  if (tx.meta?.err) return { ok: false, error: 'The provided transaction failed on-chain' };
  const touchesProgram = tx.transaction.message.staticAccountKeys?.some((k) => k.equals(PROGRAM_ID))
    ?? (tx.transaction.message as any).accountKeys?.some((k: PublicKey) => k.equals(PROGRAM_ID));
  if (!touchesProgram) return { ok: false, error: 'The provided transaction signature does not touch the Lynx program' };

  return { ok: true, onChainTitle };
}

export function getIndexerStatus() {
  return {
    enabled: !!PROGRAM_ID,
    keeperEnabled: !!getKeeperKeypair(),
    keeperConsecutiveErrors,
    keeperPaused: Date.now() < keeperPausedUntil,
    keeperPausedUntil,
    lastRefreshAt,
    lastRefreshError,
    markets: marketsByPubkey.size,
    orders: ordersByPubkey.size,
    positions: positionsByPubkey.size,
    spotOrders: spotOrdersByPubkey.size
  };
}

export function listIndexedMarkets(): IndexedMarket[] {
  return Array.from(marketsByPubkey.values());
}

export function getIndexedMarket(pubkey: string): IndexedMarket | undefined {
  return marketsByPubkey.get(pubkey);
}

export function listOpenOrdersForMarket(marketPubkey: string): IndexedPredictionOrder[] {
  return Array.from(ordersByPubkey.values()).filter((o) => o.market === marketPubkey && o.status === 'Open');
}

export function listPositionsForOwner(owner: string): IndexedPosition[] {
  return Array.from(positionsByPubkey.values()).filter((p) => p.owner === owner);
}

export function listOpenSpotOrders(): IndexedSpotOrder[] {
  return Array.from(spotOrdersByPubkey.values()).filter((o) => o.status === 'Open');
}

// --- Keeper: ejecuta ordenes limite ya cumplidas ---
// Espejo exacto de implied_price_bps() en lib.rs: solo lectura, nunca decide
// el resultado — el programa vuelve a comprobar la condicion on-chain antes
// de mover un solo lamport/micro-LYNX, asi que un bug aqui como mucho hace
// que el keeper intente (y falle) una ejecucion, nunca causa una perdida.
function impliedPriceBps(market: IndexedMarket, outcome: OnChainOutcome): number | null {
  const pool = BigInt(market.poolTotal);
  if (pool === 0n) return null;
  const numerator = outcome === 'Yes' ? BigInt(market.yesTotal) : outcome === 'No' ? BigInt(market.noTotal) : outcome === 'Draw' ? BigInt(market.drawTotal) : null;
  if (numerator === null) return null;
  return Number((numerator * 10_000n) / pool);
}

function u64LE(v: bigint) { const b = Buffer.alloc(8); b.writeBigUInt64LE(v, 0); return b; }

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

let cachedConfigInfo: { lynxMint: PublicKey; treasury: PublicKey; cachedAt: number } | null = null;
const CONFIG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
async function getConfigInfo(conn: Connection): Promise<{ lynxMint: PublicKey; treasury: PublicKey }> {
  if (cachedConfigInfo && (Date.now() - cachedConfigInfo.cachedAt < CONFIG_CACHE_TTL_MS)) return cachedConfigInfo;
  if (!PROGRAM_ID) throw new Error('PROGRAM_ID not configured');
  const configPk = pda([Buffer.from('config')], PROGRAM_ID);
  const info = await withRpcTimeout(conn.getAccountInfo(configPk), 'getConfigInfo:getAccountInfo:config', 15000);
  if (!info) throw new Error('ProtocolConfig account not found on-chain');
  let offset = 8;
  offset += 32; // admin
  const treasury = new PublicKey(info.data.subarray(offset, offset + 32)); offset += 32;
  const lynxMint = new PublicKey(info.data.subarray(offset, offset + 32)); offset += 32;
  cachedConfigInfo = { lynxMint, treasury, cachedAt: Date.now() };
  return cachedConfigInfo;
}

export async function runKeeperOnce() {
  if (Date.now() < keeperPausedUntil) return;
  if (!PROGRAM_ID) return;
  const keeper = getKeeperKeypair();
  if (!keeper) return;
  const conn = getConnection();
  const now = Math.floor(Date.now() / 1000);

  for (const order of ordersByPubkey.values()) {
    if (order.status !== 'Open') continue;
    if (now >= order.expiresTs) continue; // dejar que cancel_prediction_limit_order_* la limpie
    const market = marketsByPubkey.get(order.market);
    if (!market) continue;
    if (market.status !== 'Open' && market.status !== 'Active') continue;
    const currentPriceBps = impliedPriceBps(market, order.outcome);
    if (currentPriceBps === null) continue;
    if (currentPriceBps >= order.limitPriceBps) continue; // condicion aun no se cumple

    try {
      const marketPk = new PublicKey(order.market);
      const orderPk = new PublicKey(order.pubkey);
      const ownerPk = new PublicKey(order.owner);
      const outcomeByte = { Unresolved: 0, Yes: 1, No: 2, Draw: 3 }[order.outcome];
      const vault = pda([Buffer.from('vault'), marketPk.toBuffer()], PROGRAM_ID);
      const position = pda([Buffer.from('position'), marketPk.toBuffer(), ownerPk.toBuffer(), Buffer.from([outcomeByte])], PROGRAM_ID);

      let ix: TransactionInstruction;
      if (market.currency === 'SOL') {
        const escrow = pda([Buffer.from('pred_order_escrow_sol'), orderPk.toBuffer()], PROGRAM_ID);
        ix = new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: marketPk, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: orderPk, isSigner: false, isWritable: true },
            { pubkey: escrow, isSigner: false, isWritable: true },
            { pubkey: position, isSigner: false, isWritable: true },
            { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
            { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
          ],
          data: IX.executePredictionLimitOrderSol,
        });
      } else {
        // BE-H-03: Execute LYNX prediction limit orders via execute_prediction_limit_order_lynx
        const { lynxMint, treasury } = await getConfigInfo(conn);
        const configPk = pda([Buffer.from('config')], PROGRAM_ID);
        const escrow = pda([Buffer.from('pred_order_escrow_lynx'), orderPk.toBuffer()], PROGRAM_ID);
        const marketLynxVault = pda([Buffer.from('market_lynx_vault'), marketPk.toBuffer()], PROGRAM_ID);
        const ownerLynxAta = await getAssociatedTokenAddress(lynxMint, ownerPk);
        ix = new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: marketPk, isSigner: false, isWritable: true },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: orderPk, isSigner: false, isWritable: true },
            { pubkey: escrow, isSigner: false, isWritable: true },
            { pubkey: position, isSigner: false, isWritable: true },
            { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
            { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
            { pubkey: configPk, isSigner: false, isWritable: false },
            { pubkey: lynxMint, isSigner: false, isWritable: false },
            { pubkey: marketLynxVault, isSigner: false, isWritable: true },
            { pubkey: ownerLynxAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: IX.executePredictionLimitOrderLynx,
        });
      }

      const tx = new Transaction().add(ix);
      tx.feePayer = keeper.publicKey;
      const signature = await sendAndConfirmTransaction(conn, tx, [keeper], { commitment: 'confirmed' });
      chainLog.info('keeper filled order', { order: order.pubkey, signature });
    } catch (err: any) {
      // Fallos individuales de una orden (p.ej. alguien mas la ejecuto primero,
      // o la condicion cambio justo antes de confirmar) no deben tumbar el loop.
      chainLog.warn('keeper failed to fill order', { order: order.pubkey, error: err?.message });
    }
  }

  await matchSpotOrdersOnce(keeper, conn);
  keeperConsecutiveErrors = 0; // Reset on successful completion
}

// Cruza ordenes del libro LYNX/SOL de forma greedy (prioridad precio-tiempo),
// una pareja a la vez. Es solo una referencia razonable: cualquiera puede
// correr su propio keeper mas sofisticado, ya que match_spot_orders() es
// permissionless y el programa valida todo on-chain de todas formas.
async function matchSpotOrdersOnce(keeper: Keypair, conn: Connection) {
  if (!PROGRAM_ID) return;
  const now = Math.floor(Date.now() / 1000);
  const open = Array.from(spotOrdersByPubkey.values()).filter((o) => o.status === 'Open' && now < o.expiresTs);
  const remaining = new Map<string, bigint>(open.map((o) => [o.pubkey, BigInt(o.remaining)]));

  const buys = open.filter((o) => o.side === 'Buy').sort((a, b) => {
    const priceDiff = BigInt(b.priceScaled) - BigInt(a.priceScaled);
    if (priceDiff !== 0n) return priceDiff > 0n ? 1 : -1;
    return a.createdTs - b.createdTs;
  });
  const sells = open.filter((o) => o.side === 'Sell').sort((a, b) => {
    const priceDiff = BigInt(a.priceScaled) - BigInt(b.priceScaled);
    if (priceDiff !== 0n) return priceDiff > 0n ? 1 : -1;
    return a.createdTs - b.createdTs;
  });

  let i = 0;
  let j = 0;
  while (i < buys.length && j < sells.length) {
    const buy = buys[i];
    const sell = sells[j];
    const buyRemaining = remaining.get(buy.pubkey) ?? 0n;
    const sellRemaining = remaining.get(sell.pubkey) ?? 0n;
    if (buyRemaining === 0n) { i++; continue; }
    if (sellRemaining === 0n) { j++; continue; }
    if (BigInt(buy.priceScaled) < BigInt(sell.priceScaled)) break; // ya no cruzan, ordenados por precio

    const fill = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;
    try {
      const { lynxMint, treasury } = await getConfigInfo(conn);
      const buyOwner = new PublicKey(buy.owner);
      const sellOwner = new PublicKey(sell.owner);
      const buyOrderPk = new PublicKey(buy.pubkey);
      const sellOrderPk = new PublicKey(sell.pubkey);
      const configPk = pda([Buffer.from('config')], PROGRAM_ID);
      const buyEscrow = pda([Buffer.from('spot_order_escrow_sol'), buyOrderPk.toBuffer()], PROGRAM_ID);
      const sellEscrow = pda([Buffer.from('spot_order_escrow_lynx'), sellOrderPk.toBuffer()], PROGRAM_ID);
      const buyerLynxAta = await getAssociatedTokenAddress(lynxMint, buyOwner);

      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: configPk, isSigner: false, isWritable: false },
          { pubkey: buyOrderPk, isSigner: false, isWritable: true },
          { pubkey: buyEscrow, isSigner: false, isWritable: true },
          { pubkey: sellOrderPk, isSigner: false, isWritable: true },
          { pubkey: sellEscrow, isSigner: false, isWritable: true },
          { pubkey: sellOwner, isSigner: false, isWritable: true },
          { pubkey: buyOwner, isSigner: false, isWritable: true },
          { pubkey: buyerLynxAta, isSigner: false, isWritable: true },
          { pubkey: treasury, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([IX.matchSpotOrders, u64LE(fill)]),
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = keeper.publicKey;
      const signature = await sendAndConfirmTransaction(conn, tx, [keeper], { commitment: 'confirmed' });
      chainLog.info('keeper matched spot orders', { buy: buy.pubkey, sell: sell.pubkey, fill: fill.toString() });
    } catch (err: any) {
      chainLog.warn('keeper failed to match spot orders', { buy: buy.pubkey, sell: sell.pubkey, error: err?.message });
    }

    remaining.set(buy.pubkey, buyRemaining - fill);
    remaining.set(sell.pubkey, sellRemaining - fill);
    if (remaining.get(buy.pubkey) === 0n) i++;
    if (remaining.get(sell.pubkey) === 0n) j++;
  }
}
