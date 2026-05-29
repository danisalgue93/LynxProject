import React, { useState } from 'react';
import { X, Loader2, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

type CreateMarketModalProps = {
  onClose: () => void;
  onSubmit: (market: {
    title: string;
    description: string;
    category: string;
    currency: 'SOL' | 'LYNX';
    isTernary: boolean;
    oracleId: string;
    cutoffAt: number;
    resolveAt: number;
  }) => Promise<void>;
};

export function CreateMarketModal({ onClose, onSubmit }: CreateMarketModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Sports');
  const [currency, setCurrency] = useState<'SOL' | 'LYNX'>('SOL');
  const [isTernary, setIsTernary] = useState(false);
  const [oracleId, setOracleId] = useState('manual:admin');
  const [cutoffLocal, setCutoffLocal] = useState('');
  const [resolveLocal, setResolveLocal] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    setError('');
    const cutoffAt = cutoffLocal ? new Date(cutoffLocal).getTime() : Date.now() + 60 * 60 * 1000;
    const resolveAt = resolveLocal ? new Date(resolveLocal).getTime() : cutoffAt + 60 * 60 * 1000;
    if (!title.trim()) {
      setError('El evento necesita un titulo.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || 'General',
        currency,
        isTernary,
        oracleId: oracleId.trim() || 'manual:admin',
        cutoffAt,
        resolveAt,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'No se pudo crear el mercado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 text-white">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }} className="relative w-full max-w-xl bg-[#0D0D0E] border border-[#27272A] rounded-xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-[#1F1F23] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[#00FFD1]/10 border border-[#00FFD1]/20 text-[#00FFD1] flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest">Crear mercado</h2>
              <p className="text-[10px] text-[#71717A] uppercase tracking-widest">Solo administrador + firma wallet</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[#71717A] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titulo del evento" className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-sm outline-none focus:border-[#00FFD1]" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Reglas de settlement" rows={3} className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-sm outline-none focus:border-[#00FFD1] resize-none" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoria" className="bg-[#18181B] border border-[#27272A] rounded p-3 text-sm outline-none focus:border-[#00FFD1]" />
            <input value={oracleId} onChange={(e) => setOracleId(e.target.value)} placeholder="Oracle / fuente" className="bg-[#18181B] border border-[#27272A] rounded p-3 text-sm outline-none focus:border-[#00FFD1]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[10px] text-[#71717A] uppercase font-bold tracking-widest">
              Cut-off
              <input type="datetime-local" value={cutoffLocal} onChange={(e) => setCutoffLocal(e.target.value)} className="mt-2 w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-sm text-white outline-none focus:border-[#00FFD1]" />
            </label>
            <label className="text-[10px] text-[#71717A] uppercase font-bold tracking-widest">
              Resolucion
              <input type="datetime-local" value={resolveLocal} onChange={(e) => setResolveLocal(e.target.value)} className="mt-2 w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-sm text-white outline-none focus:border-[#00FFD1]" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={currency} onChange={(e) => setCurrency(e.target.value as 'SOL' | 'LYNX')} className="bg-[#18181B] border border-[#27272A] rounded p-3 text-sm outline-none focus:border-[#00FFD1]">
              <option value="SOL">SOL</option>
              <option value="LYNX">LYNX</option>
            </select>
            <button onClick={() => setIsTernary((v) => !v)} className="bg-[#18181B] border border-[#27272A] rounded p-3 text-sm font-bold uppercase tracking-widest hover:border-[#00FFD1]">
              {isTernary ? 'Ternario A/B/Draw' : 'Binario Si/No'}
            </button>
          </div>
          {error && <div className="text-red-400 text-xs font-mono bg-red-400/10 border border-red-400/20 rounded p-3">{error}</div>}
          <button onClick={submit} disabled={isSubmitting} className="w-full py-4 rounded bg-[#00FFD1] text-black font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-60">
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Firmar y registrar mercado
          </button>
        </div>
      </motion.div>
    </div>
  );
}
