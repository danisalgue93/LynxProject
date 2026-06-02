import React, { useEffect, useState } from "react";
import { X, Mail, Wallet, Loader2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/src/context/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode: "login" | "signup" | "change";
  onLoginSuccess?: () => void;
}

type Mode = "login" | "signup" | "verify" | "forgot" | "reset" | "change";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

export function AuthModal({ isOpen, onClose, defaultMode, onLoginSuccess }: AuthModalProps) {
  const { t } = useTranslation();
  const { setVisible } = useWalletModal();
  const { connected, publicKey, signMessage } = useWallet();
  const {
    login,
    register,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    changePassword,
    loginWithWallet,
  } = useAuth();

  const [mode, setMode] = useState<Mode>(defaultMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [walletLoginRequested, setWalletLoginRequested] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(defaultMode);
      setError(null);
      setStatus(null);
      setWalletLoginRequested(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [defaultMode, isOpen]);

  useEffect(() => {
    if (!walletLoginRequested || !connected || !publicKey || !signMessage || !isOpen) return;

    const runWalletLogin = async () => {
      setIsSubmitting(true);
      setError(null);
      try {
        const message = JSON.stringify({
          app: "LYNX",
          action: "LYNX_LOGIN",
          wallet: publicKey.toBase58(),
          issuedAt: new Date().toISOString(),
        });
        const signatureBytes = await signMessage(new TextEncoder().encode(message));
        await loginWithWallet(publicKey.toBase58(), message, bytesToBase64(signatureBytes));
        onLoginSuccess?.();
        onClose();
      } catch (err: any) {
        setError(err?.message || t("auth.walletLoginFailed", "Wallet login failed"));
      } finally {
        setIsSubmitting(false);
        setWalletLoginRequested(false);
      }
    };

    runWalletLogin();
  }, [connected, isOpen, loginWithWallet, onClose, onLoginSuccess, publicKey, signMessage, t, walletLoginRequested]);

  if (!isOpen) return null;

  const complete = () => {
    onLoginSuccess?.();
    onClose();
  };

  const handleWalletLogin = async () => {
    setWalletLoginRequested(true);
    setError(null);
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!publicKey || !signMessage) {
      setError(t("auth.walletCannotSign", "This wallet cannot sign login messages."));
      return;
    }
    const message = JSON.stringify({
      app: "LYNX",
      action: "LYNX_LOGIN",
      wallet: publicKey.toBase58(),
      issuedAt: new Date().toISOString(),
    });
    setIsSubmitting(true);
    try {
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      await loginWithWallet(publicKey.toBase58(), message, bytesToBase64(signatureBytes));
      complete();
    } catch (err: any) {
      setError(err?.message || t("auth.walletLoginFailed", "Wallet login failed"));
    } finally {
      setIsSubmitting(false);
      setWalletLoginRequested(false);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      if (mode === "login") {
        await login(email, password);
        complete();
        return;
      }
      if (mode === "signup") {
        const result = await register(email, password);
        const signupResult = result as { requiresEmailVerification?: boolean; devVerificationToken?: string; email?: string } | undefined;
        if (signupResult?.requiresEmailVerification) {
          setVerificationToken(signupResult.devVerificationToken || "");
          setStatus(t("auth.confirmEmailSent", "Confirm your email to activate the account."));
          setMode("verify");
          return;
        }
        complete();
        return;
      }
      if (mode === "verify") {
        await verifyEmail(verificationToken);
        complete();
        return;
      }
      if (mode === "forgot") {
        const result = await requestPasswordReset(email);
        setResetToken(result.devResetToken || "");
        setStatus(t("auth.resetEmailSent", "Password reset instructions sent."));
        setMode("reset");
        return;
      }
      if (mode === "reset") {
        await resetPassword(resetToken, newPassword);
        setStatus(t("auth.passwordResetDone", "Password updated. You can log in now."));
        setMode("login");
        setPassword("");
        setNewPassword("");
      } else if (mode === "change") {
        if (newPassword !== confirmPassword) {
          throw new Error(t("auth.passwordsMismatch", "New passwords do not match"));
        }
        await changePassword(currentPassword, newPassword);
        setStatus(t("auth.passwordChanged", "Password changed successfully."));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err: any) {
      const message = err?.message || t("auth.authFailed", "Authentication failed");
      if (typeof message === 'string' && message.includes('Invalid email or password')) {
        setError(t('auth.invalidEmailOrPassword', 'Invalid email or password'));
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = mode === "signup"
    ? t("auth.createAccount", "Create account")
    : mode === "verify"
      ? t("auth.confirmEmail", "Confirm email")
      : mode === "forgot" || mode === "reset"
        ? t("auth.recoverPassword", "Recover password")
        : mode === "change"
          ? t("auth.changePassword", "Change password")
          : t("auth.signIn", "Sign in");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-[#0D0D0E] border border-[#1F1F23] rounded-xl shadow-2xl overflow-hidden">
        <button
          type="button"
          aria-label={t("common.close", "Close")}
          onClick={onClose}
          className="absolute top-4 right-4 text-[#71717A] hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 md:p-8">
          <div className="mb-6">
            <div className="w-12 h-12 mb-4 rounded-full bg-[#00FFD1]/10 border border-[#00FFD1]/30 flex items-center justify-center">
              {mode === "forgot" || mode === "reset" ? (
                <KeyRound className="w-6 h-6 text-[#00FFD1]" />
              ) : (
                <Wallet className="w-6 h-6 text-[#00FFD1]" />
              )}
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">{title}</h2>
            <p className="text-xs text-[#A1A1AA]">
              {t("auth.modalSubtitle", "Use a wallet first, or use email and password with an internal managed wallet.")}
            </p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-950/40 border border-red-500/30 rounded text-xs text-red-200">
              {error}
            </div>
          )}
          {status && (
            <div className="mb-4 px-4 py-3 bg-[#00FFD1]/10 border border-[#00FFD1]/25 rounded text-xs text-[#BFFEF2]">
              {status}
            </div>
          )}

          {mode !== 'change' && (
            <>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-3 bg-[#00FFD1] hover:bg-[#00E5BC] text-black py-3 px-4 rounded font-black text-sm transition-colors disabled:opacity-60"
                onClick={handleWalletLogin}
                disabled={isSubmitting}
              >
                {isSubmitting && walletLoginRequested ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />}
                {t("auth.signInWithWallet", "Sign in with wallet")}
              </button>

              <div className="relative py-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#27272A]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-[#0D0D0E] text-[#71717A] uppercase tracking-widest">
                    {t("auth.emailPassword", "Email and password")}
                  </span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-3">

            {(mode === "login" || mode === "signup" || mode === "forgot") && (
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("auth.email", "Email")}
                required
                className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
              />
            )}

            {(mode === "login" || mode === "signup") && (
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.password", "Password")}
                required
                className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
              />
            )}

            {mode === "change" && (
              <>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder={t("auth.currentPassword", "Current password")}
                  required
                  className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={t("auth.newPassword", "New password")}
                  required
                  className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t("auth.confirmNewPassword", "Confirm new password")}
                  required
                  className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
                />
              </>
            )}

            {mode === "verify" && (
              <input
                value={verificationToken}
                onChange={(event) => setVerificationToken(event.target.value)}
                placeholder={t("auth.verificationToken", "Verification token")}
                required
                className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
              />
            )}

            {mode === "reset" && (
              <>
                <input
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                  placeholder={t("auth.resetToken", "Reset token")}
                  required
                  className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={t("auth.newPassword", "New password")}
                  required
                  className="w-full bg-[#18181B] border border-[#27272A] text-white px-4 py-3 rounded text-sm placeholder-[#52525B] focus:outline-none focus:border-[#00FFD1]/50"
                />
              </>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] text-white py-3 px-4 rounded font-bold text-sm transition-colors disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 text-[#A1A1AA]" />}
              {mode === "signup"
                ? t("auth.createAccount", "Create account")
                : mode === "verify"
                  ? t("auth.confirmEmail", "Confirm email")
                  : mode === "forgot"
                    ? t("auth.sendReset", "Send reset link")
                    : mode === "reset"
                      ? t("auth.updatePassword", "Update password")
                      : mode === "change"
                        ? t("auth.changePassword", "Change password")
                        : t("auth.signIn", "Sign in")}
            </button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
            {mode !== "login" && mode !== 'change' && (
              <button type="button" onClick={() => setMode("login")} className="text-[#00FFD1] hover:underline">
                {t("auth.backToLogin", "Back to login")}
              </button>
            )}
            {mode === "login" && (
              <>
                <button type="button" onClick={() => setMode("signup")} className="text-[#00FFD1] hover:underline">
                  {t("auth.needAccount", "Create account")}
                </button>
                <button type="button" onClick={() => setMode("forgot")} className="text-[#A1A1AA] hover:text-white">
                  {t("auth.forgotPassword", "Forgot password?")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
