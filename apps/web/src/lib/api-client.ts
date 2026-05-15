// Authenticated API client for runtime data fetches (project files,
// chat SSE, etc.). Mirrors `src/shared/api-client.ts` style: cookie
// session auth, `credentials: include`, no token attached. EventSource
// streams just need credentials enabled at construction time.

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${API_BASE}${path}`;
}

export interface ApiFetchOptions extends RequestInit {
  expectOk?: boolean;
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });
  if (options.expectOk && !res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || res.statusText);
  }
  return res;
}

export async function apiJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(path, { ...options, expectOk: true });
  return (await res.json()) as T;
}

/**
 * EventSource that includes credentials. Use this for SSE endpoints
 * like /api/chat. Same-site cookies flow because the API lives on a
 * registrable-domain-adjacent host (api.<domain>).
 */
export function apiEventSource(path: string): EventSource {
  return new EventSource(apiUrl(path), { withCredentials: true });
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(`API ${status}: ${message}`);
    this.name = 'ApiError';
  }
}
