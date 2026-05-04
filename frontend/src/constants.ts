import { MarketStatus } from './types';

export const STATUS_COLORS: Record<MarketStatus, string> = {
  [MarketStatus.OPEN]: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  [MarketStatus.ACTIVE]: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  [MarketStatus.CUT_OFF]: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  [MarketStatus.RESOLVED]: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  [MarketStatus.EXPIRED]: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
};


