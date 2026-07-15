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
 * una fase posterior (ver auditoria_lynx_project.md).
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
export function solPerLynxToPriceScaled(solPerLynx: number): bigint {
  const decimals = 10n ** BigInt(LYNX_DECIMALS);
  const numerator = BigInt(Math.round(solPerLynx * 1e9));
  const scaled = (numerator * PRICE_SCALE) / (1_000_000_000n * decimals);
  return scaled;
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
};

const ACCOUNT_DISCRIMINATORS = {
  protocolConfig: Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]),
};

function outcomeByte(outcome: OnChainOutcome): number {
  return { Yes: 1, No: 2, Draw: 3 }[outcome];
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

// --- PDAs ---

export function configPda(programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
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

// Genera un order_id "unico con alta probabilidad" para este owner+mercado.
// Colisionar solo fallaria la creacion de la orden (la cuenta ya existiria),
// nunca corrompe estado; en ese caso, reintenta con otro id.
export function randomOrderId(): bigint {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return (BigInt(arr[0]) << 32n) | BigInt(arr[1]);
}

// --- Lectura de ProtocolConfig (para obtener el mint de LYNX y la tesoreria) ---

let cachedConfig: { lynxMint: PublicKey; treasury: PublicKey } | null = null;
let cachedConfigTimestamp = 0;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getProtocolConfigInfo(connection: Connection): Promise<{ lynxMint: PublicKey; treasury: PublicKey }> {
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
  void admin;
  cachedConfig = { lynxMint, treasury };
  cachedConfigTimestamp = Date.now();
  return cachedConfig;
}

// Reset util para tests / si el programa se redespliega con otra config.
export function clearProtocolConfigCache() {
  cachedConfig = null;
  cachedConfigTimestamp = 0;
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

// --- Compra a mercado (precio actual del pool, sin condicion) ---

export async function buildBuyPositionSolTx(params: {
  buyer: PublicKey;
  market: PublicKey;
  outcome: OnChainOutcome;
  amountSol: number;
}): Promise<Transaction> {
  const { buyer, market, outcome, amountSol } = params;
  const programId = getProgramId();
  const lamports = toBaseUnits(amountSol, 'SOL');
  const config = configPda(programId);
  const vault = marketVaultPda(market, programId);
  const position = positionPda(market, buyer, outcome, programId);

  const data = Buffer.concat([IX.buyPositionSol, Buffer.from([outcomeByte(outcome)]), u64LE(lamports)]);
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
}): Promise<Transaction> {
  const { connection, buyer, market, outcome, amountLynx } = params;
  const programId = getProgramId();
  const { lynxMint } = await getProtocolConfigInfo(connection);
  const amount = toBaseUnits(amountLynx, 'LYNX');
  const config = configPda(programId);
  const position = positionPda(market, buyer, outcome, programId);
  const marketLynxVault = marketLynxVaultPda(market, programId);
  const userLynxAccount = await getAssociatedTokenAddress(lynxMint, buyer);

  const data = Buffer.concat([IX.buyPositionLynxWithBurn, Buffer.from([outcomeByte(outcome)]), u64LE(amount)]);
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
  const escrow = predictionOrderEscrowLynxPda(order, programId);
  const ownerLynxAccount = await getAssociatedTokenAddress(lynxMint, orderOwner);
  const ix = new TransactionInstruction({
    programId,
    keys: [
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
