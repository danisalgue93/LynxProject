/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage } from '@/src/lib/errors';
import { useState, useEffect, useRef } from 'react';
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
import { Zap } from 'lucide-react';
import { Market } from '../types';
import { useProgram } from '../hooks/useProgram';
import { eventBus, type AppEventName, type AppEvents } from '../lib/eventBus';
import { API_BASE_URL, getAccessToken } from '../lib/api';
import { io, type Socket } from 'socket.io-client';
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
  const { createDuel, createMarket } = useProgram();
  const activeWallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession);
  const socketRef = useRef<Socket | null>(null);
  const governanceReadOnly = !isAuthenticated || !activeWallet;

  useEffect(() => {
    try {
      const token = getAccessToken();
      const socket = io(API_BASE_URL, { 
        transports: ['websocket'],
        auth: { token }
      });
      socketRef.current = socket;
      socket.on('connect', () => {
        if (activeWallet) socket.emit('identify', activeWallet);
      });
      const events: AppEventName[] = ['market:created','market:updated','duel:created','duel:accepted','orderbook:updated','portfolio:updated','portfolio:updated:private','dao:proposal-created','dao:proposal-updated','crypto:tx'];
      for (const ev of events) {
        // Socket payloads are an external, untyped boundary; consumers narrow
        // per-event via the AppEvents map in lib/eventBus.ts.
        socket.on(ev, (payload: unknown) => {
          eventBus.emit(ev, payload as AppEvents[typeof ev]);
        });
      }
      return () => {
        socket.disconnect();
        socketRef.current = null;
      };
    } catch (err) {
      console.error('Socket init failed', err);
    }
    // Mount-only ON PURPOSE: the socket connects once per Dashboard mount, and
    // wallet changes are handled by the follow-up effect below re-emitting
    // `identify` — depending on activeWallet here would tear down and reconnect
    // the socket on every wallet switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeWallet && socketRef.current?.connected) {
      socketRef.current.emit('identify', activeWallet);
    }
  }, [activeWallet]);

  // Toasts for transactions
  const [txToasts, setTxToasts] = useState<Array<{ id: string; signature: string; link: string; wallet?: string }>>([]);

  useEffect(() => {
    return eventBus.on('crypto:tx', (d) => {
      if (!d || !d.signature) return;
      const id = `tx-${Date.now()}-${crypto.randomUUID()}`;
      setTxToasts((s) => [{ id, signature: d.signature, link: d.link, wallet: d.wallet }, ...s]);
      setTimeout(() => setTxToasts((s) => s.filter(t => t.id !== id)), 12000);
    });
  }, []);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

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
                // Carry the parent market's on-chain pubkey so the duel is
                // created on-chain (SOL) when the market lives on-chain.
                await createDuel({ ...data, onChainMarket: selectedMarket?.onChainMarket });
                setIsCreateDuelOpen(false);
              } catch (e) {
                console.error(e);
                addToast({
                  type: 'error',
                  message: getErrorMessage(e) || t('duels.createFailed', 'Failed to create duel'),
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
