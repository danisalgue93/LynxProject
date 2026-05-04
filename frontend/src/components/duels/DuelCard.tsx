import React, { useState, useEffect } from 'react';
import { Duel, MarketStatus, Market } from '@/src/types';
import { formatSOL, cn } from '@/src/lib/utils';
import { Sword, User, Timer, ArrowRight, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { STATUS_COLORS } from '@/src/constants';
import { useProgram } from '@/src/hooks/useProgram';

interface DuelCardProps {
  key?: string;
  duel: Duel;
}

export function DuelCard({ duel }: DuelCardProps) {
  const { fetchMarkets } = useProgram();
  const [parentMarket, setParentMarket] = useState<Market | null>(null);

  useEffect(() => {
    const loadMarket = async () => {
      const markets = await fetchMarkets();
      const market = markets.find(m => m.id === duel.parentMarketId);
      if (market) setParentMarket(market);
    };
    loadMarket();
  }, [duel.parentMarketId, fetchMarkets]);

  const isOpen = duel.status === MarketStatus.OPEN;
  const isLynx = duel.currency === 'LYNX';

  const displayAmount = duel.currency === 'LYNX' ? `${(duel.amount * 1).toLocaleString()} $LYNX` : formatSOL(duel.amount);

  return (
    <motion.div 
      whileHover={{ scale: 1.01 }}
      className={cn(
        "glass-card rounded overflow-hidden p-4 md:p-6 bg-[#0D0D0E] border relative group h-full",
        isLynx 
          ? "border-[#9945FF]/30 bg-[#9945FF]/5 hover:border-[#9945FF]/60" 
          : "border-[#1F1F23] hover:border-[#00FFD1]/30"
      )}
      id={`duel-card-${duel.id}`}
    >
      {isLynx && (
        <div className="absolute top-0 right-0 px-2 md:px-3 py-0.5 md:py-1 bg-[#9945FF] text-white text-[7px] md:text-[9px] font-black uppercase tracking-widest rounded-bl">
          LYNX DUEL
        </div>
      )}
      
      <div className="absolute top-0 right-0 p-3 md:p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Sword className="w-16 h-16 md:w-24 md:h-24 rotate-12" />
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4 md:mb-8">
          <div className={cn(
            "px-1.5 md:px-2 py-0.5 rounded text-[7px] md:text-[9px] font-bold uppercase tracking-widest border",
            STATUS_COLORS[duel.status]
          )}>
            {duel.status}
          </div>
          <div className={cn("text-base md:text-xl font-mono font-bold tracking-tighter", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>
            {displayAmount}
          </div>
        </div>

        <div className="mb-4 md:mb-8">
          <div className="text-[7px] md:text-[9px] uppercase text-[#52525B] font-bold mb-0.5 md:mb-1 tracking-widest">Target Market</div>
          <h4 className="text-xs md:text-sm font-bold text-[#E4E4E7] line-clamp-1 group-hover:text-[#00FFD1] transition-colors tracking-tight">
            {parentMarket?.title || "Unknown Market"}
          </h4>
        </div>

        <div className="flex items-center justify-between gap-2 md:gap-4 mb-6 md:mb-8">
          <div className="flex flex-col items-center gap-1 md:gap-2 flex-1">
            <div className={cn(
              "w-8 h-8 md:w-12 md:h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              isLynx 
                ? "bg-[#9945FF]/10 border-[#9945FF]/30 group-hover:border-[#9945FF]/60 group-hover:shadow-[0_0_15px_rgba(153,69,255,0.1)]" 
                : "bg-[#00FFD1]/10 border-[#00FFD1]/30 group-hover:border-[#00FFD1]/60 group-hover:shadow-[0_0_15px_rgba(0,255,209,0.1)]"
            )}>
              <User className={cn("w-4 h-4 md:w-5 md:h-5", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")} />
            </div>
            <div className="text-[7px] md:text-[9px] font-mono text-[#52525B] uppercase tracking-tight">{duel.creator}</div>
            <div className={cn("text-[7px] md:text-[9px] font-black uppercase tracking-[0.2em]", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>PLAYER A</div>
          </div>

          <div className="flex flex-col items-center px-1 md:px-2 py-0.5 md:py-1 bg-[#18181B] rounded border border-[#27272A]">
            <div className="text-[8px] md:text-[10px] font-black text-[#3F3F46] italic uppercase">VS</div>
          </div>

          <div className="flex flex-col items-center gap-1 md:gap-2 flex-1">
            <div className={cn(
              "w-8 h-8 md:w-12 md:h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              duel.rival 
                ? "bg-red-400/10 border-red-400/30 group-hover:border-red-400/60 group-hover:shadow-[0_0_15px_rgba(248,113,113,0.1)]" 
                : "bg-red-400/10 border-red-400/30 border-dashed group-hover:border-red-400/50"
            )}>
              <User className={cn("w-4 h-4 md:w-5 md:h-5 text-red-400", !duel.rival && "opacity-70 animate-pulse")} />
            </div>
            <div className={cn(
              "text-[7px] md:text-[9px] font-mono uppercase tracking-tight",
              duel.rival ? "text-[#52525B]" : "text-red-400 italic"
            )}>{duel.rival || "Waiting..."}</div>
            <div className="text-[7px] md:text-[9px] font-black text-red-400 uppercase tracking-[0.2em]">PLAYER B</div>
          </div>
        </div>

        <button className={cn(
          "w-full py-2.5 md:py-3 rounded font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2",
          isOpen 
            ? "bg-[#00FFD1] text-black hover:bg-[#00E5BC] shadow-[0_0_15px_rgba(0,255,209,0.2)]" 
            : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:text-white"
        )}>
          {isOpen ? "Accept Duel" : "Match Progress"}
          <ArrowRight className="w-2.5 h-2.5 md:w-3 md:h-3" />
        </button>
      </div>
    </motion.div>
  );
}
