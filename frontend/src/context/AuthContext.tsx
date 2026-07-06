import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiUrl, clearAccessToken, setAccessToken } from '../lib/api';
import { clearManagedAuthSession, saveManagedAuthSession } from '../lib/auth';

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  role?: 'admin' | 'user';
  authMethod?: 'email' | 'wallet';
  emailVerified?: boolean;
  walletAddress?: string;
  managedWalletAddress?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ requiresEmailVerification?: boolean; devVerificationToken?: string; email?: string } | void>;
  verifyEmail: (verificationToken: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ devResetToken?: string }>;
  resetPassword: (resetToken: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  loginWithWallet: (wallet: string, signatureMessage: string, signature: string) => Promise<void>;
  logout: () => void;
  linkWallet: (wallet: string, signatureMessage: string, signature: string) => Promise<void>;
  unlinkWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
}

const AUTH_FETCH_TIMEOUT_MS = 30_000;

// This file predates apiFetch() in lib/api.ts and still calls fetch()
// directly, so it never got that helper's AbortController timeout — a
// hung backend left login/register/etc. spinning forever. This mirrors
// the same abort+timeout pattern (and the same timeout error message)
// without switching these calls over to apiFetch() itself, which would
// also pull in apiFetch's automatic Authorization header and 401
// refresh-retry behavior — a bigger behavior change than this fix calls for.
async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = AUTH_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY_USER = 'lynx_auth_user';
const LEGACY_STORAGE_KEY_TOKEN = 'lynx_auth_token';
const LEGACY_STORAGE_KEY_REFRESH = 'lynx_refresh_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const rememberUser = (nextUser: AuthUser) => {
    setUser(nextUser);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(nextUser));
    if (nextUser.authMethod === 'email' && nextUser.managedWalletAddress) {
      saveManagedAuthSession({
        provider: 'email-password',
        email: nextUser.email,
        walletAddress: nextUser.managedWalletAddress,
        loginAt: Date.now(),
      });
    } else {
      clearManagedAuthSession();
    }
  };

  const clearSession = () => {
    setUser(null);
    setToken(null);
    clearAccessToken();
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(LEGACY_STORAGE_KEY_TOKEN);
    localStorage.removeItem(LEGACY_STORAGE_KEY_REFRESH);
    clearManagedAuthSession();
  };

  const applySession = (data: { user: AuthUser; token: string }) => {
    setToken(data.token);
    setAccessToken(data.token);
    rememberUser(data.user);
  };

  const refreshUser = async () => {
    try {
      const response = await fetchWithTimeout(apiUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        clearSession();
        return;
      }
      const data = await response.json();
      applySession(data);
    } catch {
      clearSession();
    }
  };

  useEffect(() => {
    localStorage.removeItem(LEGACY_STORAGE_KEY_TOKEN);
    localStorage.removeItem(LEGACY_STORAGE_KEY_REFRESH);

    const storedUser = localStorage.getItem(STORAGE_KEY_USER);
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem(STORAGE_KEY_USER);
      }
    }

    refreshUser().finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetchWithTimeout(apiUrl('/auth/login'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    applySession(await response.json());
  };

  const register = async (email: string, password: string): Promise<{ requiresEmailVerification?: boolean; devVerificationToken?: string; email?: string } | void> => {
    const response = await fetchWithTimeout(apiUrl('/auth/register'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    const data = await response.json();
    if (data.requiresEmailVerification) return data;
    applySession(data);
  };

  const verifyEmail = async (verificationToken: string) => {
    const response = await fetchWithTimeout(apiUrl('/auth/verify-email'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verificationToken })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Email verification failed');
    }

    applySession(await response.json());
  };

  const requestPasswordReset = async (email: string) => {
    const response = await fetchWithTimeout(apiUrl('/auth/request-password-reset'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Password reset request failed');
    }
    return await response.json();
  };

  const resetPassword = async (resetToken: string, password: string) => {
    const response = await fetchWithTimeout(apiUrl('/auth/reset-password'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Password reset failed');
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!token) throw new Error('Authentication required');
    const response = await fetchWithTimeout(apiUrl('/auth/change-password'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Password change failed');
    }
  };

  const loginWithWallet = async (wallet: string, signatureMessage: string, signature: string) => {
    const response = await fetchWithTimeout(apiUrl('/auth/wallet-login'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signatureMessage, signature }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Wallet login failed');
    }

    applySession(await response.json());
  };

  const linkWallet = async (wallet: string, signatureMessage: string, signature: string) => {
    if (!token) throw new Error('Authentication required to link wallet');

    const response = await fetchWithTimeout(apiUrl('/auth/link-wallet'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ wallet, signatureMessage, signature })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Wallet linking failed');
    }

    rememberUser(await response.json());
  };

  const unlinkWallet = async () => {
    if (!token) throw new Error('Authentication required to unlink wallet');

    const response = await fetchWithTimeout(apiUrl('/auth/unlink-wallet'), {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Wallet unlink failed');
    }

    rememberUser(await response.json());
  };

  const logout = () => {
    fetchWithTimeout(apiUrl('/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
    clearSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        verifyEmail,
        requestPasswordReset,
        resetPassword,
        changePassword,
        loginWithWallet,
        logout,
        linkWallet,
        unlinkWallet,
        refreshUser,
        isAuthenticated: !!user && !!token,
        isAdmin: user?.role === 'admin',
        isLoading
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
