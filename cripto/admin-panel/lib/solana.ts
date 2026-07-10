import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { assertEnv, isDevMode } from './security';

// Discriminadores Anchor = primeros 8 bytes de sha256("global:<nombre_snake_case_de_la_instruccion>").
// Se recalculan a mano (sin @coral-xyz/anchor) porque este panel construye las
// instrucciones en crudo. Si cambias el nombre de una instruccion en lib.rs,
// recalcula el discriminador correspondiente.
//
// AP-23: To verify/recompute these discriminators, use:
//   echo -n "global:config" | sha256sum | head -c 16
// or the Anchor CLI: `anchor idl parse` to extract from the IDL.
// The 8 bytes shown are the first 8 bytes of the SHA-256 hash of
// "global:<snake_case_instruction_name>" (Anchor convention).
const DISCRIMINATORS = {
  config: Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]),
  market: Buffer.from([219, 190, 213, 55, 0, 227, 198, 154]),
  multisig: Buffer.from([224, 116, 121, 186, 68, 161, 79, 236]),
  proposal: Buffer.from([53, 107, 240, 190, 43, 73, 65, 143]),
};

// Instrucciones de gobernanza / disputa (ver cripto/programs/lynx_project/src/lib.rs).
// Reemplazan a la antigua resolve_market_admin de clave unica.
const IX = {
  initMultisig: Buffer.from([119, 130, 22, 116, 114, 61, 124, 66]),
  proposeAction: Buffer.from([49, 249, 251, 197, 25, 74, 36, 5]),
  approveAction: Buffer.from([200, 117, 44, 13, 133, 139, 131, 36]),
  cancelProposal: Buffer.from([106, 74, 128, 146, 19, 65, 39, 23]),
  executeAction: Buffer.from([246, 137, 105, 113, 247, 6, 223, 174]),
  executeResolveMarketAdmin: Buffer.from([47, 108, 105, 191, 227, 174, 49, 38]),
  proposeResolution: Buffer.from([19, 68, 181, 23, 194, 146, 152, 252]),
  disputeResolution: Buffer.from([89, 169, 106, 71, 131, 77, 122, 232]),
  finalizeResolution: Buffer.from([191, 74, 94, 214, 45, 150, 152, 125]),
};

// Indice de variante GovernanceAction, en el mismo orden que el enum en state.rs.
// Solo implementamos aqui la codificacion de ResolveMarketAdmin porque es la
// unica accion de gobernanza que dispara este panel; las demas (TransferAdmin,
// SetPaused, AddSigner, RemoveSigner, SetThreshold) se pueden anadir con el
// mismo patron si se necesitan desde la UI.
const GOVERNANCE_ACTION_VARIANT = {
  TransferAdmin: 0,
  SetPaused: 1,
  AddSigner: 2,
  RemoveSigner: 3,
  SetThreshold: 4,
  ResolveMarketAdmin: 5,
} as const;

export type MarketStatus = 'Open' | 'Active' | 'CutOff' | 'PendingResolution' | 'Resolved' | 'Expired';
export type OutcomeName = 'Yes' | 'No' | 'Draw';

export type AdminMarket = {
  pubkey: string;
  id: string;
  title: string;
  oracleAuthority: string;
  status: MarketStatus;
  isTernary: boolean;
  cutoffTs: number;
  resolveTs: number;
  oracleDeadline: number;
  poolTotal: string;
  yesTotal: string;
  noTotal: string;
  drawTotal: string;
  burnedLynx: string;
  // Nuevo: resultado propuesto por el oraculo (o por una GovernanceProposal ya
  // ejecutada) mientras el mercado esta en PendingResolution, y el timestamp
  // en el que se propuso. 'Unresolved'/0 si no hay ninguna propuesta activa.
  proposedResult: OutcomeName | 'Unresolved';
  proposedTs: number;
};

export type MultisigInfo = {
  pubkey: string;
  signers: string[];
  threshold: number;
  proposalSeq: string;
};

export type GovernanceProposalInfo = {
  pubkey: string;
  proposer: string;
  proposalId: string;
  actionVariant: number;
  actionMarket?: string;
  actionResult?: OutcomeName | 'Unresolved';
  approvals: string[];
  approvalCount: number;
  thresholdReachedTs: number;
  executed: boolean;
  cancelled: boolean;
  createdTs: number;
  expiresTs: number;
};

class Reader {
  offset = 8;

  constructor(private readonly data: Buffer) {}

