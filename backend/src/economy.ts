// EVENT_PROTOCOL_FEE (10%) is the aggregate protocol take on resolved SOL
// markets, equal to STAKER_REWARD_FEE + TREASURY_EVENT_FEE below. It is kept
// here for reference/UI display only — it must never be applied as its own
// separate deduction, since the staker/treasury split already accounts for
// the full 10%.
export const EVENT_PROTOCOL_FEE = 0.1;
export const STAKER_REWARD_FEE = 0.05;
export const TREASURY_EVENT_FEE = 0.05;
export const GLOBAL_TRADE_FEE = 0.001;
export const LYNX_EVENT_BURN = 0.15;

export const LYNX_MINT_TIERS: Array<{ maxSupply: number; ratio: number }> = [
  { maxSupply: 500_000,   ratio: 1.00 },
  { maxSupply: 1_000_000, ratio: 0.80 },
  { maxSupply: 1_500_000, ratio: 0.70 },
  { maxSupply: 2_000_000, ratio: 0.60 },
  { maxSupply: 2_500_000, ratio: 0.50 },
  { maxSupply: 3_000_000, ratio: 0.40 },
  { maxSupply: 3_500_000, ratio: 0.30 },
  { maxSupply: 4_000_000, ratio: 0.20 },
  { maxSupply: 4_500_000, ratio: 0.10 },
  { maxSupply: 5_000_000, ratio: 0.05 },
];
export const LYNX_MINT_RATIO_FLOOR = 0.025;

export function getMintRatio(circulatingSupply: number): number {
  for (const tier of LYNX_MINT_TIERS) {
    if (circulatingSupply < tier.maxSupply) return tier.ratio;
  }
  return LYNX_MINT_RATIO_FLOOR;
}
// Minting split for LYNX emitted on resolved SOL markets:
// 85% to the participant (user), 15% sold on the order book at the
// initial listing price (see LYNX_INITIAL_SALE_PRICE below).
export const LYNX_PARTICIPANT_SHARE = 0.85;
export const LYNX_TREASURY_SHARE = 0;
export const LYNX_INITIAL_SALE_SHARE = 0.15;

// Initial order-book listing price for the 15% sale share, in SOL per LYNX.
// Must stay within the 0.6-0.7 SOL range.
export const LYNX_INITIAL_SALE_PRICE = 0.65;

export const DEV_WALLET = 'DEV_WALLET';

if (process.env.NODE_ENV === 'production' && !process.env.TREASURY_WALLET) {
  throw new Error('TREASURY_WALLET must be set in production');
}

export const TREASURY_WALLET = process.env.TREASURY_WALLET || 'LYNX_DEV_TREASURY';

export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

export function assertPositiveAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
}
