export const EVENT_PROTOCOL_FEE = 0.1;
export const STAKER_REWARD_FEE = 0.05;
export const TREASURY_EVENT_FEE = 0.05;
export const GLOBAL_TRADE_FEE = 0.001;
export const LYNX_EVENT_BURN = 0.15;

export const LYNX_EMISSION_PER_SOL = 1;
export const LYNX_PARTICIPANT_SHARE = 0.2;
export const LYNX_TREASURY_SHARE = 0.2;
export const LYNX_INITIAL_SALE_SHARE = 0.6;

export const DEV_WALLET = 'DEV_WALLET';
export const TREASURY_WALLET = process.env.TREASURY_WALLET || 'LYNX_DEV_TREASURY';

export function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

export function assertPositiveAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }
}