  pubkey() {
    const value = new PublicKey(this.data.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return value;
  }

  u8() {
    return this.data[this.offset++];
  }

  bool() {
    return this.u8() === 1;
  }

  u64() {
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  i64() {
    const value = this.data.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  string() {
    const length = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    const value = this.data.subarray(this.offset, this.offset + length).toString('utf8');
    this.offset += length;
    return value;
  }
}

function hasDiscriminator(data: Buffer, discriminator: Buffer) {
  return data.subarray(0, 8).equals(discriminator);
}

function statusName(value: number): MarketStatus {
  return ['Open', 'Active', 'CutOff', 'PendingResolution', 'Resolved', 'Expired'][value] as MarketStatus;
}

function outcomeName(value: number): OutcomeName | 'Unresolved' {
  return (['Unresolved', 'Yes', 'No', 'Draw'][value] ?? 'Unresolved') as OutcomeName | 'Unresolved';
}

function outcomeByte(value: OutcomeName) {
  return { Yes: 1, No: 2, Draw: 3 }[value];
}

function u32LE(value: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

function u64LE(value: bigint | number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

export function getProgramId() {
  return new PublicKey(assertEnv('PROGRAM_ID'));
}

export function getConnection() {
  return new Connection(assertEnv('RPC_URL'), 'confirmed');
}

// Clave de ESTE admin. Cada despliegue del panel (uno por cada admin del
// multisig) debe tener su propia ADMIN_KEYPAIR_BS58 distinta: nunca compartir
// la misma clave entre los dos admins, o el multisig 2-de-2 deja de aportar
// nada frente a un unico punto de fallo.
export function getAdminKeypair() {
  return Keypair.fromSecretKey(bs58.decode(assertEnv('ADMIN_KEYPAIR_BS58')));
}

// AP-14: Zero out keypair secret key bytes to reduce window for memory scraping attacks.
// Call this in a finally block after any transaction that uses a keypair.
export function wipeKeypair(kp: Keypair) {
  kp.secretKey.fill(0);
}

// Clave del oraculo, solo necesaria si este mismo panel tambien opera el rol
// de oraculo para algun mercado (propose_resolution). Si tu oraculo vive en
// un servicio separado, no hace falta configurar esto aqui.
export function getOracleKeypair() {
  return Keypair.fromSecretKey(bs58.decode(assertEnv('ORACLE_KEYPAIR_BS58')));
}

export function configPda(programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}

export function vaultPda(market: PublicKey, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), market.toBuffer()], programId)[0];
}

export function rewardsVaultPda(programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('rewards_vault')], programId)[0];
}

export function multisigPda(config = configPda(), programId = getProgramId()) {
  return PublicKey.findProgramAddressSync([Buffer.from('multisig'), config.toBuffer()], programId)[0];
}

export function proposalPda(multisig: PublicKey, proposalSeq: bigint, programId = getProgramId()) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('gov_proposal'), multisig.toBuffer(), u64LE(proposalSeq)],
    programId
  )[0];
}

export function decodeConfig(data: Buffer) {
  if (!hasDiscriminator(data, DISCRIMINATORS.config)) throw new Error('Invalid config account');
  const reader = new Reader(data);
  const admin = reader.pubkey();
  const treasury = reader.pubkey();
  const lynxMint = reader.pubkey();
  const stakeVault = reader.pubkey();
  const rewardsVault = reader.pubkey();
  reader.u64(); // total_lynx_supply
  reader.u64(); // total_lynx_burned
  reader.u64(); // total_staked
  reader.offset += 16; // reward_per_token_scaled (u128)
  reader.i64(); // emergency_delay
  reader.u8(); // bump
  reader.u8(); // rewards_vault_bump
  const paused = reader.bool();
  const multisigInitialized = reader.bool();
  return { admin, treasury, lynxMint, stakeVault, rewardsVault, paused, multisigInitialized };
}

export function decodeMarket(pubkey: PublicKey, data: Buffer): AdminMarket {
  if (!hasDiscriminator(data, DISCRIMINATORS.market)) throw new Error('Invalid market account');
  const reader = new Reader(data);
  const id = reader.u64();
  reader.pubkey(); // admin
  reader.pubkey(); // vault
  const oracleAuthority = reader.pubkey();
  const title = reader.string();
  reader.u8(); // currency
  const status = statusName(reader.u8());
  const isTernary = reader.u8() === 1;
  const cutoffTs = Number(reader.i64());
  const resolveTs = Number(reader.i64());
  const oracleDeadline = Number(reader.i64());
  reader.i64(); // resolved_ts
  reader.u8(); // result
  const poolTotal = reader.u64();
  const yesTotal = reader.u64();
  const noTotal = reader.u64();
  const drawTotal = reader.u64();
  reader.u64(); // winning_total
  const burnedLynx = reader.u64();
  reader.u8(); // bump
  reader.u8(); // vault_bump
  reader.u8(); // lynx_vault_bump
  reader.u64(); // mint_ratio_bps
  reader.u8(); // swept
  const proposedResult = outcomeName(reader.u8());
  const proposedTs = Number(reader.i64());

  return {
    pubkey: pubkey.toBase58(),
    id: id.toString(),
    title,
    oracleAuthority: oracleAuthority.toBase58(),
    status,
    isTernary,
    cutoffTs,
    resolveTs,
    oracleDeadline,
    poolTotal: poolTotal.toString(),
    yesTotal: yesTotal.toString(),
    noTotal: noTotal.toString(),
    drawTotal: drawTotal.toString(),
    burnedLynx: burnedLynx.toString(),
    proposedResult,
    proposedTs,
  };
}

