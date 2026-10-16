// ============================================================================
// src/utils/apiConfig.ts — Dynamic Frontend API Configuration & Base URL Resolver
// Supports homelab desktop Tauri instances, remote tablets, and relative PWA origins.
// ============================================================================

export const SERVER_URL_KEY = 'graywood_server_url';

/**
 * Returns the active API server base URL.
 * Checks localStorage first, then VITE_API_BASE_URL environment variable,
 * defaulting to null (which indicates relative same-origin API calls for web/PWA).
 */
export function getServerUrl(): string | null {
  try {
    const stored = localStorage.getItem(SERVER_URL_KEY);
    if (stored) return stored.trim().replace(/\/+$/, '');
  } catch {
    /* private mode / blocked storage */
  }

  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) {
      const envUrl = String((import.meta as any).env.VITE_API_BASE_URL).trim();
      if (envUrl) return envUrl.replace(/\/+$/, '');
    }
  } catch {
    /* env not available */
  }

  return null;
}

export function setServerUrl(url: string | null): void {
  try {
    if (url) {
      const normalized = url.trim().replace(/\/+$/, '');
      localStorage.setItem(SERVER_URL_KEY, normalized);
    } else {
      localStorage.removeItem(SERVER_URL_KEY);
    }
  } catch {}
}

export function getApiBaseUrl(): string {
  return getServerUrl() || '';
}

export function resolveApiUrl(input: string): string {
  const base = getServerUrl();
  if (base && input.startsWith('/api/')) {
    return `${base}${input}`;
  }
  return input;
}
