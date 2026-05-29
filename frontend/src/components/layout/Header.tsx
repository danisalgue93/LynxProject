import React, { useState, useEffect } from "react";
import { Bell, Menu, X, Globe, User, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/context/AuthContext';
import { setUserLanguage } from "@/src/i18n";
import { AuthModal } from "@/src/components/auth/AuthModal";
import { NotificationsPopover, Notification } from "@/src/components/layout/NotificationsPopover";
import { useWallet } from "@solana/wallet-adapter-react";
import { apiFetch } from "@/src/lib/api";
import { clearManagedAuthSession, getManagedWalletAddress, useManagedAuthSession } from "@/src/lib/auth";

interface HeaderProps {
  onMenuToggle: () => void;
  isSidebarOpen: boolean;
  onLogout?: () => void;
  showAuthButtons?: boolean;
}

export function Header({ onMenuToggle, isSidebarOpen, onLogout, showAuthButtons = false }: HeaderProps) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { logout, user: jwtUser } = useAuth();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { connected, disconnect, publicKey } = useWallet();
  const managedSession = useManagedAuthSession();
  const wallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || "";

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    setIsLoggedIn(connected || Boolean(managedSession) || Boolean(jwtUser));
  }, [connected, managedSession, jwtUser]);

  useEffect(() => {
    let cancelled = false;
    const loadNotifications = async () => {
      try {
        if (!wallet) {
          setNotifications([]);
          return;
        }
        const data = await apiFetch<any[]>(`/api/notifications?wallet=${encodeURIComponent(wallet)}`);
        if (!cancelled) {
          setNotifications(data.map((item) => ({
            ...item,
            timestamp: new Date(item.timestamp || item.createdAt || Date.now()),
          })));
        }
      } catch (err) {
        console.error("Failed to load notifications", err);
      }
    };
    loadNotifications();
    const interval = window.setInterval(loadNotifications, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [wallet]);

  const handleLogout = () => {
    disconnect();
    clearManagedAuthSession();
    logout();
    setIsLoggedIn(false);
    if (onLogout) {
      onLogout();
    }
    navigate('/');
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  return (
    <>
      <header className="h-16 border-b border-[#1F1F23] flex items-center justify-between px-4 lg:px-8 bg-[#0D0D0E] sticky top-0 z-50">
        <div className="flex items-center gap-4 flex-1">
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 text-[#71717A] hover:text-white transition-colors"
            id="mobile-menu-toggle"
          >
            {isSidebarOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-2 bg-[#18181B] px-3 py-1.5 rounded border border-[#27272A]">
            <div className="w-2 h-2 rounded-full bg-[#00FFD1] animate-pulse"></div>
            <span className="text-[10px] font-mono text-[#A1A1AA]">
              {t("header.solanaMainnet", "SOLANA DEVNET")}
            </span>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-2 p-2 text-[#71717A] hover:text-white transition-colors text-xs font-semibold"
              id="language-switcher"
            >
              <Globe className="w-4 h-4" />
              <span className="hidden md:inline">
                {i18n.language.startsWith("en") ? "EN" : "ES"}
              </span>
            </button>

            {showLangMenu && (
              <div className="absolute right-0 mt-2 w-36 bg-[#18181B] border border-[#27272A] rounded shadow-xl py-1 z-50">
                <button
                  onClick={() => { setUserLanguage("en"); setShowLangMenu(false); }}
                  className={`w-full flex justify-between items-center px-4 py-2 text-xs hover:bg-[#27272A] transition-colors ${i18n.language.startsWith("en") ? "text-[#00FFD1]" : "text-white"}`}
                >
                  <span>English</span>
                  <span className="text-base">US</span>
                </button>
                <button
                  onClick={() => { setUserLanguage("es"); setShowLangMenu(false); }}
                  className={`w-full flex justify-between items-center px-4 py-2 text-xs hover:bg-[#27272A] transition-colors ${i18n.language.startsWith("es") ? "text-[#00FFD1]" : "text-white"}`}
                >
                  <span>Español</span>
                  <span className="text-base">ES</span>
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="flex p-2 text-[#71717A] hover:text-white transition-colors relative"
              id="notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#FF3D00] rounded-full"></span>}
            </button>
            {isLoggedIn && (
              <NotificationsPopover
                isOpen={showNotifications}
                onClose={() => setShowNotifications(false)}
                wallet={wallet}
                notifications={notifications}
                setNotifications={setNotifications}
              />
            )}
          </div>

          <div className="flex items-center gap-2 ml-1">
            {isLoggedIn && !showAuthButtons ? (
              <div 
                className="w-8 h-8 rounded-full bg-[#18181B] border border-[#27272A] flex items-center justify-center cursor-pointer hover:bg-[#27272A] transition-colors group relative"
                onClick={handleLogout}
                title="Logout"
              >
                <LogOut className="w-4 h-4 text-[#A1A1AA] group-hover:text-white" />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#00FFD1] border-2 border-[#0D0D0E] rounded-full"></span>
              </div>
            ) : showAuthButtons ? (
              <button
                onClick={handleLoginClick}
                className="bg-[#00FFD1] text-black text-xs font-bold px-4 py-2 rounded uppercase cursor-pointer hover:bg-[#00E5BC] transition-all shadow-[0_0_10px_rgba(0,255,209,0.3)]"
              >
                Registrarse / Login
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultMode={authMode}
        onLoginSuccess={() => { setIsLoggedIn(true); navigate('/dashboard'); }}
      />
    </>
  );
}
