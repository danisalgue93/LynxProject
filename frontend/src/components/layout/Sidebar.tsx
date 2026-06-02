import React from 'react';
import { LayoutGrid, Sword, BarChart3, Wallet, Vote, Info } from 'lucide-react';
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
    { id: 'duels', label: t('nav.duels', 'Duelos'), icon: Sword },
    { id: 'orderbook', label: t('nav.orderBook', 'Order Book'), icon: BarChart3 },
    { id: 'portfolio', label: t('nav.portfolio', 'Portfolio'), icon: Wallet },
    { id: 'governance', label: t('nav.dao', 'DAO / GOV'), icon: Vote },
  ];

  const secondaryItems = [
    { id: 'docs', label: t('nav.docs', 'Docs'), icon: Info },
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
        "fixed inset-y-0 left-0 w-64 border-r border-[#1F1F23] flex flex-col h-full bg-[#0A0A0B] z-[70] transition-transform duration-300 transform lg:relative lg:translate-x-0 outline-none overflow-y-auto custom-scrollbar mobile-no-scrollbar",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-10">
            <img 
              src="https://res.cloudinary.com/demeahktg/image/upload/v1778961729/logo_plataforma_sin_fondo_xlkpa9.png" 
              alt="Lynx Logo" 
              className="w-12 h-12 object-contain rounded-sm"
            />
            <div className="flex flex-col justify-center gap-0.5">
              <span className="text-3xl font-black tracking-[0.1em] text-transparent bg-clip-text bg-gradient-to-r from-[#00FFD1] from-[25%] to-[#8219FF] to-[55%] drop-shadow-[0_0_10px_rgba(0,255,209,0.3)] leading-none">
                LYNX
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.25em] text-transparent bg-clip-text bg-gradient-to-r from-[#00FFD1] from-[25%] to-[#8219FF] to-[55%] drop-shadow-[0_0_8px_rgba(130,25,255,0.3)] -mt-1 ml-0.5">
                MARKET PROTOCOL
              </span>
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
