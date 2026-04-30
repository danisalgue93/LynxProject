import React, { useState } from 'react';
import { MOCK_MARKETS } from '@/src/constants';
import { BarChart3, TrendingUp, ArrowUpDown, History } from 'lucide-react';
import { formatSOL, cn } from '@/src/lib/utils';
import { Market, Position } from '@/src/types';

export function OrderBookView() {
  const [selectedMarketId, setSelectedMarketId] = useState(MOCK_MARKETS[0].id);
  const selectedMarket = MOCK_MARKETS.find(m => m.id === selectedMarketId) || MOCK_MARKETS[0];
  const [tradeType, setTradeType] = useState<'limit' | 'swap'>('limit');
  const [side, setSide] = useState<Position>(Position.YES);
  const [price, setPrice] = useState('0.621');
  const [amount, setAmount] = useState('5.0');

  const isLynx = selectedMarket.currency === 'LYNX';

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 md:mb-8 gap-4">
        <div className="flex items-center gap-3 md:gap-4">
          <div className={cn(
            "w-10 h-10 md:w-12 md:h-12 rounded flex items-center justify-center border transition-all",
            isLynx ? "bg-[#9945FF]/10 text-[#9945FF] border-[#9945FF]/20" : "bg-[#00FFD1]/10 text-[#00FFD1] border-[#00FFD1]/20"
          )}>
            <BarChart3 className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div>
            <h2 className="text-xl md:text-3xl font-bold text-white mb-0.5 md:mb-1 tracking-tight">Order Book</h2>
            <p className="text-[#71717A] text-[8px] md:text-[10px] font-bold uppercase tracking-widest">
              {isLynx ? "DAO Pool Governance" : "Lynx Dex Protocol Dao"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-8">
        {/* Market Selector */}
        <div className="lg:col-span-3 space-y-4 md:space-y-6 order-2 lg:order-1">
          <div className="glass-card rounded p-4 md:p-6 border border-[#1F1F23] bg-[#0D0D0E]">
            <h3 className="text-[10px] md:text-[11px] font-bold text-[#71717A] mb-4 md:mb-6 uppercase tracking-widest">Select Market</h3>
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[500px] pb-4 lg:pb-0 pr-2 snap-x no-scrollbar lg:custom-scrollbar relative touch-pan-x">
              {MOCK_MARKETS.map(m => {
                const isActive = selectedMarketId === m.id;
                const isMarketLynx = m.currency === 'LYNX';
                
                return (
                  <button 
                    key={m.id}
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedMarketId(m.id);
                    }}
                    className={cn(
                      "min-w-[140px] md:min-w-[160px] lg:min-w-0 p-3 md:p-4 rounded text-left transition-all border group shrink-0 lg:shrink cursor-pointer focus:outline-none relative z-30 snap-center",
                      isActive 
                        ? (isMarketLynx ? "bg-[#9945FF]/20 border-[#9945FF] text-white shadow-[0_0_20px_rgba(153,69,255,0.1)]" : "bg-[#00FFD1]/15 border-[#00FFD1] text-white shadow-[0_0_20px_rgba(0,255,209,0.1)]")
                        : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#52525B] hover:bg-[#1C1C21]"
                    )}
                  >
                    <div className="pointer-events-none relative flex-1 min-w-0">
                      <div className={cn("text-[8px] md:text-[9px] font-bold uppercase mb-1 tracking-widest transition-opacity", isActive ? "opacity-100 text-[#00FFD1]" : "opacity-40")}>
                        {m.category}
                      </div>
                      <div className={cn("text-[10px] md:text-[11px] font-bold truncate mb-2 transition-colors", isActive ? "text-white" : "text-[#A1A1AA]")}>
                        {m.title}
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-1.5 md:gap-2">
                          <div className={cn("w-1 md:w-1.5 h-1 md:h-1.5 rounded-full animate-pulse", isMarketLynx ? "bg-[#9945FF]" : "bg-[#00FFD1]")} />
                          <span className={cn("text-[8px] md:text-[9px] font-mono font-bold uppercase", isActive ? "text-white" : "text-[#52525B]")}>
                            {isMarketLynx ? '$LYNX' : 'SOL'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 lg:hidden text-[8px] text-center font-bold text-[#3F3F46] uppercase tracking-widest animate-pulse">
              ← Swipe to change market →
            </div>
          </div>
        </div>

        {/* Global Order Book */}
        <div className="lg:col-span-6 space-y-4 md:space-y-6 order-1 lg:order-2">
          <div className="glass-card rounded border border-[#1F1F23] bg-[#0A0A0B] overflow-hidden">
            <div className="p-3 md:p-4 border-b border-[#1F1F23] flex justify-between items-center bg-[#0D0D0E]">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-3 h-3 md:w-4 md:h-4 text-[#52525B]" />
                <span className="text-[9px] md:text-[10px] font-bold text-white uppercase tracking-widest">Global Order Book</span>
              </div>
              <div className="flex gap-3 md:gap-4 font-mono">
                 <div className="flex items-center gap-1 md:gap-1.5">
                   <div className="w-1.5 md:w-2 h-1.5 md:h-2 rounded-full bg-[#00FFD1]" />
                   <span className="text-[8px] md:text-[9px] text-[#52525B] font-bold uppercase transition-colors group-hover:text-white">Asks</span>
                 </div>
                 <div className="flex items-center gap-1 md:gap-1.5 text-red-400">
                   <div className="w-1.5 md:w-2 h-1.5 md:h-2 rounded-full bg-red-400" />
                   <span className="text-[8px] md:text-[9px] text-[#52525B] font-bold uppercase">Bids</span>
                 </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 divide-x divide-[#1F1F23]">
              <div className="p-3 md:p-4">
                <div className="flex justify-between text-[8px] md:text-[9px] font-bold text-[#52525B] uppercase mb-3 md:mb-4 px-1 md:px-2">
                  <span>Price</span>
                  <span>Qty</span>
                </div>
                <div className="space-y-0.5 md:space-y-1 font-mono text-[10px] md:text-[11px]">
                  {[0.645, 0.640, 0.635, 0.630, 0.625].map((p, i) => {
                    const dynamicPrice = isLynx ? p * 1.5 : p;
                    return (
                      <button 
                        key={i} 
                        onClick={() => setPrice(dynamicPrice.toFixed(3))}
                        className="w-full flex justify-between p-1.5 md:p-2 hover:bg-[#00FFD1]/5 rounded transition-colors group text-left"
                      >
                        <span className="text-[#00FFD1]">{dynamicPrice.toFixed(3)}</span>
                        <span className="text-[#52525B] group-hover:text-white">{(12.50 * (i + 1) * (isLynx ? 2 : 1)).toFixed(1)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="p-3 md:p-4">
                <div className="flex justify-between text-[8px] md:text-[9px] font-bold text-[#52525B] uppercase mb-3 md:mb-4 px-1 md:px-2">
                  <span>Price</span>
                  <span>Qty</span>
                </div>
                <div className="space-y-0.5 md:space-y-1 font-mono text-[10px] md:text-[11px]">
                  {[0.615, 0.610, 0.605, 0.600, 0.595].map((p, i) => {
                    const dynamicPrice = isLynx ? p * 1.5 : p;
                    return (
                      <button 
                        key={i} 
                        onClick={() => setPrice(dynamicPrice.toFixed(3))}
                        className="w-full flex justify-between p-1.5 md:p-2 hover:bg-red-400/5 rounded transition-colors group text-left"
                      >
                        <span className="text-red-400">{dynamicPrice.toFixed(3)}</span>
                        <span className="text-[#52525B] group-hover:text-white">{(8.25 * (i + 1) * (isLynx ? 2 : 1)).toFixed(1)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-6 md:p-12 border-t border-[#1F1F23] bg-[#0D0D0E]/30 flex flex-col items-center justify-center text-center">
               <TrendingUp className="w-6 h-6 md:w-8 md:h-8 text-[#52525B] mb-2 md:mb-4 opacity-10" />
               <p className="text-[8px] md:text-[10px] font-bold text-[#3F3F46] uppercase tracking-[0.2em] md:tracking-[0.3em]">P2P Settlement Engine</p>
            </div>
          </div>
        </div>

        {/* Execution Panel */}
        <div className="lg:col-span-3 order-3">
          <div className="glass-card rounded border border-[#1F1F23] bg-[#0D0D0E] p-4 md:p-6 lg:sticky lg:top-8">
            <h3 className="text-[10px] md:text-[11px] font-bold text-[#71717A] uppercase tracking-widest mb-4 md:mb-6">Execution</h3>
            
            <div className="flex gap-1 bg-[#18181B] p-0.5 rounded mb-6 md:mb-8 border border-[#27272A]">
               <button 
                onClick={() => setTradeType('limit')}
                className={cn(
                  "flex-1 py-1.5 md:py-2 text-[9px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  tradeType === 'limit' ? (isLynx ? "bg-[#9945FF] text-white shadow-[0_0_10px_rgba(153,69,255,0.3)]" : "bg-[#0FFFD1] text-black shadow-[0_0_10px_rgba(0,255,209,0.3)]") : "text-[#52525B] hover:text-[#A1A1AA]"
                )}
               >
                 Limit
               </button>
               <button 
                onClick={() => setTradeType('swap')}
                className={cn(
                  "flex-1 py-1.5 md:py-2 text-[9px] md:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                  tradeType === 'swap' ? (isLynx ? "bg-[#9945FF] text-white shadow-[0_0_10px_rgba(153,69,255,0.3)]" : "bg-[#0FFFD1] text-black shadow-[0_0_10px_rgba(0,255,209,0.3)]") : "text-[#52525B] hover:text-[#A1A1AA]"
                )}
               >
                 Swap
               </button>
            </div>

            <div className="space-y-4 md:space-y-6">
               <div>
                  <label className="text-[9px] md:text-[10px] text-[#52525B] uppercase font-bold tracking-widest mb-2 md:mb-3 block">Position</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setSide(Position.YES)}
                      className={cn(
                        "py-3 md:py-4 rounded border font-black text-[10px] md:text-xs transition-all",
                        side === Position.YES 
                          ? (isLynx ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]" : "bg-[#00FFD1]/10 border-[#00FFD1] text-[#00FFD1]") 
                          : "bg-[#18181B] border-[#27272A] text-[#52525B]"
                      )}
                    >
                      YES
                    </button>
                    <button 
                      onClick={() => setSide(Position.NO)}
                      className={cn(
                        "py-3 md:py-4 rounded border font-black text-[10px] md:text-xs transition-all",
                        side === Position.NO 
                          ? "bg-red-400/10 border-red-400 text-red-400" 
                          : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40"
                      )}
                    >
                      NO
                    </button>
                  </div>
               </div>

               {tradeType === 'limit' && (
                 <div>
                    <label className="text-[9px] md:text-[10px] text-[#52525B] uppercase font-bold tracking-widest mb-2 md:mb-3 block">Price ({selectedMarket.currency})</label>
                    <div className="relative">
                      <input 
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 md:p-4 text-xl md:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                      />
                      <span className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-[8px] md:text-[10px] font-bold text-[#3F3F46] uppercase">Fixed</span>
                    </div>
                 </div>
               )}

               <div>
                  <label className="text-[9px] md:text-[10px] text-[#52525B] uppercase font-bold tracking-widest mb-2 md:mb-3 block">Quantity</label>
                  <div className="relative">
                    <input 
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 md:p-4 text-xl md:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                    />
                    <span className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-[8px] md:text-[10px] font-bold text-[#3F3F46] uppercase">Max</span>
                  </div>
               </div>

               <div className="bg-[#141417] p-4 md:p-5 rounded border border-[#1F1F23] space-y-2 md:space-y-3">
                  <div className="flex justify-between text-[10px] md:text-[11px] font-bold items-center">
                    <span className="text-[#52525B] uppercase tracking-widest">Stake</span>
                    <span className="text-white font-mono">{(parseFloat(price) * parseFloat(amount)).toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] md:text-[11px] font-bold items-center">
                    <span className="text-[#52525B] uppercase tracking-widest">Fees</span>
                    <span className="text-[#52525B] font-mono">0.02%</span>
                  </div>
                  <div className="pt-2 border-t border-[#1F1F23] flex justify-between text-[10px] md:text-[11px] font-bold items-center">
                    <span className="text-[#52525B] uppercase tracking-widest">Payout</span>
                    <span className={cn("font-mono", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>{amount} {selectedMarket.currency}</span>
                  </div>
               </div>

               <button className={cn(
                 "w-full py-4 md:py-5 rounded text-black font-black uppercase text-xs md:text-sm tracking-widest shadow-2xl transition-all hover:scale-[1.02] active:scale-95",
                 isLynx ? "bg-[#9945FF] shadow-[#9945FF]/30" : "bg-[#0FFFD1] shadow-[#00FFD1]/30"
               )}>
                 {tradeType === 'limit' ? 'Submit Order' : 'Execute Swap'}
               </button>

               <div className="flex items-center justify-center gap-2 text-[8px] font-bold text-[#3F3F46] uppercase tracking-widest">
                  <History className="w-3 h-3" />
                  <span>Trade logs enabled</span>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
