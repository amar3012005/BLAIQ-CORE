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

export interface CostItem {
  vendor: string;
  amount: number;
}

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
  cost_items: CostItem[];
  invoice_amount?: number | null;
  payment_due_date?: string | null;
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
  cost_items?: CostItem[];
  invoice_amount?: number;
  payment_due_date?: string | null;
  clickup_folder_id?: string;
  clickup_ticket_ids?: string[];
  revision_count?: number;
  server_folder_path?: string;
  delivery_status?: DeliveryStatus;
  notes?: string;
}

// ──────────────────────────────────────────────────────────────
// Finance helpers (shared by JobBoard + FinanceBoard)
// ──────────────────────────────────────────────────────────────

// The agency adds a 15% production fee (Produktionshonorar) on top of the
// collected third-party costs — see the project workflow PDF.
export const PRODUCTION_FEE_RATE = 0.15;

export function costItemsTotal(items: CostItem[] | undefined): number {
  if (!items) return 0;
  return items.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

export function withProductionFee(net: number): number {
  return net * (1 + PRODUCTION_FEE_RATE);
}

// A job is overdue when it has been invoiced (but not yet paid) and its
// payment due date is in the past. Computed client-side so the badge reacts
// immediately, ahead of the nightly POOOL payment check (Phase 3, task 10).
export function jobIsOverdue(job: Job): boolean {
  if (job.poool_status === 'paid') return false;
  if (job.poool_status === 'overdue') return true;
  if (job.poool_status !== 'invoiced' && job.poool_status !== 'partially_paid') return false;
  if (!job.payment_due_date) return false;
  const due = new Date(`${job.payment_due_date}T23:59:59`);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
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
// Preview mode — in-memory demo store
//
// The real Admin surface lives behind auth + the daemon proxy, so the
// /admin-preview route (and anything that just wants to render the UI with
// realistic data) flips this on. When enabled, the Job CRUD functions never
// touch the network — they operate on a seeded in-memory store instead.
// ──────────────────────────────────────────────────────────────

let PREVIEW = false;

export function enablePreviewMode(): void {
  PREVIEW = true;
}

export function isPreviewMode(): boolean {
  return PREVIEW;
}

let previewSeq = 100;
const previewStore: Job[] = seedPreviewJobs();

function seedPreviewJobs(): Job[] {
  const now = new Date().toISOString();
  const day = 86_400_000;
  const iso = (offsetDays: number): string =>
    new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
  return [
    {
      id: 'job-001', job_number: '2026-014', title: 'Frühjahrskampagne Plakatserie',
      client: 'Stadtwerke München', poool_status: 'invoiced', poool_job_id: 'P-1041',
      quote_amount: 12500, third_party_costs: 3200,
      cost_items: [
        { vendor: 'Druckerei Hofmann', amount: 2400 },
        { vendor: 'Fotografie Lang', amount: 800 },
      ],
      invoice_amount: 12500, payment_due_date: iso(-9),
      clickup_folder_id: 'CU-9001', clickup_ticket_ids: ['T-3301', 'T-3302'],
      revision_count: 2, server_folder_path: '/Clients/Stadtwerke/2026-014',
      delivery_status: 'delivered', delivered_at: now,
      notes: 'Großflächenplakate + City-Light-Poster. Reinzeichnung freigegeben.',
      created_at: now, updated_at: now,
    },
    {
      id: 'job-002', job_number: '2026-021', title: 'Geschäftsbericht 2025',
      client: 'Voss Logistik GmbH', poool_status: 'quote_sent', poool_job_id: 'P-1052',
      quote_amount: 8400, third_party_costs: 0, cost_items: [],
      invoice_amount: null, payment_due_date: null,
      clickup_folder_id: 'CU-9014', clickup_ticket_ids: ['T-3410'],
      revision_count: 0, server_folder_path: '/Clients/Voss/2026-021',
      delivery_status: 'in_progress', delivered_at: null,
      notes: '64-seitiger Bericht, Layout + Satz.',
      created_at: now, updated_at: now,
    },
    {
      id: 'job-003', job_number: '2026-026', title: 'Messestand Branding IFA',
      client: 'Nordlicht Audio', poool_status: 'quote_pending',
      quote_amount: null, third_party_costs: 0, cost_items: [],
      invoice_amount: null, payment_due_date: null,
      clickup_folder_id: null, clickup_ticket_ids: [],
      revision_count: 0, server_folder_path: null,
      delivery_status: 'in_progress', delivered_at: null,
      notes: 'Erstanfrage über Protonet. Briefing-Call ausstehend.',
      created_at: now, updated_at: now,
    },
    {
      id: 'job-004', job_number: '2026-009', title: 'Rebranding Webauftritt',
      client: 'Café Mehlwald', poool_status: 'paid', poool_job_id: 'P-1028',
      quote_amount: 6200, third_party_costs: 450,
      cost_items: [{ vendor: 'Lizenz Schriftart', amount: 450 }],
      invoice_amount: 6200, payment_due_date: iso(-30),
      clickup_folder_id: 'CU-8890', clickup_ticket_ids: ['T-3105'],
      revision_count: 1, server_folder_path: '/Clients/Mehlwald/2026-009',
      delivery_status: 'archived', delivered_at: now,
      notes: 'Abgeschlossen und bezahlt.',
      created_at: now, updated_at: now,
    },
  ];
}

function touch(job: Job): Job {
  return { ...job, updated_at: new Date().toISOString() };
}

export async function listJobs(): Promise<Job[]> {
  if (PREVIEW) return previewStore.map(j => ({ ...j }));
  const data = await request<unknown>('/api/jobs');
  return asArray<Job>(data, 'data');
}

export async function getJob(id: string): Promise<Job | null> {
  if (PREVIEW) return previewStore.find(j => j.id === id) ?? null;
  try {
    const data = await request<{ data?: Job }>(`/api/jobs/${encodeURIComponent(id)}`);
    return data.data ?? null;
  } catch {
    return null;
  }
}

export async function createJob(body: JobCreate): Promise<Job> {
  if (PREVIEW) {
    const now = new Date().toISOString();
    const job: Job = {
      id: `job-${++previewSeq}`,
      job_number: body.job_number,
      title: body.title,
      client: body.client ?? '',
      poool_status: 'quote_pending',
      poool_job_id: body.poool_job_id ?? null,
      quote_amount: body.quote_amount ?? null,
      third_party_costs: 0,
      cost_items: [],
      invoice_amount: null,
      payment_due_date: null,
      clickup_folder_id: null,
      clickup_ticket_ids: [],
      revision_count: 0,
      server_folder_path: null,
      delivery_status: 'in_progress',
      delivered_at: null,
      notes: body.notes ?? '',
      created_at: now,
      updated_at: now,
    };
    previewStore.unshift(job);
    return { ...job };
  }
  const data = await request<{ data: Job }>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.data;
}

export async function updateJob(id: string, body: JobUpdate): Promise<Job> {
  if (PREVIEW) {
    const idx = previewStore.findIndex(j => j.id === id);
    if (idx < 0) throw new Error(`PATCH /api/jobs/${id} failed: HTTP 404`);
    const merged: Job = touch({ ...previewStore[idx], ...body } as Job);
    // Mirror backend behaviour: cost_items drives the third-party total, and
    // delivering stamps delivered_at.
    if (body.cost_items) {
      merged.third_party_costs = Math.round(costItemsTotal(body.cost_items) * 100) / 100;
    }
    if (body.delivery_status === 'delivered' && !merged.delivered_at) {
      merged.delivered_at = new Date().toISOString();
    }
    previewStore[idx] = merged;
    return { ...merged };
  }
  const data = await request<{ data: Job }>(`/api/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return data.data;
}

export async function deleteJob(id: string): Promise<void> {
  if (PREVIEW) {
    const idx = previewStore.findIndex(j => j.id === id);
    if (idx >= 0) previewStore.splice(idx, 1);
    return;
  }
  await request(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Push a job to POOOL (create project + quote). Surfaces the server's graceful
// detail (e.g. "POOOL not enabled") so the UI can show a clear message.
export async function pushJobToPoool(id: string): Promise<Job> {
  if (PREVIEW) {
    const idx = previewStore.findIndex(j => j.id === id);
    const job = idx >= 0 ? previewStore[idx] : undefined;
    if (!job) throw new Error('Job not found');
    const updated = touch({
      ...job,
      poool_job_id: job.poool_job_id || `P-${++previewSeq}`,
      poool_status: job.poool_status === 'quote_pending' ? 'quote_sent' : job.poool_status,
    });
    previewStore[idx] = updated;
    return { ...updated };
  }
  const r = await fetch(`${BASE}/api/jobs/${encodeURIComponent(id)}/push-poool`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await r.json().catch(() => ({}))) as { data?: Job; detail?: string; error?: string };
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body.data as Job;
}

// ──────────────────────────────────────────────────────────────
// Org integrations (POOOL + ClickUp) — Settings tab
//
// These persist into tenant_brand via the daemon's /api/v1/org/brand route
// (same-origin, session-authed) — NOT the admin proxy. API keys are write-
// only: the server returns a masked preview + a "set" flag, never the raw key.
// ──────────────────────────────────────────────────────────────

const ORG_BRAND = '/api/v1/org/brand';

export interface OrgIntegrations {
  poool_url: string;
  poool_api_key_set: boolean;
  poool_api_key_preview: string;
  poool_enabled: boolean;
  clickup_enabled: boolean;
  clickup_list_id: string;
}

export interface OrgIntegrationsUpdate {
  poool_url?: string;
  poool_api_key?: string;
  poool_enabled?: boolean;
  clickup_enabled?: boolean;
  clickup_list_id?: string;
}

function toIntegrations(d: Record<string, unknown>): OrgIntegrations {
  return {
    poool_url: typeof d.poool_url === 'string' ? d.poool_url : '',
    poool_api_key_set: Boolean(d.poool_api_key_set),
    poool_api_key_preview: typeof d.poool_api_key_preview === 'string' ? d.poool_api_key_preview : '',
    poool_enabled: Boolean(d.poool_enabled),
    clickup_enabled: Boolean(d.clickup_enabled),
    clickup_list_id: typeof d.clickup_list_id === 'string' ? d.clickup_list_id : '',
  };
}

const previewIntegrations: OrgIntegrations = {
  poool_url: 'http://poool-mcp:8888',
  poool_api_key_set: false,
  poool_api_key_preview: '',
  poool_enabled: false,
  clickup_enabled: false,
  clickup_list_id: '',
};

export async function getOrgIntegrations(): Promise<OrgIntegrations> {
  if (PREVIEW) return { ...previewIntegrations };
  const r = await fetch(ORG_BRAND, { credentials: 'include' });
  if (!r.ok) throw new Error(`GET ${ORG_BRAND} failed: HTTP ${r.status}`);
  return toIntegrations((await r.json()) as Record<string, unknown>);
}

export async function updateOrgIntegrations(body: OrgIntegrationsUpdate): Promise<OrgIntegrations> {
  if (PREVIEW) {
    if (body.poool_url !== undefined) previewIntegrations.poool_url = body.poool_url;
    if (body.poool_api_key) {
      previewIntegrations.poool_api_key_set = true;
      previewIntegrations.poool_api_key_preview = `${body.poool_api_key.slice(0, 4)}…${body.poool_api_key.slice(-4)}`;
    }
    if (body.poool_enabled !== undefined) previewIntegrations.poool_enabled = body.poool_enabled;
    if (body.clickup_enabled !== undefined) previewIntegrations.clickup_enabled = body.clickup_enabled;
    if (body.clickup_list_id !== undefined) previewIntegrations.clickup_list_id = body.clickup_list_id;
    return { ...previewIntegrations };
  }
  const r = await fetch(ORG_BRAND, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${ORG_BRAND} failed: HTTP ${r.status}`);
  return toIntegrations((await r.json()) as Record<string, unknown>);
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
