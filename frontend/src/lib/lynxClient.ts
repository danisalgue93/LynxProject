import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { Duel, Market, MarketStatus, Order, Position } from '@/src/types';

export const LYNX_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_LYNX_PROGRAM_ID ?? '7hPfrAwhNPJ6Xt7Y3ximBog1EdzfJV31VBTnYQxLRYCy',
);

const DISCRIMINATORS = {
  market: [219, 190, 213, 55, 0, 227, 198, 154],
  duel: [126, 229, 210, 60, 177, 135, 124, 224],
  order: [134, 173, 223, 185, 77, 86, 28, 51],
  userPosition: [251, 248, 209, 245, 83, 234, 17, 27],
  lynxBalance: [237, 219, 244, 203, 145, 46, 116, 16],
};

const IX = {
  buyPosition: [210, 108, 108, 28, 10, 46, 226, 137],
  placeOrder: [51, 194, 155, 175, 109, 130, 96, 106],
  createDuel: [49, 28, 93, 11, 75, 242, 69, 165],
};

const seed = (value: string) => new TextEncoder().encode(value);

type SendableWallet = WalletContextState & {
  sendTransaction: WalletContextState['sendTransaction'];
};

class Reader {
  private offset = 8;

  constructor(private readonly data: Uint8Array) {}

  pubkey() {
    const value = new PublicKey(this.data.slice(this.offset, this.offset + 32));
    this.offset += 32;
    return value;
  }

  u8() {
    return this.data[this.offset++];
  }

  bool() {
    return this.u8() === 1;
  }

