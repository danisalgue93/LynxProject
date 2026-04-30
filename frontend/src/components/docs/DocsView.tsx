import { 
  BookOpen, 
  ShieldCheck, 
  TrendingUp, 
  Users, 
  Zap, 
  Globe, 
  Scale, 
  Compass,
  ArrowRight,
  Wallet,
  FileText,
  Key,
  Database
} from 'lucide-react';
import { motion } from 'motion/react';

export function DocsView() {
  const sections = [
    {
      title: "Introduction to LYNX Market",
      icon: <Globe className="w-5 h-5" />,
      content: "LYNX Market is a decentralized prediction ecosystem built on Solana. It enables users to trade positions on real-world outcomes using high-performance P2P infrastructure. Our mission is to facilitate a liquid market for collective insights and consensus.",
      color: "#00FFD1"
    },
    {
      title: "Consensus Modeling",
      icon: <TrendingUp className="w-5 h-5" />,
      content: "Positions are represented as tokens that fluctuate based on market demand and collective opinion. By participating, users provide data points that help aggregate the most accurate forecast of future events, from technology releases to macro-economic shifts.",
      color: "#9945FF"
    },
    {
      title: "Institutional Security",
      icon: <ShieldCheck className="w-5 h-5" />,
      content: "All transactions are executed through non-custodial smart contracts. Oracle integrity is maintained via high-fidelity data streams (Switchboard/Pyth), ensuring that market settlement is always based on verifiable, objective truths.",
      color: "#14F195"
    },
    {
      title: "1v1 Forecasting Duels",
      icon: <Zap className="w-5 h-5" />,
      content: "A unique high-stakes environment where two participants can open direct peer-to-peer markets. These are permissionless markets created with custom parameters, enabling precise targeting of specific outcome variations with optimized capital efficiency.",
      color: "#F0E040"
    }
  ];

  const addresses = {
    contracts: [
      { label: "Market Core Program", address: "LYNx8...w9A2", color: "#00FFD1" },
      { label: "AMM Vault Router", address: "LYNxV...kL41", color: "#9945FF" },
      { label: "Governance DAO", address: "LYNxG...eR29", color: "#14F195" }
    ],
    wallets: [
      { label: "Foundation Treasury", address: "LYNxT...xP88", color: "#F0E040" },
      { label: "Protocol Rewards", address: "LYNxR...mC55", color: "#00FFD1" },
      { label: "Insurance Reserve", address: "LYNxI...vB12", color: "#FF4545" }
    ]
  };

  const faqs = [
    {
      q: "What determines the value of a position?",
      a: "The value is a reflection of the market's perceived probability of an outcome. If the consensus shifts toward 'Yes', the Yes position value increases. This is a dynamic pricing model identical to an order-book based DEX."
    },
    {
      q: "Is this a professional analytics tool?",
      a: "Yes. LYNX is a financial utility for information aggregation. It provides hedging mechanisms and serves as a 'Truth Machine', compensating those who provide accurate insights through successful forecasting."
    },
    {
      q: "How does the DAO governance work?",
      a: "Protocol parameters, grant allocations, and new asset listings are decided by $LYNX holders. Staking $LYNX not only grants voting power but also distributes a portion of the protocol's execution fees."
    }
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-[#00FFD1]/10 rounded border border-[#00FFD1]/20">
            <BookOpen className="w-5 h-5 text-[#00FFD1]" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Protocol Documentation</h2>
        </div>
        <p className="text-[#71717A] text-sm uppercase tracking-widest font-black">Institutional Grade Insight Exchange</p>
      </div>

      {/* Core Concept Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        {sections.map((section, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="p-8 rounded-2xl bg-[#0D0D0E] border border-[#1F1F23] relative group overflow-hidden"
          >
            <div 
              className="absolute top-0 right-0 w-32 h-32 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"
              style={{ background: `radial-gradient(circle at 100% 0%, ${section.color}, transparent 70%)` }}
            />
            <div className="mb-6 p-3 w-fit rounded-lg bg-[#141417] border border-[#27272A]" style={{ color: section.color }}>
              {section.icon}
            </div>
            <h3 className="text-lg font-bold text-white mb-3 tracking-tight">{section.title}</h3>
            <p className="text-[#71717A] text-sm leading-relaxed font-medium">
              {section.content}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Protocol Directory Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] mb-4 border-b border-[#1F1F23] pb-4">Protocol Directory</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contracts */}
            <div className="p-6 rounded-xl bg-[#0F0F12] border border-[#1F1F23] space-y-4">
              <div className="flex items-center gap-2 text-white font-bold mb-2">
                <FileText className="w-4 h-4 text-[#00FFD1]" />
                <span className="text-sm">Smart Contracts</span>
              </div>
              {addresses.contracts.map((item, i) => (
                <div key={i} className="flex justify-between items-center text-[10px]">
                  <span className="text-[#71717A] font-bold uppercase">{item.label}</span>
                  <span className="font-mono text-[#A1A1AA] bg-white/5 px-2 py-1 rounded border border-white/10">{item.address}</span>
                </div>
              ))}
            </div>

            {/* Wallets */}
            <div className="p-6 rounded-xl bg-[#0F0F12] border border-[#1F1F23] space-y-4">
              <div className="flex items-center gap-2 text-white font-bold mb-2">
                <Wallet className="w-4 h-4 text-[#9945FF]" />
                <span className="text-sm">Protocol Treasury</span>
              </div>
              {addresses.wallets.map((item, i) => (
                <div key={i} className="flex justify-between items-center text-[10px]">
                  <span className="text-[#71717A] font-bold uppercase">{item.label}</span>
                  <span className="font-mono text-[#A1A1AA] bg-white/5 px-2 py-1 rounded border border-white/10">{item.address}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 rounded-xl bg-gradient-to-br from-[#141417] to-[#0D0D0E] border border-[#1F1F23] self-start">
          <div className="flex items-center gap-2 text-white font-bold mb-4">
            <Database className="w-4 h-4 text-[#F0E040]" />
            <span className="text-sm">AMM Infrastructure</span>
          </div>
          <p className="text-[11px] text-[#71717A] leading-relaxed mb-4">
            The LYNX Automated Market Maker utilizes a customized <strong>LMSR (Logarithmic Market Scoring Rule)</strong> algorithm specifically optimized for the high throughput of the Solana network.
          </p>
          <div className="space-y-3">
            <div className="flex justify-between text-[9px] uppercase tracking-wider">
              <span className="text-[#52525B]">Swap Fee</span>
              <span className="text-[#00FFD1] font-black">0.25%</span>
            </div>
            <div className="flex justify-between text-[9px] uppercase tracking-wider">
              <span className="text-[#52525B]">AMM Efficiency</span>
              <span className="text-[#00FFD1] font-black">99.8%</span>
            </div>
            <div className="flex justify-between text-[9px] uppercase tracking-wider">
              <span className="text-[#52525B]">Settlement Delay</span>
              <span className="text-[#00FFD1] font-black">Instant</span>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ / Detailed Specs */}
      <div className="space-y-12 mb-16">
        <div>
          <h3 className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] mb-8 border-b border-[#1F1F23] pb-4">Consensus FAQ</h3>
          <div className="space-y-8">
            {faqs.map((faq, idx) => (
              <div key={idx} className="max-w-3xl">
                <h4 className="text-white font-bold mb-2 flex items-center gap-2">
                  <div className="w-1 h-4 bg-[#00FFD1] rounded-full" />
                  {faq.q}
                </h4>
                <p className="text-[#71717A] text-sm leading-relaxed pl-3 font-medium">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Technical Architecture */}
        <div className="p-8 rounded-2xl bg-[#0F0F12] border border-[#1F1F23] relative">
          <div className="flex items-center gap-4 mb-8">
            <Compass className="w-5 h-5 text-[#9945FF]" />
            <h3 className="text-lg font-bold text-white tracking-tight">Technical Architecture</h3>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div className="space-y-2">
              <span className="text-[10px] text-[#A1A1AA] font-black uppercase tracking-widest">Execution Tier</span>
              <p className="text-[11px] text-[#52525B] font-medium uppercase font-mono">Solana Virtual Machine (SVM)</p>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-[#A1A1AA] font-black uppercase tracking-widest">Oracle Mesh</span>
              <p className="text-[11px] text-[#52525B] font-medium uppercase font-mono">Switchboard v2 / Pyth Network</p>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-[#A1A1AA] font-black uppercase tracking-widest">Settlement Layer</span>
              <p className="text-[11px] text-[#52525B] font-medium uppercase font-mono">P2P Escrow Vaults</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="text-center p-12 border border-dashed border-[#1F1F23] rounded-2xl">
        <Scale className="w-8 h-8 text-[#52525B] mx-auto mb-6" />
        <h3 className="text-xl font-bold text-white mb-2">Ready to contribute to the market?</h3>
        <p className="text-[#71717A] text-sm mb-8">Join our ecosystem and start forecasting on-chain events today.</p>
        <button className="px-10 py-5 bg-[#00FFD1] text-black font-black uppercase text-xs tracking-[0.2em] rounded shadow-[0_0_30px_rgba(0,255,209,0.15)] hover:bg-[#00E5BC] transition-all inline-flex items-center gap-3">
          Get Started <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="text-center mt-12 mb-8">
        <span className="text-[9px] text-[#3F3F46] font-bold uppercase tracking-[0.4em]">Lynx Insight Engine © 2026</span>
      </div>
    </div>
  );
}
