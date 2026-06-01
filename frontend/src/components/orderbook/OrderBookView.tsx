import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, TrendingUp, ArrowUpDown, History, Loader2, Coins, Maximize2, Minimize2, ChevronUp, ChevronDown, X as XIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useTranslation } from 'react-i18next';
import { useProgram } from '@/src/hooks/useProgram';
import { useWallet } from '@solana/wallet-adapter-react';
import { eventBus } from '@/src/lib/eventBus';
import { Market, Position } from '@/src/types';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Line, LineChart } from 'recharts';
import { apiUrl } from '@/src/lib/api';
import { getManagedWalletAddress, useManagedAuthSession } from '@/src/lib/auth';
import { useToast } from '@/src/context/ToastContext';

function MarketChart({ isLynxSol, market, chartType = 'line', chartRange = '1M', chartInterval = '1D', chartSize }: { isLynxSol: boolean; market: Market | null; chartType?: 'line' | 'candle'; chartRange?: string; chartInterval?: string; chartSize?: 'minimized' | 'normal' | 'expanded' }) {
  const [tokenData, setTokenData] = useState<any[]>([]);

  useEffect(() => {
    if (!isLynxSol) return;
    
    // Fetch real data from our backend
    const fetchChartData = async () => {
      try {
        let interval = '1d';
        let limit = '30';
        
        if (chartInterval === '15m') { interval = '15m'; limit = '96'; }
        else if (chartInterval === '1H') { interval = '1h'; limit = '48'; }
        else if (chartInterval === '4H') { interval = '4h'; limit = '42'; }
        else if (chartInterval === '1D') { interval = '1d'; limit = '60'; }
        else if (chartInterval === '1W') { interval = '1w'; limit = '52'; }

        // Fetch internal market data
        const res = await fetch(apiUrl(`/api/chart/klines?symbol=LYNX&interval=${interval}&limit=${limit}`));
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        
        if (data && data.length > 0) {
          const formatted = data.map((d: any) => ({
             time: d.time,
             price: d.close,
             open: d.open,
             high: d.high,
             low: d.low,
             close: d.close
          }));
          setTokenData(formatted);
        }
      } catch (err) {
        console.error('Error fetching chart data', err);
      }
    };
    
    fetchChartData();
  }, [isLynxSol, chartInterval, chartRange]);

  const marketData = useMemo(() => {
    if (!market) return [];
    const total = (market.yesAmount || 0) + (market.noAmount || 0) + (market.drawAmount || 0);
    if (total <= 0) return [];
    const point = {
      YES: ((market.yesAmount || 0) / total) * 100,
      NO: ((market.noAmount || 0) / total) * 100,
      DRAW: market.isTernary ? ((market.drawAmount || 0) / total) * 100 : 0
    };
    return [{ time: 0, ...point }, { time: 1, ...point }];
  }, [market]);

  if (chartSize === 'minimized') return null;

  const heightClass = chartSize === 'expanded' ? 'flex-1 min-h-[400px]' : 'h-[250px] lg:h-[350px]';

  if (isLynxSol) {
    if (tokenData.length === 0) {
       return <div className={cn("w-full min-w-0 min-h-0 flex items-center justify-center text-[#A1A1AA] uppercase text-[10px] font-bold tracking-widest", heightClass)}>No LYNX trades yet</div>;
    }
    
    if (chartType === 'candle') {
      const minPrice = Math.min(...tokenData.map(d => d.low));
      const maxPrice = Math.max(...tokenData.map(d => d.high));
      
      // Use logarithmic scale if there's a large price change (> 100% variance) to match Binance-like scaling
      const useLogScale = (maxPrice / (minPrice || 0.0001)) > 2;
      
      const minVal = useLogScale ? Math.log(Math.max(minPrice, 0.000001)) : minPrice;
      const maxVal = useLogScale ? Math.log(Math.max(maxPrice, 0.000001)) : maxPrice;
      
      // Add 15% padding top and bottom for visual breathing room to prevent cutting off wicks
      const valueDiff = maxVal - minVal;
      const padding = valueDiff > 0 ? valueDiff * 0.15 : Math.abs(minVal * 0.05);
      const adjustedMin = minVal - padding;
      const adjustedMax = maxVal + padding;
      const range = adjustedMax - adjustedMin || 1;
      
      const getY = (val: number) => {
         const scaledVal = useLogScale ? Math.log(Math.max(val, 0.000001)) : val;
         return ((adjustedMax - scaledVal) / range) * 100;
      };

      const reverseGetY = (scaledVal: number) => useLogScale ? Math.exp(scaledVal) : scaledVal;
      const topLabel = reverseGetY(adjustedMax);
      const midLabel = reverseGetY((adjustedMax + adjustedMin) / 2);
      const botLabel = reverseGetY(adjustedMin);

      return (
        <div className={cn("w-full relative py-2 lg:py-4 flex gap-[2px]", heightClass)}>
          {/* Price Labels (Approximate) */}
          <div className="absolute right-0 top-2 bottom-2 lg:top-4 lg:bottom-4 w-10 lg:w-12 border-l border-[#27272A] flex flex-col justify-between text-[7px] lg:text-[9px] text-[#52525B] pl-1 font-mono z-10 bg-[#0A0A0B]/80 pointer-events-none">
            <span>{topLabel.toFixed(4)}</span>
            <span>{midLabel.toFixed(4)}</span>
            <span>{botLabel.toFixed(4)}</span>
          </div>
          
          <div className="flex-1 flex gap-[1px] sm:gap-[2px] h-full pr-10 lg:pr-12 relative group min-w-0">
            {/* Grid lines */}
            <div className="absolute left-0 right-10 lg:right-12 top-0 bottom-0 pointer-events-none flex flex-col justify-between">
               <div className="w-full border-t border-dashed border-[#27272A] opacity-50" />
               <div className="w-full border-t border-dashed border-[#27272A] opacity-50" />
               <div className="w-full border-t border-dashed border-[#27272A] opacity-50" />
            </div>

            {tokenData.map((d, i) => {
              const isUp = d.close >= d.open;
              const color = isUp ? 'bg-[#00FFD1]' : 'bg-[#EF4444]';
              const textColor = isUp ? 'text-[#00FFD1]' : 'text-[#EF4444]';
              
              const wickTopY = Math.min(getY(d.high), getY(d.low));
              const wickBottomY = Math.max(getY(d.high), getY(d.low));
              
              const bodyTopY = Math.min(getY(d.open), getY(d.close));
              const bodyBottomY = Math.max(getY(d.open), getY(d.close));
              
              // Ensure we have at least a 1px body, and avoid overflow
              const clampedBodyTop = Math.max(0, Math.min(99.5, bodyTopY));
              const clampedBodyHeight = Math.max(0.5, Math.min(100 - clampedBodyTop, bodyBottomY - bodyTopY));
              
              const clampedWickTop = Math.max(0, Math.min(99.9, wickTopY));
              const clampedWickHeight = Math.max(0.1, Math.min(100 - clampedWickTop, wickBottomY - wickTopY));
              
              return (
                <div key={i} className="flex-1 h-full relative group/candle cursor-crosshair flex justify-center min-w-0">
                  {/* Tooltip on hover */}
                  <div className="hidden group-hover/candle:flex absolute bottom-[105%] left-1/2 -translate-x-1/2 mb-2 p-1.5 lg:p-2 bg-[#0D0D0E] border border-[#27272A] shadow-xl rounded flex-col gap-0.5 lg:gap-1 text-[8px] lg:text-[10px] font-mono whitespace-nowrap z-20 text-[#A1A1AA] pointer-events-none">
                    <div className="flex justify-between gap-3 lg:gap-4"><span>O:</span> <span className="text-white">{d.open.toFixed(5)}</span></div>
                    <div className="flex justify-between gap-3 lg:gap-4"><span>H:</span> <span className="text-white">{d.high.toFixed(5)}</span></div>
                    <div className="flex justify-between gap-3 lg:gap-4"><span>L:</span> <span className="text-white">{d.low.toFixed(5)}</span></div>
                    <div className="flex justify-between gap-3 lg:gap-4"><span>C:</span> <span className={textColor}>{d.close.toFixed(5)}</span></div>
                  </div>
                  
                  {/* Crosshair effect */}
                  <div className="hidden group-hover/candle:block absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-white/10 pointer-events-none" />
                  
                  {/* Wick */}
                  <div className={`absolute w-[1px] md:w-[2px] left-1/2 -translate-x-1/2 ${color} opacity-70`} 
                       style={{ top: `${clampedWickTop}%`, height: `${clampedWickHeight}%` }} />
                       
                  {/* Body */}
                  <div className={`absolute w-full max-w-[8px] rounded-[1px] ${color}`}
                       style={{ top: `${clampedBodyTop}%`, height: `${clampedBodyHeight}%` }} />
                </div>
              )
            })}
          </div>
        </div>
      );
    }

    return (
      <div className={cn("w-full min-w-0 min-h-0", heightClass)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={tokenData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis dataKey="time" hide />
            <YAxis domain={['auto', 'auto']} stroke="#52525B" fontSize={10} tickFormatter={(val) => val.toFixed(4)} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0D0D0E', border: '1px solid #27272A', borderRadius: '4px' }}
              labelStyle={{ display: 'none' }}
              itemStyle={{ color: '#00FFD1', fontSize: '12px' }}
              formatter={(value: number) => [`${value.toFixed(4)} SOL`, 'Price']}
            />
            <Line type="monotone" dataKey="price" stroke="#00FFD1" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (marketData.length === 0) {
    return <div className={cn("w-full min-w-0 min-h-0 flex items-center justify-center text-[#A1A1AA] uppercase text-[10px] font-bold tracking-widest", heightClass)}>No market trades yet</div>;
  }

  return (
    <div className={cn("w-full min-w-0 min-h-0", heightClass)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={marketData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
          <XAxis dataKey="time" hide />
          <YAxis domain={[0, 100]} stroke="#52525B" fontSize={10} tickFormatter={(val) => `${val}%`} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#0D0D0E', border: '1px solid #27272A', borderRadius: '4px' }}
            labelStyle={{ display: 'none' }}
          />
          <Area type="monotone" dataKey="YES" stackId="1" stroke="#00FFD1" fill="#00FFD1" fillOpacity={0.2} />
          <Area type="monotone" dataKey="NO" stackId="2" stroke="#F87171" fill="#F87171" fillOpacity={0.2} />
          {market?.isTernary && (
             <Area type="monotone" dataKey="DRAW" stackId="3" stroke="#60A5FA" fill="#60A5FA" fillOpacity={0.2} />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrderBookView({ readOnly = false, onAuthRequired }: { readOnly?: boolean; onAuthRequired?: (action: string) => void }) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const { publicKey } = useWallet();
  const managedSession = useManagedAuthSession();
  const myWallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || '';
  const { fetchMarkets, executeTrade, executeLynxOrder, fetchOrderBook, cancelOrder, isLoading, error } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [lynxOrderBook, setLynxOrderBook] = useState<any>(null);
  const [predictionOrderBook, setPredictionOrderBook] = useState<any>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  
  // 'lynx-sol' is the special native token market
  const [selectedMarketId, setSelectedMarketId] = useState<string>('lynx-sol');
  
  // LYNX/SOL specific state
  const [lynxTradeType, setLynxTradeType] = useState<'limit' | 'market'>('limit');
  const [lynxSide, setLynxSide] = useState<'buy' | 'sell'>('buy');
  const [lynxPrice, setLynxPrice] = useState('0.005');
  const [lynxAmount, setLynxAmount] = useState('1000');
  
  // Prediction Market specific state
  const [predTradeType, setPredTradeType] = useState<'limit' | 'swap'>('limit');
  const [predSide, setPredSide] = useState<Position>(Position.YES);
  const [predPrice, setPredPrice] = useState('');
  const [predAmount, setPredAmount] = useState('5.0');
  
  const [isPending, setIsPending] = useState(false);
  const lynxOrderAmount = parseFloat(lynxAmount);
  const lynxOrderPrice = parseFloat(lynxPrice);
  const isLynxOrderInvalid =
    !Number.isFinite(lynxOrderAmount) ||
    lynxOrderAmount <= 0 ||
    !Number.isFinite(lynxOrderPrice) ||
    lynxOrderPrice <= 0;
  const isLynxSol = selectedMarketId === 'lynx-sol';
  const predOrderAmount = parseFloat(predAmount);
  const predOrderPrice = parseFloat(predPrice);
  const isPredOrderInvalid =
    !isLynxSol &&
    (!Number.isFinite(predOrderAmount) ||
      predOrderAmount <= 0 ||
      (predTradeType === 'limit' && (!Number.isFinite(predOrderPrice) || predOrderPrice <= 0)));
  
  // Chart state
  const [chartType, setChartType] = useState<'line' | 'candle'>('candle');
  const [chartRange, setChartRange] = useState<'1D' | '1W' | '1M' | '6M' | '1Y' | 'ALL'>('1M');
  const [chartInterval, setChartInterval] = useState<'15m' | '1H' | '4H' | '1D' | '1W'>('1D');
  const [chartSize, setChartSize] = useState<'minimized' | 'normal' | 'expanded'>('normal');

  useEffect(() => {
    const loadMarkets = async () => {
      const data = await fetchMarkets();
      setMarkets(data);
    };
    loadMarkets();
    const onUpdateMarkets = () => { loadMarkets(); };
    eventBus.addEventListener('market:created', onUpdateMarkets as any);
    eventBus.addEventListener('market:updated', onUpdateMarkets as any);
    return () => {
      eventBus.removeEventListener('market:created', onUpdateMarkets as any);
      eventBus.removeEventListener('market:updated', onUpdateMarkets as any);
    };
  }, [fetchMarkets]);

  useEffect(() => {
    const loadOrderBook = async () => {
      try {
        const data = await fetchOrderBook('LYNX/SOL');
        setLynxOrderBook(data);
      } catch (err) {
        console.error('Failed to load LYNX/SOL orderbook', err);
      }
    };
    loadOrderBook();
    const onOrderbook = () => { loadOrderBook(); };
    eventBus.addEventListener('orderbook:updated', onOrderbook as any);
    const interval = window.setInterval(loadOrderBook, 5000);
    return () => { window.clearInterval(interval); eventBus.removeEventListener('orderbook:updated', onOrderbook as any); };
  }, [fetchOrderBook]);

  useEffect(() => {
    if (!selectedMarketId || selectedMarketId === 'lynx-sol') {
      setPredictionOrderBook(null);
      return;
    }
    const loadPredictionOrderBook = async () => {
      try {
        const data = await fetchOrderBook(selectedMarketId, selectedMarketId);
        setPredictionOrderBook(data);
      } catch (err) {
        console.error('Failed to load prediction orderbook', err);
      }
    };
    loadPredictionOrderBook();
    const onOrderbook = () => { loadPredictionOrderBook(); };
    eventBus.addEventListener('orderbook:updated', onOrderbook as any);
    return () => eventBus.removeEventListener('orderbook:updated', onOrderbook as any);
  }, [fetchOrderBook, selectedMarketId]);

  const handleLynxTrade = async () => {
    if (readOnly) {
      onAuthRequired?.(t('orderbook.actionBuyLynx', 'buy or sell LYNX'));
      return;
    }
    if (isLynxOrderInvalid) {
      addToast({
        type: 'error',
        message: t('orderbook.invalidOrder', 'Enter a valid amount and price.'),
      });
      return;
    }
    setIsPending(true);
    try {
      await executeLynxOrder(
        lynxSide === 'buy' ? 'BUY' : 'SELL',
        lynxOrderAmount,
        lynxOrderPrice
      );
      const data = await fetchOrderBook('LYNX/SOL');
      setLynxOrderBook(data);
    } catch (err: any) {
      console.error(err);
      addToast({
        type: 'error',
        message: err?.message || t('orderbook.orderFailed', 'Order failed'),
      });
    } finally {
      setIsPending(false);
    }
  };

  const handlePredTrade = async () => {
    if (readOnly) {
      onAuthRequired?.(t('orderbook.actionBuyPred', 'buy or sell in markets'));
      return;
    }
    if (!selectedMarketId || selectedMarketId === 'lynx-sol') return;
    if (isPredOrderInvalid) {
      addToast({
        type: 'error',
        message: t('orderbook.invalidOrder', 'Enter a valid amount and price.'),
      });
      return;
    }
    setIsPending(true);
    try {
      await executeTrade(
        selectedMarketId, 
        predOrderAmount, 
        predSide,
        predTradeType,
        predTradeType === 'limit' ? predOrderPrice : undefined
      );
    } catch (err: any) {
      console.error(err);
      addToast({
        type: 'error',
        message: err?.message || t('orderbook.orderFailed', 'Order failed'),
      });
    } finally {
      setIsPending(false);
    }
  };

  const selectedMarket = !isLynxSol ? markets.find(m => m.id === selectedMarketId) : null;
  const lynxAsks = (lynxOrderBook?.asks || []).slice(0, 5);
  const lynxBids = (lynxOrderBook?.bids || []).slice(0, 5);
  const predAsks = (predictionOrderBook?.asks || []).slice(0, 5);
  const predBids = (predictionOrderBook?.bids || []).slice(0, 5);
  const bestAsk = lynxAsks[0]?.price;
  const bestBid = lynxBids[0]?.price;
  const midPrice = bestAsk && bestBid ? ((bestAsk + bestBid) / 2).toFixed(5) : 'N/A';
  const spread = bestAsk && bestBid ? Math.max(0, bestAsk - bestBid).toFixed(5) : 'N/A';

  // My open orders (filter both bids and asks by wallet)
  const allOpenOrders = [...(lynxOrderBook?.bids || []), ...(lynxOrderBook?.asks || [])]
    .filter((o: any) => o.owner === myWallet && o.status !== 'FILLED' && o.status !== 'CANCELLED');

  const handleCancelOrder = async (orderId: string) => {
    if (readOnly) {
      onAuthRequired?.(t('orderbook.actionCancelOrder', 'cancel orders'));
      return;
    }
    setCancellingId(orderId);
    try {
      await cancelOrder(orderId);
      // Orderbook will refresh via socket event
    } catch (err: any) {
      console.error('Cancel order failed', err);
      addToast({
        type: 'error',
        message: err?.message || t('orderbook.cancelFailed', 'Failed to cancel order'),
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="p-2 sm:p-4 lg:p-8 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-3 mb-4 lg:mb-8">
        <div className={cn(
          "w-8 h-8 lg:w-12 lg:h-12 rounded flex items-center justify-center border transition-all shrink-0",
          isLynxSol ? "bg-[#9945FF]/10 text-[#9945FF] border-[#9945FF]/20" : "bg-[#00FFD1]/10 text-[#00FFD1] border-[#00FFD1]/20"
        )}>
          <BarChart3 className="w-4 h-4 lg:w-6 lg:h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg lg:text-3xl font-bold text-white tracking-tight leading-none truncate">
            {isLynxSol ? 'LYNX/SOL' : selectedMarket?.title || 'Order Book'} {t('orderbook.orderBook', 'Order Book')}
          </h2>
          <p className="text-[#71717A] text-[8px] lg:text-[10px] font-bold uppercase tracking-widest mt-1 truncate">
            {isLynxSol ? 'LYNX DEX Protocol' : selectedMarket?.category || t('orderbook.daoGovernance', "DAO Pool Governance")}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-2 lg:gap-8 lg:items-start">
        <div className="lg:col-start-1 lg:col-span-3 lg:row-start-1 lg:row-span-2 order-1 lg:sticky lg:top-8 lg:max-h-[85vh] lg:h-[calc(100vh-100px)]">
          <div className="glass-card rounded p-2 lg:p-4 border border-[#1F1F23] bg-[#0D0D0E] h-full flex flex-col">
            <h3 className="hidden lg:block text-[11px] font-bold text-[#71717A] mb-4 uppercase tracking-widest px-2">{t('orderbook.selectMarket', 'Select Market')}</h3>
            
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto pb-2 lg:pb-0 pr-2 lg:pr-1 snap-x no-scrollbar lg:custom-scrollbar relative touch-pan-x flex-1">
              {/* Special LYNX/SOL Market */}
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedMarketId('lynx-sol');
                }}
                className={cn(
                  "min-w-[160px] lg:min-w-0 p-1.5 lg:p-4 rounded text-left transition-all border group shrink-0 lg:shrink cursor-pointer focus:outline-none relative z-30 snap-center flex flex-col",
                  isLynxSol 
                    ? "bg-[#9945FF]/20 border-[#9945FF] text-white shadow-[0_0_15px_rgba(153,69,255,0.1)]"
                    : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#9945FF]/50 hover:bg-[#1C1C21]"
                )}
              >
                <div className="pointer-events-none relative flex-1 min-w-0 w-full mb-1 lg:mb-2">
                  <div className={cn("text-[7px] lg:text-[9px] font-bold uppercase mb-0.5 lg:mb-1 tracking-widest transition-opacity line-clamp-1 flex items-center gap-1", isLynxSol ? "opacity-100 text-[#9945FF]" : "opacity-40")}>
                    <Coins className="w-2.5 h-2.5" /> LYNX DEX
                  </div>
                  <div className={cn("text-[10px] lg:text-[13px] font-black mb-0.5 lg:mb-2 transition-colors leading-tight", isLynxSol ? "text-white" : "text-[#A1A1AA]")}>
                    LYNX / SOL Token
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-auto bg-black/20 p-1 lg:p-1.5 rounded w-full justify-between">
                   <div className="flex items-center gap-1">
                     <div className="w-1.5 h-1.5 rounded-full bg-[#00FFD1]" />
                     <span className="text-[8px] font-mono font-bold text-white uppercase">SOL</span>
                   </div>
                   <span className="text-[8px] font-bold text-[#52525B]">{"<->"}</span>
                   <div className="flex items-center gap-1">
                     <div className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                     <span className="text-[8px] font-mono font-bold text-white uppercase">LYNX</span>
                   </div>
                </div>
              </button>

              <div className="hidden lg:flex items-center gap-2 px-2 py-3 mt-2">
                 <div className="h-px bg-[#27272A] flex-1" />
                 <span className="text-[8px] font-bold text-[#52525B] uppercase tracking-widest">Prediction Markets</span>
                 <div className="h-px bg-[#27272A] flex-1" />
              </div>

              {/* Prediction Markets */}
              {isLoading && markets.length === 0 ? (
                 <div className="p-4 flex items-center justify-center">
                   <Loader2 className="w-5 h-5 text-[#00FFD1] animate-spin" />
                 </div>
              ) : markets.map(m => {
                const isActive = selectedMarketId === m.id;
                
                return (
                  <button 
                    key={m.id}
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedMarketId(m.id);
                    }}
                    className={cn(
                      "min-w-[160px] lg:min-w-0 p-1.5 lg:p-4 rounded text-left transition-all border group shrink-0 lg:shrink cursor-pointer focus:outline-none relative z-30 snap-center flex flex-col",
                      isActive 
                        ? (m.currency === 'LYNX' ? "bg-[#9945FF]/20 border-[#9945FF] text-white shadow-[0_0_15px_rgba(153,69,255,0.1)]" : "bg-[#00FFD1]/15 border-[#00FFD1] text-white shadow-[0_0_15px_rgba(0,255,209,0.1)]")
                        : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#52525B] hover:bg-[#1C1C21]"
                    )}
                  >
                    <div className="pointer-events-none relative flex-1 min-w-0 w-full mb-1 lg:mb-0">
                      <div className={cn("text-[7px] lg:text-[9px] font-bold uppercase mb-0.5 lg:mb-1 tracking-widest transition-opacity line-clamp-1", isActive ? (m.currency === 'LYNX' ? "opacity-100 text-[#9945FF]" : "opacity-100 text-[#00FFD1]") : "opacity-40")}>
                        {m.category}
                      </div>
                      <div className={cn("text-[9px] lg:text-[11px] font-bold line-clamp-2 mb-0.5 lg:mb-2 transition-colors leading-tight", isActive ? "text-white" : "text-[#A1A1AA]")}>
                        {m.title}
                      </div>
                      <div className="flex items-center gap-1.5 mt-auto">
                        <div className={cn("w-1 lg:w-1.5 h-1 lg:h-1.5 rounded-full animate-pulse", m.currency === 'LYNX' ? "bg-[#9945FF]" : "bg-[#00FFD1]")} />
                        <span className={cn("text-[7px] lg:text-[9px] font-mono font-bold uppercase", isActive ? "text-white" : "text-[#52525B]")}>
                          {m.currency === 'LYNX' ? '$LYNX' : 'SOL'} PAIR
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 lg:hidden text-[7px] text-center font-bold text-[#3F3F46] uppercase tracking-widest animate-pulse">
              {t('orderbook.swipeMarkers', '← Swipe markers →')}
            </div>
          </div>
        </div>

        <div className={cn(
          "order-2 w-full flex flex-col relative",
          chartSize === 'expanded' ? "" : "lg:col-start-4 lg:col-span-6 lg:row-start-1 lg:row-span-1"
        )}>
          {/* Chart Content Definition */}
          {(() => {
            const chartContent = (
              <>
                 <div className="flex flex-wrap justify-between items-center gap-3 mb-2 lg:mb-4 shrink-0">
                   <div className="flex items-center gap-2">
                     <TrendingUp className="w-3 h-3 lg:w-4 lg:h-4 text-[#52525B] shrink-0" />
                     <span className="text-[8px] sm:text-[9px] lg:text-[10px] font-bold text-white uppercase tracking-widest whitespace-normal md:whitespace-nowrap">{isLynxSol ? 'LYNX / SOL - Live Chart' : 'Market Confidence Chart'}</span>
                   </div>
                   
                   <div className="flex flex-wrap items-center gap-2 lg:gap-3 justify-end flex-grow sm:flex-grow-0">
                     {isLynxSol && chartSize !== 'minimized' && (
                       <div className="flex flex-wrap items-center justify-end gap-2 xl:gap-3">
                         {/* Range */}
                         <div className="flex bg-[#141417] p-0.5 rounded border border-[#27272A] items-center">
                           <span className="text-[#52525B] text-[8px] font-bold uppercase mx-2 hidden xl:inline">Range</span>
                           {(['1D', '1W', '1M', '6M', '1Y', 'ALL'] as const).map(tr => (
                             <button
                               key={tr}
                               onClick={() => setChartRange(tr)}
                               className={`px-2 py-0.5 text-[9px] font-mono lg:text-[10px] rounded ${chartRange === tr ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:text-white'}`}
                             >
                               {tr}
                             </button>
                           ))}
                         </div>

                         {/* Interval */}
                         <div className="flex bg-[#141417] p-0.5 rounded border border-[#27272A] items-center">
                           <span className="text-[#52525B] text-[8px] font-bold uppercase mx-2 hidden xl:inline">Interval</span>
                           {(['15m', '1H', '4H', '1D', '1W'] as const).map(ti => (
                             <button
                               key={ti}
                               onClick={() => setChartInterval(ti)}
                               className={`px-2 py-0.5 text-[9px] font-mono lg:text-[10px] rounded ${chartInterval === ti ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:text-white'}`}
                             >
                               {ti}
                             </button>
                           ))}
                         </div>
                         
                         {/* Chart Type Toggle */}
                         <div className="flex bg-[#141417] p-0.5 rounded border border-[#27272A]">
                           <button
                             onClick={() => setChartType('line')}
                             className={`px-2 py-0.5 text-[9px] lg:text-[10px] uppercase font-bold tracking-wider rounded ${chartType === 'line' ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:text-white'}`}
                           >
                             Line
                           </button>
                           <button
                             onClick={() => setChartType('candle')}
                             className={`px-2 py-0.5 text-[9px] lg:text-[10px] uppercase font-bold tracking-wider rounded ${chartType === 'candle' ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:text-white'}`}
                           >
                             Candles
                           </button>
                         </div>
                       </div>
                     )}
                     <div className="flex items-center gap-1 bg-[#141417] p-0.5 rounded border border-[#27272A] ml-auto">
                        {chartSize !== 'minimized' && (
                          <button
                            type="button"
                            aria-label={chartSize === 'expanded' ? t('orderbook.restoreChart', 'Restore chart') : t('orderbook.expandChart', 'Expand chart')}
                            title={chartSize === 'expanded' ? t('orderbook.restoreChart', 'Restore chart') : t('orderbook.expandChart', 'Expand chart')}
                            onClick={() => setChartSize(chartSize === 'expanded' ? 'normal' : 'expanded')}
                            className="p-1 hover:bg-[#27272A] rounded text-[#A1A1AA] hover:text-white transition-colors"
                          >
                            {chartSize === 'expanded' ? <Minimize2 className="w-3 h-3 lg:w-4 lg:h-4" /> : <Maximize2 className="w-3 h-3 lg:w-4 lg:h-4" />}
                          </button>
                        )}
                        {chartSize !== 'expanded' && (
                          <button
                            type="button"
                            aria-label={chartSize === 'minimized' ? t('orderbook.showChart', 'Show chart') : t('orderbook.hideChart', 'Hide chart')}
                            title={chartSize === 'minimized' ? t('orderbook.showChart', 'Show chart') : t('orderbook.hideChart', 'Hide chart')}
                            onClick={() => setChartSize(chartSize === 'minimized' ? 'normal' : 'minimized')}
                            className="p-1 hover:bg-[#27272A] rounded text-[#A1A1AA] hover:text-white transition-colors"
                          >
                            {chartSize === 'minimized' ? <ChevronDown className="w-3 h-3 lg:w-4 lg:h-4" /> : <ChevronUp className="w-3 h-3 lg:w-4 lg:h-4" />}
                          </button>
                        )}
                     </div>
                   </div>
                 </div>
                 <MarketChart isLynxSol={isLynxSol} market={selectedMarket} chartType={chartType} chartRange={chartRange} chartInterval={chartInterval} chartSize={chartSize} />
              </>
            );

            if (chartSize === 'expanded') {
              return createPortal(
                <div className="fixed inset-0 z-[100] p-4 lg:p-8 bg-[#0A0A0B] flex flex-col items-stretch override-glass-card">
                  {chartContent}
                </div>,
                document.body
              );
            }

            return (
              <div className="glass-card border border-[#1F1F23] bg-[#0A0A0B] overflow-hidden flex flex-col rounded p-2 lg:p-4 mb-2 lg:mb-0 lg:h-auto flex-shrink-0 transition-all duration-300">
                {chartContent}
              </div>
            );
          })()}
        </div>

        <div className="flex lg:contents gap-2 order-3 w-full">
          {/* Global Order Book */}
          <div className="w-[50%] lg:w-full lg:col-start-4 lg:col-span-6 lg:row-start-2 lg:row-span-1 flex flex-col">
            <div className="glass-card rounded border border-[#1F1F23] bg-[#0A0A0B] overflow-hidden flex flex-col flex-1 h-full">
              <div className="p-2 lg:p-4 border-b border-[#1F1F23] flex flex-col sm:flex-row justify-between sm:items-center bg-[#0D0D0E] gap-2 lg:gap-0">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="w-3 h-3 lg:w-4 lg:h-4 text-[#52525B]" />
                  <span className="text-[8px] lg:text-[10px] font-bold text-white uppercase tracking-widest">{t('orderbook.orderBook', 'Order Book')}</span>
                </div>
                <div className="flex gap-2 lg:gap-4 font-mono">
                   <div className="flex items-center gap-1">
                     <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                     <span className="text-[7px] lg:text-[9px] text-[#52525B] font-bold uppercase">{isLynxSol ? t('orderbook.asks', 'Asks (Sell)') : t('orderbook.asks', 'Asks (NO)')}</span>
                   </div>
                   <div className="flex items-center gap-1 text-[#00FFD1]">
                     <div className="w-1.5 h-1.5 rounded-full bg-[#00FFD1]" />
                     <span className="text-[7px] lg:text-[9px] text-[#00FFD1]/60 font-bold uppercase">{isLynxSol ? t('orderbook.bids', 'Bids (Buy)') : t('orderbook.bids', 'Bids (YES)')}</span>
                   </div>
                </div>
              </div>
              
              <div className="flex flex-col lg:flex-row lg:divide-x divide-[#1F1F23] flex-1">
                {/* Asks (Sells / NO) */}
                <div className="flex-1 p-1 lg:p-4 order-1 lg:order-2">
                  <div className="flex justify-between text-[7px] lg:text-[9px] font-bold text-[#52525B] uppercase mb-1 lg:mb-4 px-1 lg:px-2">
                    <span>{t('orderbook.price', 'Price')} {isLynxSol && '(SOL)'}</span>
                    <span>{t('orderbook.qty', 'Qty')} {isLynxSol && '(LYNX)'}</span>
                  </div>
                  <div className="space-y-[1px] lg:space-y-1 font-mono text-[9px] lg:text-[11px] flex flex-col-reverse lg:flex-col">
                    {isLynxSol ? (
                      lynxAsks.length === 0 ? (
                        <div className="p-2 text-center text-[#52525B] uppercase text-[9px] font-bold">No asks</div>
                      ) : lynxAsks.map((order: any, i: number) => (
                        <button 
                          key={`ask-${i}`} 
                          onClick={() => setLynxPrice(Number(order.price).toFixed(4))}
                          className="w-full flex justify-between p-1 lg:p-2 hover:bg-red-400/5 rounded transition-colors group text-left"
                        >
                          <span className="text-red-400">{Number(order.price).toFixed(4)}</span>
                          <span className="text-[#52525B] group-hover:text-white">{Number(order.remaining).toLocaleString()}</span>
                        </button>
                      ))
                    ) : (
                      predAsks.length === 0 ? (
                        <div className="p-2 text-center text-[#52525B] uppercase text-[9px] font-bold">No asks</div>
                      ) : predAsks.map((order: any, i: number) => (
                        <button 
                          key={`ask-${i}`} 
                          onClick={() => setPredPrice(Number(order.price).toFixed(3))}
                          className="w-full flex justify-between p-1 lg:p-2 hover:bg-[#00FFD1]/5 rounded transition-colors group text-left"
                        >
                          <span className="text-[#00FFD1]">{Number(order.price).toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">{Number(order.remaining).toLocaleString()}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-between py-1 px-2 border-y border-[#1F1F23] bg-[#141417] order-2 lg:hidden">
                  <span className="text-[10px] font-mono font-bold text-white">{isLynxSol ? midPrice : 'N/A'}</span>
                  <span className="text-[7px] font-bold uppercase tracking-widest text-[#52525B]">{t('orderbook.spread', 'Spread {{value}}', {value: isLynxSol ? spread : 'N/A'})}</span>
                </div>

                {/* Bids (Buys / YES) */}
                <div className="flex-1 p-1 lg:p-4 order-3 lg:order-1">
                  <div className="hidden lg:flex justify-between text-[7px] lg:text-[9px] font-bold text-[#52525B] uppercase mb-1 lg:mb-4 px-1 lg:px-2">
                    <span>{t('orderbook.price', 'Price')} {isLynxSol && '(SOL)'}</span>
                    <span>{t('orderbook.qty', 'Qty')} {isLynxSol && '(LYNX)'}</span>
                  </div>
                  <div className="space-y-[1px] lg:space-y-1 font-mono text-[9px] lg:text-[11px]">
                    {isLynxSol ? (
                      lynxBids.length === 0 ? (
                        <div className="p-2 text-center text-[#52525B] uppercase text-[9px] font-bold">No bids</div>
                      ) : lynxBids.map((order: any, i: number) => (
                        <button 
                          key={`bid-${i}`} 
                          onClick={() => setLynxPrice(Number(order.price).toFixed(4))}
                          className="w-full flex justify-between p-1 lg:p-2 hover:bg-[#00FFD1]/5 rounded transition-colors group text-left"
                        >
                          <span className="text-[#00FFD1]">{Number(order.price).toFixed(4)}</span>
                          <span className="text-[#52525B] group-hover:text-white">{Number(order.remaining).toLocaleString()}</span>
                        </button>
                      ))
                    ) : (
                      predBids.length === 0 ? (
                        <div className="p-2 text-center text-[#52525B] uppercase text-[9px] font-bold">No bids</div>
                      ) : predBids.map((order: any, i: number) => (
                        <button 
                          key={`bid-${i}`} 
                          onClick={() => setPredPrice(Number(order.price).toFixed(3))}
                          className="w-full flex justify-between p-1 lg:p-2 hover:bg-red-400/5 rounded transition-colors group text-left"
                        >
                          <span className="text-red-400">{Number(order.price).toFixed(3)}</span>
                          <span className="text-[#52525B] group-hover:text-white">{Number(order.remaining).toLocaleString()}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="p-2 lg:p-4 border-t border-[#1F1F23] bg-[#0D0D0E]/30 flex flex-col items-center justify-center text-center mt-auto hidden lg:flex">
                 <p className="text-[6px] lg:text-[10px] font-bold text-[#3F3F46] uppercase tracking-[0.2em] lg:tracking-[0.3em]">{t('orderbook.p2pEngine', 'P2P Engine')}</p>
              </div>
            </div>
          </div>

          {/* Execution Panel */}
           <div className="w-[50%] lg:w-full lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:row-span-2 flex flex-col">
            <div className="glass-card rounded border border-[#1F1F23] bg-[#0D0D0E] p-2 lg:p-6 lg:sticky lg:top-8 lg:h-[calc(100vh-100px)] flex flex-col">
              <h3 className="hidden lg:block text-[11px] font-bold text-[#71717A] uppercase tracking-widest mb-6">{t('orderbook.execution', 'Execution')}</h3>
              
              <div className="flex gap-1 bg-[#18181B] p-0.5 rounded mb-3 lg:mb-8 border border-[#27272A] shrink-0">
                 <button 
                  onClick={() => isLynxSol ? setLynxTradeType('limit') : setPredTradeType('limit')}
                  className={cn(
                    "flex-1 py-1 lg:py-2 text-[8px] lg:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                    (isLynxSol ? lynxTradeType : predTradeType) === 'limit' ? "bg-[#3F3F46] text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]" : "text-[#52525B] hover:text-[#A1A1AA]"
                  )}
                 >
                   Limit
                 </button>
                 <button 
                  onClick={() => isLynxSol ? setLynxTradeType('market') : setPredTradeType('swap')}
                  className={cn(
                    "flex-1 py-1 lg:py-2 text-[8px] lg:text-[10px] font-bold rounded uppercase tracking-widest transition-all",
                    (isLynxSol ? lynxTradeType : predTradeType) === (isLynxSol ? 'market' : 'swap') ? "bg-[#3F3F46] text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]" : "text-[#52525B] hover:text-[#A1A1AA]"
                  )}
                 >
                   {isLynxSol ? 'Market' : 'Swap'}
                 </button>
              </div>

              <div className="space-y-3 lg:space-y-6 flex-1 flex flex-col justify-between lg:block">
                 <div className="space-y-3 lg:space-y-4">
                   <div>
                      <div className="grid grid-cols-2 gap-1 lg:gap-2">
                        {isLynxSol ? (
                          <>
                            <button 
                              onClick={() => setLynxSide('buy')}
                              className={cn(
                                "py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                                lynxSide === 'buy' 
                                  ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]" 
                                  : "bg-[#18181B] border-[#27272A] text-[#52525B]"
                              )}
                            >
                              Buy
                            </button>
                            <button 
                              onClick={() => setLynxSide('sell')}
                              className={cn(
                                "py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                                lynxSide === 'sell' 
                                  ? "bg-red-400/10 border-red-400 text-red-400" 
                                  : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40"
                              )}
                            >
                              Sell
                            </button>
                          </>
                        ) : (
                          <>
                            <button 
                              onClick={() => setPredSide(selectedMarket?.isTernary ? Position.A : Position.YES)}
                              className={cn(
                                "py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                                (predSide === Position.YES || predSide === Position.A)
                                  ? (selectedMarket?.currency === 'LYNX' ? "bg-[#9945FF]/10 border-[#9945FF] text-[#9945FF]" : "bg-[#00FFD1]/10 border-[#00FFD1] text-[#00FFD1]")
                                  : "bg-[#18181B] border-[#27272A] text-[#52525B]"
                              )}
                            >
                              {selectedMarket?.isTernary ? 'OPT A' : 'YES'}
                            </button>
                            <button 
                              onClick={() => setPredSide(selectedMarket?.isTernary ? Position.B : Position.NO)}
                              className={cn(
                                "py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                                (predSide === Position.NO || predSide === Position.B) 
                                  ? "bg-red-400/10 border-red-400 text-red-400" 
                                  : "bg-[#18181B] border-red-900/20 text-red-400/40 hover:text-red-400 hover:border-red-400/40"
                              )}
                            >
                              {selectedMarket?.isTernary ? 'OPT B' : 'NO'}
                            </button>
                            {selectedMarket?.isTernary && (
                              <button 
                                onClick={() => setPredSide(Position.DRAW)}
                                className={cn(
                                  "col-span-2 py-2 lg:py-4 rounded border font-black text-[9px] lg:text-xs transition-all",
                                  predSide === Position.DRAW 
                                    ? "bg-blue-400/10 border-blue-400 text-blue-400" 
                                    : "bg-[#18181B] border-blue-900/20 text-blue-400/40 hover:text-blue-400 hover:border-blue-400/40"
                                )}
                              >
                                DRAW
                              </button>
                            )}
                          </>
                        )}
                      </div>
                   </div>

                   {(isLynxSol ? lynxTradeType : predTradeType) === 'limit' && (
                     <div>
                        <div className="relative">
                          <input 
                            type="number"
                            value={isLynxSol ? lynxPrice : predPrice}
                            onChange={(e) => isLynxSol ? setLynxPrice(e.target.value) : setPredPrice(e.target.value)}
                            className="w-full bg-[#18181B] border border-[#27272A] rounded p-2 lg:p-4 text-xs lg:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                          />
                          <span className="absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 text-[7px] lg:text-[10px] font-bold text-[#3F3F46] uppercase">{t('orderbook.price', 'Price')} {isLynxSol && '(SOL)'}</span>
                        </div>
                     </div>
                   )}

                   <div>
                      <div className="relative">
                        <input 
                          type="number"
                          value={isLynxSol ? lynxAmount : predAmount}
                          onChange={(e) => isLynxSol ? setLynxAmount(e.target.value) : setPredAmount(e.target.value)}
                          className="w-full bg-[#18181B] border border-[#27272A] rounded p-2 lg:p-4 text-xs lg:text-2xl font-mono text-white outline-none focus:border-[#00FFD1] tracking-tighter"
                        />
                        <span className="absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 text-[7px] lg:text-[10px] font-bold text-[#3F3F46] uppercase">{t('orderbook.qty', 'Qty')} {isLynxSol && '(LYNX)'}</span>
                      </div>
                   </div>
                 </div>

                 <div className="mt-auto space-y-3 lg:space-y-6">
                   <div className="bg-[#141417] p-2 lg:p-5 rounded border border-[#1F1F23] space-y-1 lg:space-y-3">
                      {isLynxSol ? (
                        <>
                          <div className="flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                            <span className="text-[#52525B] uppercase tracking-widest">Total</span>
                            <span className="text-white font-mono">{(parseFloat(lynxPrice) * parseFloat(lynxAmount) || 0).toFixed(4)} SOL</span>
                          </div>
                          <div className="flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                            <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.fees', 'Fees')}</span>
                            <span className="text-[#52525B] font-mono">0.05%</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                            <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.stake', 'Stake')}</span>
                            <span className="text-white font-mono">{(parseFloat(predPrice) * parseFloat(predAmount) || 0).toFixed(3)}</span>
                          </div>
                          <div className="flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                            <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.fees', 'Fees')}</span>
                            <span className="text-[#52525B] font-mono">0.05%</span>
                          </div>
                          <div className="pt-1 lg:pt-2 border-t border-[#1F1F23] flex justify-between text-[7px] lg:text-[11px] font-bold items-center">
                            <span className="text-[#52525B] uppercase tracking-widest">{t('orderbook.payout', 'Payout')}</span>
                            <span className={cn("font-mono", selectedMarket?.currency === 'LYNX' ? "text-[#9945FF]" : "text-[#00FFD1]")}>{predAmount}</span>
                          </div>
                        </>
                      )}
                   </div>

                   <button 
                     onClick={isLynxSol ? handleLynxTrade : handlePredTrade}
                     disabled={isPending || (isLynxSol && isLynxOrderInvalid) || isPredOrderInvalid}
                     className={cn(
                     "w-full py-2 lg:py-5 rounded text-black font-black uppercase text-[10px] lg:text-sm tracking-widest shadow-2xl transition-all hover:scale-[1.02] active:scale-95 shrink-0 flex items-center justify-center gap-2",
                     isLynxSol 
                        ? (lynxSide === 'buy' ? "bg-[#9945FF] shadow-[#9945FF]/30 text-white" : "bg-red-400 shadow-red-400/30 text-white")
                        : ((predSide === Position.NO || predSide === Position.B)
                            ? "bg-red-400 shadow-red-400/30 text-white" 
                            : (selectedMarket?.currency === 'LYNX' ? "bg-[#9945FF] shadow-[#9945FF]/30 text-white" : "bg-[#00FFD1] shadow-[#00FFD1]/30 text-black")),
                     (isPending || (isLynxSol && isLynxOrderInvalid) || isPredOrderInvalid) && "opacity-50 cursor-not-allowed"
                   )}>
                     {isPending && <Loader2 className="w-3 h-3 lg:w-4 lg:h-4 animate-spin" />}
                     {isLynxSol 
                        ? (lynxSide === 'buy' ? `Buy LYNX` : `Sell LYNX`)
                        : (predTradeType === 'limit' ? t('orderbook.submit', 'Submit') : t('orderbook.swap', 'Swap'))}
                   </button>
                 </div>
              </div>
            </div>
          </div>
        </div>

        {/* My Open Orders */}
        {isLynxSol && allOpenOrders.length > 0 && (
          <div className="mt-4 lg:mt-6 bg-[#0D0D0E] border border-[#1F1F23] rounded-xl overflow-hidden">
            <div className="px-4 lg:px-6 py-3 border-b border-[#1F1F23] flex items-center justify-between">
              <span className="text-[10px] lg:text-xs font-black text-white uppercase tracking-widest">
                My Open Orders
              </span>
              <span className="text-[10px] text-[#52525B] font-bold">{allOpenOrders.length} active</span>
            </div>
            <div className="divide-y divide-[#1F1F23]">
              {allOpenOrders.map((order: any) => {
                const isBuy = order.side === 'BUY';
                const isPartial = order.status === 'PARTIAL_FILLED';
                return (
                  <div key={order.id} className="flex items-center justify-between px-4 lg:px-6 py-3 hover:bg-[#141417] transition-colors group">
                    <div className="flex items-center gap-3 lg:gap-4 flex-1 min-w-0">
                      <span className={cn(
                        "text-[9px] lg:text-[11px] font-black uppercase px-2 py-0.5 rounded",
                        isBuy ? "bg-[#9945FF]/10 text-[#9945FF]" : "bg-red-400/10 text-red-400"
                      )}>
                        {order.side}
                      </span>
                      <span className="font-mono text-[10px] lg:text-xs text-white font-bold">
                        {Number(order.remaining).toLocaleString()} LYNX
                      </span>
                      <span className="text-[10px] lg:text-xs text-[#52525B] font-mono">
                        @ {Number(order.price).toFixed(5)} SOL
                      </span>
                      {isPartial && (
                        <span className="text-[9px] text-amber-400 font-bold uppercase">Partial</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 lg:gap-3 shrink-0">
                      <span className="hidden lg:block text-[10px] text-[#52525B] font-mono">
                        ~ {(Number(order.remaining) * Number(order.price)).toFixed(4)} SOL
                      </span>
                      <button
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={cancellingId === order.id}
                        className="flex items-center gap-1 px-2 lg:px-3 py-1 rounded bg-red-400/10 hover:bg-red-400/20 text-red-400 text-[9px] lg:text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                      >
                        {cancellingId === order.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <XIcon className="w-3 h-3" />
                        )}
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
