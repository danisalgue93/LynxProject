import React, { useState, useEffect } from 'react';
import { Vote, Users, MessageSquare, ChevronRight, CheckCircle2, Clock, AlertCircle, PlusCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useProgram } from '@/src/hooks/useProgram';
import { Proposal } from '@/src/types';

export function GovernanceView() {
  const { fetchProposals, fetchDaoStats, castVote, stakeLynx, isLoading, error } = useProgram();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isPendingAct, setIsPendingAct] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const [proposalsData, statsData] = await Promise.all([
        fetchProposals(),
        fetchDaoStats()
      ]);
      setProposals(proposalsData);
      setStats(statsData);
    };
    loadData();
  }, [fetchProposals, fetchDaoStats]);

  const handleVoteAction = async (proposalId: string) => {
    setIsPendingAct(true);
    try {
      await castVote(proposalId, 'yes'); // Hardcoded to 'yes' for demo, expand later
    } catch (e) {
      console.error(e);
    } finally {
      setIsPendingAct(false);
    }
  };

  const handleStakeAction = async () => {
    setIsPendingAct(true);
    try {
      await stakeLynx(100); // 100 LYNX for demo
    } catch (e) {
      console.error(e);
    } finally {
      setIsPendingAct(false);
    }
  };

  const filteredProposals = activeCategory === 'all' 
    ? proposals 
    : proposals.filter(p => p.status === activeCategory);

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <Loader2 className="w-8 h-8 text-[#00FFD1] animate-spin mb-4" />
        <span className="font-mono text-[#71717A] text-sm uppercase tracking-widest">Loading governance data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <div className="text-red-400 font-mono text-sm border-dashed border border-red-400/20 bg-red-400/5 p-4 rounded-xl">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 md:mb-12 gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] bg-[#9945FF]/10 text-[#9945FF] px-2 py-0.5 rounded border border-[#9945FF]/20 tracking-widest uppercase font-bold">
              DAO GOVERNANCE
            </span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tighter mb-2">Community Hall</h2>
          <p className="text-[#71717A] text-sm md:text-base uppercase tracking-widest font-medium">
            $LYNX stakers drive the evolution of Lynx Market.
          </p>
        </div>

        <button className="flex items-center gap-2 px-6 py-3 bg-[#00FFD1] text-black font-black text-sm rounded uppercase tracking-tight hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(0,255,209,0.2)]">
          <PlusCircle className="w-4 h-4" />
          Create Proposal
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="glass-card rounded-xl p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[#9945FF]/10 rounded">
              <Users className="w-5 h-5 text-[#9945FF]" />
            </div>
            <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">Active Voters</span>
          </div>
          <div className="text-3xl font-mono font-bold text-white tracking-tighter">{stats.activeVoters.toLocaleString()}</div>
          <div className="text-[10px] text-[#00FFD1] mt-1 font-bold">+12% vs last week</div>
        </div>
        
        <div className="glass-card rounded-xl p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[#00FFD1]/10 rounded">
              <Vote className="w-5 h-5 text-[#00FFD1]" />
            </div>
            <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">Total LYNX Staked</span>
          </div>
          <div className="text-3xl font-mono font-bold text-white tracking-tighter">{(stats.totalLynxStaked / 1000000).toFixed(1)}M</div>
          <div className="text-[10px] text-[#71717A] mt-1 font-bold">62.4% of Supply</div>
        </div>

        <div className="glass-card rounded-xl p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-400/10 rounded">
              <MessageSquare className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">Forum Activity</span>
          </div>
          <div className="text-3xl font-mono font-bold text-white tracking-tighter">High</div>
          <div className="text-[10px] text-amber-400 mt-1 font-bold">{stats.activeDiscussions} active discussions</div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex gap-4 border-b border-[#1F1F23] pb-4 overflow-x-auto no-scrollbar">
          {['all', 'active', 'passed', 'rejected'].map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "text-[10px] font-black uppercase tracking-widest pb-2 px-1 transition-all relative shrink-0",
                activeCategory === cat ? "text-[#00FFD1]" : "text-[#52525B] hover:text-[#A1A1AA]"
              )}
            >
              {cat} Proposals
              {activeCategory === cat && (
                <div className="absolute bottom-[-17px] left-0 right-0 h-0.5 bg-[#00FFD1]" />
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredProposals.length === 0 ? (
               <motion.div
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="text-center p-12 glass-card border border-dashed border-[#1F1F23] rounded-xl bg-[#0D0D0E]"
               >
                 <p className="text-[#A1A1AA] text-sm font-mono uppercase tracking-widest">No proposals found</p>
               </motion.div>
            ) : (
              filteredProposals.map((proposal) => (
                <motion.div
                  key={proposal.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="glass-card bg-[#0D0D0E] border border-[#1F1F23] rounded-xl overflow-hidden hover:border-[#27272A] transition-all group"
                >
                  <div className="p-6 md:p-8 flex flex-col md:flex-row gap-6">
                    <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-[10px] font-mono text-[#52525B] font-bold">{proposal.id}</span>
                      <span className={cn(
                        "text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest",
                        proposal.status === 'active' ? "bg-[#00FFD1]/10 text-[#00FFD1] border border-[#00FFD1]/20" :
                        proposal.status === 'passed' ? "bg-amber-400/10 text-amber-400 border border-amber-400/20" :
                        "bg-red-400/10 text-red-400 border border-red-400/20"
                      )}>
                        {proposal.status}
                      </span>
                      <span className="text-[9px] text-[#71717A] uppercase font-bold tracking-widest">{proposal.category}</span>
                    </div>
                    <h4 className="text-xl md:text-2xl font-bold text-white mb-3 group-hover:text-[#00FFD1] transition-colors">{proposal.title}</h4>
                    <p className="text-sm text-[#71717A] line-clamp-2 md:line-clamp-none max-w-3xl mb-4 leading-relaxed font-medium">
                      {proposal.description}
                    </p>
                    <div className="flex items-center gap-4 text-[10px] text-[#52525B] font-bold uppercase tracking-widest">
                       <div className="flex items-center gap-1.5">
                         <Clock className="w-3 h-3" />
                         {proposal.endTime}
                       </div>
                       <div className="flex items-center gap-1.5">
                         <CheckCircle2 className="w-3 h-3" />
                         By {proposal.author}
                       </div>
                    </div>
                  </div>

                  <div className="w-full md:w-64 space-y-4">
                     <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                           <span className="text-[#00FFD1]">Yes</span>
                           <span className="text-white">{(proposal.votesYes / (proposal.votesYes + proposal.votesNo) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-[#1F1F23] rounded-full overflow-hidden">
                           <div 
                              className="h-full bg-[#00FFD1]" 
                              style={{ width: `${(proposal.votesYes / (proposal.votesYes + proposal.votesNo) * 100)}%` }}
                           />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                           <span className="text-[#52525B]">No</span>
                           <span className="text-white">{(proposal.votesNo / (proposal.votesYes + proposal.votesNo) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-[#1F1F23] rounded-full overflow-hidden">
                           <div 
                              className="h-full bg-[#52525B]" 
                              style={{ width: `${(proposal.votesNo / (proposal.votesYes + proposal.votesNo) * 100)}%` }}
                           />
                        </div>
                     </div>
                     <button 
                       onClick={() => proposal.status === 'active' && handleVoteAction(proposal.id)}
                       disabled={proposal.status !== 'active' || isPendingAct}
                       className={cn(
                       "w-full py-3 rounded text-[10px] font-black uppercase tracking-widest transition-all",
                       proposal.status === 'active' 
                        ? "bg-[#18181B] border border-[#27272A] text-white hover:bg-[#00FFD1] hover:text-black hover:border-transparent" 
                        : "bg-[#18181B] border border-[#27272A] text-[#3F3F46] cursor-not-allowed",
                       isPendingAct && "opacity-50 cursor-not-allowed"
                     )}>
                       {proposal.status === 'active' ? 'Cast your Vote' : 'Voting Ended'}
                     </button>
                  </div>
                </div>
              </motion.div>
            )))}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-16 p-8 rounded-2xl bg-gradient-to-br from-[#0D0D0E] to-[#141417] border border-[#1F1F23] relative overflow-hidden">
          <div className="absolute inset-0 opacity-5 bg-[radial-gradient(circle_at_50%_100%,_#00FFD1_0%,_transparent_70%)]"></div>
          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
             <div>
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">Need a Voice?</h3>
                <p className="text-[#71717A] text-sm md:text-base max-w-xl font-medium tracking-wide">
                  Stake your $LYNX tokens to participate in governance. Active voters earn a "Governance Multiplier" on their trading fee rebates.
                </p>
             </div>
             <button 
                onClick={handleStakeAction}
                disabled={isPendingAct}
                className={cn("px-8 py-4 bg-[#18181B] text-white border border-[#27272A] hover:bg-[#27272A] transition-all rounded font-black text-sm uppercase tracking-widest",
                  isPendingAct && "opacity-50 cursor-not-allowed"
                )}>
                Stake $LYNX
             </button>
          </div>
      </div>
    </div>
  );
}
