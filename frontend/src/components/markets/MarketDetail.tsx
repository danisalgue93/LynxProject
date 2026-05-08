import React, { useState, useEffect } from 'react';
import { Market, Position, Duel } from '@/src/types';
import { X, TrendingUp, ShieldCheck, Zap, Info, BarChart3, Clock, ArrowRight, Sword } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatSOL, cn } from '@/src/lib/utils';
import { useProgram } from '@/src/hooks/useProgram';
import { useTranslation } from 'react-i18next';

interface MarketDetailProps {
  market: Market;
  onClose: () => void;
}

export function MarketDetail({ market, onClose }: MarketDetailProps) {
  const { t } = useTranslation();
  const { fetchDuels, executeTrade } = useProgram();
  const [marketDuels, setMarketDuels] = useState<Duel[]>([]);
  
  const [betAmount, setBetAmount] = useState('5.0');
  const [selectedSide, setSelectedSide] = useState<Position>(Position.YES);
  const [isPending, setIsPending] = useState(false);

  const [activeMode, setActiveMode] = useState<'quick' | 'book' | 'duels'>('quick');

  useEffect(() => {
    if (activeMode === 'duels') {
      const loadDuels = async () => {
        const duels = await fetchDuels();
        setMarketDuels(duels.filter(d => d.parentMarketId === market.id));
      };
      loadDuels();
    }
  }, [fetchDuels, activeMode, market.id]);

  const handleQuickBet = async () => {
    setIsPending(true);
    try {
      await executeTrade(
        market.id,
        parseFloat(betAmount),
        selectedSide === Position.YES,
        'swap'
      );
      onClose();
    } catch (err) {
      console.error('Quick bet failed', err);
    } finally {
      setIsPending(false);
    }
  };

  const isLynx = market.currency === 'LYNX';
  const tokenAmount = (parseFloat(betAmount) / (selectedSide === Position.YES ? 0.621 : 0.379)).toFixed(2);

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#0A0A0B]/90 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <motion.div 
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        className="relative w-full max-w-6xl bg-[#0A0A0B] border-t md:border border-[#1F1F23] md:rounded-xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[95vh] md:h-auto md:min-h-0"
      >
        {/* Left Side: Market Info & Dynamic Content */}
        <div className="flex-1 p-5 md:p-10 flex flex-col bg-[#0D0D0E]/50 overflow-y-auto custom-scrollbar">
          <div className="mb-6 md:mb-8">
            <div className="flex items-center gap-3 mb-2">
              <span className={cn(
                "text-[8px] md:text-[9px] px-2 py-0.5 rounded border tracking-[0.2em] uppercase font-bold",
                isLynx ? "bg-[#9945FF]/10 text-[#9945FF] border-[#9945FF]/20" : "bg-[#18181B] text-[#A1A1AA] border-[#27272A]"
              )}>
                {market.category} Market #{market.id} {isLynx && `• ${t('marketDetail.special', 'SPECIAL')}`}
              </span>
              <span className="text-[8px] md:text-[9px] text-[#52525B] font-mono font-bold">{t('marketDetail.oracle', 'ORACLE: SWITCHBOARD')}</span>
            </div>
            <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              {market.title}
            </h1>
            
            {market.imageUrl && (
              <div className="w-full h-32 md:h-48 rounded-xl overflow-hidden mb-6 relative">
                 <img 
                    src={market.imageUrl} 
                    alt={market.title} 
                    className="w-full h-full object-cover opacity-80"
                    referrerPolicy="no-referrer"
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-[#0D0D0E] via-transparent to-transparent" />
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {activeMode === 'quick' && (
              <motion.div
                key="quick-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6 md:space-y-8"
              >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                   {[
                     { label: t('marketDetail.ratio', 'Ratio'), value: '62% YES', color: isLynx ? 'text-[#9945FF]' : 'text-[#00FFD1]' },
                     { label: t('marketDetail.asset', 'Asset'), value: market.currency, color: 'text-white' },
                     { label: t('marketDetail.yield', 'Yield'), value: '7.5%', color: 'text-[#9945FF]' },
                     { label: t('marketDetail.status', 'Status'), value: t('marketDetail.preEvent', 'PRE-EVENT'), color: 'text-amber-400' }
                   ].map((stat, i) => (
                     <div key={i} className="p-3 md:p-4 bg-[#141417] border border-[#27272A] rounded">
                       <span className="text-[8px] md:text-[9px] text-[#71717A] block uppercase font-bold mb-1">{stat.label}</span>
                       <span className={`text-[11px] md:text-sm font-mono font-bold ${stat.color}`}>{stat.value}</span>
                     </div>
                   ))}
                </div>

                <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#27272A] rounded-xl relative overflow-hidden bg-[#0D0D0E] min-h-[250px] md:min-h-[300px] p-6">
                   <div className={cn("absolute inset-0 opacity-10", isLynx ? "bg-[radial-gradient(circle_at_50%_50%,_#9945FF_0%,_transparent_70%)]" : "bg-[radial-gradient(circle_at_50%_50%,_#00FFD1_0%,_transparent_70%)]")}></div>
                   <div className="z-10 flex flex-col items-center text-center w-full max-w-xs">
                      <span className="text-[9px] md:text-[10px] text-[#52525B] uppercase font-bold tracking-widest mb-4">{t('marketDetail.probability', 'Probability')}</span>
                      <span className="text-4xl md:text-6xl font-mono font-bold text-white mb-2 tracking-tighter">0.621 <span className="text-xs md:text-sm text-[#52525B]">{market.currency}</span></span>
                      <div className="flex gap-2 mt-4 md:mt-6 w-full">
                        <div className="w-full h-1.5 md:h-2 bg-[#27272A] rounded-full overflow-hidden flex">
                          <div 
                            className={cn("h-full transition-all duration-1000", isLynx ? "bg-[#9945FF]" : "bg-gradient-to-r from-[#00FFD1] to-[#9945FF]")}
                            style={{ width: '62%' }}
                          ></div>
                        </div>
                      </div>
                      <div className="flex justify-between w-full mt-2 text-[8px] md:text-[10px] font-black uppercase">
                        <span className={cn(isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>62% YES</span>
                        <span className="text-red-400">38% NO</span>
                      </div>
                   </div>
                </div>
              </motion.div>
            )}

            {activeMode === 'book' && (
              <motion.div
                key="book-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4 md:space-y-6"
              >
                <div className="grid grid-cols-2 gap-4 md:gap-8">
                  <div>
                    <h4 className="text-[8px] md:text-[10px] font-bold text-[#00FFD1] uppercase tracking-widest mb-3 md:mb-4">{t('marketDetail.buyOrders', 'Buy Orders')}</h4>
                    <div className="space-y-1 font-mono text-[10px] md:text-[11px]">
                      {[0.645, 0.640, 0.635, 0.630, 0.625].map((p, i) => (
                        <div key={i} className="flex justify-between p-1.5 md:p-2 hover:bg-white/5 rounded transition-colors group">
                          <span className="text-[#00FFD1]">{p.toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">12.5</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[8px] md:text-[10px] font-bold text-red-400 uppercase tracking-widest mb-3 md:mb-4">{t('marketDetail.sellOrders', 'Sell Orders')}</h4>
                    <div className="space-y-1 font-mono text-[10px] md:text-[11px]">
                      {[0.615, 0.610, 0.605, 0.600, 0.595].map((p, i) => (
                        <div key={i} className="flex justify-between p-1.5 md:p-2 hover:bg-white/5 rounded transition-colors group">
                          <span className="text-red-400">{p.toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">8.2</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="p-6 md:p-8 border border-dashed border-[#27272A] rounded-xl flex flex-col items-center justify-center text-center bg-[#0A0A0B]">
                    <BarChart3 className={cn("w-8 h-8 md:w-12 md:h-12 mb-3 md:mb-4 opacity-20", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")} />
                    <p className="text-[8px] md:text-[10px] font-bold text-[#52525B] uppercase tracking-widest">{t('marketDetail.connectToTrade', 'Connect wallet to trade')}</p>
                </div>
              </motion.div>
            )}

            {activeMode === 'duels' && (
              <motion.div
                key="duels-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold text-white uppercase tracking-widest">{t('marketDetail.openChallenges', 'Open Challenges ({{count}})', { count: marketDuels.length })}</h4>
                  <button className={cn("px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest border transition-all", isLynx ? "border-[#9945FF]/30 text-[#9945FF] hover:bg-[#9945FF]/10" : "border-[#00FFD1]/30 text-[#00FFD1] hover:bg-[#00FFD1]/10")}>
                    {t('marketDetail.hostNewDuel', 'Host New Duel')}
                  </button>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                  {marketDuels.length > 0 ? marketDuels.map(duel => (
                    <div key={duel.id} className={cn("p-4 rounded border flex items-center justify-between group hover:scale-[1.01] transition-all cursor-pointer", isLynx ? "bg-[#9945FF]/5 border-[#9945FF]/20" : "bg-[#18181B] border-[#27272A]")}>
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded flex items-center justify-center border", isLynx ? "bg-[#9945FF]/10 border-[#9945FF]/20 text-[#9945FF]" : "bg-[#18181B] border-[#27272A] text-white")}>
                          <Sword className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-[10px] text-[#52525B] font-bold uppercase mb-0.5">{t('marketDetail.creator', 'Creator: {{creator}}', { creator: duel.creator })}</div>
                          <div className="text-sm font-bold text-white uppercase italic tracking-tighter">{t('marketDetail.versus', 'VERSUS {{position}}', { position: duel.positionA })}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-[#52525B] font-bold uppercase mb-0.5">{t('marketDetail.stakeStandalone', 'Stake')}</div>
                        <div className={cn("font-mono font-bold", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>{duel.amount} {market.currency}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="p-20 border border-dashed border-[#27272A] rounded-xl text-center">
                       <p className="text-[10px] font-bold text-[#52525B] uppercase tracking-widest">{t('marketDetail.noActiveDuels', 'No active duels for this event.')}</p>
                       <p className="text-[9px] text-[#52525B] uppercase mt-2">{t('marketDetail.beTheFirst', 'Be the first to host one!')}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Side: Execution Panel */}
         <aside className="w-full md:w-[360px] lg:w-[400px] bg-[#0D0D0E] border-t md:border-t-0 md:border-l border-[#1F1F23] flex flex-col shrink-0">
          <div className="p-4 md:p-6 border-b border-[#1F1F23]">
             <h3 className="hidden md:block text-[10px] md:text-[11px] font-bold text-[#71717A] uppercase tracking-widest mb-4 md:mb-6">{t('marketDetail.marketAccess', 'Market Access')}</h3>
             
             <div className="flex gap-1 bg-[#18181B] p-0.5 rounded mb-4 md:mb-6 border border-[#27272A]">
               <button 
                onClick={() => setActiveMode('quick')}
                className={cn(
                  "flex-1 py-1.5 md:py-3 text-[8px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  activeMode === 'quick' ? (isLynx ? "bg-[#9945FF] text-white" : "bg-[#0A0A0B] text-[#00FFD1]") : "text-[#52525B] hover:text-white"
                )}
               >
                 {t('marketDetail.quick', 'Quick')}
               </button>
               <button 
                onClick={() => setActiveMode('book')}
                className={cn(
                  "flex-1 py-1.5 md:py-3 text-[8px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  activeMode === 'book' ? (isLynx ? "bg-[#9945FF] text-white" : "bg-[#0A0A0B] text-[#00FFD1]") : "text-[#52525B] hover:text-white"
                )}
               >
                 {t('marketDetail.book', 'Book')}
               </button>
               <button 
                onClick={() => setActiveMode('duels')}
                className={cn(
                  "flex-1 py-1.5 md:py-3 text-[8px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  activeMode === 'duels' ? (isLynx ? "bg-[#9945FF] text-white" : "bg-[#0A0A0B] text-[#00FFD1]") : "text-[#52525B] hover:text-white"
                )}
               >
                 {t('marketDetail.duels', 'Duels')}
               </button>
             </div>

             <AnimatePresence mode="wait">
               {activeMode === 'quick' ? (
                 <motion.div
                    key="action-quick"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4 md:space-y-6"
                 >
                    <div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setSelectedSide(Position.YES)}
                          className={cn(
                            "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                            selectedSide === Position.YES 
                              ? (isLynx ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]" : "bg-[#00FFD1]/5 border-[#00FFD1] text-[#00FFD1]")
                              : "bg-[#18181B] border-[#27272A] text-[#52525B]"
                          )}
                        >
                          {t('marketDetail.yes', 'YES')}
                        </button>
                        <button 
                          onClick={() => setSelectedSide(Position.NO)}
                          className={cn(
                            "flex-1 py-2 md:py-4 rounded border transition-all font-black text-[10px] md:text-sm",
                            selectedSide === Position.NO 
                              ? "bg-red-400/10 border-red-400 text-red-400" 
                              : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40"
                          )}
                        >
                          {t('marketDetail.no', 'NO')}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1.5 md:mb-2">
                        <label className="text-[8px] md:text-[10px] text-[#71717A] uppercase font-bold tracking-wider">{t('marketDetail.stake', 'Stake ({{currency}})', { currency: market.currency })}</label>
                        <span className={cn("text-[8px] md:text-[10px] font-mono font-bold", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>{t('marketDetail.max', 'MAX: {{max}}', { max: isLynx ? '5K' : '42' })}</span>
                      </div>
                      <div className="relative group">
                        <input 
                          type="number" 
                          className="w-full bg-[#18181B] border border-[#27272A] rounded p-2.5 md:p-4 text-lg md:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter" 
                          value={betAmount}
                          onChange={(e) => setBetAmount(e.target.value)}
                        />
                        <button 
                          className="absolute right-1.5 md:right-2 top-1.5 md:top-2 bottom-1.5 md:bottom-2 px-2.5 md:px-3 bg-[#27272A] text-[8px] md:text-[10px] font-black text-[#A1A1AA] hover:text-[#00FFD1] hover:bg-[#2D2D33] uppercase rounded transition-all z-10"
                          onClick={() => setBetAmount(isLynx ? '5000' : '42')}
                        >
                          Max
                        </button>
                      </div>
                    </div>

                    <div className="bg-[#18181B] p-3 md:p-5 rounded border border-[#27272A] space-y-2 md:space-y-4">
                      <div className="flex justify-between text-[9px] md:text-[11px] font-medium items-center">
                        <span className="text-[#52525B] uppercase tracking-widest">{t('marketDetail.shares', 'Shares')}</span>
                        <span className="font-mono text-white font-bold">{tokenAmount}</span>
                      </div>
                      <div className="flex justify-between text-[9px] md:text-[11px] font-medium items-center">
                        <span className="text-[#52525B] uppercase tracking-widest">{t('marketDetail.estPayout', 'Est. Payout')}</span>
                        <span className={cn("font-mono font-bold", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>{(parseFloat(betAmount) * 1.6).toFixed(2)}</span>
                      </div>
                    </div>

                    <button 
                      onClick={handleQuickBet}
                      disabled={isPending}
                      className={cn(
                        "w-full text-black font-black py-3 md:py-4 rounded uppercase tracking-tighter text-[10px] md:text-sm transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 md:gap-3",
                        isLynx ? "bg-[#9945FF] shadow-[0_0_20px_rgba(153,69,255,0.3)]" : "bg-gradient-to-r from-[#00FFD1] to-[#9945FF] shadow-[0_0_20px_rgba(0,255,209,0.3)]"
                      )}
                    >
                      {isPending ? (
                        <>
                          <div className="w-3 h-3 md:w-4 md:h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                          {t('marketDetail.processing', 'Processing...')}
                        </>
                      ) : (
                        t('marketDetail.confirmTrade', "Confirm Trade")
                      )}
                    </button>
                 </motion.div>
               ) : (
                 <motion.div
                    key="action-info"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="p-6 bg-[#18181B]/50 border border-[#27272A] rounded-xl text-center"
                 >
                    <div className={cn("w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4", isLynx ? "bg-[#9945FF]/10 text-[#9945FF]" : "bg-[#00FFD1]/10 text-[#00FFD1]")}>
                       <Zap className="w-5 h-5" />
                    </div>
                    <h4 className="text-[11px] font-black text-white uppercase tracking-widest mb-2">{t('marketDetail.professionalMode', 'Professional Mode')}</h4>
                    <p className="text-[10px] text-[#71717A] leading-relaxed uppercase font-bold">
                      {activeMode === 'book' 
                        ? t('marketDetail.bookInfo', "Select a price point on the left to pre-fill an order. Direct P2P matching with zero spread.")
                        : t('marketDetail.duelsInfo', "Browse direct challenges for this event. These are fixed-odds duels with pre-defined stakes.")}
                    </p>
                 </motion.div>
               )}
             </AnimatePresence>
          </div>
          
          <div className="p-6 mt-auto">
             <button onClick={onClose} className="w-full text-[10px] font-bold text-[#52525B] uppercase tracking-[0.3em] hover:text-white transition-colors">
               {t('marketDetail.discardAndReturn', 'Discard & Return')}
             </button>
          </div>
        </aside>
      </motion.div>
    </div>
  );
}
