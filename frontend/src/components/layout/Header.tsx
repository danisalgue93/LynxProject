import React, { useState } from 'react';
import { Search, Bell, Menu, X, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setUserLanguage } from '@/src/i18n';

interface HeaderProps {
  onMenuToggle: () => void;
  isSidebarOpen: boolean;
}

export function Header({ onMenuToggle, isSidebarOpen }: HeaderProps) {
  const { i18n, t } = useTranslation();
  const [showLangMenu, setShowLangMenu] = useState(false);

  const changeLanguage = (lng: string) => {
    setUserLanguage(lng);
    setShowLangMenu(false);
  };

  const isEnglish = i18n.language.startsWith('en');

  return (
    <header className="h-16 border-b border-[#1F1F23] flex items-center justify-between px-4 lg:px-8 bg-[#0D0D0E] sticky top-0 z-50">
      <div className="flex items-center gap-4 flex-1">
        <button 
          onClick={onMenuToggle}
          className="lg:hidden p-2 text-[#71717A] hover:text-white transition-colors"
          id="mobile-menu-toggle"
        >
          {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div className="relative w-full max-w-md group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#52525B] group-focus-within:text-[#00FFD1] transition-colors" />
          <input 
            type="text" 
            placeholder={t('common.search', 'Search markets...')}
            className="w-full bg-[#18181B] border border-[#27272A] rounded py-1.5 pl-10 pr-4 text-xs text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#00FFD1] transition-all"
            id="market-search"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-2 bg-[#18181B] px-3 py-1.5 rounded border border-[#27272A]">
          <div className="w-2 h-2 rounded-full bg-[#00FFD1] animate-pulse"></div>
          <span className="text-[10px] font-mono text-[#A1A1AA]">{t('header.solanaMainnet', 'SOLANA MAINNET: 12.4ms')}</span>
        </div>

        <div className="relative">
          <button 
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center gap-2 p-2 text-[#71717A] hover:text-white transition-colors text-xs font-semibold"
            id="language-switcher"
          >
            <Globe className="w-4 h-4" />
            <span className="hidden md:inline">{isEnglish ? 'EN' : 'ES'}</span>
          </button>
          
          {showLangMenu && (
            <div className="absolute right-0 mt-2 w-36 bg-[#18181B] border border-[#27272A] rounded shadow-xl py-1 z-50">
              <button 
                onClick={() => changeLanguage('en')}
                className={`w-full flex justify-between items-center px-4 py-2 text-xs hover:bg-[#27272A] transition-colors ${i18n.language.startsWith('en') ? 'text-[#00FFD1]' : 'text-white'}`}
              >
                <span>English</span>
                <span className="text-base">🇺🇸</span>
              </button>
              <button 
                onClick={() => changeLanguage('es')}
                className={`w-full flex justify-between items-center px-4 py-2 text-xs hover:bg-[#27272A] transition-colors ${i18n.language.startsWith('es') ? 'text-[#00FFD1]' : 'text-white'}`}
              >
                <span>Español</span>
                <span className="text-base">🇪🇸</span>
              </button>
            </div>
          )}
        </div>

        <button className="p-2 text-[#71717A] hover:text-white transition-colors relative" id="notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#FF3D00] rounded-full"></span>
        </button>
        
        <button 
          onClick={() => alert("Replace this button with <WalletMultiButton /> from @solana/wallet-adapter-react-ui when integrating smart contracts.")}
          className="bg-[#00FFD1] text-black text-[10px] md:text-xs font-bold px-2 py-1.5 md:px-4 md:py-2 rounded uppercase cursor-pointer hover:bg-[#00E5BC] transition-transform active:scale-95 whitespace-nowrap" 
          id="wallet-connect"
        >
          {t('common.connectWallet', 'Connect Wallet')}
        </button>
      </div>
    </header>
  );
}
