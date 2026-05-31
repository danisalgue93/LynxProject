import React, { useState, useEffect } from 'react';
import { Duel, DuelStatus, Market, Position } from '@/src/types';
import { formatSOL, cn } from '@/src/lib/utils';
import { Sword, User, Timer, ArrowRight, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { STATUS_COLORS } from '@/src/constants';
import { useProgram } from '@/src/hooks/useProgram';
import { useBlockchainTransaction } from '@/src/hooks/useBlockchainTransaction';
import { getManagedWalletAddress, useManagedAuthSession } from '@/src/lib/auth';
import { useTranslation } from 'react-i18next';

interface DuelCardProps {
  key?: string;
  duel: Duel;
}

export function DuelCard({ duel }: DuelCardProps) {
  const { t } = useTranslation();
  const { fetchMarkets, acceptDuel } = useProgram();
  const { executeTransaction } = useBlockchainTransaction();
  const { publicKey } = useWallet();
  const managedSession = useManagedAuthSession();
  const [parentMarket, setParentMarket] = useState<Market | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    const loadMarket = async () => {
      const markets = await fetchMarkets();
      const market = markets.find(m => m.id === duel.parentMarketId);
      if (market) setParentMarket(market);
    };
    loadMarket();
  }, [duel.parentMarketId, fetchMarkets]);

  const handleAccept = async (position?: Position) => {
    if (duel.status !== DuelStatus.OPEN || isCreator) return;
    setIsAccepting(true);
    try {
      await executeTransaction(
        async () => {
          await acceptDuel(duel.id, position);
          return `accept-duel-${duel.id}-${Date.now()}`;
        },
        {
          pendingMessage: t('duels.acceptPending', 'Accepting duel...'),
          successMessage: t('duels.acceptSuccess', 'Duel accepted successfully!'),
          errorMessage: t('duels.acceptFailed', 'Failed to accept duel'),
          explorerUrl: () => 'https://explorer.solana.com?cluster=devnet'
        }
      );
    } catch (e) {
      console.error(e);
    } finally {
      setIsAccepting(false);
    }
  };

  const isOpen = duel.status === DuelStatus.OPEN;
  const isLynx = duel.currency === 'LYNX';
  const currentWallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || '';
  const isCreator = Boolean(currentWallet && duel.creator === currentWallet);
  const cannotAcceptOwnDuelLabel = t('duels.cannotAcceptOwn', 'You created this duel');
  const ownDuelButtonLabel = t('duels.ownDuel', 'Own Duel');
  const acceptableTernaryPositions = [Position.YES, Position.NO, Position.DRAW].filter(
    (position) => position !== duel.positionA
  );

  const displayAmount = duel.currency === 'LYNX' ? `${(duel.amount * 1).toLocaleString()} $LYNX` : formatSOL(duel.amount);

  return (
    <motion.div 
      whileHover={{ scale: 1.01 }}
      className={cn(
        "glass-card rounded overflow-hidden p-4 md:p-6 bg-[#0D0D0E] border relative group h-full flex flex-col",
        isLynx 
          ? "border-[#9945FF]/30 bg-[#9945FF]/5 hover:border-[#9945FF]/60" 
          : "border-[#1F1F23] hover:border-[#00FFD1]/30"
      )}
      id={`duel-card-${duel.id}`}
    >
      {isLynx && (
        <div className="absolute top-0 right-0 px-2 md:px-3 py-0.5 md:py-1 bg-[#9945FF] text-white text-[7px] md:text-[9px] font-black uppercase tracking-widest rounded-bl">
          {t('duels.lynxDuel', 'LYNX DUEL')}
        </div>
      )}

      {!isLynx && duel.isTernary && (
        <div className="absolute top-0 right-0 px-2 md:px-3 py-0.5 md:py-1 bg-blue-500/80 text-white text-[7px] md:text-[9px] font-black uppercase tracking-widest rounded-bl">
          {t('duels.1v1vP', '1v1vP DUEL')}
        </div>
      )}
      
      <div className="absolute top-0 right-0 p-3 md:p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <Sword className="w-16 h-16 md:w-24 md:h-24 rotate-12" />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-4 md:mb-8">
          <div className={cn(
            "px-1.5 md:px-2 py-0.5 rounded text-[7px] md:text-[9px] font-bold uppercase tracking-widest border",
            STATUS_COLORS[duel.status]
          )}>
            {t(`status.${duel.status}`, duel.status)}
          </div>
          <div className={cn("text-base md:text-xl font-mono font-bold tracking-tighter", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>
            {displayAmount}
          </div>
        </div>

        <div className="mb-4 md:mb-8">
          <div className="text-[7px] md:text-[9px] uppercase text-[#52525B] font-bold mb-0.5 md:mb-1 tracking-widest">{t('duels.targetMarket', 'Target Market')}</div>
          <h4 className="text-xs md:text-sm font-bold text-[#E4E4E7] line-clamp-1 group-hover:text-[#00FFD1] transition-colors tracking-tight">
            {parentMarket?.title || t('duels.unknownMarket', 'Unknown Market')}
          </h4>
        </div>

        <div className="flex items-start justify-between gap-2 md:gap-4 mb-6 md:mb-8 h-[90px] md:h-[110px]">
          <div className="flex flex-col items-center gap-1 md:gap-2 flex-1 relative">
            <div className={cn(
              "w-8 h-8 md:w-12 md:h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              isLynx 
                ? "bg-[#9945FF]/10 border-[#9945FF]/30 group-hover:border-[#9945FF]/60 group-hover:shadow-[0_0_15px_rgba(153,69,255,0.1)]" 
                : "bg-[#00FFD1]/10 border-[#00FFD1]/30 group-hover:border-[#00FFD1]/60 group-hover:shadow-[0_0_15px_rgba(0,255,209,0.1)]"
            )}>
              <User className={cn("w-4 h-4 md:w-5 md:h-5", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")} />
            </div>
            <div className="absolute top-[40px] md:top-[60px] w-full items-center flex flex-col gap-1 md:gap-2">
              <div className="text-[7px] md:text-[9px] font-mono text-[#52525B] uppercase tracking-tight line-clamp-1 break-all px-1 text-center w-full">{duel.creator}</div>
              <div className={cn("text-[7px] md:text-[9px] font-black uppercase tracking-[0.2em]", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>{t('duels.playerA', 'PLAYER A')}</div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-start gap-1 md:gap-2 flex-1 pt-1 md:pt-2">
            {duel.isTernary ? (
              <>
                 <div className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center border transition-all duration-300 bg-[#9945FF]/10 border-[#9945FF]/50 shadow-[0_0_10px_rgba(153,69,255,0.2)]">
                    <Shield className="w-3 h-3 md:w-4 md:h-4 text-[#9945FF]" />
                 </div>
                 <div className="flex flex-col items-center mt-1">
                   <div className="text-[6px] md:text-[7px] font-mono text-[#52525B] uppercase tracking-tight">System</div>
                   <div className="text-[7px] md:text-[9px] font-black text-[#9945FF] uppercase tracking-[0.2em] leading-none my-0.5">{t('duels.protocol', 'PROTOCOL')}</div>
                   <div className="text-[5px] md:text-[6px] text-[#9945FF] uppercase tracking-wider">(LYNX)</div>
                 </div>
              </>
            ) : (
              <div className="px-1 md:px-2 py-0.5 md:py-1 bg-[#18181B] rounded border border-[#27272A] mt-2">
                <div className="text-[8px] md:text-[10px] font-black text-[#3F3F46] italic uppercase">{t('duels.vs', 'VS')}</div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-1 md:gap-2 flex-1 relative">
            <div className={cn(
              "w-8 h-8 md:w-12 md:h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              duel.rival 
                ? "bg-red-400/10 border-red-400/30 group-hover:border-red-400/60 group-hover:shadow-[0_0_15px_rgba(248,113,113,0.1)]" 
                : "bg-red-400/10 border-red-400/30 border-dashed group-hover:border-red-400/50"
            )}>
              <User className={cn("w-4 h-4 md:w-5 md:h-5 text-red-400", !duel.rival && "opacity-70 animate-pulse")} />
            </div>
            <div className="absolute top-[40px] md:top-[60px] w-full items-center flex flex-col gap-1 md:gap-2">
              <div className={cn(
                "text-[7px] md:text-[9px] font-mono uppercase tracking-tight line-clamp-1 break-all px-1 text-center w-full",
                duel.rival ? "text-[#52525B]" : "text-red-400 italic"
              )}>{duel.rival || t('duels.waiting', 'Waiting...')}</div>
              <div className="text-[7px] md:text-[9px] font-black text-red-400 uppercase tracking-[0.2em]">{t('duels.playerB', 'PLAYER B')}</div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center bg-[#141417]/50 border border-[#1F1F23] rounded p-2 md:p-3 mb-4 md:mb-6 h-[56px] md:h-[64px]">
          <div className="space-y-0.5 md:space-y-1">
             <div className="text-[7px] md:text-[8px] uppercase font-bold text-[#71717A] tracking-widest">{t('duels.winnerGets', 'Winner Gets')}</div>
             <div className="text-xs md:text-sm font-mono font-bold text-white tracking-tighter">
                {duel.currency === 'LYNX' ? `${((duel.amount * 2) * 0.999).toLocaleString()} $LYNX` : formatSOL((duel.amount * 2) * 0.999)}
             </div>
          </div>
          <div className="text-right flex flex-col justify-center items-end hidden sm:flex">
             <div className="text-[7px] md:text-[8px] uppercase font-bold text-[#71717A] tracking-widest mb-1">{isLynx ? t('duels.burn', 'Burn') : t('duels.endReward', 'End Reward')}</div>
             <div className={cn("text-[8px] md:text-[9px] font-bold px-1.5 py-0.5 rounded tracking-widest flex items-center gap-1", isLynx ? "bg-red-400/10 border border-red-400/30 text-red-400" : "bg-[#9945FF]/10 border border-[#9945FF]/30 text-[#9945FF]")}>
                {isLynx ? (
                  <>
                    <span className="whitespace-nowrap">-{(duel.amount * 2) * 0.15} LYNX</span>
                    <span className="opacity-70 text-[6px] md:text-[7px] whitespace-nowrap">({t('duels.lynxBurn', '15% BURN')})</span>
                  </>
                ) : duel.isTernary ? (
                  <>
                    <span className="whitespace-nowrap">+{duel.amount} LYNX</span>
                    <span className="opacity-70 text-[6px] md:text-[7px] whitespace-nowrap">({t('duels.lynxMatch', '+ 100% LYNX MATCH')})</span>
                  </>
                ) : (
                  <>
                    <span className="whitespace-nowrap">P2P</span>
                    <span className="opacity-70 text-[6px] md:text-[7px] whitespace-nowrap">(NO AUTO EMISSION)</span>
                  </>
                )}
             </div>
          </div>
          <div className="text-right flex flex-col justify-center items-end sm:hidden">
             <div className="text-[7px] md:text-[8px] uppercase font-bold text-[#71717A] tracking-widest leading-none mb-1">{isLynx ? t('duels.burn', 'Burn') : t('duels.endReward', 'End Reward')}</div>
             <div className={cn("text-[8px] md:text-[9px] font-bold tracking-widest flex flex-col items-end", isLynx ? "text-red-400" : "text-[#9945FF]")}>
                {isLynx ? (
                  <>
                    <span className="whitespace-nowrap leading-none">-{(duel.amount * 2) * 0.15} LYNX</span>
                  </>
                ) : duel.isTernary ? (
                  <>
                    <span className="whitespace-nowrap leading-none">+{duel.amount} LYNX</span>
                  </>
                ) : (
                  <>
                    <span className="whitespace-nowrap leading-none">P2P</span>
                  </>
                )}
             </div>
          </div>
        </div>

        <div className="mt-auto hidden" />
        <div className="mt-auto shrink-0">
          {duel.isTernary && isOpen ? (
            <div className={cn(
              "grid gap-2 h-10 md:h-12",
              acceptableTernaryPositions.length === 3 ? "grid-cols-3" : "grid-cols-2"
            )}>
              {acceptableTernaryPositions.map(pos => (
                  <button
                    key={pos}
                    onClick={() => handleAccept(pos)}
                    disabled={isAccepting || isCreator}
                    title={isCreator ? cannotAcceptOwnDuelLabel : undefined}
                    className={cn(
                      "w-full h-full rounded font-black text-[8px] md:text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden",
                      "bg-[#00FFD1] text-black hover:bg-[#00E5BC] shadow-[0_0_15px_rgba(0,255,209,0.2)]",
                      (isAccepting || isCreator) && "opacity-50 cursor-not-allowed hover:bg-[#00FFD1]"
                    )}
                  >
                    <span className="truncate">
                      {isCreator ? ownDuelButtonLabel : isAccepting ? t('duels.accepting', "...") : (
                        pos === Position.YES ? t('marketDetail.optA', 'OPT A') : 
                        pos === Position.NO ? t('marketDetail.optB', 'OPT B') : 
                        t('marketDetail.draw', 'DRAW')
                      )}
                    </span>
                  </button>
                ))}
            </div>
          ) : (
            <div className="h-10 md:h-12">
              <button 
                onClick={() => handleAccept()}
                 disabled={isAccepting || isCreator || (!isOpen && duel.status !== DuelStatus.OPEN)}
                 title={isCreator ? cannotAcceptOwnDuelLabel : undefined}
                 className={cn(
                 "w-full h-full rounded font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 whitespace-nowrap",
                 isOpen 
                   ? "bg-[#00FFD1] text-black hover:bg-[#00E5BC] shadow-[0_0_15px_rgba(0,255,209,0.2)]" 
                   : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:text-white",
                 (isAccepting || isCreator) && "opacity-50 cursor-not-allowed hover:bg-[#00FFD1]"
               )}>
                 <span className="truncate">{isCreator ? ownDuelButtonLabel : isAccepting ? t('duels.accepting', "Accepting...") : (isOpen ? t('duels.acceptDuel', "Accept Duel") : t('duels.matchProgress', "Match Progress"))}</span>
                 <ArrowRight className="w-2.5 h-2.5 md:w-3 md:h-3 shrink-0" />
               </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
