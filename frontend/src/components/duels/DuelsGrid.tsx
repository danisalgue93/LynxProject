import React, { useEffect, useState } from 'react';
import { DuelCard } from './DuelCard';
import { Duel } from '@/src/types';
import { useProgram } from '@/src/hooks/useProgram';
import { Sword, Plus, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/lib/utils';
import { eventBus } from '@/src/lib/eventBus';

interface DuelsGridProps {
  onCreateDuel?: () => void;
}

type FilterType = 'ALL' | '1v1' | '1v1vP';

export function DuelsGrid({ onCreateDuel }: DuelsGridProps) {
  const { t } = useTranslation();
  const { fetchDuels, isLoading, error } = useProgram();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');

  useEffect(() => {
    const loadDuels = async () => {
      const data = await fetchDuels();
      setDuels(data);
    };
    loadDuels();
    const onUpdate = () => { loadDuels(); };
    eventBus.addEventListener('duel:created', onUpdate as any);
    eventBus.addEventListener('duel:accepted', onUpdate as any);
    return () => {
      eventBus.removeEventListener('duel:created', onUpdate as any);
      eventBus.removeEventListener('duel:accepted', onUpdate as any);
    };
  }, [fetchDuels]);

  const filteredDuels = duels.filter(duel => {
    if (filter === '1v1') return !duel.isTernary;
    if (filter === '1v1vP') return duel.isTernary;
    return true; // ALL
  });

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-red-400/10 rounded flex items-center justify-center text-red-400 border border-red-400/20">
            <Sword className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-1 tracking-tight">{t('duels.title', '1v1 Duels')} & 1v1vP</h2>
            <p className="text-[#71717A] text-[10px] font-bold uppercase tracking-widest">{t('duels.subtitle', 'Dex Protocol Governance')}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="flex items-center bg-[#18181B] rounded border border-[#27272A] p-1 flex-1 md:flex-none">
            {(['ALL', '1v1', '1v1vP'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  "px-3 md:px-4 py-1.5 md:py-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded transition-all flex-1 md:flex-none whitespace-nowrap",
                  filter === type 
                    ? "bg-[#27272A] text-white" 
                    : "text-[#71717A] hover:bg-[#27272A]/50 hover:text-white"
                )}
              >
                {type}
              </button>
            ))}
          </div>

          <button 
            onClick={onCreateDuel}
            className="px-6 py-3 bg-[#00FFD1] text-black font-black text-xs rounded hover:bg-[#00E5BC] transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(0,255,209,0.2)] uppercase tracking-widest justify-center"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">{t('duels.createNew', 'Create New Duel')}</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="w-8 h-8 text-[#00FFD1] animate-spin" />
          <span className="ml-4 font-mono text-[#71717A] text-sm uppercase tracking-widest">{t('common.syncingBlockchain', 'Syncing with blockchain...')}</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center w-full min-h-[300px] bg-red-400/5 border border-red-400/20 rounded-xl p-8 text-center">
          <p className="text-red-400 text-sm font-mono">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {filteredDuels.map(duel => (
            <DuelCard key={duel.id} duel={duel} />
          ))}
          
          {/* Invitation card */}
          <div 
            onClick={onCreateDuel}
            className="glass-card rounded p-6 border-dashed border-[#1F1F23] flex flex-col items-center justify-center text-center group cursor-pointer hover:border-[#00FFD1]/30 transition-all min-h-[300px] bg-[#0A0A0B]"
          >
            <div className="w-12 h-12 rounded bg-[#18181B] flex items-center justify-center mb-4 group-hover:scale-110 transition-transform border border-[#27272A]">
              <Plus className="w-5 h-5 text-[#52525B] group-hover:text-[#00FFD1]" />
            </div>
            <h4 className="text-[11px] font-black text-white mb-2 uppercase tracking-widest">{t('duels.hostActive', 'Host active Duel')}</h4>
            <p className="text-[10px] text-[#71717A] max-w-[140px] uppercase font-bold tracking-tight">{t('duels.challengePool', 'Challenge the pool to a fixed-odds outcome.')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
