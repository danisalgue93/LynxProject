import React, { useState, useEffect } from 'react';
import { Vote, Users, MessageSquare, ChevronRight, CheckCircle2, Clock, AlertCircle, PlusCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useProgram } from '@/src/hooks/useProgram';
import { Proposal } from '@/src/types';
import { useTranslation } from 'react-i18next';
import CreateProposalModal from './CreateProposalModal';
import StakeModal from './StakeModal';
import { useBlockchainTransaction } from '@/src/hooks/useBlockchainTransaction';
import { getTxExplorerUrl } from '@/src/lib/explorer';
import { useToast } from '@/src/context/ToastContext';
import { useAuth } from '@/src/context/AuthContext';

export function GovernanceView({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useTranslation();
  const { fetchProposals, fetchDaoStats, castVote, createProposal, stakeLynx, isLoading, error } = useProgram();
  const { executeTransaction } = useBlockchainTransaction();
  const { addToast } = useToast();
  const { isAdmin } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isPendingAct, setIsPendingAct] = useState(false);
  const [votedProposalIds, setVotedProposalIds] = useState<Set<string>>(() => new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);

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

  const handleVoteAction = async (proposalId: string, voteType: 'yes' | 'no') => {
    if (readOnly) return;
    setIsPendingAct(true);
    try {
      await executeTransaction(
        async () => {
          const result = await castVote(proposalId, voteType);
          return typeof result === 'string' ? result : `vote-${proposalId}-${voteType}-${Date.now()}`;
        },
        {
          pendingMessage: t('governance.votePending', 'Casting {{voteType}} vote...', { voteType }),
          successMessage: t('governance.voteSuccess', 'Vote cast successfully!'),
          errorMessage: t('governance.voteFailed', 'Failed to cast vote'),
          explorerUrl: (txHash) => getTxExplorerUrl(txHash)
        }
      );
      setVotedProposalIds((prev) => new Set(prev).add(proposalId));
      const [proposalsData, statsData] = await Promise.all([fetchProposals(), fetchDaoStats()]);
      setProposals(proposalsData);
      setStats(statsData);
    } catch (e: any) {
      console.error(e);
      const msg: string = e?.message || '';
      if (msg.includes('already voted') || msg.includes('already_voted')) {
        // Mark as voted so buttons disable immediately
        setVotedProposalIds((prev) => new Set(prev).add(proposalId));
        addToast({ type: 'info', message: t('governance.alreadyVoted', 'You already voted on this proposal'), duration: 5000 });
      } else {
        addToast({ type: 'error', message: msg || t('governance.voteFailed', 'Failed to cast vote') });
      }
    } finally {
      setIsPendingAct(false);
    }
  };

  const handleStakeAction = async (amount?: number) => {
    if (readOnly) return;
    if (typeof amount === 'undefined') {
      setShowStakeModal(true);
      return;
    }
    if (!amount || amount <= 0) return;
    setIsPendingAct(true);
    setStakeError(null);
    try {
      await executeTransaction(
        async () => {
          const result = await stakeLynx(amount);
          return typeof result === 'string' ? result : `stake-${amount}-${Date.now()}`;
        },
        {
          pendingMessage: t('governance.stakePending', 'Staking {{amount}} LYNX...', { amount }),
          successMessage: t('governance.stakeSuccess', 'Successfully staked {{amount}} LYNX!', { amount }),
          errorMessage: t('governance.stakeFailed', 'Failed to stake LYNX'),
          explorerUrl: (txHash) => getTxExplorerUrl(txHash)
        }
      );
      const statsData = await fetchDaoStats();
      setStats(statsData);
    } catch (e: any) {
      console.error(e);
      const msg: string = e?.message || '';
      if (msg.includes('Insufficient LYNX') || msg.includes('insufficient_lynx')) {
        setStakeError(t('portfolio.insufficientLynxBalance', 'Not enough LYNX to complete this transaction.'));
      } else {
        setStakeError(msg || t('governance.stakeFailed', 'Failed to stake LYNX'));
      }
    } finally {
      setIsPendingAct(false);
    }
  };

  const handleCreateProposal = async (input?: { title: string; description?: string; category?: string }) => {
    if (readOnly) return;
    if (!input) {
      setShowCreateModal(true);
      return;
    }
    setIsPendingAct(true);
    try {
      await executeTransaction(
        async () => {
          const result = await createProposal(input);
          return typeof result === 'string' ? result : `proposal-${Date.now()}`;
        },
        {
          pendingMessage: t('governance.createProposalPending', 'Creating proposal: "{{title}}"...', { title: input.title }),
          successMessage: t('governance.createProposalSuccess', 'Proposal created successfully!'),
          errorMessage: t('governance.createProposalFailed', 'Failed to create proposal'),
          explorerUrl: (txHash) => getTxExplorerUrl(txHash)
        }
      );
      const [proposalsData, statsData] = await Promise.all([fetchProposals(), fetchDaoStats()]);
      setProposals(proposalsData);
      setStats(statsData);
      setShowCreateModal(false);
    } catch (e: any) {
      console.error(e);
      addToast({ type: 'error', message: e?.message || t('governance.createProposalFailed', 'Failed to create proposal') });
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
        <span className="font-mono text-[#71717A] text-sm uppercase tracking-widest">{t('governance.loading', 'Loading governance data...')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px]">
        <div className="text-red-400 font-mono text-sm border-dashed border border-red-400/20 bg-red-400/5 p-4 rounded-xl">
          {t('common.error', 'Error')}: {error}
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
              {t('governance.daoGovernance', 'DAO GOVERNANCE')}
            </span>
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tighter mb-2">{t('governance.communityHall', 'Community Hall')}</h2>
          <p className="text-[#71717A] text-sm md:text-base uppercase tracking-widest font-medium">
            {t('governance.subtitle', '$LYNX stakers drive the evolution of Lynx Market.')}
          </p>
        </div>

        <button
          onClick={() => handleCreateProposal()}
          disabled={readOnly || !isAdmin}
          title={!isAdmin ? t('governance.adminsOnly', 'Admins only') : undefined}
          className="flex items-center gap-2 px-6 py-3 bg-[#00FFD1] text-black font-black text-sm rounded uppercase tracking-tight hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(0,255,209,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusCircle className="w-4 h-4" />
          {t('governance.createProposal', 'Create Proposal')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="glass-card rounded-xl p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[#9945FF]/10 rounded">
              <Users className="w-5 h-5 text-[#9945FF]" />
            </div>
            <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">{t('governance.activeVoters', 'Active Voters')}</span>
          </div>
          <div className="text-3xl font-mono font-bold text-white tracking-tighter">{stats?.activeVoters?.toLocaleString() || '0'}</div>
          <div className="text-[10px] text-[#00FFD1] mt-1 font-bold">{t('governance.vsLastWeek', '+0% vs last week')}</div>
        </div>
        
        <div className="glass-card rounded-xl p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[#00FFD1]/10 rounded">
              <Vote className="w-5 h-5 text-[#00FFD1]" />
            </div>
            <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">{t('governance.totalStaked', 'Total LYNX Staked')}</span>
          </div>
          <div className="text-3xl font-mono font-bold text-white tracking-tighter">
            {stats?.totalLynxStaked >= 1000000 
              ? `${(stats.totalLynxStaked / 1000000).toFixed(1)}M` 
              : stats?.totalLynxStaked?.toLocaleString() || '0'}
          </div>
          <div className="text-[10px] text-[#71717A] mt-1 font-bold">{t('governance.ofSupply', '0% of Supply')}</div>
        </div>

        <div className="glass-card rounded-xl p-6 border border-[#1F1F23] bg-[#0D0D0E]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-400/10 rounded">
              <MessageSquare className="w-5 h-5 text-amber-400" />
            </div>
            <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">{t('governance.forumActivity', 'Forum Activity')}</span>
          </div>
          <div className="text-3xl font-mono font-bold text-white tracking-tighter">{stats?.activeDiscussions || '0'}</div>
          <div className="text-[10px] text-amber-400 mt-1 font-bold">{t('governance.activeDiscussions', '{{count}} active discussions', { count: stats?.activeDiscussions || 0 })}</div>
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
              {t(`governance.${cat}Proposals`, `${cat} Proposals`)}
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
                 <p className="text-[#A1A1AA] text-sm font-mono uppercase tracking-widest">{t('governance.noProposals', 'No proposals found')}</p>
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
                         {t('governance.byAuthor', 'By {{author}}', { author: proposal.author })}
                       </div>
                    </div>
                  </div>

                  <div className="w-full md:w-64 space-y-4">
                     <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                           <span className="text-[#00FFD1]">{t('governance.yes', 'Yes')}</span>
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
                           <span className="text-[#52525B]">{t('governance.no', 'No')}</span>
                           <span className="text-white">{(proposal.votesNo / (proposal.votesYes + proposal.votesNo) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-[#1F1F23] rounded-full overflow-hidden">
                           <div 
                              className="h-full bg-[#52525B]" 
                              style={{ width: `${(proposal.votesNo / (proposal.votesYes + proposal.votesNo) * 100)}%` }}
                           />
                        </div>
                     </div>
                     <div className="space-y-2">
                       {proposal.status === 'active' ? (
                         <>
                           <button
                             onClick={() => handleVoteAction(proposal.id, 'yes')}
                             disabled={isPendingAct || readOnly || votedProposalIds.has(proposal.id)}
                             title={votedProposalIds.has(proposal.id) ? t('governance.alreadyVoted', 'You already voted on this proposal') : undefined}
                             className={cn(
                               "w-full py-2 rounded text-[10px] font-black uppercase tracking-widest transition-all bg-[#00FFD1] text-black",
                               (isPendingAct || readOnly || votedProposalIds.has(proposal.id)) && "opacity-50 cursor-not-allowed"
                             )}
                           >
                             {t('governance.voteYes', 'Vote YES')}
                           </button>
                           <button
                             onClick={() => handleVoteAction(proposal.id, 'no')}
                             disabled={isPendingAct || readOnly || votedProposalIds.has(proposal.id)}
                             title={votedProposalIds.has(proposal.id) ? t('governance.alreadyVoted', 'You already voted on this proposal') : undefined}
                             className={cn(
                               "w-full py-2 rounded text-[10px] font-black uppercase tracking-widest transition-all bg-[#18181B] text-white border border-[#27272A] hover:bg-[#52525B]",
                               (isPendingAct || readOnly || votedProposalIds.has(proposal.id)) && "opacity-50 cursor-not-allowed hover:bg-[#18181B]"
                             )}
                           >
                             {t('governance.voteNo', 'Vote NO')}
                           </button>
                         </>
                       ) : (
                         <button disabled className="w-full py-3 rounded text-[10px] font-black uppercase tracking-widest bg-[#18181B] border border-[#27272A] text-[#3F3F46] cursor-not-allowed">
                           {t('governance.votingEnded', 'Voting Ended')}
                         </button>
                       )}
                     </div>
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
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">{t('governance.needVoice', 'Need a Voice?')}</h3>
                <p className="text-[#71717A] text-sm md:text-base max-w-xl font-medium tracking-wide">
                  {t('governance.voiceDesc', 'Stake your $LYNX tokens to participate in governance. Active voters earn a "Governance Multiplier" on their trading fee rebates.')}
                </p>
             </div>
             <div className="flex flex-col items-start gap-3">
             {stakeError && (
               <div className="w-full p-3 bg-[#3F1F1F] border border-[#4B1F1F] rounded text-sm text-[#FFD6D6] font-bold flex items-start justify-between gap-3">
                 <div className="flex-1 text-left text-[11px]">{stakeError}</div>
                 <button onClick={() => setStakeError(null)} className="text-[#FFB4B4] text-[10px] shrink-0">{t('orderbook.dismiss', 'Dismiss')}</button>
               </div>
             )}
             <button 
                onClick={() => handleStakeAction()}
                disabled={isPendingAct || readOnly}
                className={cn("px-8 py-4 bg-[#18181B] text-white border border-[#27272A] hover:bg-[#27272A] transition-all rounded font-black text-sm uppercase tracking-widest",
                  isPendingAct && "opacity-50 cursor-not-allowed"
                )}>
                {t('governance.stakeLynx', 'Stake $LYNX')}
             </button>
             </div>
          </div>
      </div>
      {showCreateModal && (
        <CreateProposalModal onClose={() => setShowCreateModal(false)} onSubmit={(input) => handleCreateProposal(input)} />
      )}
      {showStakeModal && (
        <StakeModal onClose={() => setShowStakeModal(false)} onSubmit={(amt) => handleStakeAction(amt)} defaultAmount={1} />
      )}
    </div>
  );
}
