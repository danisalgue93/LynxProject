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
  RefreshCw,
  Wallet,
  Link2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useTranslation } from 'react-i18next';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useBlockchainTransaction } from '@/src/hooks/useBlockchainTransaction';

export function SettingsView() {
  const { t } = useTranslation();
  const [slippage, setSlippage] = useState('0.5');
  const [priorityFee, setPriorityFee] = useState('fast');
  const [showKey, setShowKey] = useState(false);
  const [notifications, setNotifications] = useState({
    trades: true,
    gov: true,
    system: false
  });
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const navigate = useNavigate();
  const { user, linkWallet, unlinkWallet, isAuthenticated } = useAuth();
  const { executeTransaction } = useBlockchainTransaction();

  // Load saved settings from localStorage
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('lynx.settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.slippage) setSlippage(String(parsed.slippage));
        if (parsed.priorityFee) setPriorityFee(parsed.priorityFee);
        if (typeof parsed.notifications === 'object') setNotifications(parsed.notifications);
      }
    } catch (err) {
      console.error('Failed to load settings', err);
    }
  }, []);

  const saveSettings = () => {
    const obj = { slippage, priorityFee, notifications };
    localStorage.setItem('lynx.settings', JSON.stringify(obj));
    console.log('[settings] saved', obj);
  };

  const resetSettings = () => {
    localStorage.removeItem('lynx.settings');
    setSlippage('0.5');
    setPriorityFee('fast');
    setNotifications({ trades: true, gov: true, system: false });
    console.log('[settings] reset to defaults');
  };

  const handleLinkWallet = async () => {
    setLinkError(null);
    setLinkSuccess(null);

    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { mode: 'login' } }));
      return;
    }

    if (!connected) {
      setVisible(true);
      return;
    }

    if (!publicKey || !signMessage) {
      setLinkError('No wallet is ready. Conecta Phantom o Solflare primero.');
      return;
    }

    setLinking(true);
    try {
      await executeTransaction(
        async () => {
          const walletAddress = publicKey.toBase58();
          const signatureMessage = JSON.stringify({
            app: 'LYNX',
            action: 'LINK_WALLET',
            wallet: walletAddress,
            issuedAt: new Date().toISOString()
          });
          const rawSignature = await signMessage(new TextEncoder().encode(signatureMessage));
          let binary = '';
          rawSignature.forEach((byte) => { binary += String.fromCharCode(byte); });
          const signature = window.btoa(binary);

          await linkWallet(walletAddress, signatureMessage, signature);
          setLinkSuccess('Wallet vinculada correctamente a tu cuenta.');
          return `link-${walletAddress}-${Date.now()}`;
        },
        {
          pendingMessage: 'Linking wallet to account...',
          successMessage: 'Wallet linked successfully!',
          errorMessage: 'Failed to link wallet',
          explorerUrl: () => 'https://explorer.solana.com?cluster=devnet'
        }
      );
    } catch (error: any) {
      setLinkError(error?.message || 'Error al vincular la wallet');
      console.error('Link wallet failed', error);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkWallet = async () => {
    setLinkError(null);
    setLinkSuccess(null);

    try {
      await executeTransaction(
        async () => {
          await unlinkWallet();
          setLinkSuccess('Wallet desvinculada. Puedes enlazar otra wallet ahora.');
          return `unlink-${Date.now()}`;
        },
        {
          pendingMessage: 'Unlinking wallet from account...',
          successMessage: 'Wallet unlinked successfully!',
          errorMessage: 'Failed to unlink wallet',
          explorerUrl: () => 'https://explorer.solana.com?cluster=devnet'
        }
      );
    } catch (error: any) {
      setLinkError(error?.message || 'Error al desvincular la wallet');
      console.error('Unlink wallet failed', error);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-[#00FFD1]/10 rounded border border-[#00FFD1]/20">
            <SettingsIcon className="w-5 h-5 text-[#00FFD1]" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{t('settings.systemSettings', 'System Settings')}</h2>
        </div>
        <p className="text-[#71717A] text-sm uppercase tracking-widest font-medium">{t('settings.systemDesc', 'Configure your P2P execution environment.')}</p>
      </div>

      <div className="space-y-8">
        {/* Trading Preferences */}
        <section className="glass-card rounded-2xl border border-[#1F1F23] bg-[#0D0D0E] overflow-hidden">
          <div className="p-6 border-b border-[#1F1F23] flex items-center justify-between bg-[#141417]/50">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-[#00FFD1]" />
              <h3 className="text-xs font-black text-white uppercase tracking-widest">{t('settings.tradeExecution', 'Trade Execution')}</h3>
            </div>
            <span className="text-[9px] font-bold text-[#52525B] uppercase tracking-widest">{t('settings.autoSaveEnabled', 'Auto-save enabled')}</span>
          </div>
          
          <div className="p-6 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-4 block">{t('settings.slippageTolerance', 'Slippage Tolerance (%)')}</label>
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
                      placeholder={t('settings.custom', 'Custom')}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-4 block">{t('settings.solanaPriorityFee', 'Solana Priority Fee')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'global', label: t('settings.feeStatic', 'Static') },
                    { id: 'fast', label: t('settings.feeTurbo', 'Turbo') },
                    { id: 'ultra', label: t('settings.feeUltra', 'MeV+') }
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
            <h3 className="text-xs font-black text-white uppercase tracking-widest">{t('settings.securityAndVault', 'Security & MPC Vault')}</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="p-5 rounded-xl bg-[#141417] border border-[#1F1F23] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#9945FF]/10 flex items-center justify-center text-[#9945FF] border border-[#9945FF]/20">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-0.5 tracking-tight">{t('settings.sessionManagement', 'Session Key Management')}</h4>
                  <p className="text-[10px] text-[#52525B] font-medium uppercase tracking-wider">{t('settings.tradingEnabledDesc', 'Trading enabled without constant signing')}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowKey(!showKey)}
                className="flex items-center gap-2 px-4 py-2 bg-[#18181B] border border-[#27272A] rounded text-[9px] font-black uppercase text-[#A1A1AA] hover:text-white transition-all"
              >
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showKey ? t('settings.hideAuth', 'Hide Managed Auth') : t('settings.revealAuth', 'Reveal Managed Auth')}
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
                <span className="text-[10px] text-[#71717A] uppercase font-bold tracking-widest">{t('settings.globalSpendingLimit', 'Global Spending Limit')}</span>
                <span className="text-[10px] text-white font-mono">{t('settings.spendingAmount', '15.00 SOL / Month')}</span>
              </div>
              <div className="h-1.5 w-full bg-[#1F1F23] rounded-full">
                <div className="h-full w-[35%] bg-[#9945FF] rounded-full" />
              </div>
            </div>
          </div>
        </section>

        {/* Wallet Linking */}
        <section className="glass-card rounded-2xl border border-[#1F1F23] bg-[#0D0D0E] overflow-hidden">
          <div className="p-6 border-b border-[#1F1F23] flex items-center gap-3 bg-[#141417]/50">
            <Wallet className="w-4 h-4 text-[#00FFD1]" />
            <h3 className="text-xs font-black text-white uppercase tracking-widest">{t('settings.walletBinding', 'Wallet Binding')}</h3>
          </div>

          <div className="p-6 space-y-5">
            <div className="rounded-2xl border border-[#27272A] bg-[#141417] p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-bold text-white">{t('settings.accountWallet', 'Account Wallet')}</p>
                  <p className="text-[11px] text-[#71717A]">{t('settings.walletBindingDesc', 'Link your authenticated account to a Solana wallet for trading and market actions.')}</p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#27272A] bg-[#0D0D0E] px-3 py-1 text-[10px] uppercase tracking-widest text-[#A1A1AA]">
                  <Link2 className="w-3 h-3" />
                  {user?.walletAddress ? t('settings.linked', 'Linked') : t('settings.notLinked', 'Not linked')}
                </div>
              </div>

              {user?.walletAddress ? (
                <div className="space-y-3">
                  <div className="text-[11px] text-[#D4D4D8] font-mono break-all">{user.walletAddress}</div>
                  <button
                    type="button"
                    onClick={handleUnlinkWallet}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#18181B] border border-[#27272A] px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-[#F97316] hover:bg-[#27272A] transition"
                  >
                    <X className="w-4 h-4" />
                    {t('settings.unlinkWallet', 'Unlink Wallet')}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[11px] text-[#A1A1AA]">{t('settings.connectWalletInstruction', 'Connect a wallet and sign a verification message to bind it to your account.')}</p>
                  <button
                    type="button"
                    onClick={handleLinkWallet}
                    disabled={linking}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#00FFD1] px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-black hover:bg-[#a2ffe0] transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Wallet className="w-4 h-4" />
                    {linking ? t('settings.linkingWallet', 'Linking wallet...') : t('settings.linkWallet', 'Link Wallet')}
                  </button>
                </div>
              )}

              {(linkError || linkSuccess) && (
                <div className={cn(
                  'rounded-2xl border px-4 py-3 text-[11px] font-medium',
                  linkError ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                )}>
                  {linkError || linkSuccess}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Network & Infrastructure */}
        <section className="glass-card rounded-2xl border border-[#1F1F23] bg-[#0D0D0E] overflow-hidden">
          <div className="p-6 border-b border-[#1F1F23] flex items-center gap-3 bg-[#141417]/50">
            <Cpu className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-black text-white uppercase tracking-widest">{t('settings.networkArchitecture', 'Network Architecture')}</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1">
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-3 block">{t('settings.rpcCluster', 'RPC Cluster')}</label>
                <div className="relative">
                  <select className="w-full bg-[#18181B] border border-[#27272A] rounded p-3 text-xs font-bold text-white outline-none focus:border-[#00FFD1] appearance-none">
                    <option>{t('settings.lynxOptimized', 'Lynx Optimized (Default)')}</option>
                    <option>{t('settings.heliusManaged', 'Helius Managed RPC')}</option>
                    <option>{t('settings.quicknodePerf', 'Quicknode Performance')}</option>
                    <option>{t('settings.localhost', 'Localhost 8899')}</option>
                  </select>
                  <RefreshCw className="w-3 h-3 absolute right-4 top-1/2 -translate-y-1/2 text-[#52525B]" />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-[#71717A] font-black uppercase tracking-widest mb-3 block">{t('settings.onChainStream', 'On-Chain Data Stream')}</label>
                <div className="p-3 bg-[#141417] border border-[#1F1F23] rounded flex items-center justify-between">
                   <span className="text-[11px] font-mono text-[#00FFD1]">{t('settings.latency', 'LATENCY: 12ms')}</span>
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
          <button 
            onClick={saveSettings}
            className="flex-1 py-4 bg-[#00FFD1] text-black font-black uppercase text-xs tracking-widest rounded shadow-[0_0_20px_rgba(0,255,209,0.2)] hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
            <Save className="w-4 h-4" />
            {t('settings.synchronizeConfig', 'Synchronize Config')}
          </button>
          <button 
            onClick={resetSettings}
            className="px-8 py-4 bg-[#18181B] border border-[#27272A] text-[#71717A] font-bold uppercase text-xs tracking-widest rounded hover:text-white transition-all">
            {t('settings.factoryReset', 'Factory Reset')}
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
