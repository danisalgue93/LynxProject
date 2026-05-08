import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, ArrowUpDown, History, Loader2 } from 'lucide-react';
import { formatSOL, cn } from '@/src/lib/utils';
import { Market, Position } from '@/src/types';
import { useProgram } from '@/src/hooks/useProgram';
import { useTranslation } from 'react-i18next';

export function OrderBookView() {
  const { t } = useTranslation();
  const { fetchMarkets, executeTrade, isLoading, error } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  
  const [tradeType, setTradeType] = useState<'limit' | 'swap'>('limit');
  const [side, setSide] = useState<Position>(Position.YES);
  const [price, setPrice] = useState('0.621');
  const [amount, setAmount] = useState('5.0');
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const loadMarkets = async () => {
      const data = await fetchMarkets();
      setMarkets(data);
      if (data.length > 0) {
        setSelectedMarketId(data[0].id);
      }
    };
    loadMarkets();
  }, [fetchMarkets]);

  const handleTrade = async () => {
    if (!selectedMarketId) return;
    setIsPending(true);
    try {
      await executeTrade(
        selectedMarketId, 
        parseFloat(amount), 
        side === Position.YES, 
        tradeType, 
        tradeType === 'limit' ? parseFloat(price) : undefined
      );
      // Optional: Show success toast or reset form
    } catch (err) {
      console.error(err);
      // Optional: Show error toast
    } finally {
      setIsPending(false);
    }
  };

  const selectedMarket = markets.find(m => m.id === selectedMarketId);
  const isLynx = selectedMarket?.currency === 'LYNX';

  if (isLoading || !selectedMarket) {
    return (
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[500px]">
        <Loader2 className="w-8 h-8 text-[#00FFD1] animate-spin" />
        <span className="ml-4 font-mono text-[#71717A] text-sm uppercase tracking-widest">
          {isLoading ? t('orderbook.loadingMechanics', 'Loading orderbook mechanics...') : t('orderbook.noMarkets', 'No markets available')}
        </span>
      </div>
    );
  }

  return (
    <div className="p-2 sm:p-4 lg:p-8 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-3 mb-4 lg:mb-8">
        <div className={cn(
          "w-8 h-8 lg:w-12 lg:h-12 rounded flex items-center justify-center border transition-all shrink-0",
          isLynx ? "bg-[#9945FF]/10 text-[#9945FF] border-[#9945FF]/20" : "bg-[#00FFD1]/10 text-[#00FFD1] border-[#00FFD1]/20"
        )}>
          <BarChart3 className="w-4 h-4 lg:w-6 lg:h-6" />
        </div>
        <div>
          <h2 className="text-lg lg:text-3xl font-bold text-white tracking-tight leading-none">{t('orderbook.orderBook', 'Order Book')}</h2>
          <p className="text-[#71717A] text-[8px] lg:text-[10px] font-bold uppercase tracking-widest mt-1">
            {isLynx ? t('orderbook.daoGovernance', "DAO Pool Governance") : t('orderbook.lynxProtocol', "Lynx Dex Protocol Dao")}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-2 lg:gap-8">
        {/* Market Selector - Horizontal scroll on mobile, vertical on desktop */}
        <div className="lg:col-span-3 order-1">
          <div className="glass-card rounded p-2 lg:p-6 border border-[#1F1F23] bg-[#0D0D0E]">
            <h3 className="hidden lg:block text-[11px] font-bold text-[#71717A] mb-6 uppercase tracking-widest">{t('orderbook.selectMarket', 'Select Market')}</h3>
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[600px] pb-2 lg:pb-0 pr-2 snap-x no-scrollbar lg:custom-scrollbar relative touch-pan-x">
              {markets.map(m => {
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
                      "min-w-[160px] lg:min-w-0 p-2 lg:p-4 rounded text-left transition-all border group shrink-0 lg:shrink cursor-pointer focus:outline-none relative z-30 snap-center",
                      isActive 
                        ? (isMarketLynx ? "bg-[#9945FF]/20 border-[#9945FF] text-white shadow-[0_0_15px_rgba(153,69,255,0.1)]" : "bg-[#00FFD1]/15 border-[#00FFD1] text-white shadow-[0_0_15px_rgba(0,255,209,0.1)]")
                        : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#52525B] hover:bg-[#1C1C21]"
                    )}
                  >
                    <div className="pointer-events-none relative flex-1 min-w-0">
                      <div className={cn("text-[7px] lg:text-[9px] font-bold uppercase mb-1 tracking-widest transition-opacity line-clamp-1", isActive ? "opacity-100 text-[#00FFD1]" : "opacity-40")}>
                        {m.category}
                      </div>
                      <div className={cn("text-[9px] lg:text-[11px] font-bold line-clamp-2 mb-1 lg:mb-2 transition-colors leading-tight", isActive ? "text-white" : "text-[#A1A1AA]")}>
                        {m.title}
                      </div>
                      <div className="flex items-center gap-1.5 mt-auto">
                        <div className={cn("w-1 lg:w-1.5 h-1 lg:h-1.5 rounded-full animate-pulse", isMarketLynx ? "bg-[#9945FF]" : "bg-[#00FFD1]")} />
                        <span className={cn("text-[7px] lg:text-[9px] font-mono font-bold uppercase", isActive ? "text-white" : "text-[#52525B]")}>
                          {isMarketLynx ? '$LYNX' : 'SOL'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 lg:hidden text-[7px] text-center font-bold text-[#3F3F46] uppercase tracking-widest animate-pulse">
              {t('orderbook.swipeMarkers', '← Swipe markers →')}
            </div>
          </div>
        </div>

        {/* Mobile: Binance style 2-column layout for Orderbook + Execution */}
        <div className="flex lg:contents gap-2 lg:gap-8 order-2">
          {/* Global Order Book */}
          <div className="flex-1 lg:col-span-6 w-[50%] lg:w-full">
            <div className="glass-card rounded border border-[#1F1F23] bg-[#0A0A0B] overflow-hidden h-full flex flex-col">
              <div className="p-2 lg:p-4 border-b border-[#1F1F23] flex flex-col sm:flex-row justify-between sm:items-center bg-[#0D0D0E] gap-2 lg:gap-0">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="w-3 h-3 lg:w-4 lg:h-4 text-[#52525B]" />
                  <span className="text-[8px] lg:text-[10px] font-bold text-white uppercase tracking-widest">{t('orderbook.orderBook', 'Order Book')}</span>
                </div>
                <div className="flex gap-2 lg:gap-4 font-mono">
                   <div className="flex items-center gap-1">
                     <div className="w-1.5 h-1.5 rounded-full bg-[#00FFD1]" />
                     <span className="text-[7px] lg:text-[9px] text-[#52525B] font-bold uppercase">{t('orderbook.asks', 'Asks')}</span>
                   </div>
                   <div className="flex items-center gap-1 text-red-400">
                     <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                     <span className="text-[7px] lg:text-[9px] text-red-400/60 font-bold uppercase">{t('orderbook.bids', 'Bids')}</span>
                   </div>
                </div>
              </div>
              
              <div className="flex flex-col lg:flex-row lg:divide-x divide-[#1F1F23] flex-1">
                {/* Asks (Sells) */}
                <div className="flex-1 p-1 lg:p-4">
                  <div className="flex justify-between text-[7px] lg:text-[9px] font-bold text-[#52525B] uppercase mb-1 lg:mb-4 px-1 lg:px-2">
                    <span>{t('orderbook.price', 'Price')}</span>
                    <span>{t('orderbook.qty', 'Qty')}</span>
                  </div>
                  <div className="space-y-[1px] lg:space-y-1 font-mono text-[9px] lg:text-[11px]">
                    {[0.645, 0.640, 0.635, 0.630, 0.625].map((p, i) => {
                      const dynamicPrice = isLynx ? p * 1.5 : p;
                      return (
                        <button 
                          key={i} 
                          onClick={() => setPrice(dynamicPrice.toFixed(3))}
                          className="w-full flex justify-between p-1 lg:p-2 hover:bg-[#00FFD1]/5 rounded transition-colors group text-left"
                        >
                          <span className="text-[#00FFD1]">{dynamicPrice.toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">{(12.50 * (i + 1) * (isLynx ? 2 : 1)).toFixed(1)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                {/* Mobile Spacing Divider / Current Spread */}
                <div className="lg:hidden flex items-center justify-between py-1 px-2 border-y border-[#1F1F23] bg-[#141417]">
                  <span className="text-[10px] font-mono font-bold text-white">0.621</span>
                  <span className="text-[7px] font-bold uppercase tracking-widest text-[#52525B]">{t('orderbook.spread', 'Spread {{value}}', {value: '0.004'})}</span>
                </div>

                {/* Bids (Buys) */}
                <div className="flex-1 p-1 lg:p-4">
                  <div className="hidden lg:flex justify-between text-[7px] lg:text-[9px] font-bold text-[#52525B] uppercase mb-1 lg:mb-4 px-1 lg:px-2">
                    <span>{t('orderbook.price', 'Price')}</span>
                    <span>{t('orderbook.qty', 'Qty')}</span>
                  </div>
                  <div className="space-y-[1px] lg:space-y-1 font-mono text-[9px] lg:text-[11px]">
                    {[0.615, 0.610, 0.605, 0.600, 0.595].map((p, i) => {
                      const dynamicPrice = isLynx ? p * 1.5 : p;
                      return (
                        <button 
                          key={i} 
                          onClick={() => setPrice(dynamicPrice.toFixed(3))}
                          className="w-full flex justify-between p-1 lg:p-2 hover:bg-red-400/5 rounded transition-colors group text-left"
                        >
                          <span className="text-red-400">{dynamicPrice.toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">{(8.25 * (i + 1) * (isLynx ? 2 : 1)).toFixed(1)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-2 lg:p-8 border-t border-[#1F1F23] bg-[#0D0D0E]/30 flex flex-col items-center justify-center text-center mt-auto">
                 <p className="text-[6px] lg:text-[10px] font-bold text-[#3F3F46] uppercase tracking-[0.2em] lg:tracking-[0.3em]">{t('orderbook.p2pEngine', 'P2P Engine')}</p>
              </div>
            </div>
          </div>

          {/* Execution Panel */}
          <div className="flex-1 lg:col-span-3 w-[50%] lg:w-full">
            <div className="glass-card rounded border border-[#1F1F23] bg-[#0D0D0E] p-2 lg:p-6 lg:sticky lg:top-8 h-full flex flex-col">
              <h3 className="hidden lg:block text-[11px] font-bold text-[#71717A] uppercase tracking-widest mb-6">{t('orderbook.execution', 'Execution')}</h3>
              
              <div className="flex gap-1 bg-[#18181B] p-0.5 rounded mb-3 lg:mb-8 border border-[#27272A] shrink-0">
                 <button 
                  onClick={() => setTradeType('limit')}
                  className={cn(
                    "flex-1 py-1 lg:py-2 text-[8px] lg:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                    tradeType === 'limit' ? (isLynx ? "bg-[#9945FF] text-white shadow-[0_0_10px_rgba(153,69,255,0.3)]" : "bg-[#0FFFD1] text-black shadow-[0_0_10px_rgba(0,255,209,0.3)]") : "text-[#52525B] hover:text-[#A1A1AA]"
                  )}
                 >
                   {t('orderbook.limit', 'Limit')}
                 </button>
                 <button 
                  onClick={() => setTradeType('swap')}
                  className={cn(
                    "flex-1 py-1 lg:py-2 text-[8px] lg:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                    tradeType === 'swap' ? (isLynx ? "bg-[#9945FF] text-white shadow-[0_0_10px_rgba(153,69,255,0.3)]" : "bg-[#0FFFD1] text-black shadow-[0_0_10px_rgba(0,255,209,0.3)]") : "text-[#52525B] hover:text-[#A1A1AA]"
                  )}
                 >
                   {t('orderbook.swap', 'Swap')}
                 </button>
              </div>

              <div className="space-y-3 lg:space-y-6 flex-1 flex flex-col justify-between lg:block">
                 <div className="space-y-3 lg:space-y-4">
                   <div>
                      <div className="grid grid-cols-2 gap-1 lg:gap-2">
                        <button 
                          onClick={() => setSide(Position.YES)}
                          className={cn(
                            "py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                            side === Position.YES 
                              ? (isLynx ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]" : "bg-[#00FFD1]/10 border-[#00FFD1] text-[#00FFD1]") 
                              : "bg-[#18181B] border-[#27272A] text-[#52525B]"
                          )}
                        >
                          {t('orderbook.yes', 'YES')}
                        </button>
                        <button 
                          onClick={() => setSide(Position.NO)}
                          className={cn(
                            "py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                            side === Position.NO 
                              ? "bg-red-400/10 border-red-400 text-red-400" 
                              : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40"
                          )}
                        >
                          {t('orderbook.no', 'NO')}
                        </button>
                      </div>
                   </div>

                   {tradeType === 'limit' && (
                     <div>
                        <div className="relative">
                          <input 
                            type="number"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="w-full bg-[#18181B] border border-[#27272A] rounded p-2 lg:p-4 text-xs lg:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                          />
                          <span className="absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 text-[7px] lg:text-[10px] font-bold text-[#3F3F46] uppercase">{t('orderbook.price', 'Price')}</span>
                        </div>
                     </div>
                   )}

                   <div>
                      <div className="relative">
                        <input 
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="w-full bg-[#18181B] border border-[#27272A] rounded p-2 lg:p-4 text-xs lg:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                        />
                        <span className="absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 text-[7px] lg:text-[10px] font-bold text-[#3F3F46] uppercase">{t('orderbook.qty', 'Qty')}</span>
                      </div>
                   </div>
                 </div>

                 <div className="mt-auto space-y-3 lg:space-y-6">
                   <div className="bg-[#141417] p-2 lg:p-5 rounded border border-[#1F1F23] space-y-1 lg:space-y-3">
                      <div className="flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                        <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.stake', 'Stake')}</span>
                        <span className="text-white font-mono">{(parseFloat(price) * parseFloat(amount) || 0).toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                        <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.fees', 'Fees')}</span>
                        <span className="text-[#52525B] font-mono">0.02%</span>
                      </div>
                      <div className="pt-1 lg:pt-2 border-t border-[#1F1F23] flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                        <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.payout', 'Payout')}</span>
                        <span className={cn("font-mono", isLynx ? "text-[#9945FF]" : "text-[#00FFD1]")}>{amount}</span>
                      </div>
                   </div>

                   <button 
                     onClick={handleTrade}
                     disabled={isPending}
                     className={cn(
                     "w-full py-2 lg:py-5 rounded text-black font-black uppercase text-[10px] lg:text-sm tracking-widest shadow-2xl transition-all hover:scale-[1.02] active:scale-95 shrink-0 flex items-center justify-center gap-2",
                     isLynx ? "bg-[#9945FF] shadow-[#9945FF]/30" : "bg-[#00FFD1] shadow-[#00FFD1]/30",
                     isPending && "opacity-50 cursor-not-allowed"
                   )}>
                     {isPending && <Loader2 className="w-3 h-3 lg:w-4 lg:h-4 animate-spin" />}
                     {tradeType === 'limit' ? t('orderbook.submit', 'Submit') : t('orderbook.swap', 'Swap')}
                   </button>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

