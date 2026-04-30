import React from 'react';
import { Duel, MarketStatus } from '@/src/types';
import { formatSOL, cn } from '@/src/lib/utils';
import { Sword, User, Timer, ArrowRight, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { MOCK_MARKETS, STATUS_COLORS } from '@/src/constants';

interface DuelCardProps {
  key?: string;
  duel: Duel;
}

export function DuelCard({ duel }: DuelCardProps) {
  const parentMarket = MOCK_MARKETS.find(m => m.id === duel.parentMarketId);
  const isOpen = duel.status === MarketStatus.OPEN;
  const isLynx = duel.currency === 'LYNX';

  const displayAmount = duel.currency === 'LYNX' ? `${(duel.amount * 1).toLocaleString()} $LYNX` : formatSOL(duel.amount);

  return (
    <motion.div 
      whileHover={{ scale: 1.01 }}
      className={cn(
        "glass-card rounded overflow-hidden p-6 bg-[#0D0D0E] border relative group h-full",
        isLynx 
          ? "border-[#9945FF]/30 bg-[#9945FF]/5 hover:border-[#9945FF]/60" 
          : "border-[#1F1F23] hover:border-[#00FFD1]/30"
      )}
      id={`duel-card-${duel.id}`}
    >
      {isLynx && (
        <div className="absolute top-0 right-0 px-3 py-1 bg-[#9945FF] text-white text-[9px] font-black uppercase tracking-widest rounded-bl">
          LYNX DUEL
        </div>
      )}
      
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Sword className="w-24 h-24 rotate-12" />
      </div>

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-8">
          <div className={cn(
            "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border",
            STATUS_COLORS[duel.status]
          )}>
            {duel.status}
          </div>
          <div className={cn("text-xl font-mono font-bold tracking-tighter", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>
            {displayAmount}
          </div>
        </div>

        <div className="mb-8">
          <div className="text-[9px] uppercase text-[#52525B] font-bold mb-1 tracking-widest">Target Market</div>
          <h4 className="text-sm font-bold text-[#E4E4E7] line-clamp-1 group-hover:text-[#00FFD1] transition-colors tracking-tight">
            {parentMarket?.title || "Unknown Market"}
          </h4>
        </div>

        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              isLynx 
                ? "bg-[#9945FF]/10 border-[#9945FF]/30 group-hover:border-[#9945FF]/60 group-hover:shadow-[0_0_15px_rgba(153,69,255,0.1)]" 
                : "bg-[#00FFD1]/10 border-[#00FFD1]/30 group-hover:border-[#00FFD1]/60 group-hover:shadow-[0_0_15px_rgba(0,255,209,0.1)]"
            )}>
              <User className={cn("w-5 h-5", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")} />
            </div>
            <div className="text-[9px] font-mono text-[#52525B] uppercase tracking-tight">{duel.creator}</div>
            <div className={cn("text-[9px] font-black uppercase tracking-[0.2em]", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>PLAYER A</div>
          </div>

          <div className="flex flex-col items-center px-2 py-1 bg-[#18181B] rounded border border-[#27272A]">
            <div className="text-[10px] font-black text-[#3F3F46] italic uppercase">VS</div>
          </div>

          <div className="flex flex-col items-center gap-2 flex-1">
            <div className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              duel.rival 
                ? "bg-red-400/10 border-red-400/30 group-hover:border-red-400/60 group-hover:shadow-[0_0_15px_rgba(248,113,113,0.1)]" 
                : "bg-white/5 border-white/5 border-dashed"
            )}>
              {duel.rival ? (
                <User className="w-5 h-5 text-red-400" />
              ) : (
                <User className="w-5 h-5 text-[#27272A] opacity-50" />
              )}
            </div>
            <div className="text-[9px] font-mono text-[#52525B] uppercase tracking-tight">{duel.rival || "INVITING..."}</div>
            <div className="text-[9px] font-black text-red-400/80 uppercase tracking-[0.2em]">PLAYER B</div>
          </div>
        </div>

        <button className={cn(
          "w-full py-3 rounded font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2",
          isOpen 
            ? "bg-[#00FFD1] text-black hover:bg-[#00E5BC] shadow-[0_0_15px_rgba(0,255,209,0.2)]" 
            : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:text-white"
        )}>
          {isOpen ? "Accept Duel" : "Match Progress"}
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}
