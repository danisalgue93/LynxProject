import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogIn, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface RequiresLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  action?: string;
}

export function RequiresLoginModal({ isOpen, onClose, action }: RequiresLoginModalProps) {
  const { t } = useTranslation();

  const handleLogin = () => {
    window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[100]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-md px-4"
          >
            <div className="relative bg-[#0D0D0E] border border-[#27272A] rounded-xl p-8 shadow-2xl">
              <button
                type="button"
                aria-label={t('common.close', 'Close')}
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-[#1F1F23] rounded transition-colors"
              >
                <X className="w-5 h-5 text-[#71717A]" />
              </button>

              <div className="text-center">
                <div className="w-16 h-16 bg-[#00FFD1] rounded-full flex items-center justify-center mx-auto mb-6">
                  <LogIn className="w-8 h-8 text-black" />
                </div>

                <h2 className="text-2xl font-bold text-white mb-3">{t('auth.loginRequiredTitle', 'Sign in required')}</h2>
                <p className="text-[#A1A1AA] mb-8">
                  {t('auth.loginRequiredBody', 'You need an account to {{action}}.', {
                    action: action || t('auth.thisAction', 'continue'),
                  })}
                </p>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleLogin}
                    className="w-full px-6 py-3 bg-[#00FFD1] text-black font-bold text-sm rounded hover:bg-[#00E5BC] transition-all uppercase tracking-tight flex items-center justify-center gap-2 group"
                  >
                    <LogIn className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    {t('auth.signIn', 'Sign in')}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full px-6 py-3 bg-[#18181B] text-white font-bold text-sm rounded border border-[#27272A] hover:bg-[#27272A] transition-all uppercase tracking-tight"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
