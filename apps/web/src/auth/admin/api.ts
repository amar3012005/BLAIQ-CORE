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
  // Realistic ages so the Supervisor surfaces aging-quote follow-ups.
  const ago = (days: number): string => new Date(Date.now() - days * day).toISOString();
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
      created_at: ago(9), updated_at: now,
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
      created_at: ago(6), updated_at: now,
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

export interface ServerFile {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface JobNotification {
  id: number;
  kind: string;
  channel: string;
  subject: string;
  body: string;
  status: string;
  created_at: string | null;
}

// List notifications raised for a job (delivery notices, overdue reminders).
export async function listJobNotifications(id: string): Promise<JobNotification[]> {
  if (PREVIEW) {
    return [
      { id: 2, kind: 'payment_overdue', channel: 'log', subject: 'Zahlung überfällig — 2026-014', body: '', status: 'logged', created_at: new Date().toISOString() },
      { id: 1, kind: 'delivery', channel: 'log', subject: 'Lieferung — 2026-014', body: '', status: 'logged', created_at: new Date().toISOString() },
    ];
  }
  const data = await request<unknown>(`/api/jobs/${encodeURIComponent(id)}/notifications`);
  return asArray<JobNotification>(data, 'data');
}

// Create the job's delivery folder on the server (stamps server_folder_path).
export async function createServerFolder(id: string): Promise<Job> {
  if (PREVIEW) {
    const idx = previewStore.findIndex(j => j.id === id);
    const job = idx >= 0 ? previewStore[idx] : undefined;
    if (!job) throw new Error('Job not found');
    const updated = touch({
      ...job,
      server_folder_path: job.server_folder_path || `/data/clients/preview/${job.job_number}`,
    });
    previewStore[idx] = updated;
    return { ...updated };
  }
  const r = await fetch(`${BASE}/api/jobs/${encodeURIComponent(id)}/server-folder`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await r.json().catch(() => ({}))) as { data?: Job; detail?: string; error?: string };
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body.data as Job;
}

// List files in a job's server folder (daemon route, same-origin/session).
export async function listServerFiles(serverFolderPath: string): Promise<ServerFile[]> {
  if (PREVIEW) {
    return [
      { name: '_job.txt', dir: false, size: 64, mtime: Date.now() },
      { name: 'final-delivery', dir: true, size: 0, mtime: Date.now() },
    ];
  }
  const r = await fetch(`/api/v1/org/server/files?path=${encodeURIComponent(serverFolderPath)}`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json().catch(() => ({ files: [] }))) as { files?: ServerFile[] };
  return body.files ?? [];
}

// Create a ClickUp ticket for a job (appends its id to clickup_ticket_ids).
export async function pushJobToClickup(id: string): Promise<Job> {
  if (PREVIEW) {
    const idx = previewStore.findIndex(j => j.id === id);
    const job = idx >= 0 ? previewStore[idx] : undefined;
    if (!job) throw new Error('Job not found');
    const updated = touch({ ...job, clickup_ticket_ids: [...job.clickup_ticket_ids, `T-${++previewSeq}`] });
    previewStore[idx] = updated;
    return { ...updated };
  }
  const r = await fetch(`${BASE}/api/jobs/${encodeURIComponent(id)}/push-clickup`, {
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
  poool_url: 'http://poool-mcp:8000/mcp',
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
// Admin Copilot (Track AA) — grounded chat over live jobs
// ──────────────────────────────────────────────────────────────

export interface CopilotTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotReply {
  answer: string;
  model: string;
}

function fmtEurShort(v: number | null | undefined): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export async function askCopilot(message: string, history: CopilotTurn[] = []): Promise<CopilotReply> {
  if (PREVIEW) {
    const overdue = previewStore.filter(jobIsOverdue);
    const lower = message.toLowerCase();
    let answer: string;
    if (lower.includes('overdue') || lower.includes('risk') || lower.includes('at risk')) {
      answer = overdue.length
        ? `At risk right now:\n${overdue.map(j => `• ${j.job_number} · ${j.client} — invoice ${fmtEurShort(j.invoice_amount ?? j.quote_amount)} is overdue.`).join('\n')}`
        : 'Nothing overdue right now — every invoiced job is within its due date.';
    } else if (lower.includes('summar') || lower.includes('week') || lower.includes('status')) {
      const byStatus = previewStore.reduce<Record<string, number>>((a, j) => { a[j.poool_status] = (a[j.poool_status] ?? 0) + 1; return a; }, {});
      answer = `${previewStore.length} active jobs. Finance: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}. ${overdue.length} overdue.`;
    } else {
      answer = `(preview) I'm grounded in your ${previewStore.length} jobs. Ask me about overdue invoices, margins, delivery status, or what to do next. Live mode answers from real data.`;
    }
    return { answer, model: 'preview' };
  }
  const r = await fetch(`${BASE}/api/copilot`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  const body = (await r.json().catch(() => ({}))) as { data?: CopilotReply; detail?: string; error?: string };
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body.data as CopilotReply;
}

// ── Agentic actions (AA2): copilot proposes a tool call, PM approves (HITL) ──

export interface ProposedAction {
  kind: string;
  job_id: string | null;
  job_number: string | null;
  args: Record<string, unknown>;
  summary: string;
}

export interface CopilotActReply {
  answer: string | null;
  proposed: ProposedAction | null;
  model: string;
}

export async function copilotAct(message: string, history: CopilotTurn[] = []): Promise<CopilotActReply> {
  if (PREVIEW) {
    const lower = message.toLowerCase();
    const verbs: [RegExp, string][] = [
      [/deliver/, 'mark_delivered'],
      [/push.*poool|quote/, 'push_poool'],
      [/push.*clickup|ticket/, 'push_clickup'],
      [/folder/, 'create_server_folder'],
      [/chase|remind|overdue/, 'chase_payment'],
      [/invoic/, 'set_poool_status'],
    ];
    const hit = verbs.find(([re]) => re.test(lower));
    if (hit) {
      const job = previewStore.find(j => lower.includes(j.job_number.toLowerCase()) || lower.includes((j.client || '').toLowerCase())) ?? previewStore[0];
      const kind = hit[1];
      const args = kind === 'set_poool_status' ? { status: 'invoiced' } : {};
      return { answer: null, model: 'preview', proposed: job ? { kind, job_id: job.id, job_number: job.job_number, args, summary: `${kind.replace(/_/g, ' ')} · ${job.job_number}` } : null };
    }
    const reply = await askCopilot(message, history);
    return { answer: reply.answer, model: reply.model, proposed: null };
  }
  const r = await fetch(`${BASE}/api/copilot/act`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  const body = (await r.json().catch(() => ({}))) as { data?: CopilotActReply; detail?: string; error?: string };
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body.data as CopilotActReply;
}

// Execute an approved proposal by routing to the existing job-action endpoints.
export async function runProposedAction(p: ProposedAction): Promise<void> {
  if (!p.job_id) throw new Error(`Couldn't resolve the job for "${p.summary}"`);
  switch (p.kind) {
    case 'mark_delivered': await updateJob(p.job_id, { delivery_status: 'delivered' }); return;
    case 'push_poool': await pushJobToPoool(p.job_id); return;
    case 'push_clickup': await pushJobToClickup(p.job_id); return;
    case 'create_server_folder': await createServerFolder(p.job_id); return;
    case 'chase_payment': await executeNextAction(p.job_id, 'chase_payment'); return;
    case 'set_poool_status': await updateJob(p.job_id, { poool_status: String(p.args.status) as PooolStatus }); return;
    default: throw new Error(`Unknown action: ${p.kind}`);
  }
}

// ── AI Crew (AA5): specialist agents deliberate over one job in parallel ──

export interface CrewFinding {
  id: string;
  agent: string;
  role: string;
  emoji: string;
  assessment: string;
  proposed: ProposedAction | null;
}

export interface CrewDeliberation {
  job_id: string;
  job_number: string;
  title: string;
  findings: CrewFinding[];
  model: string;
}

// Send the crew at one job. Without a job_number, the backend (and preview)
// pick the single most at-risk job to review.
export async function crewDeliberate(jobNumber?: string): Promise<CrewDeliberation> {
  if (PREVIEW) {
    const score = (j: Job): number => {
      if (jobIsOverdue(j)) return 100;
      if ((j.delivery_status === 'delivered' || j.delivery_status === 'archived') &&
          ['quote_pending', 'quote_sent', 'quote_approved'].includes(j.poool_status)) return 80;
      if (['quote_pending', 'quote_sent'].includes(j.poool_status)) return 50;
      return 10;
    };
    const target = (jobNumber && previewStore.find(j => j.job_number === jobNumber))
      || [...previewStore].sort((a, b) => score(b) - score(a))[0];
    if (!target) throw new Error('No jobs to review');
    const prop = (kind: string, args: Record<string, unknown> = {}): ProposedAction =>
      ({ kind, job_id: target.id, job_number: target.job_number, args, summary: `${kind.replace(/_/g, ' ')} · ${target.job_number}` });
    const overdue = jobIsOverdue(target);
    const delivered = target.delivery_status === 'delivered' || target.delivery_status === 'archived';
    const findings: CrewFinding[] = [
      {
        id: 'finance', agent: 'Mara', role: 'Finance Lead', emoji: '💰',
        assessment: overdue
          ? `${target.job_number} is overdue — the ${fmtEurShort(target.invoice_amount ?? target.quote_amount)} invoice is past due and needs collecting now.`
          : delivered && ['quote_pending', 'quote_sent', 'quote_approved'].includes(target.poool_status)
            ? `${target.job_number} is delivered but not invoiced — ${fmtEurShort(target.quote_amount)} is sitting uncollected. Raise the invoice.`
            : `${target.job_number} finance looks healthy: ${target.poool_status.replace(/_/g, ' ')}, margin on track.`,
        proposed: overdue ? prop('chase_payment')
          : (delivered && ['quote_pending', 'quote_sent', 'quote_approved'].includes(target.poool_status)) ? prop('set_poool_status', { status: 'invoiced' })
          : null,
      },
      {
        id: 'delivery', agent: 'Tomas', role: 'Delivery Lead', emoji: '📦',
        assessment: !target.server_folder_path
          ? `${target.job_number} has no delivery folder yet — set one up before assets land.`
          : delivered
            ? `${target.job_number} is delivered and filed under ${target.server_folder_path}. Nothing blocking on my side.`
            : `${target.job_number} is in production (${target.revision_count} revision${target.revision_count === 1 ? '' : 's'}); folder ready at ${target.server_folder_path}.`,
        proposed: !target.server_folder_path ? prop('create_server_folder') : null,
      },
      {
        id: 'account', agent: 'Lena', role: 'Account Manager', emoji: '🤝',
        assessment: ['quote_pending', 'quote_sent'].includes(target.poool_status)
          ? `${target.client}'s quote on ${target.job_number} is still open — worth a follow-up to keep it moving.`
          : `${target.client} relationship on ${target.job_number} is steady; next touchpoint can wait.`,
        proposed: ['quote_pending', 'quote_sent'].includes(target.poool_status) ? prop('push_clickup') : null,
      },
    ];
    return { job_id: target.id, job_number: target.job_number, title: target.title, findings, model: 'preview' };
  }
  const r = await fetch(`${BASE}/api/copilot/crew`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_number: jobNumber ?? null }),
  });
  const body = (await r.json().catch(() => ({}))) as { data?: CrewDeliberation; detail?: string; error?: string };
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body.data as CrewDeliberation;
}

export interface CrewSweep {
  reviewed: number;
  total_jobs: number;
  skipped: number;
  deliberations: CrewDeliberation[];
  model: string;
}

// Send the full crew across the top-N at-risk jobs in one pass (the standup).
export async function crewSweep(limit = 3): Promise<CrewSweep> {
  if (PREVIEW) {
    const score = (j: Job): number => {
      if (jobIsOverdue(j)) return 100;
      if ((j.delivery_status === 'delivered' || j.delivery_status === 'archived') &&
          ['quote_pending', 'quote_sent', 'quote_approved'].includes(j.poool_status)) return 80;
      if (['quote_pending', 'quote_sent'].includes(j.poool_status)) return 50;
      return 10;
    };
    const ranked = [...previewStore].sort((a, b) => score(b) - score(a)).slice(0, limit);
    const deliberations = await Promise.all(ranked.map(j => crewDeliberate(j.job_number)));
    return { reviewed: deliberations.length, total_jobs: previewStore.length, skipped: Math.max(0, previewStore.length - deliberations.length), deliberations, model: 'preview' };
  }
  const r = await fetch(`${BASE}/api/copilot/crew/sweep`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  const body = (await r.json().catch(() => ({}))) as { data?: CrewSweep; detail?: string; error?: string };
  if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`);
  return body.data as CrewSweep;
}

// ── AI Daily Briefing (AA4): proactive Chief-of-Staff digest over the book ──

export interface BriefingInsight {
  severity: 'high' | 'medium' | 'low' | string;
  title: string;
  detail: string;
  job_number: string | null;
  action: string | null;
  // Set when the insight's job maps to a runnable Supervisor action.
  job_id: string | null;
  act_kind: string | null;
  act_label: string | null;
}

export interface Briefing {
  headline: string;
  cash_watch: string;
  insights: BriefingInsight[];
  generated_on: string;
  model: string;
}

export async function getBriefing(): Promise<Briefing> {
  if (PREVIEW) {
    const overdue = previewStore.filter(jobIsOverdue);
    const deliveredUninvoiced = previewStore.filter(j =>
      (j.delivery_status === 'delivered' || j.delivery_status === 'archived') &&
      ['quote_pending', 'quote_sent', 'quote_approved'].includes(j.poool_status));
    const openQuotes = previewStore.filter(j => ['quote_pending', 'quote_sent'].includes(j.poool_status));
    const overdueTotal = overdue.reduce((s, j) => s + (j.invoice_amount ?? j.quote_amount ?? 0), 0);
    const insights: BriefingInsight[] = [];
    for (const j of overdue) {
      insights.push({ severity: 'high', title: `Overdue invoice — ${j.client}`, detail: `${j.job_number} (${j.client}) has an overdue invoice of ${fmtEurShort(j.invoice_amount ?? j.quote_amount)}. Collect it.`, job_number: j.job_number, action: 'Send payment reminder', job_id: j.id, act_kind: 'chase_payment', act_label: 'Chase payment' });
    }
    for (const j of deliveredUninvoiced) {
      insights.push({ severity: 'high', title: `Delivered, not invoiced — ${j.client}`, detail: `${j.job_number} is delivered but still ${j.poool_status.replace(/_/g, ' ')} — ${fmtEurShort(j.quote_amount)} uncollected.`, job_number: j.job_number, action: 'Raise the invoice', job_id: j.id, act_kind: 'invoice', act_label: 'Invoice client' });
    }
    for (const j of openQuotes.slice(0, 2)) {
      insights.push({ severity: 'medium', title: `Open quote — ${j.client}`, detail: `${j.job_number} quote is ${j.poool_status.replace(/_/g, ' ')}; worth a follow-up to keep it moving.`, job_number: j.job_number, action: 'Follow up the quote', job_id: j.id, act_kind: 'follow_up_quote', act_label: 'Follow up quote' });
    }
    if (insights.length === 0) {
      insights.push({ severity: 'low', title: 'All clear', detail: 'No overdue invoices and nothing waiting to be billed. The book is healthy.', job_number: null, action: null, job_id: null, act_kind: null, act_label: null });
    }
    return {
      headline: overdue.length
        ? `${previewStore.length} active jobs — ${overdue.length} need attention, ${fmtEurShort(overdueTotal)} is overdue.`
        : `${previewStore.length} active jobs, all on track.`,
      cash_watch: `${fmtEurShort(overdueTotal)} overdue across ${overdue.length} job${overdue.length === 1 ? '' : 's'}; ${deliveredUninvoiced.length} delivered job${deliveredUninvoiced.length === 1 ? '' : 's'} ready to invoice.`,
      insights: insights.slice(0, 5),
      generated_on: new Date().toISOString().slice(0, 10),
      model: 'preview',
    };
  }
  const data = await request<{ data: Briefing }>('/api/copilot/briefing');
  return data.data;
}

// ──────────────────────────────────────────────────────────────
// POOOL sync summary (live ops.poool_cache) — shown in Finance
// ──────────────────────────────────────────────────────────────

export interface PooolSyncSummary {
  connected: boolean;
  synced_at: string | null;
  projects: number;
  orders: number;
  clients: number;
  recent_orders: { id: string; title: string }[];
}

export interface ActivityItem {
  id: number;
  kind: string;
  subject: string;
  status: string;
  created_at: string | null;
}

// Tenant-wide activity timeline from ops.notifications (delivery, overdue, etc).
export async function getActivity(): Promise<ActivityItem[]> {
  if (PREVIEW) {
    const now = Date.now();
    return [
      { id: 3, kind: 'payment_overdue', subject: 'Zahlung überfällig — 2026-014 Stadtwerke München', status: 'logged', created_at: new Date(now).toISOString() },
      { id: 2, kind: 'delivery', subject: 'Lieferung — 2026-026 Messestand Branding IFA', status: 'logged', created_at: new Date(now - 3_600_000).toISOString() },
      { id: 1, kind: 'invoice_raised', subject: 'Rechnung gestellt — 2026-021 Voss Logistik GmbH', status: 'logged', created_at: new Date(now - 7_200_000).toISOString() },
    ];
  }
  const data = await request<unknown>('/api/copilot/activity');
  return asArray<ActivityItem>(data, 'data');
}

export async function getPooolSummary(): Promise<PooolSyncSummary> {
  if (PREVIEW) {
    return {
      connected: true,
      synced_at: new Date().toISOString(),
      projects: 8,
      orders: 2,
      clients: 12,
      recent_orders: [
        { id: '5', title: 'Markenstrategie' },
        { id: '6', title: 'Geschäftsausstattung' },
      ],
    };
  }
  const data = await request<{ data: PooolSyncSummary }>('/api/copilot/poool-summary');
  return data.data;
}

// ──────────────────────────────────────────────────────────────
// Supervisor — rule-based next-actions queue (Track AA)
// ──────────────────────────────────────────────────────────────

export interface NextAction {
  job_id: string;
  job_number: string;
  client: string;
  kind: string;
  priority: string;
  label: string;
  detail: string;
}

function computePreviewActions(): NextAction[] {
  const today = Date.now();
  const out: NextAction[] = [];
  for (const j of previewStore) {
    const amt = j.invoice_amount ?? j.quote_amount ?? 0;
    if (jobIsOverdue(j)) {
      out.push({ job_id: j.id, job_number: j.job_number, client: j.client || '—', kind: 'chase_payment', priority: 'high', label: 'Chase payment', detail: `${fmtEurShort(amt)} overdue` });
      continue;
    }
    if ((j.delivery_status === 'delivered' || j.delivery_status === 'archived') &&
        ['quote_pending', 'quote_sent', 'quote_approved'].includes(j.poool_status)) {
      out.push({ job_id: j.id, job_number: j.job_number, client: j.client || '—', kind: 'invoice', priority: 'high', label: 'Invoice client', detail: 'Delivered — raise the invoice' });
      continue;
    }
    if (['quote_pending', 'quote_sent'].includes(j.poool_status)) {
      const ageDays = Math.floor((today - new Date(j.created_at).getTime()) / 86_400_000);
      if (ageDays >= 5) out.push({ job_id: j.id, job_number: j.job_number, client: j.client || '—', kind: 'follow_up_quote', priority: 'medium', label: 'Follow up quote', detail: `Quote ${j.poool_status.replace(/_/g, ' ')}` });
    }
  }
  const ord: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => (ord[a.priority] ?? 3) - (ord[b.priority] ?? 3));
}

export async function listNextActions(): Promise<NextAction[]> {
  if (PREVIEW) return computePreviewActions();
  const data = await request<unknown>('/api/copilot/next-actions');
  return asArray<NextAction>(data, 'data');
}

export async function executeNextAction(jobId: string, kind: string): Promise<void> {
  if (PREVIEW) {
    if (kind === 'invoice') {
      const idx = previewStore.findIndex(j => j.id === jobId);
      const job = idx >= 0 ? previewStore[idx] : undefined;
      if (job) previewStore[idx] = touch({ ...job, poool_status: 'invoiced', invoice_amount: job.invoice_amount ?? job.quote_amount });
    }
    return;
  }
  await request('/api/copilot/next-actions/execute', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId, kind }),
  });
}

export interface BatchResult {
  job_id: string;
  kind: string;
  ok: boolean;
  message: string;
}

// AA6 — "Run the Agency": execute the whole approved batch in one pass.
// Each item runs independently server-side; one failure never blocks the rest.
export async function executeNextActionsBatch(
  actions: { job_id: string; kind: string }[],
): Promise<BatchResult[]> {
  if (PREVIEW) {
    return actions.map(a => {
      if (a.kind === 'invoice') {
        const idx = previewStore.findIndex(j => j.id === a.job_id);
        const job = idx >= 0 ? previewStore[idx] : undefined;
        if (job) previewStore[idx] = touch({ ...job, poool_status: 'invoiced', invoice_amount: job.invoice_amount ?? job.quote_amount });
      }
      return { job_id: a.job_id, kind: a.kind, ok: true, message: `${a.kind} done` };
    });
  }
  const data = await request<{ data: BatchResult[] }>('/api/copilot/next-actions/execute-batch', {
    method: 'POST',
    body: JSON.stringify({ actions }),
  });
  return data.data;
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
