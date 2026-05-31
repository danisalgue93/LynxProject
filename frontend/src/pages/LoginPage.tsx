import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Wallet } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [displayName, setDisplayName] = useState('');

  const navigate = useNavigate();
  const { login, register } = useAuth();
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isRegister) {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-8">
          <h1 className="text-3xl font-bold text-center mb-2 text-emerald-400">Lynx</h1>
          <p className="text-center text-slate-400 mb-8">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </p>

          {error && (
            <div className="mb-4 p-4 bg-red-900 border border-red-700 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400"
                  placeholder="Your display name"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-600 text-white font-semibold py-2 rounded transition-colors"
            >
              {isLoading ? 'Processing...' : isRegister ? 'Register' : 'Login'}
            </button>
          </form>

          <div className="mt-4 p-4 bg-slate-900 border border-slate-700 rounded text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <div className="font-semibold text-slate-100">Wallet connection</div>
                <p className="text-xs text-slate-500">Conecta tu wallet Solana para poder operar tras iniciar sesión.</p>
              </div>
              <button
                type="button"
                onClick={() => setVisible(true)}
                className="inline-flex items-center gap-2 bg-[#00FFD1] text-black text-xs font-bold px-3 py-2 rounded uppercase hover:bg-[#00E5BC] transition-colors"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
            </div>
            {connected ? (
              <div className="text-xs text-[#A1E9D5]">Wallet connected. Ahora podrás realizar trades y duels.</div>
            ) : (
              <div className="text-xs text-slate-500">Si no ves tu wallet, asegúrate de tener Phantom o Solflare instalado.</div>
            )}
          </div>

          <div className="mt-6 text-center">
            <p className="text-slate-400 text-sm">
              {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError('');
                }}
                className="text-emerald-400 hover:text-emerald-300 font-medium"
              >
                {isRegister ? 'Login' : 'Register'}
              </button>
            </p>
          </div>
        </div>

        {import.meta.env.DEV && (
          <div className="mt-8 text-center text-slate-400 text-sm">
            <p>Use the configured local admin credentials.</p>
          </div>
        )}
      </div>
    </div>
  );
}
