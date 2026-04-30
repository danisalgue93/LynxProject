import React from 'react';
import { Market, MarketStatus } from '@/src/types';
import { formatSOL, formatNumber } from '@/src/lib/utils';
import { TrendingUp, Users, Clock, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

import { cn } from '@/src/lib/utils';

interface MarketCardProps {
  key?: string;
  market: Market;
  onClick: (id: string) => void;
}

export function MarketCard({ market, onClick }: MarketCardProps) {
  const isCutoff = market.status === MarketStatus.CUT_OFF;
  const isLynx = market.currency === 'LYNX';
  
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className={cn(
        "glass-card rounded overflow-hidden cursor-pointer group flex flex-col h-full bg-[#0D0D0E] border transition-all",
        isLynx 
          ? "border-[#9945FF]/30 bg-[#9945FF]/5 hover:border-[#9945FF]/60" 
          : "border-[#1F1F23] hover:border-[#00FFD1]/30"
      )}
      onClick={() => onClick(market.id)}
      id={`market-card-${market.id}`}
    >
      {market.imageUrl && (
        <div className="h-32 md:h-40 w-full relative overflow-hidden">
          <img 
            src={market.imageUrl} 
            alt={market.title} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-60 group-hover:opacity-100"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D0E] to-transparent" />
        </div>
      )}
      <div className="p-4 md:p-6 flex-1 relative">
        {isLynx && (
          <div className="absolute top-0 right-0 px-2 md:px-3 py-1 bg-[#9945FF] text-white text-[8px] md:text-[9px] font-black uppercase tracking-widest rounded-bl">
            Special Event
          </div>
        )}

        <div className="flex items-center justify-between mb-3 md:mb-4">
          <span className="px-2 py-0.5 bg-[#18181B] text-[#A1A1AA] text-[8px] md:text-[10px] font-bold uppercase tracking-widest rounded border border-[#27272A]">
            {market.category}
          </span>
          <div className="flex items-center gap-1.5 text-[#52525B] text-[8px] md:text-[10px] font-bold uppercase tracking-wider">
            <Clock className="w-3 h-3" />
            {isCutoff ? 'RESOLVED' : 'ACTIVE'}
          </div>
        </div>

        <h3 className="text-lg md:text-xl font-bold text-white mb-2 line-clamp-2 min-h-[2.5rem] md:min-h-[3rem] group-hover:text-[#00FFD1] transition-colors leading-tight tracking-tight">
          {market.title}
        </h3>
        
        <div className="flex items-center gap-3 mb-4 md:mb-6">
          <div className="flex -space-x-1.5">
            {[1, 2, 3].map(i => (
              <div key={i} className="w-4 h-4 md:w-5 md:h-5 rounded-sm border border-[#0A0A0B] bg-[#1F1F23]" />
            ))}
          </div>
          <div className="text-[9px] md:text-[10px] text-[#71717A] uppercase font-bold tracking-widest">
            <span className="text-white">124</span> TRADERS
          </div>
        </div>

        <div className="space-y-4 pt-4 md:pt-5 border-t border-[#1F1F23]">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <div className="text-[8px] md:text-[9px] uppercase font-bold text-[#52525B] tracking-widest">Liquidity</div>
              <div className="text-base md:text-lg font-mono font-bold text-white leading-none tracking-tighter">
                {market.currency === 'LYNX' ? `${(market.poolAmount * 1).toLocaleString()} $LYNX` : formatSOL(market.poolAmount)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] md:text-[9px] uppercase font-bold text-[#52525B] tracking-widest">Price</div>
              <div className="text-base md:text-lg font-mono font-bold text-[#00FFD1] leading-none tracking-tighter">
                {(market.yesAmount / market.poolAmount * 100).toFixed(0)}¢
              </div>
            </div>
          </div>

          <div className="h-1 w-full bg-[#1F1F23] rounded-full overflow-hidden flex">
            <div 
              className={cn("h-full", isLynx ? "bg-[#9945FF]" : "bg-[#00FFD1]")}
              style={{ width: `${(market.yesAmount / market.poolAmount) * 100}%` }}
            />
          </div>
          
          <div className="flex justify-between text-[10px] font-mono font-bold uppercase">
            <span className={cn(isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>YES {(market.yesAmount / market.poolAmount * 100).toFixed(0)}%</span>
            <span className="text-red-400/80">NO {(market.noAmount / market.poolAmount * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div className="p-4 bg-[#0A0A0B]/50 border-t border-[#1F1F23] flex items-center justify-between group-hover:bg-[#00FFD1]/5 transition-colors">
        <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-widest group-hover:text-[#00FFD1]">View Details</span>
        <ArrowRight className="w-3 h-3 text-[#52525B] group-hover:text-[#00FFD1] group-hover:translate-x-1 transition-all" />
      </div>
    </motion.div>
  );
}
