const rawApiUrl = import.meta.env.VITE_API_URL || '';
const AUTH_TOKEN_KEY = 'lynx_auth_token';

export const API_BASE_URL = rawApiUrl.replace(/\/$/, '');

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }
  return data as T;
}
