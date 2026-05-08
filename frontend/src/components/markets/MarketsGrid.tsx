import React, { useEffect, useState } from 'react';
import { MarketCard } from './MarketCard';
import { Market } from '@/src/types';
import { useProgram } from '@/src/hooks/useProgram';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MarketsGridProps {
  onMarketSelect: (market: Market) => void;
}

export function MarketsGrid({ onMarketSelect }: MarketsGridProps) {
  const { t } = useTranslation();
  const { fetchMarkets, isLoading, error } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);

  useEffect(() => {
    const loadMarkets = async () => {
      const data = await fetchMarkets();
      setMarkets(data);
    };
    loadMarkets();
  }, [fetchMarkets]);

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 md:mb-10 gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2 tracking-tight">{t('marketsGrid.title', 'Active Markets')}</h2>
          <p className="text-[#71717A] text-[10px] md:text-sm uppercase tracking-widest font-medium">{t('marketsGrid.subtitle', 'Trade on real-world outcomes with P2P precision.')}</p>
        </div>
        
        <div className="flex items-center gap-2 md:gap-3 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
          <select className="bg-[#18181B] border border-[#27272A] rounded px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest text-[#A1A1AA] focus:outline-none focus:border-[#00FFD1] min-w-[120px] md:min-w-[140px]">
            <option>{t('marketsGrid.allCategories', 'All Categories')}</option>
            <option>{t('marketsGrid.crypto', 'Crypto')}</option>
            <option>{t('marketsGrid.ai', 'AI')}</option>
            <option>{t('marketsGrid.sports', 'Sports')}</option>
            <option>{t('marketsGrid.governance', 'Governance')}</option>
          </select>
          <select className="bg-[#18181B] border border-[#27272A] rounded px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest text-[#A1A1AA] focus:outline-none focus:border-[#00FFD1] min-w-[140px] md:min-w-[160px]">
            <option>{t('marketsGrid.volHighToLow', 'Volume (High to Low)')}</option>
            <option>{t('marketsGrid.endingSoon', 'Ending Soon')}</option>
            <option>{t('marketsGrid.newest', 'Newest')}</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="w-8 h-8 text-[#00FFD1] animate-spin" />
          <span className="ml-4 font-mono text-[#71717A] text-sm uppercase tracking-widest">{t('common.syncingBlockchain', 'Syncing with blockchain...')}</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center w-full min-h-[300px] bg-red-400/5 border border-red-400/20 rounded-xl p-8 text-center">
          <p className="text-red-400 text-sm font-mono">{error}</p>
        </div>
      ) : markets.length === 0 ? (
         <div className="flex flex-col items-center justify-center w-full min-h-[300px] border border-dashed border-[#27272A] rounded-xl p-8 text-center bg-[#0D0D0E]/50">
           <p className="text-[#A1A1AA] text-sm font-bold uppercase tracking-widest mb-2">{t('marketsGrid.noActiveMarkets', 'No Active Markets')}</p>
           <p className="text-[#52525B] text-[10px] uppercase tracking-wider font-mono">{t('marketsGrid.noMarketsDesc', 'Connect wallet to load contracts or deploy initial data.')}</p>
         </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-8">
          {markets.map(market => (
            <MarketCard 
              key={market.id} 
              market={market} 
              onClick={() => onMarketSelect(market)} 
            />
          ))}
        </div>
      )}
    </div>
  );
}
