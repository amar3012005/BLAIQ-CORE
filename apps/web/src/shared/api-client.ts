// apiClient mirror of HIVEMIND/BLAIQ shared/api-client.js, adapted for
// the Open Design daemon. Cookie-session based (credentials: include);
// the daemon issues `od_session` on /api/v1/auth/login.

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${API_BASE}${path}`;
}

export class HttpError extends Error {
  readonly response: { status: number; data?: unknown };
  constructor(status: number, data?: unknown) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.response = { status, data };
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: payload,
      credentials: 'include',
    });
  } catch (err) {
    // Network error → no .response so the AuthProvider can switch to
    // backend_unreachable.
    throw new Error((err as Error).message || 'network error');
  }
  if (!response.ok) {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    throw new HttpError(response.status, data);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface BootstrapData {
  user: { id: string; email: string; display_name: string; role: string };
  organization: { id: string; name: string; slug: string };
  roles: string[];
  permissions: string[];
  workspace_memberships: Array<{ id: string; name: string; slug: string; role: string }>;
  feature_flags: Record<string, boolean>;
  onboarding: { completed: boolean; step: string } | null;
  connectivity: { core_api_base_url: string; core_health: string } | null;
  client_support: string[];
}

const apiClient = {
  bootstrap(): Promise<BootstrapData> {
    return request<BootstrapData>('GET', '/api/v1/auth/bootstrap');
  },
  login(input: { email: string; password: string }): Promise<BootstrapData> {
    return request<BootstrapData>('POST', '/api/v1/auth/login', input);
  },
  signup(input: {
    email: string;
    password: string;
    display_name?: string;
    tenant_name?: string;
  }): Promise<BootstrapData> {
    return request<BootstrapData>('POST', '/api/v1/auth/signup', input);
  },
  refresh(): Promise<BootstrapData> {
    return request<BootstrapData>('POST', '/api/v1/auth/refresh');
  },
  logout(): Promise<void> {
    return request<void>('POST', '/api/v1/auth/logout');
  },
  getLoginUrl(returnPath?: string): string {
    const qs = returnPath ? `?next=${encodeURIComponent(returnPath)}` : '';
    return `/login${qs}`;
  },
  apiUrl,
};

export default apiClient;
