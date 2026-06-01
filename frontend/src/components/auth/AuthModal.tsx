import React, { useEffect, useState } from "react";
import { X, Mail, Wallet, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { saveManagedAuthSession } from "@/src/lib/auth";
import { useAuth } from "@/src/context/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode: "login" | "signup";
  onLoginSuccess?: () => void;
}

declare global {
  interface Window {
    Magic?: any;
  }
}

function getMagic() {
  const key = import.meta.env.VITE_MAGIC_PUBLISHABLE_KEY;
  if (!key || typeof window.Magic === "undefined") return null;
  try {
    return new window.Magic(key, {
      extensions: [],
    });
  } catch {
    return null;
  }
}

export function AuthModal({
  isOpen,
  onClose,
  defaultMode,
  onLoginSuccess,
}: AuthModalProps) {
  const { t } = useTranslation();
  const { setVisible } = useWalletModal();
  const { connected, publicKey, signMessage } = useWallet();
  const { loginWithWallet } = useAuth();

  const [emailStep, setEmailStep] = useState<"idle" | "input" | "loading" | "done">("idle");
  const [email, setEmail] = useState("");
  const [magicError, setMagicError] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  // When wallet connects, sign a message and login
  useEffect(() => {
    if (!connected || !publicKey || !signMessage || !isOpen) return;

    const doWalletLogin = async () => {
      setWalletLoading(true);
      setMagicError(null);
      try {
        const message = JSON.stringify({
          action: 'LYNX_LOGIN',
          wallet: publicKey.toBase58(),
          ts: Date.now(),
        });
        const encoded = new TextEncoder().encode(message);
        const signatureBytes = await signMessage(encoded);
        const signature = Buffer.from(signatureBytes).toString('base64');
        await loginWithWallet(publicKey.toBase58(), message, signature);
        if (onLoginSuccess) onLoginSuccess();
        onClose();
      } catch (err: any) {
        console.error('Wallet login failed', err);
        setMagicError(err.message || 'Wallet login failed. Try again.');
      } finally {
        setWalletLoading(false);
      }
    };

    doWalletLogin();
  }, [connected, publicKey, signMessage, isOpen]);

  useEffect(() => {
    const magic = getMagic();
    if (!magic?.oauth2?.getRedirectResult) return;

    magic.oauth2.getRedirectResult()
      .then((result: any) => {
        const metadata = result?.magic?.userMetadata;
        if (!metadata) return;
        saveManagedAuthSession({
          provider: "magic-google",
          email: metadata.email,
          issuer: metadata.issuer,
          loginAt: Date.now(),
        });
        if (onLoginSuccess) onLoginSuccess();
        onClose();
      })
      .catch(() => undefined);
  }, [onClose, onLoginSuccess]);

  if (!isOpen) return null;

  const handleWalletConnect = () => {
    setVisible(true);
  };

  // Google OAuth via Magic Link
  const handleGoogleLogin = async () => {
    const magic = getMagic();
    if (!magic?.oauth2?.loginWithRedirect) {
      setMagicError("Google login needs Magic OAuth configured in the app.");
      return;
    }
    try {
      await magic.oauth2.loginWithRedirect({
        provider: "google",
        redirectURI: window.location.href,
        scope: ["user:email"],
      });
    } catch (err: any) {
      console.error("Magic Google login failed", err);
      setMagicError("Google login failed. Please try wallet connection.");
    }
  };

  // Email OTP via Magic Link
  const handleEmailLogin = async () => {
    if (!email || !email.includes("@")) {
      setMagicError("Please enter a valid email address.");
      return;
    }
    const magic = getMagic();
    if (!magic) {
      setMagicError("Magic Link is not configured. Set VITE_MAGIC_PUBLISHABLE_KEY and load the Magic SDK.");
      return;
    }
    setEmailStep("loading");
    setMagicError(null);
    try {
      await magic.auth.loginWithMagicLink({ email, showUI: true });
      const metadata = await magic.user.getMetadata().catch(() => null);
      saveManagedAuthSession({
        provider: "magic-email",
        email: metadata?.email || email,
        issuer: metadata?.issuer,
        loginAt: Date.now(),
      });
      setEmailStep("done");
      if (onLoginSuccess) onLoginSuccess();
      onClose();
    } catch (err: any) {
      console.error("Magic email login failed", err);
      setMagicError(err.message || "Login failed. Please try again.");
      setEmailStep("input");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-md bg-[#0D0D0E] border border-[#1F1F23] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={t("common.close", "Close")}
          onClick={onClose}
          className="absolute top-4 right-4 text-[#71717A] hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8">
          <div className="text-center mb-8">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#00FFD1]/20 to-[#9945FF]/20 border border-[#00FFD1]/30 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-[#00FFD1]" />
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
              {t("common.authModalTitle", "Connect Your Account")}
            </h2>
            <p className="text-xs text-[#A1A1AA]">
              {t(
                "common.authModalDescription",
                "Use Google, email, or a crypto wallet. No seed phrase needed.",
              )}
            </p>
          </div>

          {magicError && (
            <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-400">
              {magicError}
            </div>
          )}

          <div className="space-y-3">
            {/* Google via Magic Link */}
            <button
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-black py-3 px-4 rounded font-bold text-sm transition-colors"
              onClick={handleGoogleLogin}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {t("common.continueWithGoogle", "Continue with Google")}
            </button>

            {/* Email via Magic Link */}
            {emailStep === "idle" && (
              <button
                className="w-full flex items-center justify-center gap-3 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] text-white py-3 px-4 rounded font-bold text-sm transition-colors"
                onClick={() => setEmailStep("input")}
              >
                <Mail className="w-5 h-5 text-[#A1A1AA]" />
                {t("common.continueWithEmail", "Continue with Email")}
              </button>
            )}

            {(emailStep === "input" || emailStep === "loading") && (
              <div className="space-y-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleEmailLogin()}
                  placeholder="you@email.com"
                  disabled={emailStep === "loading"}
                  className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50 disabled:opacity-60"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEmailStep("idle"); setMagicError(null); }}
                    disabled={emailStep === "loading"}
                    className="flex-1 py-2.5 bg-[#27272A] text-[#A1A1AA] text-xs font-bold rounded hover:bg-[#3F3F46] transition-colors disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleEmailLogin}
                    disabled={emailStep === "loading" || !email}
                    className="flex-1 py-2.5 bg-[#00FFD1] text-black text-xs font-bold rounded hover:bg-[#00E5BC] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {emailStep === "loading" && <Loader2 className="w-3 h-3 animate-spin" />}
                    {emailStep === "loading" ? "Sending link..." : "Send Magic Link"}
                  </button>
                </div>
              </div>
            )}

            {emailStep === "done" && (
              <div className="flex items-center justify-center gap-2 py-3 text-[#00FFD1] text-sm font-bold">
                Check your email for the login link
              </div>
            )}

            <div className="relative py-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#27272A]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-[#0D0D0E] text-[#71717A] tracking-widest uppercase">
                  Or use a wallet
                </span>
              </div>
            </div>

            {/* External Wallet (Phantom / Solflare) */}
            <button
              className="w-full flex items-center justify-center gap-3 bg-[#00FFD1]/10 hover:bg-[#00FFD1]/20 border border-[#00FFD1]/30 text-[#00FFD1] py-3 px-4 rounded font-bold text-sm transition-colors disabled:opacity-50"
              onClick={handleWalletConnect}
              disabled={walletLoading}
            >
              {walletLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />}
              {walletLoading ? 'Signing in...' : t("common.continueWithWallet", "Connect Phantom / Solflare")}
            </button>
          </div>

          <p className="text-center text-[10px] text-[#52525B] mt-6">
            Google & Email login powered by{" "}
            <a href="https://magic.link" target="_blank" rel="noreferrer" className="text-[#7D00FF] hover:underline">
              Magic Link
            </a>
            {" "}- no seed phrase required.
          </p>
        </div>
      </div>
    </div>
  );
}
