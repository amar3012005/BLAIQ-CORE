// Typed API client for the BLAIQ Admin (Ops Brain) surface.
// All calls go through the daemon proxy at /api/v1/admin/*, which injects
// X-Tenant-Id from the authenticated session.

const BASE = '/api/v1/admin';

export interface AdminProject {
  id: string;
  name: string;
  status?: string;
  team_id?: string;
  created_at?: string | number;
  description?: string | null;
}

export interface AdminTask {
  id: string;
  title: string;
  horizon?: 'short' | 'mid' | 'long' | string;
  priority?: string | number;
  assignee?: string | null;
  status?: string;
  project_id?: string;
}

export interface AdminAgent {
  id: string;
  name: string;
  role?: string;
  template_id?: string;
  trust_score?: number;
  status?: string;
}

export interface AdminAgentTemplate {
  id: string;
  name: string;
  category?: string;
  description?: string;
}

export interface AdminMeeting {
  id: string;
  topic: string;
  template?: string;
  status?: string;
  started_at?: string | number;
  team_id?: string;
}

export interface AdminMeetingMessage {
  id: string;
  agent?: string;
  role?: string;
  content: string;
  created_at?: string | number;
}

export interface AdminActivity {
  id: string;
  type: string;
  agent?: string;
  details?: unknown;
  created_at?: string | number;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!r.ok) {
    throw new Error(`GET ${path} failed: HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

function asArray<T>(value: unknown, key?: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (key && Array.isArray(obj[key])) return obj[key] as T[];
    for (const k of ['items', 'data', 'results']) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
  }
  return [];
}

export async function listProjects(): Promise<AdminProject[]> {
  const data = await getJson<unknown>('/api/projects');
  return asArray<AdminProject>(data, 'projects');
}

export async function getProject(id: string): Promise<AdminProject | null> {
  try {
    return await getJson<AdminProject>(`/api/projects/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function listTasksForTeam(teamId: string): Promise<AdminTask[]> {
  const data = await getJson<unknown>(
    `/api/teams/${encodeURIComponent(teamId)}/task-wall`,
  );
  return asArray<AdminTask>(data, 'tasks');
}

export async function listAgentsForTeam(teamId: string): Promise<AdminAgent[]> {
  const data = await getJson<unknown>(
    `/api/teams/${encodeURIComponent(teamId)}/agents`,
  );
  return asArray<AdminAgent>(data, 'agents');
}

export async function listAgentTemplates(): Promise<AdminAgentTemplate[]> {
  const data = await getJson<unknown>('/api/agent-templates');
  return asArray<AdminAgentTemplate>(data, 'templates');
}

export async function listMeetingsForTeam(teamId: string): Promise<AdminMeeting[]> {
  const data = await getJson<unknown>(
    `/api/teams/${encodeURIComponent(teamId)}/meetings`,
  );
  return asArray<AdminMeeting>(data, 'meetings');
}

export async function getMeetingMessages(
  meetingId: string,
): Promise<AdminMeetingMessage[]> {
  const data = await getJson<unknown>(
    `/api/meetings/${encodeURIComponent(meetingId)}/messages`,
  );
  return asArray<AdminMeetingMessage>(data, 'messages');
}

export async function listActivities(): Promise<AdminActivity[]> {
  const data = await getJson<unknown>('/api/activities');
  return asArray<AdminActivity>(data, 'activities');
}

export interface ActivityStreamHandle {
  close: () => void;
}

/**
 * Subscribe to live activities. Tries SSE first; falls back to polling
 * every 3 s if EventSource is unavailable or the endpoint 404s.
 */
export function streamActivities(
  onEvent: (event: AdminActivity) => void,
  onError?: (err: Error) => void,
): ActivityStreamHandle {
  let closed = false;
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const startPolling = (): void => {
    let lastIds = new Set<string>();
    const tick = async (): Promise<void> => {
      if (closed) return;
      try {
        const items = await listActivities();
        const nextIds = new Set<string>();
        for (const item of items) {
          nextIds.add(item.id);
          if (!lastIds.has(item.id)) onEvent(item);
        }
        lastIds = nextIds;
      } catch (err) {
        if (onError) onError(err as Error);
      }
    };
    void tick();
    pollTimer = setInterval(() => {
      void tick();
    }, 3000);
  };

  try {
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`${BASE}/v1/stream`, { withCredentials: true });
      es.onmessage = (ev: MessageEvent<string>): void => {
        try {
          const parsed = JSON.parse(ev.data) as AdminActivity;
          onEvent(parsed);
        } catch {
          // ignore malformed frames
        }
      };
      es.onerror = (): void => {
        if (closed) return;
        es?.close();
        es = null;
        startPolling();
      };
    } else {
      startPolling();
    }
  } catch (err) {
    if (onError) onError(err as Error);
    startPolling();
  }

  return {
    close: (): void => {
      closed = true;
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}
