const rawApiUrl = import.meta.env.VITE_API_URL || '';
const AUTH_TOKEN_KEY = 'lynx_auth_token';
const REFRESH_TOKEN_KEY = 'lynx_refresh_token';

export const API_BASE_URL = rawApiUrl.replace(/\/$/, '');

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

// Default timeout: 30 seconds
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Attempt a silent token refresh using the stored refresh token.
 * Returns the new access token, or null if refresh fails.
 */
async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  try {
    const response = await fetch(apiUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      if (data.refreshToken) {
        window.localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      }
      return data.token as string;
    }
    return null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...restInit } = init ?? {};
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const doFetch = async (accessToken: string | null) => {
    return fetch(apiUrl(path), {
      ...restInit,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(restInit?.headers || {}),
      },
      signal: controller.signal,
    });
  };

  try {
    let response = await doFetch(token);

    // On 401, attempt a silent refresh and retry once
    if (response.status === 401 && token) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        // Reset abort controller for retry
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), timeoutMs);
        try {
          response = await fetch(apiUrl(path), {
            ...restInit,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${newToken}`,
              ...(restInit?.headers || {}),
            },
            signal: retryController.signal,
          });
        } finally {
          clearTimeout(retryTimeout);
        }
      } else {
        // Refresh failed — clear local session
        window.localStorage.removeItem(AUTH_TOKEN_KEY);
        window.localStorage.removeItem(REFRESH_TOKEN_KEY);
      }
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with ${response.status}`);
    }
    return data as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
