import React from 'react';
import { Search, Bell, Menu, X } from 'lucide-react';

interface HeaderProps {
  onMenuToggle: () => void;
  isSidebarOpen: boolean;
}

export function Header({ onMenuToggle, isSidebarOpen }: HeaderProps) {
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
            placeholder="Search markets..." 
            className="w-full bg-[#18181B] border border-[#27272A] rounded py-1.5 pl-10 pr-4 text-xs text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#00FFD1] transition-all"
            id="market-search"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-2 bg-[#18181B] px-3 py-1.5 rounded border border-[#27272A]">
          <div className="w-2 h-2 rounded-full bg-[#00FFD1] animate-pulse"></div>
          <span className="text-[10px] font-mono text-[#A1A1AA]">SOLANA MAINNET: 12.4ms</span>
        </div>

        <button className="p-2 text-[#71717A] hover:text-white transition-colors relative" id="notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#FF3D00] rounded-full"></span>
        </button>
        
        <button className="bg-[#00FFD1] text-black text-xs font-bold px-4 py-2 rounded uppercase cursor-pointer hover:bg-[#00E5BC] transition-transform active:scale-95" id="wallet-connect">
          Connect Wallet
        </button>
      </div>
    </header>
  );
}
