import { 
  BookOpen, 
  ShieldCheck, 
  TrendingUp, 
  Zap, 
  Globe, 
  Scale, 
  ArrowRight,
  Wallet,
  Coins,
  Flame,
  ArrowRightLeft,
  CircleDollarSign,
  BarChart4,
  Layers,
  FileText
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/lib/utils';

export function DocsView() {
  const { t } = useTranslation();

  const steps = [
    {
      id: "01",
      title: t('docs.step1Title', "Prediction Events"),
      icon: <Globe className="w-5 h-5" />,
      content: t('docs.step1Content', "Users bet SOL on real-world Yes/No prediction events."),
      color: "#00FFD1",
      details: [
        { label: "Example", value: "100 SOL Total Pool", highlight: true }
      ]
    },
    {
      id: "02",
      title: t('docs.step2Title', "Protocol Fees"),
      icon: <Scale className="w-5 h-5" />,
      content: t('docs.step2Content', "A 10% fee is applied to the total event volume for ecosystem growth and rewards."),
      color: "#9945FF",
      details: [
        { label: "LYNX Stakers", value: "5% SOL Rewards", highlight: true },
        { label: "Protocol Treasury", value: "5% SOL" }
      ]
    },
    {
      id: "03",
      title: t('docs.step3Title', "LYNX Emission"),
      icon: <Coins className="w-5 h-5" />,
      content: t('docs.step3Content', "1 LYNX is emitted for every 1 SOL wagered in regular and 1v1 events. 20% of this emission is distributed among users holding the winning side tokens at the end of the event."),
      color: "#14F195",
      details: [
        { label: "Winners", value: "20%" },
        { label: "Treasury", value: "20%" },
        { label: "Market Sale", value: "60%", highlight: true }
      ]
    },
    {
      id: "04",
      title: t('docs.step4Title', "Initial & Secondary Market"),
      icon: <BarChart4 className="w-5 h-5" />,
      content: t('docs.step4Content', "60% of emitted LYNX is sold via Order Book. Price is 100% defined by free market supply and demand."),
      color: "#F0E040",
      details: [
        { label: "Proceeds go to", value: "Treasury" },
        { label: "Price determined by", value: "Market ONLY", highlight: true }
      ]
    },
    {
      id: "05",
      title: t('docs.step5Title', "Platform Fees & Treasury"),
      icon: <Wallet className="w-5 h-5" />,
      content: t('docs.step5Content', "A 0.1% fee on all platform transactions funds the Treasury, powering buybacks, development, and system liquidity."),
      color: "#FF4545",
      details: [
        { label: "Global TX Fee", value: "0.1%" },
        { label: "Goes to", value: "Treasury", highlight: true }
      ]
    },
    {
      id: "06",
      title: t('docs.step6Title', "Staking & Rewards"),
      icon: <Layers className="w-5 h-5" />,
      content: t('docs.step6Content', "Lock your freely-traded LYNX to capture protocol value in SOL. Stakers earn the 5% event volume fees proportionally."),
      color: "#00FFD1",
      details: [
        { label: "Requirement", value: "Stake LYNX" },
        { label: "Yield", value: "SOL Volume Fees", highlight: true }
      ]
    },
    {
      id: "07",
      title: t('docs.step7Title', "1v1vP Mode"),
      icon: <Zap className="w-5 h-5" />,
      content: t('docs.step7Content', "In 1v1vP Duels, the protocol participates by emitting LYNX equal to the SOL wagered by users. If the protocol wins, the SOL goes to the Treasury. If it loses, the emitted LYNX is awarded to the players."),
      color: "#9945FF",
      details: [
        { label: "Protocol Matches", value: "1:1 with LYNX", highlight: true },
        { label: "If Protocol Loses", value: "+LYNX to Players" }
      ]
    },
    {
      id: "08",
      title: t('docs.step8Title', "Deflationary Mechanics"),
      icon: <Flame className="w-5 h-5" />,
      content: t('docs.step8Content', "Participating in special LYNX-denominated tournaments permanently burns 15% of the total wagered LYNX. No new tokens are emitted during these events."),
      color: "#FF4545",
      details: [
        { label: "Tournaments Burn", value: "15% of LYNX", highlight: true },
        { label: "Emission", value: "0 LYNX" }
      ]
    }
  ];

  const addresses = {
    contracts: [
      { label: t('docs.lynxToken', "$LYNX Token"), address: "LYNx8...w9A2", color: "#00FFD1" },
      { label: t('docs.marketCoreProg', "Market Core Program"), address: "mRk7...vL41", color: "#9945FF" },
      { label: t('docs.stakingProgram', "Staking Program"), address: "stAk...eR29", color: "#14F195" }
    ],
    wallets: [
      { label: t('docs.foundationTreasury', "Foundation Treasury"), address: "trEa...xP88", color: "#F0E040" },
      { label: t('docs.protocolRewards', "Protocol Rewards Vault"), address: "rEwA...mC55", color: "#00FFD1" },
      { label: t('docs.feeCollector', "Fee Collector (Hot)"), address: "fEeC...vB12", color: "#FF4545" }
    ]
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto mb-24">
      {/* Header */}
      <div className="mb-16">
        <div className="flex items-center gap-3 mb-4">
           <div className="w-12 h-12 bg-[#00FFD1]/10 rounded flex items-center justify-center text-[#00FFD1] border border-[#00FFD1]/20">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">{t('docs.systemLynx', 'LYNX System')}</h2>
            <p className="text-[#71717A] text-[10px] uppercase tracking-widest font-black mt-1">
              {t('docs.systemSubtitle', 'The Definitive On-Chain Prediction Economy')}
            </p>
          </div>
        </div>
        
        <div className="glass-card border border-[#00FFD1]/20 bg-[#00FFD1]/5 rounded-xl p-6 md:p-8 mt-8">
          <h3 className="text-sm font-bold text-[#00FFD1] uppercase tracking-widest mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            {t('docs.systemSummaryTitle', 'System Summary')}
          </h3>
          <p className="text-[#A1A1AA] text-sm md:text-base leading-relaxed">
            <strong className="text-white">LYNX</strong> {t('docs.systemSummary1', 'is a freely tradable token that grants access to SOL rewards generated by a prediction market. The price of LYNX is 100% determined by the free market via order book. Its main utility is staking to capture continuous SOL yield from protocol volume.')}
          </p>
        </div>
      </div>

      {/* Step by Step Flow */}
      <div className="mb-16">
        <h3 className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] mb-8 border-b border-[#1F1F23] pb-4 flex items-center gap-2">
           <ArrowRightLeft className="w-4 h-4" />
           {t('docs.operationalFlow', 'Operational Flow')}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {steps.map((step, idx) => (
            <motion.div 
              key={step.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className="p-6 md:p-8 rounded-2xl bg-[#0A0A0B] border border-[#1F1F23] relative group overflow-hidden flex flex-col"
            >
              <div 
                className="absolute top-0 right-0 w-32 h-32 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"
                style={{ background: `radial-gradient(circle at 100% 0%, ${step.color}, transparent 70%)` }}
              />
              
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-lg bg-[#141417] border border-[#27272A]" style={{ color: step.color }}>
                  {step.icon}
                </div>
                <div className="text-[10px] font-mono font-black text-[#3F3F46] tracking-widest bg-[#141417] px-2 py-1 rounded">
                  STEP {step.id}
                </div>
              </div>

              <h3 className="text-lg font-bold text-white mb-3 tracking-tight">{step.title}</h3>
              <p className="text-[#71717A] text-sm leading-relaxed font-medium mb-6 flex-1">
                {step.content}
              </p>

              <div className="space-y-2 mt-auto">
                {step.details.map((detail, dIdx) => (
                  <div key={dIdx} className={cn(
                    "flex justify-between items-center text-[10px] uppercase font-bold p-2 rounded",
                    detail.highlight ? "bg-white/5 border border-white/10" : "bg-[#0D0D0E]"
                  )}>
                    <span className="text-[#52525B]">{detail.label}</span>
                    <span className={cn(
                      "font-mono tracking-tighter",
                      detail.highlight ? "text-white" : "text-[#71717A]"
                    )}>{detail.value}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Trilemma / Breakdown Section */}
      <div className="mb-16">
        <h3 className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] mb-8 border-b border-[#1F1F23] pb-4">
           {t('docs.systemEntities', 'System Entities')}
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="p-6 rounded-xl border border-[#00FFD1]/20 bg-[#00FFD1]/5 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 opacity-10 bg-[#00FFD1] blur-3xl pointer-events-none" />
             <h4 className="text-[#00FFD1] font-bold uppercase tracking-widest text-xs mb-4">1. {t('docs.entityProtocol', 'Protocol (Treasury)')}</h4>
             <p className="text-[#A1A1AA] text-[11px] leading-relaxed mb-4 font-medium">
               {t('docs.entityProtocolDesc', 'Accumulates SOL from event fees, initial LYNX sales, 1v1vP events, and global activity fees. Can freely use these funds for buybacks, system liquidity, and development.')}
             </p>
          </div>
          
          <div className="p-6 rounded-xl border border-[#9945FF]/20 bg-[#9945FF]/5 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 opacity-10 bg-[#9945FF] blur-3xl pointer-events-none" />
             <h4 className="text-[#9945FF] font-bold uppercase tracking-widest text-xs mb-4">2. {t('docs.entityUsers', 'Users (Staking)')}</h4>
             <p className="text-[#A1A1AA] text-[11px] leading-relaxed mb-4 font-medium">
               {t('docs.entityUsersDesc', 'Buy and sell LYNX, stake to receive SOL rewards, speculate on LYNX price, and participate in prediction events with SOL.')}
             </p>
          </div>

          <div className="p-6 rounded-xl border border-[#F0E040]/20 bg-[#F0E040]/5 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 opacity-10 bg-[#F0E040] blur-3xl pointer-events-none" />
             <h4 className="text-[#F0E040] font-bold uppercase tracking-widest text-xs mb-4">3. {t('docs.entityMarket', 'Free Market')}</h4>
             <p className="text-[#A1A1AA] text-[11px] leading-relaxed mb-4 font-medium">
               {t('docs.entityMarketDesc', 'Defines the price of LYNX via order book and provides liquidity. The protocol NEVER sets or fixes the price of LYNX.')}
             </p>
          </div>
        </div>
      </div>

      {/* Protocol Directory Section */}
      <div className="mb-16">
        <h3 className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] mb-8 border-b border-[#1F1F23] pb-4 flex items-center gap-2">
           <FileText className="w-4 h-4" />
           {t('docs.protocolDir', 'Protocol Directory')}
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contracts */}
          <div className="p-6 rounded-xl bg-[#0A0A0B] border border-[#1F1F23] space-y-6">
            <div className="flex items-center gap-2 text-white font-bold mb-2">
              <FileText className="w-5 h-5 text-[#00FFD1]" />
              <span className="text-sm md:text-base tracking-tight">{t('docs.smartContracts', 'Smart Contracts')}</span>
            </div>
            <div className="space-y-4">
              {addresses.contracts.map((item, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[10px] md:text-xs">
                  <span className="text-[#A1A1AA] font-bold uppercase tracking-widest">{item.label}</span>
                  <span className="font-mono text-[#00FFD1] bg-[#00FFD1]/10 px-2 py-1.5 rounded border border-[#00FFD1]/20 w-fit">{item.address}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Wallets */}
          <div className="p-6 rounded-xl bg-[#0A0A0B] border border-[#1F1F23] space-y-6">
            <div className="flex items-center gap-2 text-white font-bold mb-2">
              <Wallet className="w-5 h-5 text-[#9945FF]" />
              <span className="text-sm md:text-base tracking-tight">{t('docs.protocolTreasuryDir', 'Protocol Treasury & Vaults')}</span>
            </div>
            <div className="space-y-4">
              {addresses.wallets.map((item, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[10px] md:text-xs">
                  <span className="text-[#A1A1AA] font-bold uppercase tracking-widest">{item.label}</span>
                  <span className="font-mono text-[#9945FF] bg-[#9945FF]/10 px-2 py-1.5 rounded border border-[#9945FF]/20 w-fit">{item.address}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="text-center p-8 md:p-12 border border-dashed border-[#1F1F23] rounded-2xl bg-[#0A0A0B]">
        <CircleDollarSign className="w-8 h-8 text-[#52525B] mx-auto mb-6" />
        <p className="text-[#71717A] text-sm md:text-base leading-relaxed max-w-2xl mx-auto font-medium">
          "{t('docs.finalQuote', 'LYNX is a prediction ecosystem where the protocol captures SOL value through market activity, and redistributes part of that value to token holders via staking, while the token price remains 100% defined by supply and demand.')}"
        </p>
      </div>
    </div>
  );
}

