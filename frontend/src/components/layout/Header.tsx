import React, { useState, useEffect } from "react";
import { Bell, Menu, X, Globe, User, LogOut, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/context/AuthContext';
import { setUserLanguage } from "@/src/i18n";
import { AuthModal } from "@/src/components/auth/AuthModal";
import { NotificationsPopover, Notification } from "@/src/components/layout/NotificationsPopover";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
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
  const { logout, user: jwtUser, isAuthenticated } = useAuth();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { connected, disconnect, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const managedSession = useManagedAuthSession();
  const connectedWallet = publicKey?.toBase58() || getManagedWalletAddress(managedSession) || "";
  const walletLabel = connectedWallet && connectedWallet.length > 14 ? `${connectedWallet.slice(0, 4)}...${connectedWallet.slice(-6)}` : connectedWallet;
  const linkedWallet = jwtUser?.walletAddress;
  const hasLinkedWallet = Boolean(linkedWallet);
  const connectedMatchesLinked = connectedWallet && linkedWallet && connectedWallet === linkedWallet;
  const walletButtonLabel = connected
    ? walletLabel || 'Connected Wallet'
    : hasLinkedWallet
      ? 'Connect account wallet'
      : 'Link Wallet';

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    setIsLoggedIn(connected || Boolean(managedSession) || Boolean(jwtUser));
  }, [connected, managedSession, jwtUser]);

  useEffect(() => {
    const handleOpenAuth = (e: any) => {
      setAuthMode(e?.detail?.mode === 'signup' ? 'signup' : 'login');
      setIsAuthModalOpen(true);
    };
    window.addEventListener('open-auth-modal', handleOpenAuth as EventListener);
    return () => window.removeEventListener('open-auth-modal', handleOpenAuth as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadNotifications = async () => {
      try {
        if (!connectedWallet) {
          setNotifications([]);
          return;
        }
        const data = await apiFetch<any[]>(`/api/notifications?wallet=${encodeURIComponent(connectedWallet)}`);
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
  }, [connectedWallet]);

  const handleLogout = () => {
    disconnect();
    clearManagedAuthSession();
    logout();
    setIsLoggedIn(false);
    setShowWalletMenu(false);
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
                wallet={connectedWallet}
                notifications={notifications}
                setNotifications={setNotifications}
              />
            )}
          </div>

          <div className="relative flex items-center gap-2 ml-1">
            {isAuthenticated ? (
              <>
                <button
                  onClick={() => {
                    if (!connected) {
                      setVisible(true);
                      return;
                    }

                    setShowWalletMenu((prev) => !prev);
                  }}
                  className="flex items-center gap-2 bg-[#111827] text-[#E5E7EB] text-xs font-semibold px-3 py-2 rounded uppercase hover:bg-[#1F2937] transition-all"
                  title={connected ? 'Show wallet info' : walletButtonLabel}
                >
                  <Wallet className="w-4 h-4" />
                  <span>{walletButtonLabel}</span>
                </button>

                {showWalletMenu && connected && (
                  <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-[#27272A] bg-[#0D0D0E] shadow-2xl p-4 text-sm text-[#E5E7EB] z-50">
                    <div className="mb-3">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#71717A]">Wallet connected</div>
                      <div className="mt-2 font-mono break-all text-xs text-white">{connectedWallet}</div>
                    </div>
                    <div className="grid gap-2">
                      <div className="rounded-2xl bg-[#141417] border border-[#27272A] p-3">
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[#71717A]">Status</div>
                        <div className="mt-1 text-xs text-[#A1A1AA]">{connectedMatchesLinked ? 'Connected wallet matches account' : 'Connected wallet differs from linked account'}</div>
                      </div>
                      {hasLinkedWallet && (
                        <div className="rounded-2xl bg-[#141417] border border-[#27272A] p-3">
                          <div className="text-[10px] uppercase tracking-[0.24em] text-[#71717A]">Account wallet</div>
                          <div className="mt-1 font-mono break-all text-xs text-white">{linkedWallet}</div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          disconnect();
                          setShowWalletMenu(false);
                        }}
                        className="w-full rounded-full bg-[#18181B] border border-[#27272A] px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#F97316] hover:bg-[#27272A] transition"
                      >
                        Disconnect Wallet
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>

            {isAuthenticated && jwtUser?.walletAddress && (
              <div className="hidden md:inline-flex items-center gap-2 rounded-full border border-[#27272A] bg-[#0D0D0E] px-3 py-2 text-[10px] uppercase tracking-widest text-[#A1A1AA]">
                <span className="font-semibold text-[#F8FAFC]">Account wallet:</span>
                <span>{jwtUser.walletAddress.slice(0, 4)}...{jwtUser.walletAddress.slice(-4)}</span>
              </div>
            )}

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
