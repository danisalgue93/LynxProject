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
import { RequiresLoginModal } from '../components/common/RequiresLoginModal';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight, Zap, LogIn } from 'lucide-react';
import { Market } from '../types';
import { useProgram } from '../hooks/useProgram';
import { eventBus } from '../lib/eventBus';
import { API_BASE_URL } from '../lib/api';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { getManagedWalletAddress, useManagedAuthSession } from '../lib/auth';

export function PublicPage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const { publicKey } = useWallet();
  const managedSession = useManagedAuthSession();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('markets');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [isCreateDuelOpen, setIsCreateDuelOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalAction, setLoginModalAction] = useState('');
  const [marketSummary, setMarketSummary] = useState({ markets: 0, volume: 0 });
  const { fetchMarkets, createDuel } = useProgram();
  const activeWallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession);

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

  const handleActionClick = (action: string) => {
    if (!isAuthenticated) {
      setLoginModalAction(action);
      setShowLoginModal(true);
    } else {
      // Si está autenticado, realizar acción normalmente
      if (action === 'crear duel') {
        setIsCreateDuelOpen(true);
      }
    }
  };

  const handleLogout = () => {
    // No logout en página pública
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
        <Header 
          onMenuToggle={toggleSidebar} 
          isSidebarOpen={isSidebarOpen} 
          onLogout={handleLogout}
          showAuthButtons={!isAuthenticated}
        />

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
                <MarketsGrid onMarketSelect={setSelectedMarket} readOnly={!isAuthenticated} />
              </motion.div>
            ) : activeTab === 'duels' ? (
              <motion.div
                key="duels"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <DuelsGrid 
                  onCreateDuel={() => handleActionClick('crear duel')}
                  readOnly={!isAuthenticated}
                />
              </motion.div>
            ) : activeTab === 'orderbook' ? (
              <motion.div
                key="orderbook"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <OrderBookView readOnly={!isAuthenticated} onAuthRequired={handleActionClick} />
              </motion.div>
            ) : activeTab === 'portfolio' ? (
              <motion.div
                key="portfolio"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                {isAuthenticated ? (
                  <PortfolioView />
                ) : (
                  <div className="p-8 flex items-center justify-center h-full min-h-[50vh]">
                    <div className="text-center p-12 glass-card rounded-[2rem] max-w-md border border-white/5">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                        <LogIn className="w-8 h-8 text-[#00FFD1]" />
                      </div>
                      <h3 className="text-2xl font-bold text-white mb-3">Portfolio Vacío</h3>
                      <p className="text-slate-400 mb-6">
                        Inicia sesión para ver tu portafolio y tus posiciones en mercados.
                      </p>
                      <button 
                        onClick={() => setShowLoginModal(true)}
                        className="px-6 py-3 bg-[#00FFD1] text-black font-bold rounded hover:bg-[#00E5BC] transition-all"
                      >
                        Registrarse / Login
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'governance' ? (
              <motion.div
                key="governance"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <GovernanceView readOnly={!isAuthenticated} />
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
            readOnly={!isAuthenticated}
            onAuthRequired={handleActionClick}
            onHostDuel={() => setIsCreateDuelOpen(true)}
          />
        )}
        {isCreateDuelOpen && isAuthenticated && (
          <CreateDuelModal 
            onClose={() => setIsCreateDuelOpen(false)} 
            onSubmit={async (data) => {
              await createDuel(data);
            }} 
          />
        )}
      </AnimatePresence>

      <RequiresLoginModal 
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        action={loginModalAction}
      />

      {/* Transaction toasts */}
      <div className="fixed right-6 top-20 z-[200] flex flex-col gap-3">
        {txToasts.map((toast) => (
          <div key={toast.id} className="bg-[#0D0D0E] border border-[#27272A] rounded p-3 shadow-lg min-w-[260px]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{t('dashboard.txRegistered', 'Transaction registered')}</div>
                <a href={toast.link} target="_blank" rel="noreferrer" className="text-xs text-[#00FFD1] hover:underline">
                  {toast.signature.slice(0, 20)}...
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