export function decodeMultisig(pubkey: PublicKey, data: Buffer): MultisigInfo {
  if (!hasDiscriminator(data, DISCRIMINATORS.multisig)) throw new Error('Invalid multisig account');
  const reader = new Reader(data);
  reader.pubkey(); // config
  const rawSigners: PublicKey[] = [];
  for (let i = 0; i < 5; i++) rawSigners.push(reader.pubkey());
  const signerCount = reader.u8();
  const threshold = reader.u8();
  const proposalSeq = reader.u64();
  return {
    pubkey: pubkey.toBase58(),
    signers: rawSigners.slice(0, signerCount).map((s) => s.toBase58()),
    threshold,
    proposalSeq: proposalSeq.toString(),
  };
}

export function decodeProposal(pubkey: PublicKey, data: Buffer): GovernanceProposalInfo {
  if (!hasDiscriminator(data, DISCRIMINATORS.proposal)) throw new Error('Invalid proposal account');
  const reader = new Reader(data);
  reader.pubkey(); // multisig
  const proposer = reader.pubkey();
  const proposalId = reader.u64();
  const actionVariant = reader.u8();
  let actionMarket: string | undefined;
  let actionResult: OutcomeName | 'Unresolved' | undefined;
  if (actionVariant === GOVERNANCE_ACTION_VARIANT.ResolveMarketAdmin) {
    actionMarket = reader.pubkey().toBase58();
    actionResult = outcomeName(reader.u8());
  } else {
    // Las demas variantes caben en como mucho 32 bytes; avanzamos el cursor
    // igual para no desalinear el resto de la lectura si en el futuro se
    // decodifican tambien sus campos.
    reader.offset += 32;
  }
  const rawApprovals: PublicKey[] = [];
  for (let i = 0; i < 5; i++) rawApprovals.push(reader.pubkey());
  const approvalCount = reader.u8();
  const thresholdReachedTs = Number(reader.i64());
  const executed = reader.bool();
  const cancelled = reader.bool();
  const createdTs = Number(reader.i64());
  const expiresTs = Number(reader.i64());

  return {
    pubkey: pubkey.toBase58(),
    proposer: proposer.toBase58(),
    proposalId: proposalId.toString(),
    actionVariant,
    actionMarket,
    actionResult,
    approvals: rawApprovals.slice(0, approvalCount).map((a) => a.toBase58()),
    approvalCount,
    thresholdReachedTs,
    executed,
    cancelled,
    createdTs,
    expiresTs,
  };
}

function mockMarkets(): AdminMarket[] {
  // AP-24: All mock data is prefixed with [MOCK] to make it obviously fake in audit trails/logs
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      pubkey: 'MockMadridDrawBarcelona111111111111111111',
      id: '1001',
      title: '[MOCK] Madrid - Empate - Barcelona',
      oracleAuthority: 'MockOracleAuthority111111111111111111111',
      status: 'CutOff',
      isTernary: true,
      cutoffTs: now - 7200,
      resolveTs: now - 4000,
      oracleDeadline: now - 400,
      poolTotal: '4200000000',
      yesTotal: '2100000000',
      noTotal: '2100000000',
      drawTotal: '0',
      burnedLynx: '0',
      proposedResult: 'Unresolved',
      proposedTs: 0,
    },
    {
      pubkey: 'MockBTCAbove100K111111111111111111111111',
      id: '1002',
      title: '[MOCK] BTC closes above 100k',
      oracleAuthority: 'MockOracleAuthority222222222222222222222',
      status: 'CutOff',
      isTernary: false,
      cutoffTs: now - 5400,
      resolveTs: now - 3900,
      oracleDeadline: now - 300,
      poolTotal: '1750000000',
      yesTotal: '900000000',
      noTotal: '850000000',
      drawTotal: '0',
      burnedLynx: '0',
      proposedResult: 'Unresolved',
      proposedTs: 0,
    },
  ];
}

