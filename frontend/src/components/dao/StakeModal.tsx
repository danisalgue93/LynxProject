import React, { useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/lib/utils';

interface Props {
  onClose: () => void;
  /** onSubmit should throw if the operation fails — the modal will display the error inline */
  onSubmit: (amount: number) => Promise<void>;
  defaultAmount?: number;
}

export function StakeModal({ onClose, onSubmit, defaultAmount = 1 }: Props) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState<number>(defaultAmount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!amount || amount <= 0) return;
    setIsSubmitting(true);
    setInlineError(null);
    try {
      await onSubmit(amount);
      onClose();
    } catch (e: any) {
      // Show the error inline above the button — no toast here; caller is responsible
      // for suppressing its own toasts so we don't get duplicates.
      const msg: string = e?.message || t('governance.stakeFailed', 'Failed to stake LYNX');
      // Humanise the "Insufficient LYNX balance" backend message
      const display = (msg.includes('Insufficient LYNX') || msg.includes('insufficient_lynx'))
        ? t('portfolio.insufficientLynxBalance', 'Not enough LYNX to complete this transaction.')
        : msg;
      setInlineError(display);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 text-white">
      <motion.div className="absolute inset-0 bg-[#0A0A0B]/95 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />

      <motion.div initial={{ opacity: 0, scale: 0.98, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 12 }} className="relative w-full max-w-md bg-[#0D0D0E] border border-[#1F1F23] rounded-xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-[#1F1F23] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-tight">{t('governance.stakeLynx', 'Stake $LYNX')}</h3>
            <div className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest">{t('governance.stakeDesc', 'Stake tokens to participate in governance')}</div>
          </div>
          <button type="button" aria-label={t('common.close', 'Close')} onClick={onClose} className="p-2 text-[#52525B] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-2 block">{t('governance.stakeAmount', 'Amount')}</label>
            <input
              type="number"
              value={String(amount)}
              onChange={(e) => { setAmount(Number(e.target.value)); setInlineError(null); }}
              className="w-full p-3 bg-[#141417] border border-[#1F1F23] rounded text-white outline-none"
            />
          </div>

          {/* Inline error — shown above the action buttons, same pattern as PortfolioView */}
          {inlineError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{inlineError}</span>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="px-4 py-2 bg-[#18181B] border border-[#27272A] rounded text-[#A1A1AA] font-bold">{t('common.cancel', 'Cancel')}</button>
            <button
              disabled={isSubmitting || !amount || amount <= 0}
              onClick={handleSubmit}
              className={cn('px-6 py-2 rounded font-black uppercase text-sm', isSubmitting ? 'bg-[#00FFD1]/30 text-black/50' : 'bg-[#00FFD1] text-black')}
            >
              {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2 inline"/> {t('common.processing','Processing')}</> : t('governance.stakeNow','Stake')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default StakeModal;
