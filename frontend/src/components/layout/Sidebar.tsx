import React from 'react';
import { LayoutGrid, Sword, BarChart3, Wallet, Vote, Info, Settings } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ activeTab, setActiveTab, isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();

  const menuItems = [
    { id: 'markets', label: t('nav.markets', 'Markets'), icon: LayoutGrid },
    { id: 'duels', label: t('nav.duels', '1v1 Duels'), icon: Sword },
    { id: 'orderbook', label: t('nav.orderBook', 'Order Book'), icon: BarChart3 },
    { id: 'governance', label: t('nav.dao', 'DAO / GOV'), icon: Vote },
    { id: 'portfolio', label: t('nav.portfolio', 'Portfolio'), icon: Wallet },
  ];

  const secondaryItems = [
    { id: 'docs', label: t('nav.docs', 'Docs'), icon: Info },
    { id: 'settings', label: t('nav.settings', 'Settings'), icon: Settings },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] lg:hidden"
          onClick={onClose}
        />
      )}

      <div className={cn(
        "fixed inset-y-0 left-0 w-64 border-r border-[#1F1F23] flex flex-col h-full bg-[#0A0A0B] z-[70] transition-transform duration-300 transform lg:relative lg:translate-x-0 outline-none",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-8 h-8 bg-gradient-to-br from-[#00FFD1] to-[#9945FF] rounded-sm rotate-45 flex items-center justify-center">
              <span className="-rotate-45 font-black text-black text-[10px]">L</span>
            </div>
            <div className="flex flex-col -gap-1">
              <span className="text-xl font-bold tracking-tighter text-white leading-none">LYNX <span className="text-[#00FFD1] font-medium tracking-normal">MARKET</span></span>
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#52525B]">Dex Protocol Dao</span>
            </div>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 group text-[11px] font-bold uppercase tracking-widest text-left",
                  activeTab === item.id 
                    ? "bg-[#18181B] text-[#00FFD1] border border-[#27272A]" 
                    : "text-[#71717A] hover:text-white"
                )}
                id={`nav-${item.id}`}
              >
                <item.icon className={cn(
                  "w-4 h-4",
                  activeTab === item.id ? "text-[#00FFD1]" : "text-[#52525B] group-hover:text-slate-300"
                )} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-[#1F1F23]">
          <div className="space-y-1">
            {secondaryItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded text-[11px] font-bold uppercase tracking-widest transition-all",
                  activeTab === item.id 
                    ? "bg-[#18181B] text-[#00FFD1] border border-[#27272A]" 
                    : "text-[#71717A] hover:text-white hover:bg-white/5"
                )}
                id={`nav-${item.id}`}
              >
                <item.icon className={cn(
                  "w-4 h-4",
                  activeTab === item.id ? "text-[#00FFD1]" : "text-[#52525B]"
                )} />
                {item.label}
              </button>
            ))}
          </div>
          
          <div className="mt-6 p-4 rounded bg-[#141417] border border-[#27272A]">
            <div className="text-[10px] uppercase tracking-widest text-[#00FFD1] font-bold mb-1">{t('sidebar.ecosystemAsset', 'Ecosystem Asset')}</div>
            <div className="text-sm font-bold text-white mb-2">{t('sidebar.lynxStaking', '$LYNX Staking')}</div>
            <p className="text-[11px] text-[#71717A] mb-0 leading-tight">{t('sidebar.stakingDesc', 'Accrue protocol fees in SOL by holding $LYNX.')}</p>
          </div>
        </div>
      </div>
    </>
  );
}
