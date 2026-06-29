import React, { useEffect, useState, useMemo } from 'react';
import { MarketCard } from './MarketCard';
import { Market } from '@/src/types';
import { useProgram } from '@/src/hooks/useProgram';
import { Loader2, Search, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { eventBus } from '@/src/lib/eventBus';

interface MarketsGridProps {
  onMarketSelect: (market: Market) => void;
  readOnly?: boolean;
  canCreateMarket?: boolean;
  onCreateMarket?: () => void;
}

type SortOption = 'volume' | 'ending' | 'newest';

export function MarketsGrid({ onMarketSelect, canCreateMarket = false, onCreateMarket }: MarketsGridProps) {
  const { t } = useTranslation();
  const { fetchMarkets, isLoading, error } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortOption>('volume');

  useEffect(() => {
    const loadMarkets = async () => {
      const data = await fetchMarkets();
      setMarkets(data);
    };
    loadMarkets();
    const onUpdate = () => { loadMarkets(); };
    eventBus.addEventListener('market:created', onUpdate as any);
    eventBus.addEventListener('market:updated', onUpdate as any);
    return () => {
      eventBus.removeEventListener('market:created', onUpdate as any);
      eventBus.removeEventListener('market:updated', onUpdate as any);
    };
  }, [fetchMarkets]);

  // Derive available categories dynamically from loaded markets
  const categories = useMemo(() => {
    const cats = new Set(markets.map(m => m.category).filter(Boolean));
    return ['all', ...Array.from(cats)];
  }, [markets]);

  // Filter and sort markets
  const filtered = useMemo(() => {
    let result = [...markets];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q)
      );
    }
    if (category !== 'all') {
      result = result.filter(m => m.category === category);
    }
    switch (sort) {
      case 'volume':
        result.sort((a, b) => (b.poolAmount || 0) - (a.poolAmount || 0));
        break;
      case 'ending':
        result.sort((a, b) => (a.cutoffAt || 0) - (b.cutoffAt || 0));
        break;
      case 'newest':
        result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        break;
    }
    return result;
  }, [markets, search, category, sort]);

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-6 md:mb-10 gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2 tracking-tight">{t('marketsGrid.title', 'Active Markets')}</h2>
          <p className="text-[#71717A] text-[10px] md:text-sm uppercase tracking-widest font-medium">{t('marketsGrid.subtitle', 'Trade on real-world outcomes with P2P precision.')}</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {canCreateMarket && (
            <button
              onClick={onCreateMarket}
              aria-label={t('marketsGrid.createMarket', 'Create market')}
              className="w-full sm:w-auto px-4 py-2 bg-[#00FFD1] text-black rounded text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#00E5BC] transition-all"
            >
              <Plus className="w-4 h-4" />
              {t('marketsGrid.createMarket', 'Create market')}
            </button>
          )}
          <div className="relative w-full sm:w-64 group flex-shrink-0">
            <label htmlFor="market-search" className="sr-only">{t('common.search', 'Search markets')}</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#52525B] group-focus-within:text-[#00FFD1] transition-colors" aria-hidden="true" />
            <input 
              type="search"
              id="market-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('common.search', 'Search markets...')}
              className="w-full bg-[#18181B] border border-[#27272A] rounded px-4 py-2 pl-10 text-xs text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#00FFD1] transition-all font-mono"
            />
          </div>

          <div className="flex items-center gap-2 md:gap-3 overflow-x-auto pb-2 md:pb-0 no-scrollbar w-full sm:w-auto">
            <label htmlFor="market-category" className="sr-only">{t('marketsGrid.category', 'Category')}</label>
            <select
              id="market-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="bg-[#18181B] border border-[#27272A] rounded px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest text-[#A1A1AA] focus:outline-none focus:border-[#00FFD1] min-w-[120px] md:min-w-[140px]"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? t('marketsGrid.allCategories', 'All Categories') : cat}
                </option>
              ))}
            </select>
            <label htmlFor="market-sort" className="sr-only">{t('marketsGrid.sortBy', 'Sort by')}</label>
            <select
              id="market-sort"
              value={sort}
              onChange={e => setSort(e.target.value as SortOption)}
              className="bg-[#18181B] border border-[#27272A] rounded px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest text-[#A1A1AA] focus:outline-none focus:border-[#00FFD1] min-w-[140px] md:min-w-[160px]"
            >
              <option value="volume">{t('marketsGrid.volHighToLow', 'Volume (High to Low)')}</option>
              <option value="ending">{t('marketsGrid.endingSoon', 'Ending Soon')}</option>
              <option value="newest">{t('marketsGrid.newest', 'Newest')}</option>
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]" role="status" aria-live="polite">
          <Loader2 className="w-8 h-8 text-[#00FFD1] animate-spin" aria-hidden="true" />
          <span className="ml-4 font-mono text-[#71717A] text-sm uppercase tracking-widest">{t('common.syncingBlockchain', 'Syncing with blockchain...')}</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center w-full min-h-[300px] bg-red-400/5 border border-red-400/20 rounded-xl p-8 text-center" role="alert">
          <p className="text-red-400 text-sm font-mono">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
         <div className="flex flex-col items-center justify-center w-full min-h-[300px] border border-dashed border-[#27272A] rounded-xl p-8 text-center bg-[#0D0D0E]/50">
           <p className="text-[#A1A1AA] text-sm font-bold uppercase tracking-widest mb-2">
             {search || category !== 'all'
               ? t('marketsGrid.noResults', 'No markets match your filters')
               : t('marketsGrid.noActiveMarkets', 'No Active Markets')}
           </p>
           <p className="text-[#52525B] text-[10px] uppercase tracking-wider font-mono">
             {search || category !== 'all'
               ? t('marketsGrid.clearFilters', 'Try adjusting your search or filters')
               : canCreateMarket
                 ? t('marketsGrid.createFirstMarket', 'Create the first market from the admin panel.')
                 : t('marketsGrid.noMarketsDesc', 'No markets have been created yet.')}
           </p>
         </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-8">
          {filtered.map(market => (
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
