/**
 * Shared API client: attaches Bearer auth token and centralizes token storage.
 */
const TOKEN_KEY = 'graywood_auth_token';
const SERVER_URL_KEY = 'graywood_server_url';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}

export function getServerUrl(): string | null {
  try {
    return localStorage.getItem(SERVER_URL_KEY);
  } catch {
    return null;
  }
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

export async function testServerConnection(url: string): Promise<{ success: boolean; isHost?: boolean; version?: string; error?: string }> {
  try {
    const baseUrl = url.trim().replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: data?.status === 'ok', isHost: data?.isHost, version: data?.version };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Connection failed' };
  }
}

export function resolveApiUrl(input: string): string {
  const base = getServerUrl();
  if (base && input.startsWith('/api/')) {
    return `${base}${input}`;
  }
  return input;
}

/**
 * Full logout: revoke the token server-side (its jti is blacklisted) and
 * clear local storage. Best-effort — local clearing always happens even if
 * the server call fails.
 */
export async function logout(): Promise<void> {
  const token = getAuthToken();
  if (token) {
    try {
      await fetch(resolveApiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* offline / server gone — still clear locally */
    }
  }
  clearAuthToken();
}

/**
 * fetch() wrapper that injects Authorization when a token is present.
 * Clears the token on 401 so the UI can fall back to guest.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (init.body != null && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const targetUrl = resolveApiUrl(input);
  const res = await fetch(targetUrl, { ...init, headers });
  if (res.status === 401 && getAuthToken()) {
    clearAuthToken();
  }
  return res;
}
