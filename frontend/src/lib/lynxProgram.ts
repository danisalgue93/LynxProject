/**
 * lynxProgram.ts
 *
 * Construye instrucciones/transacciones on-chain contra el programa Anchor
 * de Lynx (cripto/programs/lynx_project) para que el USUARIO las firme con
 * su propia wallet (via @solana/wallet-adapter). Este modulo nunca maneja
 * claves privadas ni envia fondos por su cuenta: solo arma la transaccion;
 * quien la firma y envia es siempre el componente/hook que llama a estas
 * funciones, usando `sendTransaction` de la wallet conectada.
 *
 * Reemplaza el flujo custodial anterior (deposito a una wallet de tesoreria
 * unica + balance interno en el backend) para TODO lo relacionado con
 * mercados de prediccion: comprar, poner ordenes limite, cancelarlas y
 * reclamar payouts. El backend deja de custodiar este dinero; solo lee el
 * estado on-chain para mostrarlo rapido en la UI (ver backend/src/chain.ts).
 *
 * NOTA IMPORTANTE: el trading de LYNX/SOL (par spot) y el staking/DAO siguen
 * usando el flujo off-chain existente por ahora — esa migracion queda para
 * una fase posterior (ver LAUNCH_DECISIONS.md, "phase 5").
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

// --- Configuracion ---

function getProgramId(): PublicKey {
  const raw = import.meta.env.VITE_PROGRAM_ID;
  if (!raw) {
    throw new Error('VITE_PROGRAM_ID no esta configurado. Añadelo a tu .env del frontend.');
  }
  return new PublicKey(raw);
}

export const LYNX_DECIMALS = 6;
export const BPS_DENOMINATOR = 10_000;
// Debe coincidir con constants::PRICE_SCALE en el programa Anchor.
export const PRICE_SCALE = 1_000_000_000n;

// Convierte un precio "SOL por LYNX" (humano) al price_scaled (lamports por
// micro-LYNX * PRICE_SCALE) que espera el programa para el libro spot.
//
// price_scaled = lamports_por_micro_LYNX * PRICE_SCALE, y
// lamports_por_micro_LYNX = (solPerLynx * 1e9 lamports/SOL) / 1e6 micro-LYNX/LYNX.
// Es decir price_scaled = solPerLynx * 1e12.
//
// BUG (corregido): la version previa dividia ADEMAS por 1_000_000_000n, dejando
// el resultado 1e9 veces demasiado pequeno (0.005 SOL/LYNX -> 5 en vez de 5e9).
// Con eso, spot_sol_amount() on-chain calculaba un coste 1e9 veces menor: las
// ordenes de compra revertian por caer bajo MIN_ORDER_LAMPORTS, y una venta que
// llegara a casar habria pagado al vendedor 1e9 veces menos SOL por su LYNX. La
// inversa priceScaledToSolPerLynx ya era correcta, asi que el round-trip estaba
// roto — ahora vuelve a cerrar (ver lynxProgram.spot.test.ts).
export function solPerLynxToPriceScaled(solPerLynx: number): bigint {
  const decimals = 10n ** BigInt(LYNX_DECIMALS); // micro-LYNX por LYNX
  const lamportsPerLynx = BigInt(Math.round(solPerLynx * 1e9));
  return (lamportsPerLynx * PRICE_SCALE) / decimals;
}

export function priceScaledToSolPerLynx(priceScaled: bigint): number {
  const lamportsPerMicroLynx = Number(priceScaled) / Number(PRICE_SCALE);
  return (lamportsPerMicroLynx * Math.pow(10, LYNX_DECIMALS)) / 1_000_000_000;
}

export type OnChainOutcome = 'Yes' | 'No' | 'Draw';

// --- Discriminadores Anchor (sha256("global:<instruccion>")[:8] / sha256("account:<Struct>")[:8]) ---
// Recalcula estos si cambias los nombres de las instrucciones/cuentas en el
// programa Anchor (ver cripto/programs/lynx_project/src/lib.rs).
const IX = {
  createMarket: Buffer.from([103, 226, 97, 235, 200, 188, 251, 254]),
  buyPositionSol: Buffer.from([156, 155, 60, 104, 79, 37, 11, 151]),
  buyPositionLynxWithBurn: Buffer.from([233, 55, 73, 166, 178, 33, 3, 126]),
  createPredictionLimitOrderSol: Buffer.from([119, 18, 41, 21, 24, 40, 207, 22]),
  createPredictionLimitOrderLynx: Buffer.from([93, 235, 9, 196, 136, 88, 220, 192]),
  cancelPredictionLimitOrderSol: Buffer.from([22, 87, 65, 13, 171, 10, 20, 69]),
  cancelPredictionLimitOrderLynx: Buffer.from([25, 34, 254, 136, 55, 212, 7, 221]),
  claimMarketSol: Buffer.from([199, 172, 244, 57, 182, 108, 151, 211]),
  claimMarketLynx: Buffer.from([71, 182, 236, 246, 239, 245, 191, 73]),
  placeSpotOrderBuy: Buffer.from([27, 177, 65, 85, 222, 232, 156, 164]),
  placeSpotOrderSell: Buffer.from([218, 179, 180, 17, 32, 164, 248, 242]),
  cancelSpotOrderBuy: Buffer.from([67, 101, 162, 38, 89, 23, 134, 253]),
  cancelSpotOrderSell: Buffer.from([178, 183, 109, 92, 217, 196, 230, 86]),
  stakeLynx: Buffer.from([171, 43, 75, 147, 83, 188, 211, 242]),
  unstakeLynx: Buffer.from([196, 208, 22, 83, 84, 204, 179, 239]),
  claimStakingRewards: Buffer.from([229, 141, 170, 69, 111, 94, 6, 72]),
  createDuel: Buffer.from([49, 28, 93, 11, 75, 242, 69, 165]),
  acceptDuel: Buffer.from([80, 52, 90, 135, 172, 221, 175, 102]),
  cancelDuel: Buffer.from([83, 124, 224, 237, 235, 44, 38, 57]),
  createDaoProposal: Buffer.from([112, 127, 42, 71, 195, 95, 60, 165]),
  castDaoVote: Buffer.from([129, 151, 210, 43, 50, 222, 234, 39]),
  finalizeDaoProposal: Buffer.from([76, 23, 122, 24, 113, 102, 12, 35]),
};

export type DuelType = 'OneVOne' | 'OneVOneVProtocol';
// Matches the DuelType enum order in state.rs (OneVOne = 0, OneVOneVProtocol = 1),
// which is how Anchor serializes a fieldless enum.
function duelTypeByte(duelType: DuelType): number {
  return duelType === 'OneVOne' ? 0 : 1;
}

const ACCOUNT_DISCRIMINATORS = {
  protocolConfig: Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]),
};

function outcomeByte(outcome: OnChainOutcome): number {
  return { Yes: 1, No: 2, Draw: 3 }[outcome];
}

// Enum Currency on-chain (state.rs): SOL = 0, LYNX = 1.
function currencyByte(currency: 'SOL' | 'LYNX'): number {
  return currency === 'SOL' ? 0 : 1;
}

// Debe coincidir con Market::TITLE_MAX en state.rs.
export const MARKET_TITLE_MAX = 128;

// Serializa un String de Borsh: u32 LE de longitud (en bytes UTF-8) + bytes.
function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function u64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function i64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value), 0);
  return buf;
}

// Convierte SOL/LYNX en unidades humanas a la unidad on-chain minima
// (lamports para SOL, micro-LYNX para LYNX).
export function toBaseUnits(amount: number, currency: 'SOL' | 'LYNX'): bigint {
  const factor = currency === 'SOL' ? 1_000_000_000 : Math.pow(10, LYNX_DECIMALS);
  return BigInt(Math.round(amount * factor));
}

export function fromBaseUnits(amount: bigint | number, currency: 'SOL' | 'LYNX'): number {
  const factor = currency === 'SOL' ? 1_000_000_000 : Math.pow(10, LYNX_DECIMALS);
  return Number(amount) / factor;
}

// Convierte un precio "SOL por token" (o probabilidad 0..1) al formato
// limit_price_bps (0..10000) que espera el programa.
export function probabilityToBps(probability: number): number {
  return Math.max(0, Math.min(BPS_DENOMINATOR, Math.round(probability * BPS_DENOMINATOR)));
}

// Banda de slippage por defecto para compras a mercado: 10 puntos porcentuales
// sobre el precio implicito que el usuario vio. Generosa a proposito para no
// revertir compras legitimas en pools pequenos (donde una sola apuesta mueve
// mucho el precio implicito), pero corta un movimiento grande e inesperado.
export const DEFAULT_SLIPPAGE_BPS = 1000;

// Recorta max_price_bps al rango valido on-chain (1..=10000). 10000 = sin
// proteccion. Ver enforce_market_slippage en lib.rs.
function clampMaxPriceBps(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return BPS_DENOMINATOR;
  return Math.max(1, Math.min(BPS_DENOMINATOR, Math.round(value)));
}

// Precio implicito (bps) del lado `outcome` dado el estado actual del pool, o
// null si el pool esta vacio (aun no hay precio de referencia).
export function impliedPriceBpsForSide(pool: { yes: number; no: number; draw?: number }, outcome: OnChainOutcome): number | null {
  const total = pool.yes + pool.no + (pool.draw ?? 0);
  if (total <= 0) return null;
  const side = outcome === 'Yes' ? pool.yes : outcome === 'No' ? pool.no : (pool.draw ?? 0);
  return Math.round((side / total) * BPS_DENOMINATOR);
}

// max_price_bps para una compra a mercado: precio implicito actual del lado +
// una banda de tolerancia. Si el pool esta vacio devuelve 10000 (el guard
// on-chain se omite igualmente para el primer comprador).
export function maxPriceBpsWithSlippage(
  pool: { yes: number; no: number; draw?: number },
  outcome: OnChainOutcome,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): number {
  const current = impliedPriceBpsForSide(pool, outcome);
  if (current === null) return BPS_DENOMINATOR;
  return clampMaxPriceBps(current + slippageBps);
}

// --- PDAs ---

export function configPda(programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}

// Market PDA: seeds = [b"market", market_id.to_le_bytes()] (ver CreateMarket en lib.rs).
export function marketPda(marketId: bigint, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('market'), u64LE(marketId)], programId)[0];
}

export function marketVaultPda(market: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], programId)[0];
}

export function marketLynxVaultPda(market: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('lynx_vault'), market.toBuffer()], programId)[0];
}

export function positionPda(market: PublicKey, owner: PublicKey, outcome: OnChainOutcome, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), market.toBuffer(), owner.toBuffer(), Buffer.from([outcomeByte(outcome)])],
    programId
  )[0];
}

export function predictionOrderPda(market: PublicKey, owner: PublicKey, orderId: bigint, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pred_order'), market.toBuffer(), owner.toBuffer(), u64LE(orderId)],
    programId
  )[0];
}

export function predictionOrderEscrowSolPda(order: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('pred_order_escrow_sol'), order.toBuffer()], programId)[0];
}

export function predictionOrderEscrowLynxPda(order: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('pred_order_escrow_lynx'), order.toBuffer()], programId)[0];
}

export function spotOrderPda(owner: PublicKey, orderId: bigint, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('spot_order'), owner.toBuffer(), u64LE(orderId)], programId)[0];
}

export function spotOrderEscrowSolPda(order: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('spot_order_escrow_sol'), order.toBuffer()], programId)[0];
}

export function spotOrderEscrowLynxPda(order: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('spot_order_escrow_lynx'), order.toBuffer()], programId)[0];
}

// StakePosition PDA: seeds = [b"stake", owner] (ver StakeLynx en lib.rs).
export function stakePositionPda(owner: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('stake'), owner.toBuffer()], programId)[0];
}

// RewardsVault PDA: seeds = [b"rewards_vault"] (ver ClaimStakingRewards en lib.rs).
export function rewardsVaultPda(programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('rewards_vault')], programId)[0];
}

// Duel PDA: seeds = [b"duel", parent_market, creator, duel_id] (ver CreateDuel en lib.rs).
export function duelPda(parentMarket: PublicKey, creator: PublicKey, duelId: bigint, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('duel'), parentMarket.toBuffer(), creator.toBuffer(), u64LE(duelId)],
    programId
  )[0];
}

// DuelVault PDA: seeds = [b"duel_vault", duel] (ver CreateDuel en lib.rs).
export function duelVaultPda(duel: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('duel_vault'), duel.toBuffer()], programId)[0];
}

// DaoProposal PDA: seeds = [b"dao_proposal", proposal_id.to_le_bytes()] (ver CreateDaoProposal en lib.rs).
export function daoProposalPda(proposalId: bigint, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('dao_proposal'), u64LE(proposalId)], programId)[0];
}

// DaoVote PDA: seeds = [b"dao_vote", proposal, voter] (ver CastDaoVote en lib.rs).
export function daoVotePda(proposal: PublicKey, voter: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('dao_vote'), proposal.toBuffer(), voter.toBuffer()], programId)[0];
}

// Genera un order_id "unico con alta probabilidad" para este owner+mercado.
// Colisionar solo fallaria la creacion de la orden (la cuenta ya existiria),
// nunca corrompe estado; en ese caso, reintenta con otro id.
export function randomOrderId(): bigint {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return (BigInt(arr[0]) << 32n) | BigInt(arr[1]);
}

// --- Lectura de ProtocolConfig (para obtener el mint de LYNX y la tesoreria) ---

// stakeVault is read from the config account, not derived: it is an externally
// created token account whose address the program stores in config.stake_vault
// (it has no PDA seed — see InitializeProtocol in lib.rs). Field order in
// ProtocolConfig is admin, treasury, lynx_mint, stake_vault, rewards_vault, so
// after the 8-byte discriminator the offsets are 8, 40, 72, 104, 136.
let cachedConfig: { lynxMint: PublicKey; treasury: PublicKey; stakeVault: PublicKey } | null = null;
let cachedConfigTimestamp = 0;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getProtocolConfigInfo(connection: Connection): Promise<{ lynxMint: PublicKey; treasury: PublicKey; stakeVault: PublicKey }> {
  if (cachedConfig && Date.now() - cachedConfigTimestamp < CONFIG_CACHE_TTL_MS) return cachedConfig;
  const config = configPda();
  const info = await connection.getAccountInfo(config);
  if (!info) throw new Error('No se encontro la cuenta ProtocolConfig on-chain. ¿Esta bien configurado VITE_PROGRAM_ID?');
  if (!info.data.subarray(0, 8).equals(ACCOUNT_DISCRIMINATORS.protocolConfig)) {
    throw new Error('La cuenta config on-chain no tiene el formato esperado.');
  }
  let offset = 8;
  const admin = new PublicKey(info.data.subarray(offset, offset + 32)); offset += 32;
  const treasury = new PublicKey(info.data.subarray(offset, offset + 32)); offset += 32;
  const lynxMint = new PublicKey(info.data.subarray(offset, offset + 32)); offset += 32;
  const stakeVault = new PublicKey(info.data.subarray(offset, offset + 32));
  void admin;
  cachedConfig = { lynxMint, treasury, stakeVault };
  cachedConfigTimestamp = Date.now();
  return cachedConfig;
}

// Reset util para tests / si el programa se redespliega con otra config.
export function clearProtocolConfigCache() {
  cachedConfig = null;
  cachedConfigTimestamp = 0;
}

export type StakeInfo = { amount: number; pendingRewards: number };

// Reads the on-chain StakePosition for `owner`, or null if they have never
// staked (the PDA does not exist yet). This is the source of truth for the
// staked balance once staking is on-chain — the UI must read it here rather
// than from the backend's off-chain portfolio.
//
// Layout, after the 8-byte account discriminator (see StakePosition in
// programs/lynx_project/src/state.rs): owner Pubkey(32), amount u64,
// reward_debt_scaled u128, pending_rewards u64, bump u8. `amount` is in
// micro-LYNX; `pending_rewards` is in lamports (rewards are paid in SOL).
export async function readStakePosition(connection: Connection, owner: PublicKey): Promise<StakeInfo | null> {
  const info = await connection.getAccountInfo(stakePositionPda(owner));
  if (!info || info.data.length < 8 + 32 + 8 + 16 + 8) return null;
  const d = info.data;
  const amountMicroLynx = d.readBigUInt64LE(8 + 32); // offset 40
  const pendingLamports = d.readBigUInt64LE(8 + 32 + 8 + 16); // offset 64
  return {
    amount: Number(amountMicroLynx) / 10 ** LYNX_DECIMALS,
    pendingRewards: Number(pendingLamports) / 1_000_000_000,
  };
}

// The owner's on-chain LYNX (SPL) balance in whole LYNX, or 0 if they have no
// LYNX token account yet. This is what "available to stake" must read from once
// staking is on-chain — not the backend's off-chain portfolio balance.
export async function readLynxBalance(connection: Connection, owner: PublicKey): Promise<number> {
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const ata = await getAssociatedTokenAddress(lynxMint, owner);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0; // ATA does not exist yet
  }
}

async function ensureAtaInstruction(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): Promise<{ address: PublicKey; instruction: TransactionInstruction | null }> {
  const address = await getAssociatedTokenAddress(mint, owner);
  const info = await Promise.race([
    connection.getAccountInfo(address),
    new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 10000)),
  ]);
  if (info) return { address, instruction: null };
  return {
    address,
    instruction: createAssociatedTokenAccountInstruction(payer, address, owner, mint),
  };
}

function buildTx(instructions: TransactionInstruction[], feePayer: PublicKey): Transaction {
  const tx = new Transaction();
  instructions.forEach((ix) => tx.add(ix));
  tx.feePayer = feePayer;
  return tx;
}

// --- Creacion de mercado (admin) ---
//
// Construye la instruccion create_market que el admin firma con su wallet. El
// mercado y su boveda son PDAs init; el backend NO custodia nada: solo verifica
// contra el RPC que esta cuenta Market existe, la posee el programa y su titulo
// coincide, antes de indexarla (ver backend/src/chain.ts verifyOnChainMarketCreation).
//
// oracle_authority es quien podra proponer/resolver el resultado on-chain; para
// mercados manuales ("manual:admin") es el propio admin. cutoff_ts/resolve_ts van
// en SEGUNDOS unix (el programa los compara contra Clock).
export function buildCreateMarketTx(params: {
  admin: PublicKey;
  title: string;
  currency: 'SOL' | 'LYNX';
  isTernary: boolean;
  cutoffTs: number; // unix seconds
  resolveTs: number; // unix seconds
  oracleAuthority?: PublicKey; // por defecto, el admin (oraculo manual)
}): { tx: Transaction; marketId: bigint; marketPubkey: PublicKey } {
  const { admin, title, currency, isTernary, cutoffTs, resolveTs } = params;
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error('El titulo del mercado no puede estar vacio.');
  if (Buffer.from(trimmedTitle, 'utf8').length > MARKET_TITLE_MAX) {
    throw new Error(`El titulo del mercado supera ${MARKET_TITLE_MAX} bytes.`);
  }
  const programId = getProgramId();
  const oracleAuthority = params.oracleAuthority ?? admin;
  const marketId = randomOrderId();
  const market = marketPda(marketId, programId);
  const config = configPda(programId);
  const vault = marketVaultPda(market, programId);

  const data = Buffer.concat([
    IX.createMarket,
    u64LE(marketId),
    borshString(trimmedTitle),
    oracleAuthority.toBuffer(),
    i64LE(cutoffTs),
    i64LE(resolveTs),
    Buffer.from([currencyByte(currency)]),
    Buffer.from([isTernary ? 1 : 0]),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], admin), marketId, marketPubkey: market };
}

// --- Compra a mercado (precio actual del pool, sin condicion) ---

export async function buildBuyPositionSolTx(params: {
  buyer: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
  amountSol: number;
  // Precio implicito maximo (bps, 1..=10000) del lado elegido que se acepta.
  // Por defecto 10000 = sin proteccion. Ver buy_position_sol en lib.rs.
  maxPriceBps?: number;
}): Promise<Transaction> {
  const { buyer, market, outcome, amountSol } = params;
  const programId = getProgramId();
  const lamports = toBaseUnits(amountSol, 'SOL');
  const maxPriceBps = clampMaxPriceBps(params.maxPriceBps);
  const config = configPda(programId);
  const vault = marketVaultPda(market, programId);
  const position = positionPda(market, buyer, outcome, programId);

  const data = Buffer.concat([IX.buyPositionSol, Buffer.from([outcomeByte(outcome)]), u64LE(lamports), u64LE(maxPriceBps)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return buildTx([ix], buyer);
}

export async function buildBuyPositionLynxTx(params: {
  connection: Connection;
  buyer: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
  amountLynx: number;
  // Ver buildBuyPositionSolTx. Por defecto 10000 = sin proteccion.
  maxPriceBps?: number;
}): Promise<Transaction> {
  const { connection, buyer, market, outcome, amountLynx } = params;
  const programId = getProgramId();
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const maxPriceBps = clampMaxPriceBps(params.maxPriceBps);
  const config = configPda(programId);
  const position = positionPda(market, buyer, outcome, programId);
  const marketLynxVault = marketLynxVaultPda(market, programId);
  const userLynxAccount = await getAssociatedTokenAddress(lynxMint, buyer);

  const data = Buffer.concat([IX.buyPositionLynxWithBurn, Buffer.from([outcomeByte(outcome)]), u64LE(amount), u64LE(maxPriceBps)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: lynxMint, isSigner: false, isWritable: true },
      { pubkey: userLynxAccount, isSigner: false, isWritable: true },
      { pubkey: marketLynxVault, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return buildTx([ix], buyer);
}

// --- Ordenes limite ---

export async function buildCreateLimitOrderSolTx(params: {
  owner: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
  amountSol: number;
  limitProbability: number; // 0..1
  expiresTs: number; // unix seconds
}): Promise<{ tx: Transaction; orderId: bigint; orderPubkey: PublicKey }> {
  const { owner, market, outcome, amountSol, limitProbability, expiresTs } = params;
  const programId = getProgramId();
  const orderId = randomOrderId();
  const lamports = toBaseUnits(amountSol, 'SOL');
  const limitBps = probabilityToBps(limitProbability);
  const config = configPda(programId);
  const order = predictionOrderPda(market, owner, orderId, programId);
  const escrow = predictionOrderEscrowSolPda(order, programId);

  const data = Buffer.concat([
    IX.createPredictionLimitOrderSol,
    u64LE(orderId),
    Buffer.from([outcomeByte(outcome)]),
    u64LE(lamports),
    u64LE(limitBps),
    i64LE(expiresTs),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], owner), orderId, orderPubkey: order };
}

export async function buildCreateLimitOrderLynxTx(params: {
  connection: Connection;
  owner: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
  amountLynx: number;
  limitProbability: number;
  expiresTs: number;
}): Promise<{ tx: Transaction; orderId: bigint; orderPubkey: PublicKey }> {
  const { connection, owner, market, outcome, amountLynx, limitProbability, expiresTs } = params;
  const programId = getProgramId();
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const orderId = randomOrderId();
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const limitBps = probabilityToBps(limitProbability);
  const config = configPda(programId);
  const order = predictionOrderPda(market, owner, orderId, programId);
  const escrow = predictionOrderEscrowLynxPda(order, programId);
  const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);

  const data = Buffer.concat([
    IX.createPredictionLimitOrderLynx,
    u64LE(orderId),
    Buffer.from([outcomeByte(outcome)]),
    u64LE(amount),
    u64LE(limitBps),
    i64LE(expiresTs),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: lynxMint, isSigner: false, isWritable: true },
      { pubkey: userLynxAccount, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], owner), orderId, orderPubkey: order };
}

export function buildCancelLimitOrderSolTx(params: {
  signer: PublicKey;
  market: PublicKey;
  order: PublicKey;
  orderOwner: PublicKey;
}): Transaction {
  const { signer, market, order, orderOwner } = params;
  const programId = getProgramId();
  const escrow = predictionOrderEscrowSolPda(order, programId);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: orderOwner, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
    ],
    data: IX.cancelPredictionLimitOrderSol,
  });
  return buildTx([ix], signer);
}

export async function buildCancelLimitOrderLynxTx(params: {
  connection: Connection;
  signer: PublicKey;
  market: PublicKey;
  order: PublicKey;
  orderOwner: PublicKey;
}): Promise<Transaction> {
  const { connection, signer, market, order, orderOwner } = params;
  const programId = getProgramId();
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const config = configPda(programId);
  const escrow = predictionOrderEscrowLynxPda(order, programId);
  const ownerLynxAccount = await getAssociatedTokenAddress(lynxMint, orderOwner);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: ownerLynxAccount, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: IX.cancelPredictionLimitOrderLynx,
  });
  return buildTx([ix], signer);
}

// --- Reclamar payout ---

export function buildClaimMarketSolTx(params: {
  claimant: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
}): Transaction {
  const { claimant, market, outcome } = params;
  const programId = getProgramId();
  const vault = marketVaultPda(market, programId);
  const position = positionPda(market, claimant, outcome, programId);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: claimant, isSigner: true, isWritable: true },
    ],
    data: IX.claimMarketSol,
  });
  return buildTx([ix], claimant);
}

export async function buildClaimMarketLynxTx(params: {
  connection: Connection;
  claimant: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
}): Promise<Transaction> {
  const { connection, claimant, market, outcome } = params;
  const programId = getProgramId();
  const { lynxMint, treasury } = await getProtocolConfigInfo(connection);
  const config = configPda(programId);
  const position = positionPda(market, claimant, outcome, programId);
  const marketLynxVault = marketLynxVaultPda(market, programId);

  const instructions: TransactionInstruction[] = [];
  const claimantAta = await ensureAtaInstruction(connection, claimant, claimant, lynxMint);
  if (claimantAta.instruction) instructions.push(claimantAta.instruction);
  const treasuryAta = await getAssociatedTokenAddress(lynxMint, treasury);

  instructions.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: market, isSigner: false, isWritable: false },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: marketLynxVault, isSigner: false, isWritable: true },
        { pubkey: claimantAta.address, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: claimant, isSigner: true, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: IX.claimMarketLynx,
    })
  );
  return buildTx(instructions, claimant);
}

// --- Libro de ordenes LYNX/SOL on-chain (spot) ---

export async function buildPlaceSpotOrderBuyTx(params: {
  owner: PublicKey;
  amountLynx: number;
  priceSolPerLynx: number;
  expiresTs: number;
}): Promise<{ tx: Transaction; orderId: bigint; orderPubkey: PublicKey }> {
  const { owner, amountLynx, priceSolPerLynx, expiresTs } = params;
  const programId = getProgramId();
  const orderId = randomOrderId();
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const priceScaled = solPerLynxToPriceScaled(priceSolPerLynx);
  const config = configPda(programId);
  const order = spotOrderPda(owner, orderId, programId);
  const escrow = spotOrderEscrowSolPda(order, programId);

  const data = Buffer.concat([
    IX.placeSpotOrderBuy,
    u64LE(orderId),
    u64LE(amount),
    (() => { const b = Buffer.alloc(16); b.writeBigUInt64LE(priceScaled & 0xffffffffffffffffn, 0); b.writeBigUInt64LE(priceScaled >> 64n, 8); return b; })(),
    i64LE(expiresTs),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], owner), orderId, orderPubkey: order };
}

export async function buildPlaceSpotOrderSellTx(params: {
  connection: Connection;
  owner: PublicKey;
  amountLynx: number;
  priceSolPerLynx: number;
  expiresTs: number;
}): Promise<{ tx: Transaction; orderId: bigint; orderPubkey: PublicKey }> {
  const { connection, owner, amountLynx, priceSolPerLynx, expiresTs } = params;
  const programId = getProgramId();
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const orderId = randomOrderId();
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const priceScaled = solPerLynxToPriceScaled(priceSolPerLynx);
  const config = configPda(programId);
  const order = spotOrderPda(owner, orderId, programId);
  const escrow = spotOrderEscrowLynxPda(order, programId);
  const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);

  const data = Buffer.concat([
    IX.placeSpotOrderSell,
    u64LE(orderId),
    u64LE(amount),
    (() => { const b = Buffer.alloc(16); b.writeBigUInt64LE(priceScaled & 0xffffffffffffffffn, 0); b.writeBigUInt64LE(priceScaled >> 64n, 8); return b; })(),
    i64LE(expiresTs),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: lynxMint, isSigner: false, isWritable: true },
      { pubkey: userLynxAccount, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], owner), orderId, orderPubkey: order };
}

export function buildCancelSpotOrderBuyTx(params: { signer: PublicKey; order: PublicKey; orderOwner: PublicKey }): Transaction {
  const { signer, order, orderOwner } = params;
  const programId = getProgramId();
  const escrow = spotOrderEscrowSolPda(order, programId);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: orderOwner, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
    ],
    data: IX.cancelSpotOrderBuy,
  });
  return buildTx([ix], signer);
}

export async function buildCancelSpotOrderSellTx(params: {
  connection: Connection;
  signer: PublicKey;
  order: PublicKey;
  orderOwner: PublicKey;
}): Promise<Transaction> {
  const { connection, signer, order, orderOwner } = params;
  const programId = getProgramId();
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const config = configPda(programId);
  const escrow = spotOrderEscrowLynxPda(order, programId);
  const ownerLynxAccount = await getAssociatedTokenAddress(lynxMint, orderOwner);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: order, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: ownerLynxAccount, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: IX.cancelSpotOrderSell,
  });
  return buildTx([ix], signer);
}

// --- Staking LYNX on-chain -----------------------------------------------------
//
// WIRED INTO THE UI: useProgram.ts (stakeLynx/unstakeLynx/claimRewards) builds
// and signs these against the user's real LYNX via signAndSendOnChain, and the
// staking UI (StakeModal, GovernanceView, PortfolioView) calls them — the staked
// balance / pending rewards are read from the on-chain StakePosition, not an
// off-chain backend balance. Account order and data layout are cross-checked
// against StakeLynx/UnstakeLynx/ClaimStakingRewards in lib.rs and unit-tested in
// lynxProgram.staking.test.ts.
//
// STILL PENDING (see LAUNCH_DECISIONS.md phase 5): end-to-end verification
// against a program deployed on devnet, signing with a real wallet. A valid byte
// layout and green unit tests are not proof the deployed program accepts the
// transaction, so treat this path as verified-in-code but not yet verified
// end-to-end.

export async function buildStakeLynxTx(params: {
  connection: Connection;
  owner: PublicKey;
  amountLynx: number;
}): Promise<Transaction> {
  const { connection, owner, amountLynx } = params;
  const programId = getProgramId();
  const { lynxMint, stakeVault } = await getProtocolConfigInfo(connection);
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const config = configPda(programId);
  const stakePosition = stakePositionPda(owner, programId);
  const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);

  const data = Buffer.concat([IX.stakeLynx, u64LE(amount)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: stakePosition, isSigner: false, isWritable: true },
      { pubkey: userLynxAccount, isSigner: false, isWritable: true },
      { pubkey: lynxMint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return buildTx([ix], owner);
}

export async function buildUnstakeLynxTx(params: {
  connection: Connection;
  owner: PublicKey;
  amountLynx: number;
}): Promise<Transaction> {
  const { connection, owner, amountLynx } = params;
  const programId = getProgramId();
  const { lynxMint, stakeVault } = await getProtocolConfigInfo(connection);
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const config = configPda(programId);
  const stakePosition = stakePositionPda(owner, programId);
  const userLynxAccount = await getAssociatedTokenAddress(lynxMint, owner);

  const data = Buffer.concat([IX.unstakeLynx, u64LE(amount)]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: stakePosition, isSigner: false, isWritable: true },
      { pubkey: userLynxAccount, isSigner: false, isWritable: true },
      { pubkey: lynxMint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  return buildTx([ix], owner);
}

// Rewards are paid in SOL (lamports) from the rewards_vault, so no token account
// or mint is involved here — see claim_staking_rewards in lib.rs.
export function buildClaimStakingRewardsTx(params: {
  owner: PublicKey;
}): Transaction {
  const { owner } = params;
  const programId = getProgramId();
  const config = configPda(programId);
  const rewardsVault = rewardsVaultPda(programId);
  const stakePosition = stakePositionPda(owner, programId);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: rewardsVault, isSigner: false, isWritable: true },
      { pubkey: stakePosition, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
    ],
    data: IX.claimStakingRewards,
  });
  return buildTx([ix], owner);
}

// --- Duelos on-chain -----------------------------------------------------------
//
// WIRED INTO THE UI: useProgram.ts (createDuel/acceptDuel/cancelDuel) builds and
// signs these against the user's real SOL via signAndSendOnChain whenever there
// is an on-chain parent market and a connected wallet, and the duel UI
// (CreateDuelModal, DuelCard) calls them; the legacy off-chain engine
// (backend/src/state.ts) is only a fallback for markets without an on-chain
// backing. Account order and data layout are cross-checked against
// CreateDuel/AcceptDuel/CancelDuel in lib.rs and unit-tested in
// lynxProgram.duels.test.ts. Settlement (resolve_duel_sol / resolve_protocol_duel)
// is intentionally absent: those instructions take no signer — they are
// permissionless cranks and belong in the keeper (backend/src/chain.ts), not a
// user-signed client transaction.
//
// STILL PENDING (see LAUNCH_DECISIONS.md phase 5): like staking, end-to-end
// verification on devnet with a real deployed program and wallet — verified in
// code, not yet verified end-to-end.

export async function buildCreateDuelTx(params: {
  creator: PublicKey;
  parentMarket: PublicKey;
  creatorOutcome: OnChainOutcome;
  duelType: DuelType;
  amountSol: number;
  expiresTs: number;
}): Promise<{ tx: Transaction; duelId: bigint; duelPubkey: PublicKey }> {
  const { creator, parentMarket, creatorOutcome, duelType, amountSol, expiresTs } = params;
  const programId = getProgramId();
  const duelId = randomOrderId();
  const lamports = toBaseUnits(amountSol, 'SOL');
  const config = configPda(programId);
  const duel = duelPda(parentMarket, creator, duelId, programId);
  const duelVault = duelVaultPda(duel, programId);

  const data = Buffer.concat([
    IX.createDuel,
    u64LE(duelId),
    u64LE(lamports),
    Buffer.from([outcomeByte(creatorOutcome)]),
    Buffer.from([duelTypeByte(duelType)]),
    i64LE(expiresTs),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: parentMarket, isSigner: false, isWritable: false },
      { pubkey: duel, isSigner: false, isWritable: true },
      { pubkey: duelVault, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], creator), duelId, duelPubkey: duel };
}

export function buildAcceptDuelTx(params: {
  rival: PublicKey;
  duel: PublicKey;
  parentMarket: PublicKey;
  rivalOutcome: OnChainOutcome;
}): Transaction {
  const { rival, duel, parentMarket, rivalOutcome } = params;
  const programId = getProgramId();
  const config = configPda(programId);
  const duelVault = duelVaultPda(duel, programId);

  const data = Buffer.concat([IX.acceptDuel, Buffer.from([outcomeByte(rivalOutcome)])]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: duel, isSigner: false, isWritable: true },
      { pubkey: parentMarket, isSigner: false, isWritable: false },
      { pubkey: duelVault, isSigner: false, isWritable: true },
      { pubkey: rival, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return buildTx([ix], rival);
}

export function buildCancelDuelTx(params: {
  creator: PublicKey;
  duel: PublicKey;
}): Transaction {
  const { creator, duel } = params;
  const programId = getProgramId();
  const duelVault = duelVaultPda(duel, programId);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: duel, isSigner: false, isWritable: true },
      { pubkey: duelVault, isSigner: false, isWritable: true },
    ],
    data: IX.cancelDuel,
  });
  return buildTx([ix], creator);
}

// --- DAO on-chain (gobernanza, voto ponderado por stake) --------------------
//
// Reemplaza el DAO simulado del backend (state.ts). Crear propuestas es
// SOLO-ADMIN on-chain (create_dao_proposal exige config.admin); el peso del voto
// es el LYNX apostado del votante (StakePosition.amount) leido on-chain al votar,
// y la cuenta DaoVote (una por proposal+voter, `init`) impide el doble voto a
// nivel de programa. finalize_dao_proposal es permissionless tras end_ts.
// Layout/orden de cuentas cross-checkeado con CreateDaoProposal/CastDaoVote/
// FinalizeDaoProposal en lib.rs y unit-tested en lynxProgram.dao.test.ts.

export const DAO_TITLE_MAX = 128; // == DaoProposal::TITLE_MAX en state.rs

export function buildCreateDaoProposalTx(params: {
  admin: PublicKey;
  title: string;
  durationSeconds: number;
  proposalId?: bigint;
}): { tx: Transaction; proposalId: bigint; proposalPubkey: PublicKey } {
  const { admin, title, durationSeconds } = params;
  const trimmed = title.trim();
  if (!trimmed) throw new Error('El titulo de la propuesta no puede estar vacio.');
  if (Buffer.from(trimmed, 'utf8').length > DAO_TITLE_MAX) {
    throw new Error(`El titulo de la propuesta supera ${DAO_TITLE_MAX} bytes.`);
  }
  const programId = getProgramId();
  const proposalId = params.proposalId ?? randomOrderId();
  const config = configPda(programId);
  const proposal = daoProposalPda(proposalId, programId);

  const data = Buffer.concat([
    IX.createDaoProposal,
    u64LE(proposalId),
    borshString(trimmed),
    i64LE(durationSeconds),
  ]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { tx: buildTx([ix], admin), proposalId, proposalPubkey: proposal };
}

export function buildCastDaoVoteTx(params: {
  voter: PublicKey;
  proposalId: bigint;
  voteYes: boolean;
}): Transaction {
  const { voter, proposalId, voteYes } = params;
  const programId = getProgramId();
  const proposal = daoProposalPda(proposalId, programId);
  const stakePosition = stakePositionPda(voter, programId);
  const vote = daoVotePda(proposal, voter, programId);

  const data = Buffer.concat([IX.castDaoVote, Buffer.from([voteYes ? 1 : 0])]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: stakePosition, isSigner: false, isWritable: false },
      { pubkey: vote, isSigner: false, isWritable: true },
      { pubkey: voter, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return buildTx([ix], voter);
}

// Permissionless tras end_ts: cualquiera (nuestro keeper o un tercero) puede
// cerrar la propuesta; el resultado lo decide la mayoria de votos on-chain.
export function buildFinalizeDaoProposalTx(params: {
  payer: PublicKey;
  proposalId: bigint;
}): Transaction {
  const { payer, proposalId } = params;
  const programId = getProgramId();
  const proposal = daoProposalPda(proposalId, programId);
  const ix = new TransactionInstruction({
    programId,
    keys: [{ pubkey: proposal, isSigner: false, isWritable: true }],
    data: IX.finalizeDaoProposal,
  });
  return buildTx([ix], payer);
}
