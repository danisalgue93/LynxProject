import { useEffect, useState } from 'react';

export type ManagedAuthSession = {
  provider: 'email-password' | 'magic-email';
  email?: string;
  // Issued by the backend; absent until the account's email is verified.
  walletAddress?: string;
  loginAt: number;
};
// `issuer` was removed: nothing ever wrote or read it. Its only consumer was the
// deleted `MAGIC:${issuer}` address fabrication in getManagedWalletAddress.

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

/**
 * The managed wallet address the backend issued for this session, or null.
 *
 * Only the backend can mint this value: it is `MAGIC:` + the first 32 hex chars
 * of sha256(`${userId}:${email}`) (see managedWalletForUser in
 * backend/src/server.ts), and the API validates it against
 * /^MAGIC:[0-9a-f]{32}$/.
 *
 * This used to fall back to `MAGIC:${session.email}` when the session carried no
 * walletAddress. That address can never be correct — it is neither the hash the
 * backend derives nor a shape the API accepts — so every request built on it
 * came back "400 Invalid wallet address format". The fallback fired for real
 * users: in production the backend only issues managedWalletAddress once the
 * email is verified, so any freshly-registered account hit it.
 *
 * Returning null instead surfaces the true state — "this session has no wallet
 * yet" — and lets callers show that, rather than firing off a request that is
 * guaranteed to fail with a message about address formats.
 */
export function getManagedWalletAddress(session = getManagedAuthSession()) {
  return session?.walletAddress ?? null;
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