  u32() {
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0, true);
    this.offset += 4;
    return value;
  }

  u64() {
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8).getBigUint64(0, true);
    this.offset += 8;
    return value;
  }

  i64() {
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8).getBigInt64(0, true);
    this.offset += 8;
    return value;
  }

  string() {
    const length = this.u32();
    const value = new TextDecoder().decode(this.data.slice(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
}

function hasDiscriminator(data: Uint8Array, discriminator: number[]) {
  return discriminator.every((byte, index) => data[index] === byte);
}

function sol(lamports: bigint | number) {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

function lamports(amount: number) {
  return BigInt(Math.round(amount * LAMPORTS_PER_SOL));
}

function writeU8(value: number) {
  return Uint8Array.of(value);
}

function writeU64(value: bigint | number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function writeI64(value: bigint | number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true);
  return bytes;
}

function concatBytes(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function marketStatus(value: number): MarketStatus {
  return [MarketStatus.OPEN, MarketStatus.ACTIVE, MarketStatus.CUT_OFF, MarketStatus.RESOLVED, MarketStatus.EXPIRED][value] ?? MarketStatus.OPEN;
}

function duelStatus(value: number): MarketStatus {
  return [MarketStatus.OPEN, MarketStatus.ACTIVE, MarketStatus.RESOLVED, MarketStatus.EXPIRED][value] ?? MarketStatus.OPEN;
}

function outcome(value: number): Position | undefined {
  return [undefined, Position.YES, Position.NO, Position.DRAW][value];
}

function binaryOutcome(value: number): Position {
  return value === 1 ? Position.NO : Position.YES;
}

function positionByte(position: Position) {
  return position === Position.NO || position === Position.B ? 1 : 0;
}

function requireWallet(wallet: SendableWallet) {
  if (!wallet.publicKey) throw new Error('Connect your wallet first');
  return wallet.publicKey;
}

export async function fetchOnChainMarkets(connection: Connection): Promise<Market[]> {
  const accounts = await connection.getProgramAccounts(LYNX_PROGRAM_ID);
  return accounts
    .filter(({ account }) => hasDiscriminator(account.data, DISCRIMINATORS.market))
    .map(({ pubkey, account }) => decodeMarket(pubkey, account.data))
    .sort((a, b) => b.poolAmount - a.poolAmount);
}

export async function fetchOnChainDuels(connection: Connection): Promise<Duel[]> {
  const accounts = await connection.getProgramAccounts(LYNX_PROGRAM_ID);
  return accounts
    .filter(({ account }) => hasDiscriminator(account.data, DISCRIMINATORS.duel))
    .map(({ pubkey, account }) => decodeDuel(pubkey, account.data));
}

export async function fetchOnChainOrders(connection: Connection, marketId?: string): Promise<Order[]> {
  const accounts = await connection.getProgramAccounts(LYNX_PROGRAM_ID);
  return accounts
    .filter(({ account }) => hasDiscriminator(account.data, DISCRIMINATORS.order))
    .map(({ pubkey, account }) => decodeOrder(pubkey, account.data))
    .filter((order) => !marketId || order.marketId === marketId);
}

export async function fetchOnChainPortfolio(connection: Connection, wallet: PublicKey | null) {
  if (!wallet) {
    return { solBalance: 0, lynxBalance: 0, totalProfit: 0, feeShare: '0.0', holdings: [], payments: [] };
  }

  const [balance, accounts, markets] = await Promise.all([
    connection.getBalance(wallet),
    connection.getProgramAccounts(LYNX_PROGRAM_ID),
    fetchOnChainMarkets(connection),
  ]);
  const marketsById = new Map(markets.map((market) => [market.id, market]));

  const holdings = accounts
    .filter(({ account }) => hasDiscriminator(account.data, DISCRIMINATORS.userPosition))
    .map(({ account }) => decodeUserPosition(account.data))
    .filter((position) => position.owner.equals(wallet))
    .map((position) => {
      const market = marketsById.get(position.market.toBase58());
      const currentPrice = market?.poolAmount
        ? position.position === Position.NO
          ? market.noAmount / market.poolAmount
          : market.yesAmount / market.poolAmount
        : 0.5;
      return {
        marketId: position.market.toBase58(),
        position: position.position,
        amount: sol(position.amount),
        entryPrice: 1,
        currentPrice,
      };
    });

  const [lynxAccount] = PublicKey.findProgramAddressSync([seed('lynx'), wallet.toBuffer()], LYNX_PROGRAM_ID);
  const lynxInfo = await connection.getAccountInfo(lynxAccount);
  const lynxBalance = lynxInfo && hasDiscriminator(lynxInfo.data, DISCRIMINATORS.lynxBalance) ? Number(decodeLynxBalance(lynxInfo.data)) : 0;

  return {
    solBalance: sol(balance),
    lynxBalance,
    totalProfit: 0,
    feeShare: lynxBalance > 0 ? '0.1' : '0.0',
    holdings,
    payments: [],
  };
}

export async function buyOnChainPosition(connection: Connection, wallet: SendableWallet, marketId: string, amountSol: number, position: Position) {
  const buyer = requireWallet(wallet);
  const market = new PublicKey(marketId);
  const [vault] = PublicKey.findProgramAddressSync([seed('vault'), market.toBuffer()], LYNX_PROGRAM_ID);
  const outcomeValue = positionByte(position);
  const [positionAccount] = PublicKey.findProgramAddressSync(
    [seed('position'), market.toBuffer(), buyer.toBuffer(), Uint8Array.of(outcomeValue)] as any,
    LYNX_PROGRAM_ID,
  );

  const data = concatBytes(Uint8Array.from(IX.buyPosition), writeU8(outcomeValue), writeU64(lamports(amountSol)));
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: LYNX_PROGRAM_ID,
      keys: [
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: positionAccount, isSigner: false, isWritable: true },
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data as any,
    }),
  );
  return wallet.sendTransaction(tx, connection);
}

export async function placeOnChainOrder(
  connection: Connection,
  wallet: SendableWallet,
  marketId: string,
  amount: number,
  isYes: boolean,
  priceSol: number,
) {
  const owner = requireWallet(wallet);
  const market = new PublicKey(marketId);
  const nonce = BigInt(Date.now());
  const [order] = PublicKey.findProgramAddressSync(
    [seed('order'), market.toBuffer(), owner.toBuffer(), writeU64(nonce)] as any,
    LYNX_PROGRAM_ID,
  );

  const data = concatBytes(
    Uint8Array.from(IX.placeOrder),
    writeU64(nonce),
    writeU8(1),
    writeU8(isYes ? 0 : 1),
    writeU64(lamports(amount)),
    writeU64(lamports(priceSol)),
  );
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: LYNX_PROGRAM_ID,
      keys: [
        { pubkey: market, isSigner: false, isWritable: false },
        { pubkey: order, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data as any,
    }),
  );
  return wallet.sendTransaction(tx, connection);
}

