import { useEffect, useState } from 'react';

export type ManagedAuthSession = {
  provider: 'magic-email' | 'magic-google';
  email?: string;
  issuer?: string;
  loginAt: number;
};

const SESSION_KEY = 'lynx_managed_auth_session';

export function saveManagedAuthSession(session: ManagedAuthSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('lynx:managed-auth', { detail: session }));
}

export function getManagedAuthSession(): ManagedAuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as ManagedAuthSession : null;
  } catch {
    return null;
  }
}

export function clearManagedAuthSession() {
  window.localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('lynx:managed-auth', { detail: null }));
}

export function getManagedWalletAddress(session = getManagedAuthSession()) {
  if (!session) return null;
  const stableId = session.issuer || session.email;
  return stableId ? `MAGIC:${stableId}` : null;
}

export function useManagedAuthSession() {
  const [session, setSession] = useState<ManagedAuthSession | null>(() => getManagedAuthSession());

  useEffect(() => {
    const onManagedAuth = () => setSession(getManagedAuthSession());
    window.addEventListener('lynx:managed-auth', onManagedAuth as EventListener);
    window.addEventListener('storage', onManagedAuth);
    return () => {
      window.removeEventListener('lynx:managed-auth', onManagedAuth as EventListener);
      window.removeEventListener('storage', onManagedAuth);
    };
  }, []);

  return session;
}
