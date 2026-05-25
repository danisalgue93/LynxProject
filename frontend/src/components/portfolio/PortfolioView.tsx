import React, { useEffect, useState } from 'react';
import { Wallet, PieChart, TrendingUp, CheckCircle2, Trophy as RewardIcon, CreditCard } from 'lucide-react';
import { formatSOL, formatNumber, cn } from '@/src/lib/utils';
import { useProgram } from '@/src/hooks/useProgram';
import { eventBus } from '@/src/lib/eventBus';
import { Market, Portfolio } from '@/src/types';
import { useTranslation } from 'react-i18next';
import { useWallet } from '@solana/wallet-adapter-react';

async function openSignedMoonPay(walletAddress?: string) {
  const params = new URLSearchParams({ currencyCode: 'sol' });
  if (walletAddress && walletAddress !== 'DEV_WALLET') params.set('walletAddress', walletAddress);

  const response = await fetch(`/integrations/moonpay/onramp-url?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) {
    throw new Error(data?.error || 'MoonPay is not configured');
  }

  window.open(data.url, '_blank', 'width=500,height=700,noopener');
}

export function PortfolioView() {
  const { t } = useTranslation();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const { fetchMarkets, fetchPortfolio, claimRewards, stakeLynx, unstakeLynx, isLoading, error } = useProgram();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [stakeMode, setStakeMode] = useState<'stake'|'unstake'>('stake');
  const [stakeAmount, setStakeAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'wallet' | 'portfolio' | 'staking'>('wallet');
  const [moonPayError, setMoonPayError] = useState<string | null>(null);

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
    const onUpdate = () => { loadData(); };
    eventBus.addEventListener('portfolio:updated', onUpdate as any);
    eventBus.addEventListener('dev:reset', onUpdate as any);
    return () => {
      eventBus.removeEventListener('portfolio:updated', onUpdate as any);
      eventBus.removeEventListener('dev:reset', onUpdate as any);
    };
  }, [fetchMarkets, fetchPortfolio]);

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      const result = await claimRewards();
      if (result?.portfolio) setPortfolio(result.portfolio);
    } catch (err) {
      console.error(err);
    } finally {
      setIsClaiming(false);
    }
  };

  const handleStakeAction = async () => {
    if (!stakeAmount || isNaN(Number(stakeAmount))) return;
    setIsStaking(true);
    try {
      if (stakeMode === 'stake') {
        const updated = await stakeLynx(Number(stakeAmount));
        if (updated) setPortfolio(updated);
      } else {
        const updated = await unstakeLynx(Number(stakeAmount));
        if (updated) setPortfolio(updated);
      }
      setStakeAmount('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsStaking(false);
    }
  };

  if (!portfolio) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <div className="w-8 h-8 rounded-full border-t-2 border-[#00FFD1] animate-spin mb-4" />
        <span className="font-mono text-[#71717A] text-sm uppercase tracking-widest">{t('portfolio.loading', 'Loading on-chain portfolio...')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <div className="text-red-400 font-mono text-sm border-dashed border border-red-400/20 bg-red-400/5 p-4 rounded-xl">
          {t('common.error', 'Error')}: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-white border border-white/10">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-1">{t('portfolio.title', 'Your Portfolio')}</h2>
            <p className="text-slate-500 text-sm">{t('portfolio.subtitle', 'Manage your positions, balances and $LYNX rewards.')}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6 mb-8 border-b border-[#1F1F23]">
        <button 
          onClick={() => setActiveTab('wallet')} 
          className={cn("pb-3 text-sm font-bold uppercase tracking-widest transition-colors relative", activeTab === 'wallet' ? "text-[#00FFD1]" : "text-[#71717A] hover:text-white")}
        >
           {t('portfolio.walletTab', 'Wallet')}
           {activeTab === 'wallet' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#00FFD1]" />}
        </button>
        <button 
           onClick={() => setActiveTab('portfolio')} 
           className={cn("pb-3 text-sm font-bold uppercase tracking-widest transition-colors relative", activeTab === 'portfolio' ? "text-[#00FFD1]" : "text-[#71717A] hover:text-white")}
        >
           {t('portfolio.portfolioTab', 'Portfolio')}
           {activeTab === 'portfolio' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#00FFD1]" />}
        </button>
        <button 
           onClick={() => setActiveTab('staking')} 
           className={cn("pb-3 text-sm font-bold uppercase tracking-widest transition-colors relative", activeTab === 'staking' ? "text-[#00FFD1]" : "text-[#71717A] hover:text-white")}
        >
           {t('portfolio.stakingTab', 'Staking')}
           {activeTab === 'staking' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#00FFD1]" />}
        </button>
      </div>

      {activeTab === 'wallet' && (
        <div className="space-y-6">
          <div className="glass-card rounded p-6 md:p-8 border border-[#1F1F23] bg-[#0D0D0E]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-[#18181B] border border-[#27272A] flex items-center justify-center">
                <Wallet className="w-5 h-5 text-[#9945FF]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white tracking-widest uppercase mb-1">{t('portfolio.walletTab', 'Wallet')}</h3>
                <p className="text-[10px] text-[#A1A1AA] font-mono tracking-tight">{t('portfolio.connectedVia', 'Connected via Google / Email')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
               <div className="space-y-4">
                 <div className="bg-[#141417] p-4 rounded border border-[#27272A]">
                    <div className="text-[9px] text-[#71717A] uppercase font-bold tracking-widest mb-2">Wallet Address</div>
                    <div className="font-mono text-white text-xs truncate max-w-[250px]">
                      {portfolio.walletAddress || "7XytR...Pq9W"}
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <div className="bg-[#141417] p-4 rounded border border-[#27272A] flex-1">
                      <div className="text-[9px] text-[#71717A] uppercase font-bold tracking-widest mb-2">SOL Balance</div>
                      <div className="font-mono font-bold text-[#00FFD1]">{formatSOL(portfolio.solBalance)}</div>
                    </div>
                    <div className="bg-[#141417] p-4 rounded border border-[#27272A] flex-1">
                      <div className="text-[9px] text-[#71717A] uppercase font-bold tracking-widest mb-2">LYNX Balance</div>
                      <div className="font-mono font-bold text-[#9945FF]">{formatNumber(portfolio.lynxBalance)}</div>
                    </div>
                 </div>
               </div>

               <div className="bg-[#141417] p-6 rounded border border-[#27272A] flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center p-2 mb-4">
                     <svg viewBox="0 0 40 40" fill="none" className="w-full h-full"><path d="M20 40C31.0457 40 40 31.0457 40 20C40 8.9543 31.0457 0 20 0C8.9543 0 0 8.9543 0 20C0 31.0457 8.9543 40 20 40Z" fill="#7D00FF"/><path d="M26.2428 11.5833H13.7571C11.9686 11.5833 10.519 13.0425 10.519 14.8427V25.1574C10.519 26.9576 11.9686 28.4168 13.7571 28.4168H26.2428C28.0313 28.4168 29.4809 26.9576 29.4809 25.1574V14.8427C29.4809 13.0425 28.0313 11.5833 26.2428 11.5833ZM25.8643 25.0416H14.1356C12.9818 25.0416 12.0463 24.1 12.0463 22.9388V17.0612C12.0463 15.9 12.9818 14.9584 14.1356 14.9584H25.8643C27.0181 14.9584 27.9536 15.9 27.9536 17.0612V22.9388C27.9536 24.1 27.0181 25.0416 25.8643 25.0416Z" fill="white"/><path d="M23.1091 19.3402C23.1091 20.8927 21.8596 22.1504 20.2974 22.1504C18.7352 22.1504 17.4858 20.8927 17.4858 19.3402C17.4858 17.7877 18.7352 16.53 20.2974 16.53C21.8596 16.53 23.1091 17.7877 23.1091 19.3402Z" fill="white"/></svg>
                  </div>
                  <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wide">Buy Crypto</h4>
                  <p className="text-[10px] text-[#A1A1AA] mb-4 leading-relaxed max-w-[200px]">
                    Instantly purchase crypto using your credit card, debit card, or bank account via MoonPay.
                  </p>
                  {moonPayError && (
                    <div className="mb-3 text-[10px] text-red-400 bg-red-950/20 border border-red-500/20 rounded px-3 py-2">
                      {moonPayError}
                    </div>
                  )}
                  <button
                    className="w-full py-3 bg-[#7D00FF] hover:bg-[#6000C8] text-white font-black text-[10px] uppercase tracking-widest rounded flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(125,0,255,0.3)]"
                    onClick={async () => {
                      setMoonPayError(null);
                      try {
                        await openSignedMoonPay(walletAddress);
                      } catch (err: any) {
                        setMoonPayError(err.message || 'MoonPay is not available');
                      }
                    }}
                  >
                    <CreditCard className="w-4 h-4" />
                    {t('portfolio.buyCrypto', 'Buy Crypto with MoonPay')}
                  </button>
               </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="lg:col-span-1 glass-card rounded p-4 md:p-6 border border-[#1F1F23] bg-[#0D0D0E]">
              <div className="text-[9px] md:text-[10px] uppercase font-black text-[#71717A] tracking-widest mb-3 md:mb-4">{t('portfolio.totalAssets', 'Total Assets')}</div>
              <div className="text-2xl md:text-3xl font-mono font-bold text-white mb-2 tracking-tighter">{formatSOL(portfolio.solBalance)}</div>
              <div className="text-[9px] md:text-[10px] text-[#00FFD1] flex items-center gap-1 font-bold uppercase tracking-wider">
                <TrendingUp className="w-3 h-3" />
                {t('portfolio.activeVault', 'Active Vault')}
              </div>
            </div>

            <div className="lg:col-span-1 glass-card rounded p-4 md:p-6 border border-[#27272A] bg-[#141417]">
              <div className="text-[9px] md:text-[10px] uppercase font-black text-[#A1A1AA] tracking-widest mb-3 md:mb-4">{t('portfolio.lynxHolding', '$LYNX Holding')}</div>
              <div className="text-2xl md:text-3xl font-mono font-bold text-white mb-2 tracking-tighter">{formatNumber(portfolio.lynxBalance)}</div>
              <div className="text-[9px] md:text-[10px] text-[#71717A] flex items-center gap-1 font-bold uppercase tracking-widest">
                {t('portfolio.yieldWeight', 'Yield Weight: High')}
              </div>
            </div>

            <div className="lg:col-span-2 glass-card rounded p-4 md:p-6 border border-[#1F1F23] flex items-center justify-between bg-[#0D0D0E]">
              <div>
                <div className="text-[9px] md:text-[10px] uppercase font-black text-[#71717A] tracking-widest mb-3 md:mb-4">{t('portfolio.totalRewardPool', 'Total Reward Pool')}</div>
                <div className="text-2xl md:text-3xl font-mono font-bold text-[#00FFD1] tracking-tighter">+{formatSOL(portfolio.totalProfit || 0)}</div>
                <div className="text-[8px] md:text-[9px] text-[#52525B] mt-2 uppercase font-bold tracking-widest">{t('portfolio.realTimeSync', 'REAL-TIME ON-CHAIN SYNC')}</div>
              </div>
              <div className="h-full w-24 md:w-32 relative opacity-10 md:opacity-20 hidden sm:block">
                <PieChart className="w-full h-full text-[#E4E4E7]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'portfolio' && (
        <div className="grid grid-cols-1 gap-8">
           <div className="space-y-8">
             {/* Event Settlements Section */}
             <div>
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#00FFD1]" />
                  <h3 className="text-[10px] md:text-[11px] font-bold text-white uppercase tracking-widest">{t('portfolio.pendingSettlements', 'Pending Event Settlements')}</h3>
                </div>
                <button 
                  onClick={handleClaim}
                  disabled={isClaiming}
                  className={cn(
                  "text-[9px] md:text-[10px] font-bold text-[#00FFD1] hover:underline uppercase tracking-widest",
                  isClaiming && "opacity-50 cursor-not-allowed"
                )}>{t('portfolio.claimAll', 'Claim All')}</button>
              </div>
              
              <div className="space-y-3">
                {portfolio.payments?.map((claim: any, i: number) => {
                  const isLynx = (claim.token || 'SOL') === 'LYNX';
                  return (
                  <div key={i} className={cn(
                    "glass-card rounded p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all",
                    isLynx ? "border-[#9945FF]/20 bg-[#9945FF]/5" : "border-[#00FFD1]/20 bg-[#00FFD1]/5"
                  )}>
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded flex items-center justify-center border",
                        isLynx ? "bg-[#9945FF]/10 text-[#9945FF] border-[#9945FF]/10" : "bg-[#00FFD1]/10 text-[#00FFD1] border-[#00FFD1]/10"
                      )}>
                        <RewardIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs md:text-sm font-bold text-white mb-1 tracking-tight">{claim.title}</h4>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[9px] font-bold text-black px-1.5 py-0.5 rounded tracking-tighter uppercase",
                            isLynx ? "bg-[#9945FF]" : "bg-[#00FFD1]"
                          )}>{t('portfolio.won', 'Won')}</span>
                          <span className="text-[9px] text-[#71717A] font-bold uppercase tracking-widest">{claim.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-6">
                      <div className="text-right">
                        <div className={cn(
                          "text-sm md:text-lg font-mono font-bold tracking-tighter",
                          (claim.token || 'SOL') === 'LYNX' ? "text-[#9945FF]" : "text-[#00FFD1]"
                        )}>
                          +{claim.amount} {claim.token || 'SOL'}
                        </div>
                        <div className="text-[9px] text-[#71717A] font-bold uppercase tracking-widest text-right">
                          {t('portfolio.readyToClaim', 'Ready to claim')}
                        </div>
                      </div>
                      <button 
                        onClick={handleClaim}
                        disabled={isClaiming}
                        className={cn(
                        "px-4 py-2 bg-[#00FFD1] text-black text-[10px] font-black uppercase rounded tracking-tight hover:scale-105 active:scale-95 transition-all",
                        isClaiming && "opacity-50 hover:scale-100 active:scale-100 cursor-not-allowed",
                        (claim.token || 'SOL') === 'LYNX' && "bg-[#9945FF] text-white"
                      )}>
                        {t('portfolio.claim', 'Claim')}
                      </button>
                    </div>
                  </div>
                )})}
                {(!portfolio.payments || portfolio.payments.length === 0) && (
                   <div className="text-center p-8 glass-card border border-dashed border-[#1F1F23] rounded-xl bg-[#0D0D0E]">
                     <p className="text-[#A1A1AA] text-xs font-mono uppercase tracking-widest">{t('portfolio.noPendingClaims', 'No pending claims')}</p>
                   </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#52525B]" />
                  <h3 className="text-[10px] md:text-[11px] font-bold text-[#71717A] uppercase tracking-widest">{t('portfolio.openPositions', 'Open Trading Positions')}</h3>
                </div>
                <button className="text-[9px] md:text-[10px] font-bold text-[#00FFD1] hover:underline uppercase tracking-widest">{t('portfolio.history', 'History')}</button>
              </div>
              
              <div className="space-y-2">
                {portfolio.holdings?.map((holding: any, idx: number) => {
                  const market = markets.find(m => m.id === holding.marketId);
                  const title = market ? market.title : t('portfolio.unknownMarket', 'Unknown Market (Loading...)');
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
                            <span className="text-[#52525B] font-bold uppercase tracking-widest">{t('portfolio.shares', '{{amount}} Shares', { amount: holding.amount })}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className={cn("text-xs md:text-sm font-mono font-bold tracking-tighter", isProfit ? "text-[#00FFD1]" : "text-red-400")}>
                          {isProfit ? '+' : ''}{pnl.toFixed(2)} SOL
                        </div>
                        <div className="text-[8px] md:text-[9px] text-[#52525B] font-bold uppercase tracking-widest">
                          {t('portfolio.roi', 'ROI: {{value}}%', { value: ((pnl / (holding.entryPrice * holding.amount)) * 100).toFixed(1) })}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(!portfolio.holdings || portfolio.holdings.length === 0) && (
                   <div className="text-center p-8 glass-card border border-dashed border-[#1F1F23] rounded-xl bg-[#0D0D0E]">
                     <p className="text-[#A1A1AA] text-xs font-mono uppercase tracking-widest">{t('portfolio.noActivePositions', 'No active positions')}</p>
                   </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'staking' && (
        <div className="max-w-md lg:max-w-4xl mx-auto">
          <div className="glass-card rounded overflow-hidden border border-[#00FFD1]/30 bg-[#00FFD1]/5 mt-4 flex flex-col lg:flex-row">
            <div className="p-4 md:p-8 flex-1 lg:flex lg:flex-col lg:justify-center">
              <div className="w-28 h-28 md:w-32 md:h-32 flex items-center justify-center mb-6 mx-auto">
                <img 
                  src="https://res.cloudinary.com/demeahktg/image/upload/v1778963944/Lynx-Sol_Sinfondo_imzk2w.png" 
                  alt="Lynx Logo" 
                  className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(0,255,209,0.3)]"
                />
              </div>
              <h4 className="text-sm font-bold text-white mb-2 text-center uppercase tracking-widest">{t('portfolio.protocolDividends', 'Protocol Dividends')}</h4>
              <p className="text-xs text-[#71717A] mb-6 leading-relaxed text-center">
                {t('portfolio.accruedDesc', 'You have accrued')} <span className="text-[#00FFD1] font-mono font-bold">{portfolio.totalProfit || '0.00'} SOL</span> {t('portfolio.fromPassiveFees', 'from passive fees.')}
              </p>
              
              <div className="space-y-2 mb-6 bg-[#18181B] p-4 rounded border border-[#27272A]">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-[#52525B]">{t('portfolio.staked', 'Staked')}</span>
                  <span className="text-white font-mono tracking-tighter">{formatNumber(portfolio.stakedLynx || 0)} $LYNX</span>
                </div>
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                  <span className="text-[#52525B]">{t('portfolio.feeShare', 'Fee Share')}</span>
                  <span className="text-white font-mono tracking-tighter">{portfolio.feeShare || '0.0'}%</span>
                </div>
              </div>

              <button 
                onClick={handleClaim}
                disabled={isClaiming}
                className={cn(
                "w-full py-3 lg:mb-0 mb-6 bg-gradient-to-r from-[#00FFD1] to-[#9945FF] text-black font-black text-xs rounded shadow-[0_0_20px_rgba(0,255,209,0.2)] uppercase tracking-tighter transition-all hover:scale-[1.02] active:scale-95",
                isClaiming && "opacity-50 cursor-not-allowed hover:scale-100 active:scale-100"
              )}>
                {t('portfolio.claimAmount', 'Claim {{amount}} SOL', { amount: portfolio.totalProfit || '0.00' })}
              </button>
            </div>

            <div className="p-4 md:p-8 border-t lg:border-t-0 lg:border-l border-[#00FFD1]/20 flex-1 flex flex-col bg-black/10 lg:bg-transparent">
              <div className="flex-1 flex flex-col justify-center mb-6">
                <h4 className="text-xs font-bold text-white mb-6 text-center uppercase tracking-widest">Manage Stake</h4>
                <div className="flex justify-between gap-4 mb-6">
                  <div className="bg-[#141417] border border-[#27272A] rounded p-3 flex-1 text-center">
                    <div className="text-[9px] text-[#71717A] uppercase font-bold tracking-widest mb-2">Wallet</div>
                    <div className="text-sm font-mono font-bold text-white">{formatNumber(portfolio.lynxBalance || 0)}</div>
                  </div>
                  <div className="bg-[#141417] border border-[#27272A] rounded p-3 flex-1 text-center">
                    <div className="text-[9px] text-[#71717A] uppercase font-bold tracking-widest mb-2">Staked</div>
                    <div className="text-sm font-mono font-bold text-white">{formatNumber(portfolio.stakedLynx || 0)}</div>
                  </div>
                </div>
                
                <div className="flex gap-3 mb-6">
                  <button 
                    onClick={() => setStakeMode('stake')}
                    className={cn(
                      "flex-1 py-2.5 text-[10px] font-bold uppercase rounded transition-colors border",
                      stakeMode === 'stake' 
                        ? "bg-[#00FFD1]/10 border-[#00FFD1]/50 text-[#00FFD1]" 
                        : "bg-[#0D0D0E] border-[#27272A] text-[#71717A] hover:border-[#52525B]"
                    )}
                  >
                    Stake
                  </button>
                  <button 
                    onClick={() => setStakeMode('unstake')}
                    className={cn(
                      "flex-1 py-2.5 text-[10px] font-bold uppercase rounded transition-colors border",
                      stakeMode === 'unstake'
                        ? "bg-[#00FFD1]/10 border-[#00FFD1]/50 text-[#00FFD1]"
                        : "bg-[#0D0D0E] border-[#27272A] text-[#71717A] hover:border-[#52525B]"
                    )}
                  >
                    Unstake
                  </button>
                </div>

                <div className="relative">
                  <input 
                    type="number"
                    placeholder="Amount of LYNX..."
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-sm text-white placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50 focus:ring-1 focus:ring-[#00FFD1]/50 transition-all font-mono"
                  />
                  <button 
                    onClick={() => setStakeAmount(String(stakeMode === 'stake' ? portfolio.lynxBalance : portfolio.stakedLynx))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#00FFD1] uppercase tracking-widest hover:underline"
                  >
                    MAX
                  </button>
                </div>
              </div>
                  
              <div className="mt-auto shrink-0">
                <button 
                  onClick={handleStakeAction}
                  disabled={isStaking || !stakeAmount || isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0}
                  className={cn(
                    "w-full py-3 bg-[#00FFD1] text-black font-black text-xs rounded uppercase tracking-tighter transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_15px_rgba(0,255,209,0.2)]",
                    (isStaking || !stakeAmount || isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0) && "opacity-50 cursor-not-allowed hover:scale-100 active:scale-100"
                  )}
                >
                  {isStaking ? <span className="flex items-center justify-center gap-2"><div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin"/> Processing...</span> : (stakeMode === 'stake' ? 'Stake LYNX' : 'Unstake LYNX')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
