import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiUrl } from '../lib/api';
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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY_TOKEN = 'lynx_auth_token';
const STORAGE_KEY_USER = 'lynx_auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = (data: { user: AuthUser; token: string }) => {
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));
    if (data.user.authMethod === 'email' && data.user.managedWalletAddress) {
      saveManagedAuthSession({
        provider: 'email-password',
        email: data.user.email,
        walletAddress: data.user.managedWalletAddress,
        loginAt: Date.now(),
      });
    } else {
      clearManagedAuthSession();
    }
  };

  const refreshUser = async () => {
    const storedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (!storedToken) return;

    try {
      const response = await fetch(apiUrl('/auth/me'), {
        headers: {
          Authorization: `Bearer ${storedToken}`
        }
      });
      if (!response.ok) {
        localStorage.removeItem(STORAGE_KEY_TOKEN);
        localStorage.removeItem(STORAGE_KEY_USER);
        setToken(null);
        setUser(null);
        return;
      }
      const data = await response.json();
      // Backend currently returns a bare user object; a future token-rotation
      // response would look like { user, token }. Handle both shapes.
      const userData = data.user ?? data;
      const newToken = data.token ?? null;
      setUser(userData);
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userData));
      if (newToken) {
        setToken(newToken);
        localStorage.setItem(STORAGE_KEY_TOKEN, newToken);
      }
      if (userData.authMethod === 'email' && userData.managedWalletAddress) {
        saveManagedAuthSession({
          provider: 'email-password',
          email: userData.email,
          walletAddress: userData.managedWalletAddress,
          loginAt: Date.now(),
        });
      }
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_USER);
    }
  };

  // Load from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
    const storedUser = localStorage.getItem(STORAGE_KEY_USER);

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      refreshUser().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();
    applySession(data);
  };

  const register = async (email: string, password: string): Promise<{ requiresEmailVerification?: boolean; devVerificationToken?: string; email?: string } | void> => {
    const response = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    const data = await response.json();
    if (data.requiresEmailVerification) {
      return data;
    }
    applySession(data);
  };

  const verifyEmail = async (verificationToken: string) => {
    const response = await fetch(apiUrl('/auth/verify-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verificationToken })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Email verification failed');
    }

    const data = await response.json();
    applySession(data);
  };

  const requestPasswordReset = async (email: string) => {
    const response = await fetch(apiUrl('/auth/request-password-reset'), {
      method: 'POST',
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
    const response = await fetch(apiUrl('/auth/reset-password'), {
      method: 'POST',
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
    const response = await fetch(apiUrl('/auth/change-password'), {
      method: 'POST',
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
    const response = await fetch(apiUrl('/auth/wallet-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signatureMessage, signature }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Wallet login failed');
    }

    const data = await response.json();
    applySession(data);
  };

  const linkWallet = async (wallet: string, signatureMessage: string, signature: string) => {
    if (!token) {
      throw new Error('Authentication required to link wallet');
    }

    const response = await fetch(apiUrl('/auth/link-wallet'), {
      method: 'POST',
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

    const data = await response.json();
    setUser(data);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data));
  };

  const unlinkWallet = async () => {
    if (!token) {
      throw new Error('Authentication required to unlink wallet');
    }

    const response = await fetch(apiUrl('/auth/unlink-wallet'), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Wallet unlink failed');
    }

    const data = await response.json();
    setUser(data);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_USER);
    clearManagedAuthSession();
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