export async function createOnChainDuel(connection: Connection, wallet: SendableWallet, params: any) {
  const creator = requireWallet(wallet);
  const parentMarket = new PublicKey(params.parentMarketId);
  const duelId = BigInt(Date.now());
  const [duel] = PublicKey.findProgramAddressSync(
    [seed('duel'), parentMarket.toBuffer(), creator.toBuffer(), writeU64(duelId)] as any,
    LYNX_PROGRAM_ID,
  );
  const [duelVault] = PublicKey.findProgramAddressSync([seed('duel_vault'), duel.toBuffer()], LYNX_PROGRAM_ID);
  const expiresTs = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

  const data = concatBytes(
    Uint8Array.from(IX.createDuel),
    writeU64(duelId),
    writeU64(lamports(Number(params.amount))),
    writeU8(positionByte(params.positionA ?? Position.YES)),
    writeI64(expiresTs),
  );
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: LYNX_PROGRAM_ID,
      keys: [
        { pubkey: parentMarket, isSigner: false, isWritable: false },
        { pubkey: duel, isSigner: false, isWritable: true },
        { pubkey: duelVault, isSigner: false, isWritable: true },
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data as any,
    }),
  );
  return wallet.sendTransaction(tx, connection);
}

function decodeMarket(pubkey: PublicKey, data: Uint8Array): Market {
  const reader = new Reader(data);
  reader.u64();
  reader.pubkey();
  reader.pubkey();
  const title = reader.string();
  const oracleId = reader.string();
  const currency = reader.u8() === 1 ? 'LYNX' : 'SOL';
  const status = marketStatus(reader.u8());
  const cutoffAt = Number(reader.i64()) * 1000;
  const resolvedRaw = Number(reader.i64()) * 1000;
  const result = outcome(reader.u8());
  const poolAmount = sol(reader.u64());
  const yesAmount = sol(reader.u64());
  const noAmount = sol(reader.u64());
  reader.u64();

  return {
    id: pubkey.toBase58(),
    title,
    description: oracleId,
    category: currency === 'LYNX' ? 'Governance' : 'On-chain',
    status,
    poolAmount,
    yesAmount,
    noAmount,
    currency,
    oracleId,
    createdAt: 0,
    cutoffAt,
    resolvedAt: resolvedRaw > 0 ? resolvedRaw : undefined,
    result,
  };
}

function decodeDuel(pubkey: PublicKey, data: Uint8Array): Duel {
  const reader = new Reader(data);
  const parentMarket = reader.pubkey();
  const creator = reader.pubkey();
  const rival = reader.pubkey();
  const amount = sol(reader.u64());
  const creatorOutcome = binaryOutcome(reader.u8());
  const status = duelStatus(reader.u8());
  reader.i64();

  return {
    id: pubkey.toBase58(),
    parentMarketId: parentMarket.toBase58(),
    creator: creator.toBase58(),
    rival: rival.equals(PublicKey.default) ? undefined : rival.toBase58(),
    amount,
    currency: 'SOL',
    status,
    positionA: creatorOutcome,
    positionB: creatorOutcome === Position.YES ? Position.NO : Position.YES,
    createdAt: 0,
  };
}

function decodeOrder(pubkey: PublicKey, data: Uint8Array): Order {
  const reader = new Reader(data);
  const market = reader.pubkey();
  const owner = reader.pubkey();
  const side = reader.u8() === 0 ? 'BUY' : 'SELL';
  const position = binaryOutcome(reader.u8());
  reader.u64();
  const remaining = sol(reader.u64());
  const price = sol(reader.u64());

  return {
    id: pubkey.toBase58(),
    marketId: market.toBase58(),
    owner: owner.toBase58(),
    side,
    position,
    amount: remaining,
    price,
    createdAt: 0,
  };
}

function decodeUserPosition(data: Uint8Array) {
  const reader = new Reader(data);
  const market = reader.pubkey();
  const owner = reader.pubkey();
  const position = binaryOutcome(reader.u8());
  const amount = reader.u64();
  reader.bool();
  reader.bool();
  return { market, owner, position, amount };
}

function decodeLynxBalance(data: Uint8Array) {
  const reader = new Reader(data);
  reader.pubkey();
  return reader.u64();
}