// Ahora tambien devuelve mercados en PendingResolution, para que el panel
// pueda mostrar "resultado propuesto por el oraculo, disputable hasta X" y no
// solo los que ya llevan tiempo atascados en CutOff esperando al fallback admin.
export async function fetchPendingMarkets() {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return mockMarkets();
  }

  const connection = getConnection();
  const programId = getProgramId();
  const accounts = await connection.getProgramAccounts(programId);

  return accounts
    .filter(({ account }) => hasDiscriminator(account.data, DISCRIMINATORS.market))
    .map(({ pubkey, account }) => decodeMarket(pubkey, account.data))
    .filter((market) => market.status === 'CutOff' || market.status === 'PendingResolution')
    .sort((a, b) => a.oracleDeadline - b.oracleDeadline);
}

export async function fetchMultisig(): Promise<MultisigInfo> {
  const connection = getConnection();
  const config = configPda();
  const ms = multisigPda(config);
  const info = await connection.getAccountInfo(ms);
  if (!info) throw new Error('Multisig account not found. Run init_multisig first.');
  return decodeMultisig(ms, info.data);
}

export async function fetchOpenProposals(): Promise<GovernanceProposalInfo[]> {
  const connection = getConnection();
  const programId = getProgramId();
  const accounts = await connection.getProgramAccounts(programId);
  return accounts
    .filter(({ account }) => hasDiscriminator(account.data, DISCRIMINATORS.proposal))
    .map(({ pubkey, account }) => decodeProposal(pubkey, account.data))
    .filter((p) => !p.executed && !p.cancelled)
    .sort((a, b) => a.createdTs - b.createdTs);
}

// --- Paso 1: un admin (uno de los dos firmantes del multisig) PROPONE
// resolver un mercado atascado en CutOff via el fallback admin. Esto NO mueve
// ningun fondo todavia: solo crea la GovernanceProposal con 1 aprobacion (la
// del proponente). Requiere que ya haya pasado oracle_deadline (se valida
// tambien on-chain dentro de execute_resolve_market_admin).
export async function proposeResolveMarketAdmin(marketPubkey: string, result: OutcomeName) {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return { signature: `mock-propose-${marketPubkey}-${result}-${Date.now()}`, proposalPubkey: 'mock-proposal' };
  }

  const connection = getConnection();
  const programId = getProgramId();
  const proposer = getAdminKeypair();
  const market = new PublicKey(marketPubkey);
  const config = configPda(programId);
  const multisig = multisigPda(config, programId);

  const msInfo = await connection.getAccountInfo(multisig);
  if (!msInfo) throw new Error('Multisig account not found. Run init_multisig first.');
  const decodedMs = decodeMultisig(multisig, msInfo.data);
  const proposal = proposalPda(multisig, BigInt(decodedMs.proposalSeq), programId);

  const actionData = Buffer.concat([
    Buffer.from([GOVERNANCE_ACTION_VARIANT.ResolveMarketAdmin]),
    market.toBuffer(),
    Buffer.from([outcomeByte(result)]),
  ]);
  const data = Buffer.concat([IX.proposeAction, actionData]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: multisig, isSigner: false, isWritable: true },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: proposer.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = proposer.publicKey;
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [proposer], { commitment: 'confirmed' });
    return { signature, proposalPubkey: proposal.toBase58() };
  } finally {
    try { wipeKeypair(proposer); } catch { /* best-effort memory wipe */ }
  }
}

// --- Paso 2: el SEGUNDO admin (el otro firmante) aprueba la propuesta ya
// creada. Cuando approval_count alcanza el threshold del multisig (2 de 2 en
// el caso tipico de este proyecto), arranca el timelock de
// GOVERNANCE_EXECUTION_DELAY_SECONDS antes de poder ejecutarla.
export async function approveProposal(proposalPubkey: string) {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return `mock-approve-${proposalPubkey}-${Date.now()}`;
  }

  const connection = getConnection();
  const programId = getProgramId();
  const signerKeypair = getAdminKeypair();
  const config = configPda(programId);
  const multisig = multisigPda(config, programId);
  const proposal = new PublicKey(proposalPubkey);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: multisig, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: signerKeypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: IX.approveAction,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = signerKeypair.publicKey;
  try {
    return await sendAndConfirmTransaction(connection, tx, [signerKeypair], { commitment: 'confirmed' });
  } finally {
    try { wipeKeypair(signerKeypair); } catch { /* best-effort memory wipe */ }
  }
}

