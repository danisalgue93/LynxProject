import React, { useEffect, useState } from "react";
import { Bell, ChevronDown, Globe, LogOut, Menu, User, Wallet, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { AuthModal } from "@/src/components/auth/AuthModal";
import { useAuth } from "@/src/context/AuthContext";
import { setUserLanguage } from "@/src/i18n";
import { apiFetch } from "@/src/lib/api";
import { NotificationsPopover, Notification } from "@/src/components/layout/NotificationsPopover";

interface HeaderProps {
  onMenuToggle: () => void;
  isSidebarOpen: boolean;
  onLogout?: () => void;
  showAuthButtons?: boolean;
}

function compactAddress(value?: string) {
  if (!value) return "";
  return value.length > 16 ? `${value.slice(0, 4)}...${value.slice(-6)}` : value;
}

export function Header({ onMenuToggle, isSidebarOpen, onLogout, showAuthButtons = false }: HeaderProps) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { disconnect } = useWallet();
  const { logout, user, isAuthenticated, changePassword } = useAuth();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "change">("login");
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const accountWallet = user?.walletAddress || user?.managedWalletAddress || "";
  const isWalletAccount = user?.authMethod === "wallet";
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    const handleOpenAuth = (event: any) => {
      setAuthMode(event?.detail?.mode === "signup" ? "signup" : "login");
      setIsAuthModalOpen(true);
    };
    window.addEventListener("open-auth-modal", handleOpenAuth as EventListener);
    return () => window.removeEventListener("open-auth-modal", handleOpenAuth as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadNotifications = async () => {
      if (!accountWallet) {
        setNotifications([]);
        return;
      }
      try {
        const data = await apiFetch<any[]>(`/api/notifications?wallet=${encodeURIComponent(accountWallet)}`);
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
  }, [accountWallet]);

  const openAuth = (mode: "login" | "signup" = "login") => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
  };

  const handleLogout = async () => {
    await disconnect().catch(() => undefined);
    logout();
    setShowAccountMenu(false);
    onLogout?.();
    navigate("/");
  };

  const openChangePassword = () => {
    setAuthMode("change");
    setIsAuthModalOpen(true);
    setShowAccountMenu(false);
  };

  return (
    <>
      <header className="h-16 border-b border-[#1F1F23] flex items-center justify-between px-4 lg:px-8 bg-[#0D0D0E] sticky top-0 z-50">
        <div className="flex items-center gap-4 flex-1">
          <button
            type="button"
            aria-label={isSidebarOpen ? t("common.close", "Close") : t("header.openMenu", "Open menu")}
            onClick={onMenuToggle}
            className="lg:hidden p-2 text-[#71717A] hover:text-white transition-colors"
            id="mobile-menu-toggle"
          >
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-2 bg-[#18181B] px-3 py-1.5 rounded border border-[#27272A]">
            <div className="w-2 h-2 rounded-full bg-[#00FFD1] animate-pulse" />
            <span className="text-[10px] font-mono text-[#A1A1AA]">{t("header.solanaMainnet", "SOLANA DEVNET")}</span>
          </div>

          <div className="relative">
            <button
              type="button"
              aria-label={t("header.changeLanguage", "Change language")}
              onClick={() => setShowLangMenu((value) => !value)}
              className="flex items-center gap-2 p-2 text-[#71717A] hover:text-white transition-colors text-xs font-semibold"
              id="language-switcher"
            >
              <Globe className="w-4 h-4" />
              <span className="hidden md:inline">{i18n.language.startsWith("en") ? "EN" : "ES"}</span>
            </button>

            {showLangMenu && (
              <div className="absolute right-0 mt-2 w-36 bg-[#18181B] border border-[#27272A] rounded shadow-xl py-1 z-50">
                <button
                  onClick={() => { setUserLanguage("en"); setShowLangMenu(false); }}
                  className={`w-full flex justify-between items-center px-4 py-2 text-xs hover:bg-[#27272A] transition-colors ${i18n.language.startsWith("en") ? "text-[#00FFD1]" : "text-white"}`}
                >
                  <span>English</span>
                  <span>EN</span>
                </button>
                <button
                  onClick={() => { setUserLanguage("es"); setShowLangMenu(false); }}
                  className={`w-full flex justify-between items-center px-4 py-2 text-xs hover:bg-[#27272A] transition-colors ${i18n.language.startsWith("es") ? "text-[#00FFD1]" : "text-white"}`}
                >
                  <span>Español</span>
                  <span>ES</span>
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              aria-label={t("notifications.title", "Notifications")}
              onClick={() => setShowNotifications((value) => !value)}
              className="flex p-2 text-[#71717A] hover:text-white transition-colors relative"
              id="notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#FF3D00] rounded-full" />}
            </button>
            {isAuthenticated && (
              <NotificationsPopover
                isOpen={showNotifications}
                onClose={() => setShowNotifications(false)}
                wallet={accountWallet}
                notifications={notifications}
                setNotifications={setNotifications}
              />
            )}
          </div>

          {isAuthenticated && user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAccountMenu((value) => !value)}
                className="flex items-center gap-2 bg-[#111827] text-[#E5E7EB] text-xs font-semibold px-3 py-2 rounded uppercase hover:bg-[#1F2937] transition-all"
              >
                {isWalletAccount ? <Wallet className="w-4 h-4" /> : <User className="w-4 h-4" />}
                <span>{isWalletAccount ? compactAddress(user.walletAddress) : user.email}</span>
                <ChevronDown className="w-3 h-3 text-[#71717A]" />
              </button>

              {showAccountMenu && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-[#27272A] bg-[#0D0D0E] shadow-2xl p-4 text-sm text-[#E5E7EB] z-50">
                  <div className="mb-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[#71717A]">
                      {isWalletAccount ? t("auth.walletAccount", "Wallet account") : t("auth.emailAccount", "Email account")}
                    </div>
                    <div className="mt-2 font-mono break-all text-xs text-white">
                      {isWalletAccount ? user.walletAddress : user.email}
                    </div>
                    {!isWalletAccount && user.managedWalletAddress && (
                      <div className="mt-2 text-[10px] text-[#71717A] break-all">
                        {t("auth.internalWallet", "Internal wallet")}: {compactAddress(user.managedWalletAddress)}
                      </div>
                    )}
                  </div>

                  {!isWalletAccount && (
                    <button
                      type="button"
                      onClick={openChangePassword}
                      className="mt-3 w-full rounded bg-[#18181B] border border-[#27272A] px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#00FFD1] hover:bg-[#27272A] transition"
                    >
                      {t("auth.changePassword", "Change password")}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-3 w-full rounded bg-[#18181B] border border-[#27272A] px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#F97316] hover:bg-[#27272A] transition flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    {t("header.logout", "Logout")}
                  </button>
                </div>
              )}
            </div>
          ) : showAuthButtons ? (
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="bg-[#00FFD1] text-black text-xs font-bold px-4 py-2 rounded uppercase hover:bg-[#00E5BC] transition-all shadow-[0_0_10px_rgba(0,255,209,0.3)]"
            >
              {t("auth.signIn", "Sign in")}
            </button>
          ) : null}
        </div>
      </header>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultMode={authMode}
        onLoginSuccess={() => navigate("/dashboard")}
      />
    </>
  );
}
