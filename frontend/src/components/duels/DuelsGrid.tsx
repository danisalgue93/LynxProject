import React from 'react';
import { DuelCard } from './DuelCard';
import { MOCK_DUELS } from '@/src/constants';
import { Sword, Plus } from 'lucide-react';

interface DuelsGridProps {
  onCreateDuel?: () => void;
}

export function DuelsGrid({ onCreateDuel }: DuelsGridProps) {
  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-red-400/10 rounded flex items-center justify-center text-red-400 border border-red-400/20">
            <Sword className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-white mb-1 tracking-tight">1v1 Duels</h2>
            <p className="text-[#71717A] text-[10px] font-bold uppercase tracking-widest">Dex Protocol Governance</p>
          </div>
        </div>
        
        <button 
          onClick={onCreateDuel}
          className="px-6 py-3 bg-[#00FFD1] text-black font-black text-xs rounded hover:bg-[#00E5BC] transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(0,255,209,0.2)] uppercase tracking-widest w-full md:w-auto justify-center"
        >
          <Plus className="w-4 h-4" />
          Create New Duel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {MOCK_DUELS.map(duel => (
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
          <h4 className="text-[11px] font-black text-white mb-2 uppercase tracking-widest">Host active Duel</h4>
          <p className="text-[10px] text-[#71717A] max-w-[140px] uppercase font-bold tracking-tight">Challenge the pool to a fixed-odds outcome.</p>
        </div>
      </div>
    </div>
  );
}
