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

const DISCRIMINATORS = {
  config: Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]),
  market: Buffer.from([219, 190, 213, 55, 0, 227, 198, 154]),
};

const RESOLVE_MARKET_ADMIN_IX = Buffer.from([217, 170, 181, 169, 93, 52, 2, 104]);

export type MarketStatus = 'Open' | 'Active' | 'CutOff' | 'Resolved';
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
};

class Reader {
  private offset = 8;

  constructor(private readonly data: Buffer) {}

  pubkey() {
    const value = new PublicKey(this.data.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return value;
  }

  u8() {
    return this.data[this.offset++];
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
  return ['Open', 'Active', 'CutOff', 'Resolved'][value] as MarketStatus;
}

function outcomeByte(value: OutcomeName) {
  return { Yes: 1, No: 2, Draw: 3 }[value];
}

export function getProgramId() {
  return new PublicKey(assertEnv('PROGRAM_ID'));
}

export function getConnection() {
  return new Connection(assertEnv('RPC_URL'), 'confirmed');
}

export function getAdminKeypair() {
  return Keypair.fromSecretKey(bs58.decode(assertEnv('ADMIN_KEYPAIR_BS58')));
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

export function decodeConfig(data: Buffer) {
  if (!hasDiscriminator(data, DISCRIMINATORS.config)) throw new Error('Invalid config account');
  const reader = new Reader(data);
  return {
    admin: reader.pubkey(),
    treasury: reader.pubkey(),
    lynxMint: reader.pubkey(),
    stakeVault: reader.pubkey(),
    rewardsVault: reader.pubkey(),
  };
}

export function decodeMarket(pubkey: PublicKey, data: Buffer): AdminMarket {
  if (!hasDiscriminator(data, DISCRIMINATORS.market)) throw new Error('Invalid market account');
  const reader = new Reader(data);
  const id = reader.u64();
  reader.pubkey();
  reader.pubkey();
  const oracleAuthority = reader.pubkey();
  const title = reader.string();
  reader.u8();
  const status = statusName(reader.u8());
  const isTernary = reader.u8() === 1;
  const cutoffTs = Number(reader.i64());
  const resolveTs = Number(reader.i64());
  const oracleDeadline = Number(reader.i64());
  reader.i64();
  reader.u8();
  const poolTotal = reader.u64();
  const yesTotal = reader.u64();
  const noTotal = reader.u64();
  const drawTotal = reader.u64();
  reader.u64();
  const burnedLynx = reader.u64();

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
  };
}


function mockMarkets(): AdminMarket[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      pubkey: 'MockMadridDrawBarcelona111111111111111111',
      id: '1001',
      title: 'Madrid - Empate - Barcelona',
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
    },
    {
      pubkey: 'MockBTCAbove100K111111111111111111111111',
      id: '1002',
      title: 'BTC closes above 100k',
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
    },
  ];
}

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
    .filter((market) => market.status === 'CutOff')
    .sort((a, b) => a.oracleDeadline - b.oracleDeadline);
}

export async function resolveMarketManually(marketPubkey: string, result: OutcomeName) {
  if (isDevMode() && process.env.MOCK_MARKETS === 'true') {
    return `mock-tx-${marketPubkey}-${result}-${Date.now()}`;
  }

  const connection = getConnection();
  const programId = getProgramId();
  const admin = getAdminKeypair();
  const market = new PublicKey(marketPubkey);
  const config = configPda(programId);
  const [configInfo, marketInfo] = await Promise.all([
    connection.getAccountInfo(config),
    connection.getAccountInfo(market),
  ]);

  if (!configInfo) throw new Error('Protocol config account not found');
  if (!marketInfo) throw new Error('Market account not found');

  const decodedConfig = decodeConfig(configInfo.data);
  const decodedMarket = decodeMarket(market, marketInfo.data);
  const now = Math.floor(Date.now() / 1000);

  if (!decodedConfig.admin.equals(admin.publicKey)) {
    throw new Error('Configured ADMIN_KEYPAIR_BS58 is not the current protocol admin');
  }
  if (decodedMarket.status !== 'CutOff') {
    throw new Error(`Market status is ${decodedMarket.status}; only CutOff markets can be resolved`);
  }
  if (now < decodedMarket.oracleDeadline) {
    const minutes = Math.ceil((decodedMarket.oracleDeadline - now) / 60);
    throw new Error(`Oracle timeout has not passed yet. Wait ${minutes} more minute(s).`);
  }

  const data = Buffer.concat([RESOLVE_MARKET_ADMIN_IX, Buffer.from([outcomeByte(result)])]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vaultPda(market, programId), isSigner: false, isWritable: true },
      { pubkey: decodedConfig.rewardsVault, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: decodedConfig.treasury, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  return sendAndConfirmTransaction(connection, tx, [admin], { commitment: 'confirmed' });
}