// --- Paso 3: una vez aprobada por el umbral y pasado el timelock, cualquiera
// (aqui, el admin que haga click) ejecuta de verdad la resolucion del mercado.
// Esto es lo unico que mueve fondos (via finalize_market_and_fees on-chain).
export async function executeResolveMarketAdmin(proposalPubkey: string, marketPubkey: string) {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return `mock-execute-${marketPubkey}-${Date.now()}`;
  }

  const connection = getConnection();
  const programId = getProgramId();
  const payer = getAdminKeypair();
  const market = new PublicKey(marketPubkey);
  const config = configPda(programId);
  const multisig = multisigPda(config, programId);
  const proposal = new PublicKey(proposalPubkey);

  const configInfo = await connection.getAccountInfo(config);
  if (!configInfo) throw new Error('Protocol config account not found');
  const decodedConfig = decodeConfig(configInfo.data);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: multisig, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vaultPda(market, programId), isSigner: false, isWritable: true },
      { pubkey: decodedConfig.rewardsVault, isSigner: false, isWritable: true },
      { pubkey: decodedConfig.treasury, isSigner: false, isWritable: true },
    ],
    data: IX.executeResolveMarketAdmin,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  try {
    return await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
  } finally {
    try { wipeKeypair(payer); } catch { /* best-effort memory wipe */ }
  }
}

// Cualquier firmante del multisig puede disputar un resultado propuesto por el
// oraculo (market.status === 'PendingResolution') mientras siga dentro de la
// ventana de disputa de 24h. Esto devuelve el mercado a CutOff sin mover
// fondos; la unica via para resolverlo despues es el flujo de gobernanza
// anterior (propose/approve/execute), una vez pasado oracle_deadline.
export async function disputeResolution(marketPubkey: string) {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return `mock-dispute-${marketPubkey}-${Date.now()}`;
  }

  const connection = getConnection();
  const programId = getProgramId();
  const signerKeypair = getAdminKeypair();
  const market = new PublicKey(marketPubkey);
  const config = configPda(programId);
  const multisig = multisigPda(config, programId);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: multisig, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: signerKeypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: IX.disputeResolution,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = signerKeypair.publicKey;
  try {
    return await sendAndConfirmTransaction(connection, tx, [signerKeypair], { commitment: 'confirmed' });
  } finally {
    try { wipeKeypair(signerKeypair); } catch { /* best-effort memory wipe */ }
  }
}

// Permissionless on-chain: The on-chain finalize_resolution instruction does not
// require any specific signer authority — anyone can crank it once the dispute
// window has expired. However, the admin panel STILL requires an authenticated
// admin session to trigger this call (for audit trail and rate-limiting purposes).
// This ensures every finalization triggered from the panel is logged and attributed.
export async function finalizeResolution(marketPubkey: string) {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return `mock-finalize-${marketPubkey}-${Date.now()}`;
  }

  const connection = getConnection();
  const programId = getProgramId();
  const payer = getAdminKeypair();
  const market = new PublicKey(marketPubkey);
  const config = configPda(programId);

  const configInfo = await connection.getAccountInfo(config);
  if (!configInfo) throw new Error('Protocol config account not found');
  const decodedConfig = decodeConfig(configInfo.data);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vaultPda(market, programId), isSigner: false, isWritable: true },
      { pubkey: decodedConfig.rewardsVault, isSigner: false, isWritable: true },
      { pubkey: decodedConfig.treasury, isSigner: false, isWritable: true },
    ],
    data: IX.finalizeResolution,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  try {
    return await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
  } finally {
    try { wipeKeypair(payer); } catch { /* best-effort memory wipe */ }
  }
}

// Bootstrap de una sola vez: crea el multisig 2-de-2 (o el M-de-N que se pase)
// a partir del admin unico original. Debe ejecutarse manualmente una vez
// tras desplegar el programa, antes de que transfer_admin/resolve_market_admin
// de clave unica queden inhabilitados.
export async function initMultisig(signerPubkeys: string[], threshold: number) {
  const connection = getConnection();
  const programId = getProgramId();
  const admin = getAdminKeypair();
  const config = configPda(programId);
  const multisig = multisigPda(config, programId);

  const signersBuf = Buffer.concat([
    u32LE(signerPubkeys.length),
    ...signerPubkeys.map((p) => new PublicKey(p).toBuffer()),
  ]);
  const data = Buffer.concat([IX.initMultisig, signersBuf, Buffer.from([threshold])]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: multisig, isSigner: false, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  try {
    return await sendAndConfirmTransaction(connection, tx, [admin], { commitment: 'confirmed' });
  } finally {
    try { wipeKeypair(admin); } catch { /* best-effort memory wipe */ }
  }
}
