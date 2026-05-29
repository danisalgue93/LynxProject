/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { MarketsGrid } from '../components/markets/MarketsGrid';
import { DuelsGrid } from '../components/duels/DuelsGrid';
import { OrderBookView } from '../components/orderbook/OrderBookView';
import { PortfolioView } from '../components/portfolio/PortfolioView';
import { GovernanceView } from '../components/dao/GovernanceView';
import { SettingsView } from '../components/settings/SettingsView';
import { DocsView } from '../components/docs/DocsView';
import { MarketDetail } from '../components/markets/MarketDetail';
import { CreateDuelModal } from '../components/duels/CreateDuelModal';
import { CreateMarketModal } from '../components/markets/CreateMarketModal';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight, Zap } from 'lucide-react';
import { Market } from '../types';
import { useProgram } from '../hooks/useProgram';
import { eventBus } from '../lib/eventBus';
import { API_BASE_URL } from '../lib/api';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';

export function Dashboard() {
  const { t } = useTranslation();
  const { logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('markets');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [isCreateDuelOpen, setIsCreateDuelOpen] = useState(false);
  const [isCreateMarketOpen, setIsCreateMarketOpen] = useState(false);
  const [marketSummary, setMarketSummary] = useState({ markets: 0, volume: 0 });
  const { fetchMarkets, createDuel, createMarket } = useProgram();

  useEffect(() => {
    try {
      const socket = io(API_BASE_URL, { transports: ['websocket'] });
      socket.on('connect', () => console.log('[socket] connected', socket.id));
      const events = ['market:created','market:updated','duel:created','duel:accepted','orderbook:updated','portfolio:updated','dao:proposal-created','dao:proposal-updated','dev:reset','crypto:tx'];
      for (const ev of events) {
        socket.on(ev, (payload: any) => {
          eventBus.dispatchEvent(new CustomEvent(ev, { detail: payload }));
        });
      }
      return () => {
        socket.disconnect();
      };
    } catch (err) {
      console.error('Socket init failed', err);
    }
  }, []);

  // Toasts for transactions
  const [txToasts, setTxToasts] = useState<Array<{ id: string; signature: string; link: string; wallet?: string }>>([]);

  useEffect(() => {
    const onTx = (e: Event) => {
      const d = (e as CustomEvent<{ signature: string; link: string; wallet?: string }>).detail;
      if (!d || !d.signature) return;
      const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      setTxToasts((s) => [{ id, signature: d.signature, link: d.link, wallet: d.wallet }, ...s]);
      setTimeout(() => setTxToasts((s) => s.filter(t => t.id !== id)), 12000);
    };
    eventBus.addEventListener('crypto:tx', onTx as any);
    return () => eventBus.removeEventListener('crypto:tx', onTx as any);
  }, []);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

  useEffect(() => {
    const refresh = async () => {
      const markets = await fetchMarkets();
      setMarketSummary({
        markets: markets.length,
        volume: markets.reduce((sum, market) => sum + (market.poolAmount || 0), 0)
      });
    };
    refresh();
    const onMarketsChanged = () => { refresh(); };
    eventBus.addEventListener('market:created', onMarketsChanged as any);
    eventBus.addEventListener('market:updated', onMarketsChanged as any);
    return () => {
      eventBus.removeEventListener('market:created', onMarketsChanged as any);
      eventBus.removeEventListener('market:updated', onMarketsChanged as any);
    };
  }, [fetchMarkets]);

  const launchFirstMarket = async () => {
    const markets = await fetchMarkets();
    if (markets.length > 0) {
      setSelectedMarket(markets[0]);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-[#0A0A0B] text-[#E4E4E7] font-sans overflow-hidden lynx-grid">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={(tab) => { setActiveTab(tab); closeSidebar(); }} 
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
      />
      
      <main className="flex-1 flex flex-col overflow-y-auto relative custom-scrollbar mobile-no-scrollbar">
        <Header onMenuToggle={toggleSidebar} isSidebarOpen={isSidebarOpen} onLogout={handleLogout} />

        <div className="flex-1">
          <AnimatePresence mode="wait">
            {activeTab === 'markets' ? (
              <motion.div
                key="markets"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                {/* Hero section */}
                <div className="p-4 md:p-8 pb-0">
                  <div className="relative overflow-hidden rounded-xl bg-[#0D0D0E] border border-[#1F1F23] p-6 md:p-12">
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_50%_50%,_#00FFD1_0%,_transparent_70%)] pointer-events-none"></div>
                    
                    <div className="relative z-10 max-w-2xl">
                      <div className="flex items-center gap-2 mb-4 md:mb-6">
                        <span className="text-[9px] md:text-[10px] bg-[#18181B] text-[#A1A1AA] px-2 py-0.5 rounded border border-[#27272A] tracking-widest uppercase font-bold">
                          {t('dashboard.mainnetBadge', 'DEVNET')}
                        </span>
                        <span className="text-[#71717A] text-[9px] md:text-[10px] font-bold uppercase tracking-[0.2em]">
                          {t('dashboard.daoSubtitle', 'DEX PROTOCOL DAO')}
                        </span>
                      </div>

                      <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 md:mb-6 leading-[1.05] tracking-tighter">
                        {t('dashboard.heroTitle1', 'Predict. Duel.')} <br/>
                        <span className="text-gradient">{t('dashboard.heroTitle2', 'Dominate.')}</span>
                      </h1>

                      <p className="text-sm md:text-base text-[#71717A] mb-6 md:mb-8 leading-relaxed max-w-lg">
                        {t('dashboard.heroDescription', 'The definitive P2P prediction ecosystem on Solana. Trade real-world outcomes, duel with high leverage, and shape the protocol through our Dex Protocol DAO.')}
                      </p>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                        <button 
                          onClick={launchFirstMarket}
                          className="px-6 md:px-8 py-3 md:py-4 bg-[#00FFD1] text-black font-black text-xs md:text-sm rounded shadow-[0_0_20px_rgba(0,255,209,0.2)] uppercase tracking-tight hover:bg-[#00E5BC] transition-all flex items-center justify-center gap-2 group"
                        >
                          {t('dashboard.launchMarkets', 'Launch Markets')}
                          <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                        </button>
                        <button 
                          onClick={() => setIsCreateDuelOpen(true)}
                          className="px-6 md:px-8 py-3 md:py-4 bg-[#18181B] text-white font-bold text-xs md:text-sm rounded border border-[#27272A] hover:bg-[#27272A] transition-all uppercase tracking-tight"
                        >
                          {t('dashboard.hostDuel', 'Host 1v1 Duel')}
                        </button>
                      </div>

                      <div className="flex flex-row justify-between sm:grid sm:grid-cols-3 gap-2 sm:gap-12 mt-8 md:mt-12 pt-8 md:pt-12 border-t border-[#1F1F23]">
                        <div className="space-y-0.5 sm:space-y-1 text-center sm:text-left flex-1 border-r border-[#1F1F23] sm:border-0 pr-2 sm:pr-0">
                          <div className="text-[6px] min-[380px]:text-[8px] md:text-[10px] text-[#71717A] block uppercase font-bold tracking-widest whitespace-nowrap">{t('dashboard.totalVolume', 'Total Volume')}</div>
                          <div className="text-sm min-[380px]:text-base md:text-2xl font-mono font-bold text-white tracking-tighter">{marketSummary.volume.toFixed(2)} SOL</div>
                        </div>
                        <div className="space-y-0.5 sm:space-y-1 text-center sm:text-left flex-1 border-r border-[#1F1F23] sm:border-0 px-2 sm:px-0">
                          <div className="text-[6px] min-[380px]:text-[8px] md:text-[10px] text-[#71717A] block uppercase font-bold tracking-widest whitespace-nowrap">{t('marketsGrid.title', 'Active Markets')}</div>
                          <div className="text-sm min-[380px]:text-base md:text-2xl font-mono font-bold text-[#00FFD1] tracking-tighter">{marketSummary.markets}</div>
                        </div>
                        <div className="space-y-0.5 sm:space-y-1 text-center sm:text-left flex-1 pl-2 sm:pl-0">
                          <div className="text-[6px] min-[380px]:text-[8px] md:text-[10px] text-[#71717A] block uppercase font-bold tracking-widest whitespace-nowrap">Network</div>
                          <div className="text-sm min-[380px]:text-base md:text-2xl font-mono font-bold text-[#9945FF] tracking-tighter">Devnet</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <MarketsGrid onMarketSelect={setSelectedMarket} canCreateMarket={isAdmin} onCreateMarket={() => setIsCreateMarketOpen(true)} />
              </motion.div>
            ) : activeTab === 'duels' ? (
              <motion.div
                key="duels"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <DuelsGrid onCreateDuel={() => setIsCreateDuelOpen(true)} />
              </motion.div>
            ) : activeTab === 'orderbook' ? (
              <motion.div
                key="orderbook"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <OrderBookView />
              </motion.div>
            ) : activeTab === 'portfolio' ? (
              <motion.div
                key="portfolio"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <PortfolioView />
              </motion.div>
            ) : activeTab === 'governance' ? (
              <motion.div
                key="governance"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <GovernanceView />
              </motion.div>
            ) : activeTab === 'settings' ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <SettingsView />
              </motion.div>
            ) : activeTab === 'docs' ? (
              <motion.div
                key="docs"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <DocsView />
              </motion.div>
            ) : (
              <motion.div
                key="other"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-8 flex items-center justify-center h-full min-h-[50vh]"
              >
                <div className="text-center p-12 glass-card rounded-[2rem] max-w-md border border-white/5">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Zap className="w-8 h-8 text-[#00FFA3]" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{t('common.syncing', 'Syncing Program...')}</h3>
                  <p className="text-slate-400 mb-6">
                    {t('common.optimizingModule', 'The {{module}} module is currently being optimized for high-speed P2P matching. Check back in a moment.', { module: activeTab })}
                  </p>
                  <button 
                    onClick={() => setActiveTab('markets')}
                    className="text-sm font-bold text-[#00FFA3] hover:underline"
                  >
                    {t('common.returnToMarkets', 'Return to Markets')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <footer className="p-4 md:p-8 mt-auto border-t border-[#1F1F23]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-0">
            <div className="text-[9px] md:text-[10px] text-[#52525B] font-bold uppercase tracking-[0.2em] text-center md:text-left">
              &copy; 2026 LYNX MARKET. <span className="text-[#00FFD1]">{t('footer.dao', 'DEX PROTOCOL DAO.')}</span>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-row gap-4 sm:gap-8 text-[9px] md:text-[10px] text-[#52525B] font-black uppercase tracking-widest text-center">
              <a href="#" className="hover:text-white transition-colors">{t('footer.privacy', 'Privacy')}</a>
              <a href="#" className="hover:text-white transition-colors">{t('footer.terms', 'Terms')}</a>
              <a href="#" className="hover:text-white transition-colors">{t('footer.twitter', 'Twitter (X)')}</a>
              <a href="#" className="hover:text-white transition-colors">{t('footer.discord', 'Discord')}</a>
            </div>
          </div>
        </footer>
      </main>

      <AnimatePresence>
        {selectedMarket && (
          <MarketDetail 
            market={selectedMarket} 
            onClose={() => setSelectedMarket(null)} 
          />
        )}
        {isCreateDuelOpen && (
          <CreateDuelModal 
            onClose={() => setIsCreateDuelOpen(false)} 
            onSubmit={async (data) => {
              try {
                await createDuel(data);
                setIsCreateDuelOpen(false);
              } catch (e) {
                console.error(e);
              }
            }} 
          />
        )}
        {isCreateMarketOpen && isAdmin && (
          <CreateMarketModal
            onClose={() => setIsCreateMarketOpen(false)}
            onSubmit={async (data) => {
              await createMarket(data);
            }}
          />
        )}
      </AnimatePresence>

      {/* Transaction toasts */}
      <div className="fixed right-6 top-20 z-[200] flex flex-col gap-3">
        {txToasts.map((t) => (
          <div key={t.id} className="bg-[#0D0D0E] border border-[#27272A] rounded p-3 shadow-lg min-w-[260px]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm font-bold text-white">Transaccion registrada</div>
                <a href={t.link} target="_blank" rel="noreferrer" className="text-xs text-[#00FFD1] font-mono break-all">{t.signature}</a>
                {t.wallet && <div className="text-[10px] text-[#71717A] mt-1">{t.wallet}</div>}
              </div>
              <button onClick={() => setTxToasts((s) => s.filter(x => x.id !== t.id))} className="text-[#71717A] text-xs">Cerrar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
