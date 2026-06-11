// Typed API client for the BLAIQ Admin surface.
// All calls go through the daemon proxy at /api/v1/admin/*, which injects
// X-Tenant-Id from the authenticated session.

const BASE = '/api/v1/admin';

// ──────────────────────────────────────────────────────────────
// Job — central entity of the BLAIQ project workflow
// ──────────────────────────────────────────────────────────────

export type PooolStatus =
  | 'quote_pending'
  | 'quote_sent'
  | 'quote_approved'
  | 'invoiced'
  | 'partially_paid'
  | 'paid'
  | 'overdue';

export type DeliveryStatus = 'in_progress' | 'delivered' | 'archived';

export interface Job {
  id: string;
  job_number: string;
  title: string;
  client: string;
  // POOOL track
  poool_status: PooolStatus;
  poool_job_id?: string | null;
  quote_amount?: number | null;
  third_party_costs?: number | null;
  invoice_amount?: number | null;
  // ClickUp track
  clickup_folder_id?: string | null;
  clickup_ticket_ids: string[];
  revision_count: number;
  // Server track
  server_folder_path?: string | null;
  delivery_status: DeliveryStatus;
  delivered_at?: string | null;
  // Meta
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface JobCreate {
  job_number: string;
  title: string;
  client?: string;
  poool_job_id?: string;
  quote_amount?: number;
  notes?: string;
}

export interface JobUpdate {
  title?: string;
  client?: string;
  poool_status?: PooolStatus;
  poool_job_id?: string;
  quote_amount?: number;
  third_party_costs?: number;
  invoice_amount?: number;
  clickup_folder_id?: string;
  clickup_ticket_ids?: string[];
  revision_count?: number;
  server_folder_path?: string;
  delivery_status?: DeliveryStatus;
  notes?: string;
}

// ──────────────────────────────────────────────────────────────
// Activity stream (kept from original — used by ActivityFeed)
// ──────────────────────────────────────────────────────────────

export interface AdminActivity {
  id: string;
  type: string;
  agent?: string;
  details?: unknown;
  created_at?: string | number;
}

// ──────────────────────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: HTTP ${r.status}`);
  return (await r.json()) as T;
}

function asArray<T>(value: unknown, key?: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (key && Array.isArray(obj[key])) return obj[key] as T[];
    for (const k of ['data', 'items', 'results']) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
  }
  return [];
}

// ──────────────────────────────────────────────────────────────
// Job API
// ──────────────────────────────────────────────────────────────

export async function listJobs(): Promise<Job[]> {
  const data = await request<unknown>('/api/jobs');
  return asArray<Job>(data, 'data');
}

export async function getJob(id: string): Promise<Job | null> {
  try {
    const data = await request<{ data?: Job }>(`/api/jobs/${encodeURIComponent(id)}`);
    return data.data ?? null;
  } catch {
    return null;
  }
}

export async function createJob(body: JobCreate): Promise<Job> {
  const data = await request<{ data: Job }>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.data;
}

export async function updateJob(id: string, body: JobUpdate): Promise<Job> {
  const data = await request<{ data: Job }>(`/api/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return data.data;
}

export async function deleteJob(id: string): Promise<void> {
  await request(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ──────────────────────────────────────────────────────────────
// Activity API
// ──────────────────────────────────────────────────────────────

export async function listActivities(): Promise<AdminActivity[]> {
  const data = await request<unknown>('/api/activities');
  return asArray<AdminActivity>(data, 'activities');
}

export interface ActivityStreamHandle {
  close: () => void;
}

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
    pollTimer = setInterval(() => { void tick(); }, 3000);
  };

  try {
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`${BASE}/v1/stream`, { withCredentials: true });
      es.onmessage = (ev: MessageEvent<string>): void => {
        try { onEvent(JSON.parse(ev.data) as AdminActivity); } catch { /* ignore */ }
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
