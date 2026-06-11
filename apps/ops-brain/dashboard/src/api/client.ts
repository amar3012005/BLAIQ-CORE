const API_BASE = import.meta.env.VITE_API_URL || '';

export const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws/events`;

// Global project context — set by ProjectContext, read by apiFetch
let currentProjectPath: string | null = null;
let currentProjectId: string | null = null;

export function setCurrentProjectPath(path: string | null) {
  currentProjectPath = path;
}

export function setCurrentProjectId(id: string | null) {
  currentProjectId = id;
}

export function getCurrentProjectPath(): string | null {
  return currentProjectPath;
}

export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const projectHeaders: Record<string, string> = {};
  // HTTP headers must be ISO-8859-1 (RFC 7230). CJK paths (e.g. "C:/Users/TUF/Desktop/AI团队框架")
  // would crash fetch with "non ISO-8859-1 code point". X-Project-Id (UUID) is always ASCII-safe
  // and sufficient for project isolation; X-Project-Dir is a cwd-fallback for MCP/Hook tools.
  if (currentProjectPath && /^[\x00-\x7F]*$/.test(currentProjectPath)) {
    projectHeaders['X-Project-Dir'] = currentProjectPath;
  }
  if (currentProjectId) projectHeaders['X-Project-Id'] = currentProjectId;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...projectHeaders, ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || error.error || 'API request failed');
  }
  return res.json();
}
