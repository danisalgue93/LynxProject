const rawApiUrl = import.meta.env.VITE_API_URL || '';

export const API_BASE_URL = rawApiUrl.replace(/\/$/, '');

if (typeof window !== 'undefined' && import.meta.env.PROD && !API_BASE_URL) {
  console.error(
    '[lynx] VITE_API_URL is not set in production. API calls will fail. ' +
    'Set it in your .env or build arguments.'
  );
}

// Singleton access token for the current authenticated session.
// When multiple concurrent requests trigger a 401 + refresh, they all share
// the same refresh promise (see tryRefreshToken) so only one refresh is
// sent. After refresh, the new token is immediately available to all callers.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

const DEFAULT_TIMEOUT_MS = 30_000;

let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const response = await fetch(apiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.token) {
      setAccessToken(data.token);
      return data.token as string;
    }
    return null;
  } catch {
    return null;
  }
}

async function tryRefreshToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...restInit } = init ?? {};
  const token = getAccessToken();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const doFetch = async (currentToken: string | null, signal: AbortSignal) => {
    return fetch(apiUrl(path), {
      ...restInit,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
        ...(restInit?.headers || {}),
      },
      signal,
    });
  };

  try {
    let response = await doFetch(token, controller.signal);

    if (response.status === 401) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), timeoutMs);
        try {
          response = await doFetch(newToken, retryController.signal);
        } finally {
          clearTimeout(retryTimeout);
        }
      } else {
        clearAccessToken();
      }
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with ${response.status}`);
    }
    return data as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.', { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
