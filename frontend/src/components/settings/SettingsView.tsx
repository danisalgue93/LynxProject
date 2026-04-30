import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Shield, 
  Zap, 
  Bell, 
  Cpu, 
  Globe, 
  Lock, 
  Eye, 
  EyeOff,
  ChevronRight,
  Save,
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';

export function SettingsView() {
  const [slippage, setSlippage] = useState('0.5');
  const [priorityFee, setPriorityFee] = useState('fast');
  const [showKey, setShowKey] = useState(false);
  const [notifications, setNotifications] = useState({
    trades: true,
    gov: true,
    system: false
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-[#00FFD1]/10 rounded border border-[#00FFD1]/20">
            <SettingsIcon className="w-5 h-5 text-[#00FFD1]" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">System Settings</h2>
        </div>
        <p className="text-[#71717A] text-sm uppercase tracking-widest font-medium">Configure your P2P execution environment.</p>
      </div>

      <div className="space-y-8">
        {/* Trading Preferences */}
        <section className="glass-card rounded-2xl border border-[#1F1F23] bg-[#0D0D0E] overflow-hidden">
          <div className="p-6 border-b border-[#1F1F23] flex items-center justify-between bg-[#141417]/50">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-[#00FFD1]" />
              <h3 className="text-xs font-black text-white uppercase tracking-widest">Trade Execution</h3>
            </div>
            <span className="text-[9px] font-bold text-[#52525B] uppercase tracking-widest">Auto-save enabled</span>
          </div>
          
          <div className="p-6 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-4 block">Slippage Tolerance (%)</label>
                <div className="flex gap-2">
                  {['0.1', '0.5', '1.0'].map(val => (
                    <button 
                      key={val}
                      onClick={() => setSlippage(val)}
                      className={cn(
                        "flex-1 py-3 rounded border text-[11px] font-mono font-bold transition-all",
                        slippage === val ? "bg-[#00FFD1] text-black border-transparent" : "bg-[#18181B] border-[#27272A] text-[#52525B] hover:text-white"
                      )}
                    >
                      {val}%
                    </button>
                  ))}
                  <div className="flex-[2] relative">
                    <input 
                      type="text" 
                      value={slippage} 
                      onChange={(e) => setSlippage(e.target.value)}
                      className="w-full h-full bg-[#18181B] border border-[#27272A] rounded px-4 text-[11px] font-mono text-white outline-none focus:border-[#00FFD1]"
                      placeholder="Custom"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-4 block">Solana Priority Fee</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'global', label: 'Static' },
                    { id: 'fast', label: 'Turbo' },
                    { id: 'ultra', label: 'MeV+' }
                  ].map(fee => (
                    <button 
                      key={fee.id}
                      onClick={() => setPriorityFee(fee.id)}
                      className={cn(
                        "py-3 rounded border text-[9px] font-black uppercase tracking-widest transition-all",
                        priorityFee === fee.id ? "bg-[#9945FF] text-white border-transparent shadow-[0_0_15px_rgba(153,69,255,0.3)]" : "bg-[#18181B] border-[#27272A] text-[#52525B]"
                      )}
                    >
                      {fee.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Security / Managed Keys */}
        <section className="glass-card rounded-2xl border border-[#1F1F23] bg-[#0D0D0E] overflow-hidden">
          <div className="p-6 border-b border-[#1F1F23] flex items-center gap-3 bg-[#141417]/50">
            <Shield className="w-4 h-4 text-[#9945FF]" />
            <h3 className="text-xs font-black text-white uppercase tracking-widest">Security & MPC Vault</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="p-5 rounded-xl bg-[#141417] border border-[#1F1F23] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#9945FF]/10 flex items-center justify-center text-[#9945FF] border border-[#9945FF]/20">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-0.5 tracking-tight">Session Key Management</h4>
                  <p className="text-[10px] text-[#52525B] font-medium uppercase tracking-wider">Trading enabled without constant signing</p>
                </div>
              </div>
              <button 
                onClick={() => setShowKey(!showKey)}
                className="flex items-center gap-2 px-4 py-2 bg-[#18181B] border border-[#27272A] rounded text-[9px] font-black uppercase text-[#A1A1AA] hover:text-white transition-all"
              >
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showKey ? 'Hide Managed Auth' : 'Reveal Managed Auth'}
              </button>
            </div>

            {showKey && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-lg bg-red-400/5 border border-red-400/20"
              >
                <div className="text-[9px] font-mono text-red-400/80 break-all leading-relaxed">
                  LYNX_AUTH_V2_82d7x...9945ff_session_338a0b0c2e1
                </div>
              </motion.div>
            )}

            <div className="pt-2">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] text-[#71717A] uppercase font-bold tracking-widest">Global Spending Limit</span>
                <span className="text-[10px] text-white font-mono">15.00 SOL / Month</span>
              </div>
              <div className="h-1.5 w-full bg-[#1F1F23] rounded-full">
                <div className="h-full w-[35%] bg-[#9945FF] rounded-full" />
              </div>
            </div>
          </div>
        </section>

        {/* Network & Infrastructure */}
        <section className="glass-card rounded-2xl border border-[#1F1F23] bg-[#0D0D0E] overflow-hidden">
          <div className="p-6 border-b border-[#1F1F23] flex items-center gap-3 bg-[#141417]/50">
            <Cpu className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-black text-white uppercase tracking-widest">Network Architecture</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-3 block">RPC Cluster</label>
                <div className="relative">
                  <select className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-xs font-bold text-white outline-none focus:border-[#00FFD1] appearance-none">
                    <option>Lynx Optimized (Default)</option>
                    <option>Helius Managed RPC</option>
                    <option>Quicknode Performance</option>
                    <option>Localhost 8899</option>
                  </select>
                  <RefreshCw className="w-3 h-3 absolute right-4 top-1/2 -translate-y-1/2 text-[#52525B]" />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-3 block">On-Chain Data Stream</label>
                <div className="p-3 bg-[#141417] border border-[#1F1F23] rounded flex items-center justify-between">
                   <span className="text-[11px] font-mono text-[#00FFD1]">LATENCY: 12ms</span>
                   <div className="flex gap-1">
                      {[1,2,3,4,5].map(i => <div key={i} className="w-1 h-3 bg-[#00FFD1] rounded-full" />)}
                   </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Action Bar */}
        <div className="pt-4 flex flex-col md:flex-row gap-4">
          <button className="flex-1 py-4 bg-[#00FFD1] text-black font-black uppercase text-xs tracking-widest rounded shadow-[0_0_20px_rgba(0,255,209,0.2)] hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
            <Save className="w-4 h-4" />
            Synchronize Config
          </button>
          <button className="px-8 py-4 bg-[#18181B] border border-[#27272A] text-[#71717A] font-bold uppercase text-xs tracking-widest rounded hover:text-white transition-all">
            Factory Reset
          </button>
        </div>

        <div className="text-center pt-8">
           <div className="text-[9px] text-[#3F3F46] font-bold uppercase tracking-[0.3em] mb-4">Lynx Market Core v2.4.1-stable</div>
           <div className="flex justify-center gap-6">
              <Globe className="w-4 h-4 text-[#3F3F46] hover:text-[#52525B] cursor-pointer" />
              <Lock className="w-4 h-4 text-[#3F3F46] hover:text-[#52525B] cursor-pointer" />
              <Bell className="w-4 h-4 text-[#3F3F46] hover:text-[#52525B] cursor-pointer" />
           </div>
        </div>
      </div>
    </div>
  );
}
