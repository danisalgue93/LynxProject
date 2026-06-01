import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiUrl } from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  role?: 'admin' | 'user';
  walletAddress?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
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
      setUser(data);
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data));
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
    setToken(data.token);
    setUser(data.user);

    localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const response = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    const data = await response.json();
    setToken(data.token);
    setUser(data.user);

    localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));
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
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));
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
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
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
