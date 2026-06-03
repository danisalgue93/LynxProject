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
import { useWallet } from '@solana/wallet-adapter-react';
import { getManagedWalletAddress, useManagedAuthSession } from '../lib/auth';
import { useToast } from '../context/ToastContext';

export function Dashboard() {
  const { t } = useTranslation();
  const { logout, isAdmin, isAuthenticated } = useAuth();
  const { publicKey } = useWallet();
  const managedSession = useManagedAuthSession();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('markets');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [isCreateDuelOpen, setIsCreateDuelOpen] = useState(false);
  const [isCreateMarketOpen, setIsCreateMarketOpen] = useState(false);
  const [marketSummary, setMarketSummary] = useState({ markets: 0, volume: 0 });
  const { fetchMarkets, createDuel, createMarket } = useProgram();
  const activeWallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession);
  const governanceReadOnly = !isAuthenticated || !activeWallet;

  useEffect(() => {
    try {
      const socket = io(API_BASE_URL, { transports: ['websocket'] });
      socket.on('connect', () => {
        console.log('[socket] connected', socket.id);
        if (activeWallet) socket.emit('identify', activeWallet);
      });
      const events = ['market:created','market:updated','duel:created','duel:accepted','orderbook:updated','portfolio:updated','portfolio:updated:private','dao:proposal-created','dao:proposal-updated','dev:reset','crypto:tx'];
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
  }, [activeWallet]);

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
      return;
    }
    addToast({
      type: 'info',
      message: t('dashboard.noActiveMarkets', 'No active markets yet'),
    });
  };

  const handleLogout = () => {
    logout();
    navigate('/');
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
                <GovernanceView readOnly={governanceReadOnly} />
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
              <span>{t('footer.privacy', 'Privacy')}</span>
              <span>{t('footer.terms', 'Terms')}</span>
              <span>{t('footer.twitter', 'Twitter (X)')}</span>
              <span>{t('footer.discord', 'Discord')}</span>
            </div>
          </div>
        </footer>
      </main>

      <AnimatePresence>
        {selectedMarket && (
          <MarketDetail 
            market={selectedMarket} 
            onClose={() => setSelectedMarket(null)} 
            onHostDuel={() => setIsCreateDuelOpen(true)}
          />
        )}
        {isCreateDuelOpen && (
          <CreateDuelModal 
            onClose={() => setIsCreateDuelOpen(false)} 
            onSubmit={async (data) => {
              try {
                await createDuel(data);
                setIsCreateDuelOpen(false);
              } catch (e: any) {
                console.error(e);
                addToast({
                  type: 'error',
                  message: e?.message || t('duels.createFailed', 'Failed to create duel'),
                });
              }
            }} 
          />
        )}
        {isCreateMarketOpen && isAdmin && (
          <CreateMarketModal
            onClose={() => setIsCreateMarketOpen(false)}
            onSubmit={async (data) => {
              try {
                await createMarket(data);
                setIsCreateMarketOpen(false);
              } catch (e) {
                console.error(e);
                throw e;
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Transaction toasts */}
      <div className="fixed right-6 top-20 z-[200] flex flex-col gap-3">
        {txToasts.map((toast) => (
          <div key={toast.id} className="bg-[#0D0D0E] border border-[#27272A] rounded p-3 shadow-lg min-w-[260px]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{t('dashboard.txRegistered', 'Transaction registered')}</div>
                <a href={toast.link} target="_blank" rel="noreferrer" className="text-xs text-[#00FFD1] font-mono break-all">{toast.signature}</a>
                {toast.wallet && <div className="text-[10px] text-[#71717A] mt-1">{toast.wallet}</div>}
              </div>
              <button onClick={() => setTxToasts((s) => s.filter(x => x.id !== toast.id))} className="text-[#71717A] text-xs">{t('common.close', 'Close')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
