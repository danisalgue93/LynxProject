import React from 'react';
import { MarketCard } from './MarketCard';
import { MOCK_MARKETS } from '@/src/constants';
import { Market } from '@/src/types';

interface MarketsGridProps {
  onMarketSelect: (market: Market) => void;
}

export function MarketsGrid({ onMarketSelect }: MarketsGridProps) {
  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 md:mb-10 gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2 tracking-tight">Active Markets</h2>
          <p className="text-[#71717A] text-[10px] md:text-sm uppercase tracking-widest font-medium">Trade on real-world outcomes with P2P precision.</p>
        </div>
        
        <div className="flex items-center gap-2 md:gap-3 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
          <select className="bg-[#18181B] border border-[#27272A] rounded px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest text-[#A1A1AA] focus:outline-none focus:border-[#00FFD1] min-w-[120px] md:min-w-[140px]">
            <option>All Categories</option>
            <option>Crypto</option>
            <option>AI</option>
            <option>Sports</option>
            <option>Governance</option>
          </select>
          <select className="bg-[#18181B] border border-[#27272A] rounded px-3 md:px-4 py-1.5 md:py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest text-[#A1A1AA] focus:outline-none focus:border-[#00FFD1] min-w-[140px] md:min-w-[160px]">
            <option>Volume (High to Low)</option>
            <option>Ending Soon</option>
            <option>Newest</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-8">
        {MOCK_MARKETS.map(market => (
          <MarketCard 
            key={market.id} 
            market={market} 
            onClick={() => onMarketSelect(market)} 
          />
        ))}
      </div>
    </div>
  );
}
