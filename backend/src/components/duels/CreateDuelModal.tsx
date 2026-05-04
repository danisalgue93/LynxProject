import React, { useState, useEffect } from 'react';
import { Market, Position } from '@/src/types';
import { useProgram } from '@/src/hooks/useProgram';
import { X, Sword, Target, ChevronRight, Info, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatSOL, cn } from '@/src/lib/utils';

interface CreateDuelModalProps {
  onClose: () => void;
  onSubmit: (duel: any) => void;
}

export function CreateDuelModal({ onClose, onSubmit }: CreateDuelModalProps) {
  const { fetchMarkets, isLoading } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);
  
  const [step, setStep] = useState(1);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [side, setSide] = useState<Position | null>(null);
  const [amount, setAmount] = useState<number>(0.1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadMarkets = async () => {
      const data = await fetchMarkets();
      setMarkets(data);
    };
    loadMarkets();
  }, [fetchMarkets]);

  const currency = selectedMarket?.currency || 'SOL';
  const FIXED_AMOUNTS = currency === 'SOL' ? [0.1, 0.25, 0.5, 1, 5, 10] : [100, 250, 500, 1000, 5000, 10000];

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  // Auto-set amount when currency changes
  const selectMarketAndNext = (market: Market) => {
    setSelectedMarket(market);
    setAmount(market.currency === 'SOL' ? 0.1 : 100);
    handleNext();
  };

  const submitDuel = async () => {
    if (!selectedMarket || !side) return;
    setIsSubmitting(true);
    try {
      await onSubmit({ marketId: selectedMarket.id, side, amount, currency });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 text-white">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#0A0A0B]/95 backdrop-blur-md"
        onClick={onClose}
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-lg bg-[#0D0D0E] border border-[#1F1F23] rounded-xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="p-6 border-b border-[#1F1F23] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-400/10 rounded flex items-center justify-center text-red-400 border border-red-400/20">
              <Sword className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight uppercase">Forge 1v1 Duel</h2>
              <div className="text-[9px] text-[#52525B] font-bold uppercase tracking-widest">Balanced P2P Matching</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[#52525B] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div>
                  <label className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-4 block">1. Select Target Event</label>
                  <p className="text-[10px] text-[#52525B] font-bold uppercase mb-4">Choose a market to build your duel around</p>
                  
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 text-[#00FFD1] animate-spin" />
                    </div>
                  ) : markets.length === 0 ? (
                    <div className="text-center py-8">
                       <p className="text-[#A1A1AA] text-xs font-mono">No active markets available for duel</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                      {markets.map(market => {
                        const isLynx = market.currency === 'LYNX';
                        return (
                          <button
                            key={market.id}
                            onClick={() => selectMarketAndNext(market)}
                            className={cn(
                              "w-full p-4 rounded border text-left transition-all group flex items-center justify-between relative overflow-hidden",
                              isLynx 
                                ? "bg-[#9945FF]/5 border-[#9945FF]/30 hover:border-[#9945FF]/60" 
                                : "bg-[#18181B] border-[#27272A] hover:border-[#00FFD1]/50"
                            )}
                          >
                            {isLynx && (
                              <div className="absolute top-0 right-0 px-2 py-0.5 bg-[#9945FF] text-white text-[7px] font-black uppercase tracking-widest rounded-bl">
                                Special Event
                              </div>
                            )}
                            <div>
                              <div className="text-[9px] text-[#52525B] font-bold uppercase mb-1">{market.category}</div>
                              <div className={cn("text-sm font-bold group-hover:text-[#00FFD1] line-clamp-1", isLynx ? "text-[#9945FF]" : "text-white")}>
                                {market.title}
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[#27272A] group-hover:text-[#00FFD1]" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {step === 2 && selectedMarket && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className={cn(
                  "p-4 rounded border",
                  currency === 'LYNX' ? "bg-[#9945FF]/5 border-[#9945FF]/30" : "bg-[#141417] border-[#27272A]"
                )}>
                  <div className={cn(
                    "text-[10px] font-bold uppercase mb-1",
                    currency === 'LYNX' ? "text-[#9945FF]" : "text-[#52525B]"
                  )}>
                    Target Market ({currency})
                  </div>
                  <div className="text-xs font-bold text-white tracking-tight">{selectedMarket.title}</div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-4 block">3. Choose Your Side</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setSide(Position.YES)}
                      className={`p-6 rounded border transition-all flex flex-col items-center gap-3 ${
                        side === Position.YES 
                          ? "bg-[#00FFD1]/5 border-[#00FFD1] text-[#00FFD1]" 
                          : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#71717A]"
                      }`}
                    >
                      <Target className="w-6 h-6" />
                      <span className="font-black text-sm uppercase italic tracking-tighter">YES WINNER</span>
                    </button>
                    <button 
                      onClick={() => setSide(Position.NO)}
                      className={`p-6 rounded border transition-all flex flex-col items-center gap-3 ${
                        side === Position.NO 
                          ? "bg-red-400/5 border-red-400 text-red-400" 
                          : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#71717A]"
                      }`}
                    >
                      <Target className="w-6 h-6" />
                      <span className="font-black text-sm uppercase italic tracking-tighter">NO WINNER</span>
                    </button>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={handleBack} className="flex-1 py-4 bg-[#18181B] text-[#71717A] font-bold rounded uppercase text-[10px] tracking-widest border border-[#27272A]">Back</button>
                  <button 
                    disabled={!side}
                    onClick={handleNext} 
                    className="flex-1 py-4 bg-[#00FFD1] disabled:opacity-50 disabled:cursor-not-allowed text-black font-black rounded uppercase text-[10px] tracking-widest shadow-[0_0_15px_rgba(0,255,209,0.2)]"
                  >
                    Confirm Side
                  </button>
                </div>
              </motion.div>
            )}

            {step === 3 && selectedMarket && side && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div>
                  <label className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-4 block">4. Entry Price Tier ({currency})</label>
                  <p className="text-[10px] text-[#52525B] font-bold uppercase mb-4">Select fixed amount to match with comparable rivals</p>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {FIXED_AMOUNTS.map((val) => (
                      <button
                        key={val}
                        onClick={() => setAmount(val)}
                        className={`p-4 rounded border font-mono font-bold transition-all ${
                          amount === val 
                            ? "bg-[#0FFFD1]/10 border-[#0FFFD1] text-[#0FFFD1]" 
                            : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#52525B]"
                        }`}
                      >
                        {val} {currency}
                      </button>
                    ))}
                  </div>

                  <div className="mt-8 p-4 bg-[#00FFD1]/5 border border-[#00FFD1]/20 rounded">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${currency === 'SOL' ? 'bg-[#00FFD1]' : 'bg-[#9945FF]'} animate-pulse`} />
                      <span className="text-[9px] font-bold text-[#A1A1AA] uppercase tracking-widest">Economic Level: {amount >= 5 ? 'High Stakes' : amount >= 0.5 ? 'Professional' : 'Standard'}</span>
                    </div>
                    <div className="flex justify-between items-center bg-[#0A0A0B] p-3 rounded mt-2 border border-[#1F1F23]">
                      <span className="text-[10px] text-[#52525B] uppercase font-bold tracking-widest">Potential Return</span>
                      <span className="text-lg font-mono font-bold text-white tracking-tighter">
                        {(amount * 1.95).toFixed(amount === 0.25 ? 2 : 1)} {currency}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={handleBack} className="flex-1 py-4 bg-[#18181B] text-[#71717A] font-bold rounded uppercase text-[10px] tracking-widest border border-[#27272A]">Back</button>
                  <button 
                    onClick={submitDuel}
                    disabled={isSubmitting}
                    className={cn(
                      "flex-1 py-4 bg-gradient-to-r from-[#00FFD1] to-[#9945FF] text-black font-black rounded uppercase text-[10px] tracking-widest shadow-[0_0_20px_rgba(0,255,209,0.3)] transition-all",
                      isSubmitting && "opacity-50 cursor-not-allowed text-black/50"
                    )}
                  >
                    {isSubmitting ? 'Deploying...' : 'Deploy to Chain'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
