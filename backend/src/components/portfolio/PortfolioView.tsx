import React, { useEffect, useState } from 'react';
import { Wallet, PieChart, TrendingUp, History, Coins, CheckCircle2, Trophy as RewardIcon } from 'lucide-react';
import { formatSOL, formatNumber, cn } from '@/src/lib/utils';
import { useProgram } from '@/src/hooks/useProgram';
import { Market } from '@/src/types';

export function PortfolioView() {
  const { fetchMarkets, fetchPortfolio, claimRewards, isLoading, error } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const [marketData, portfolioData] = await Promise.all([
        fetchMarkets(),
        fetchPortfolio()
      ]);
      setMarkets(marketData);
      setPortfolio(portfolioData);
    };
    loadData();
  }, [fetchMarkets, fetchPortfolio]);

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await claimRewards();
      // Assume portfolio fetches updated amounts next
    } catch (err) {
      console.error(err);
    } finally {
      setIsClaiming(false);
    }
  };

  if (!portfolio) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <div className="w-8 h-8 rounded-full border-t-2 border-[#00FFD1] animate-spin mb-4" />
        <span className="font-mono text-[#71717A] text-sm uppercase tracking-widest">Loading on-chain portfolio...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <div className="text-red-400 font-mono text-sm border-dashed border border-red-400/20 bg-red-400/5 p-4 rounded-xl">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-white border border-white/10">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-1">Your Portfolio</h2>
            <p className="text-slate-500 text-sm">Manage your positions, balances and $LYNX rewards.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6 mb-8 md:mb-12">
        <div className="lg:col-span-1 glass-card rounded p-4 md:p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="text-[9px] md:text-[10px] uppercase font-black text-[#71717A] tracking-widest mb-3 md:mb-4">Total Assets</div>
          <div className="text-2xl md:text-3xl font-mono font-bold text-white mb-2 tracking-tighter">{formatSOL(portfolio.solBalance)}</div>
          <div className="text-[9px] md:text-[10px] text-[#00FFD1] flex items-center gap-1 font-bold uppercase tracking-wider">
            <TrendingUp className="w-3 h-3" />
            Active Vault
          </div>
        </div>

        <div className="lg:col-span-1 glass-card rounded p-4 md:p-6 border border-[#27272A] bg-[#141417]">
          <div className="text-[9px] md:text-[10px] uppercase font-black text-[#A1A1AA] tracking-widest mb-3 md:mb-4">$LYNX Holding</div>
          <div className="text-2xl md:text-3xl font-mono font-bold text-white mb-2 tracking-tighter">{formatNumber(portfolio.lynxBalance)}</div>
          <div className="text-[9px] md:text-[10px] text-[#71717A] flex items-center gap-1 font-bold uppercase tracking-widest">
            Yield Weight: High
          </div>
        </div>

        <div className="lg:col-span-2 glass-card rounded p-4 md:p-6 border border-[#1F1F23] flex items-center justify-between bg-[#0D0D0E]">
          <div>
            <div className="text-[9px] md:text-[10px] uppercase font-black text-[#71717A] tracking-widest mb-3 md:mb-4">Total Reward Pool</div>
            <div className="text-2xl md:text-3xl font-mono font-bold text-[#00FFD1] tracking-tighter">+{formatSOL(portfolio.totalProfit || 0)}</div>
            <div className="text-[8px] md:text-[9px] text-[#52525B] mt-2 uppercase font-bold tracking-widest">REAL-TIME ON-CHAIN SYNC</div>
          </div>
          <div className="h-full w-24 md:w-32 relative opacity-10 md:opacity-20 hidden sm:block">
            <PieChart className="w-full h-full text-[#E4E4E7]" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
           {/* Event Settlements Section */}
           <div>
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#00FFD1]" />
                <h3 className="text-[10px] md:text-[11px] font-bold text-white uppercase tracking-widest">Pending Event Settlements</h3>
              </div>
              <button 
                onClick={handleClaim}
                disabled={isClaiming}
                className={cn(
                "text-[9px] md:text-[10px] font-bold text-[#00FFD1] hover:underline uppercase tracking-widest",
                isClaiming && "opacity-50 cursor-not-allowed"
              )}>Claim All</button>
            </div>
            
            <div className="space-y-3">
              {portfolio.payments?.map((claim: any, i: number) => (
                <div key={i} className="glass-card rounded p-4 border border-[#00FFD1]/20 bg-[#00FFD1]/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-[#00FFD1]/10 rounded flex items-center justify-center text-[#00FFD1] border border-[#00FFD1]/10">
                      <RewardIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs md:text-sm font-bold text-white mb-1 tracking-tight">{claim.title}</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-black bg-[#00FFD1] px-1.5 py-0.5 rounded tracking-tighter uppercase">Won</span>
                        <span className="text-[9px] text-[#71717A] font-bold uppercase tracking-widest">{claim.date}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-6">
                    <div className="text-right">
                      <div className="text-sm md:text-lg font-mono font-bold text-[#00FFD1] tracking-tighter">
                        +{claim.amount} SOL
                      </div>
                      <div className="text-[9px] text-[#71717A] font-bold uppercase tracking-widest text-right">
                        Ready to claim
                      </div>
                    </div>
                    <button 
                      onClick={handleClaim}
                      disabled={isClaiming}
                      className={cn(
                      "px-4 py-2 bg-[#00FFD1] text-black text-[10px] font-black uppercase rounded tracking-tight hover:scale-105 active:scale-95 transition-all",
                      isClaiming && "opacity-50 hover:scale-100 active:scale-100 cursor-not-allowed"
                    )}>
                      Claim
                    </button>
                  </div>
                </div>
              ))}
              {(!portfolio.payments || portfolio.payments.length === 0) && (
                 <div className="text-center p-8 glass-card border border-dashed border-[#1F1F23] rounded-xl bg-[#0D0D0E]">
                   <p className="text-[#A1A1AA] text-xs font-mono uppercase tracking-widest">No pending claims</p>
                 </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#52525B]" />
                <h3 className="text-[10px] md:text-[11px] font-bold text-[#71717A] uppercase tracking-widest">Open Trading Positions</h3>
              </div>
              <button className="text-[9px] md:text-[10px] font-bold text-[#00FFD1] hover:underline uppercase tracking-widest">History</button>
            </div>
            
            <div className="space-y-2">
              {portfolio.holdings?.map((holding: any, idx: number) => {
                const market = markets.find(m => m.id === holding.marketId);
                const title = market ? market.title : `Unknown Market (Loading...)`;
                const pnl = (holding.currentPrice - holding.entryPrice) * holding.amount;
                const isProfit = pnl >= 0;

                return (
                  <div key={idx} className="glass-card rounded p-4 border border-[#1F1F23] flex items-center justify-between group hover:border-[#27272A] transition-all bg-[#0D0D0E]">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-8 h-8 bg-[#141417] rounded flex items-center justify-center text-[#52525B] group-hover:text-[#00FFD1] transition-colors border border-[#27272A]">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-[11px] md:text-xs font-bold text-white mb-1 tracking-tight truncate max-w-[150px] sm:max-w-none">{title}</h4>
                        <div className="flex items-center gap-2 text-[9px]">
                          <span className={cn("font-bold px-1.5 py-0.5 rounded border tracking-tighter", holding.position === 'YES' ? "text-[#00FFD1] bg-[#00FFD1]/5 border-[#00FFD1]/20" : "text-red-400 bg-red-400/5 border-red-400/20")}>{holding.position}</span>
                          <span className="text-[#52525B] font-bold uppercase tracking-widest">{holding.amount} Shares</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className={cn("text-xs md:text-sm font-mono font-bold tracking-tighter", isProfit ? "text-[#00FFD1]" : "text-red-400")}>
                        {isProfit ? '+' : ''}{pnl.toFixed(2)} SOL
                      </div>
                      <div className="text-[8px] md:text-[9px] text-[#52525B] font-bold uppercase tracking-widest">
                        ROI: {((pnl / (holding.entryPrice * holding.amount)) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                );
              })}
              {(!portfolio.holdings || portfolio.holdings.length === 0) && (
                 <div className="text-center p-8 glass-card border border-dashed border-[#1F1F23] rounded-xl bg-[#0D0D0E]">
                   <p className="text-[#A1A1AA] text-xs font-mono uppercase tracking-widest">No active positions</p>
                 </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <h3 className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest mb-6">$LYNX Yield Hub</h3>
          <div className="glass-card rounded overflow-hidden border border-[#00FFD1]/30 bg-[#00FFD1]/5">
            <div className="p-8">
              <div className="w-10 h-10 bg-gradient-to-br from-[#00FFD1] to-[#9945FF] rounded rotate-45 flex items-center justify-center mb-8 mx-auto">
                <Coins className="w-5 h-5 text-black -rotate-45" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2 text-center uppercase tracking-widest">Protocol Dividends</h4>
              <p className="text-xs text-[#71717A] mb-8 leading-relaxed text-center">
                You have accrued <span className="text-[#00FFD1] font-mono font-bold">{portfolio.totalProfit || '0.00'} SOL</span> from passive fees.
              </p>
              
              <div className="space-y-2 mb-8 bg-[#18181B] p-4 rounded border border-[#27272A]">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-[#52525B]">Staked</span>
                  <span className="text-white font-mono tracking-tighter">{formatNumber(portfolio.lynxBalance || 0)} $LYNX</span>
                </div>
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-[#52525B]">Fee Share</span>
                  <span className="text-white font-mono tracking-tighter">{portfolio.feeShare || '0.0'}%</span>
                </div>
              </div>

              <button 
                onClick={handleClaim}
                disabled={isClaiming}
                className={cn(
                "w-full py-4 bg-gradient-to-r from-[#00FFD1] to-[#9945FF] text-black font-black text-xs rounded shadow-[0_0_20px_rgba(0,255,209,0.2)] uppercase tracking-tighter transition-all hover:scale-[1.02] active:scale-95",
                isClaiming && "opacity-50 cursor-not-allowed hover:scale-100 active:scale-100"
              )}>
                Claim {portfolio.totalProfit || '0.00'} SOL
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
