import React, { useState } from 'react';
import { X, PlusCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/lib/utils';

interface Props {
  onClose: () => void;
  onSubmit: (input: { title: string; description?: string; category?: string }) => Promise<void>;
}

export function CreateProposalModal({ onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (title.trim().length < 4) return;
    setIsSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), description: description.trim(), category: category.trim() });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 text-white">
      <motion.div className="absolute inset-0 bg-[#0A0A0B]/95 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />

      <motion.div initial={{ opacity: 0, scale: 0.98, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 12 }} className="relative w-full max-w-2xl bg-[#0D0D0E] border border-[#1F1F23] rounded-xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-[#1F1F23] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[#00FFD1]/10 flex items-center justify-center border border-[#00FFD1]/20 text-[#00FFD1]">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-tight">{t('governance.createProposal', 'Create Proposal')}</h3>
              <div className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest">{t('governance.createProposalDesc', 'Propose a change to the protocol')}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[#52525B] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-2 block">{t('governance.proposalTitle', 'Title')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-[#141417] border border-[#1F1F23] rounded text-white outline-none" placeholder={t('governance.proposalTitlePlaceholder', 'Brief title (min 4 chars)')} />
          </div>

          <div>
            <label className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-2 block">{t('governance.proposalDescription', 'Description')}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-3 bg-[#141417] border border-[#1F1F23] rounded text-white outline-none h-28" placeholder={t('governance.proposalDescriptionPlaceholder', 'Details (optional)')} />
          </div>

          <div>
            <label className="text-[10px] text-[#71717A] font-bold uppercase tracking-widest mb-2 block">{t('governance.proposalCategory', 'Category')}</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-3 bg-[#141417] border border-[#1F1F23] rounded text-white outline-none" />
          </div>

          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="px-4 py-2 bg-[#18181B] border border-[#27272A] rounded text-[#A1A1AA] font-bold">{t('common.cancel', 'Cancel')}</button>
            <button disabled={isSubmitting || title.trim().length < 4} onClick={handleSubmit} className={cn('px-6 py-2 rounded font-black uppercase text-sm', isSubmitting ? 'bg-[#00FFD1]/30 text-black/50' : 'bg-[#00FFD1] text-black')}>{isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2 inline"/> {t('common.saving','Saving')}</> : t('governance.createProposal','Create Proposal')}</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default CreateProposalModal;
