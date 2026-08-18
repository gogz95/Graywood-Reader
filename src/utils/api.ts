/**
 * Shared API client: attaches Bearer auth token and centralizes token storage.
 */
const TOKEN_KEY = 'graywood_auth_token';

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

  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && getAuthToken()) {
    clearAuthToken();
  }
  return res;
}
