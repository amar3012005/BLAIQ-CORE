// BLAIQ Admin · Job Board — tri-track view of all active jobs.
// Each job row shows live status across POOOL (finance), ClickUp (tasks), Server (files).

'use client';

import React, { useEffect, useState } from 'react';
import {
  listJobs,
  updateJob,
  createJob,
  pushJobToPoool,
  pushJobToClickup,
  createServerFolder,
  generateCampaign,
  type Campaign,
  listServerFiles,
  listJobNotifications,
  type ServerFile,
  type JobNotification,
  costItemsTotal,
  withProductionFee,
  jobIsOverdue,
  PRODUCTION_FEE_RATE,
  type Job,
  type CostItem,
  type PooolStatus,
  type DeliveryStatus,
} from './api';
import { PAL, monoSmall, sansBold, sans, pill, skeletonBar, emptyText, card, title } from './theme';
import { openCampaignKit } from './campaignKit';

// ──────────────────────────────────────────────────────────────
// Status colour map
// ──────────────────────────────────────────────────────────────

const POOOL_COLOR: Record<PooolStatus, string> = {
  quote_pending: '#9CA3AF',
  quote_sent: '#60A5FA',
  quote_approved: '#34D399',
  invoiced: '#FBBF24',
  partially_paid: '#F97316',
  paid: '#10B981',
  overdue: '#EF4444',
};

const DELIVERY_COLOR: Record<DeliveryStatus, string> = {
  in_progress: '#60A5FA',
  delivered: '#10B981',
  archived: '#9CA3AF',
};

function pooolLabel(s: PooolStatus): string {
  return s.replace(/_/g, ' ');
}

function deliveryLabel(s: DeliveryStatus): string {
  return s.replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function fmtEur(v: number | null | undefined): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
}

// ──────────────────────────────────────────────────────────────
// New-job modal
// ──────────────────────────────────────────────────────────────

interface NewJobModalProps {
  onCreated: (job: Job) => void;
  onClose: () => void;
}

function NewJobModal({ onCreated, onClose }: NewJobModalProps): JSX.Element {
  const [jobNumber, setJobNumber] = useState('');
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [quote, setQuote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!jobNumber.trim() || !title.trim()) {
      setErr('Job number and title are required.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const job = await createJob({
        job_number: jobNumber.trim(),
        title: title.trim(),
        client: client.trim(),
        quote_amount: quote ? parseFloat(quote) : undefined,
      });
      onCreated(job);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${PAL.divider}`,
    background: PAL.panel,
    ...sans,
    fontSize: 12,
    color: PAL.ink,
    outline: 'none',
    boxSizing: 'border-box',
    borderRadius: 8,
    transition: 'border-color 160ms ease, box-shadow 160ms ease',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: PAL.surface,
          border: `1px solid ${PAL.divider}`,
          borderRadius: 16,
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          padding: 28,
          width: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>New Job</div>
        {err && (
          <div style={{ ...sans, fontSize: 11, color: '#EF4444' }}>{err}</div>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...monoSmall, color: PAL.muted }}>Job Number *</span>
          <input style={inputStyle} value={jobNumber} onChange={e => setJobNumber(e.target.value)} placeholder="e.g. 2024-042" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...monoSmall, color: PAL.muted }}>Title *</span>
          <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="Project title" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...monoSmall, color: PAL.muted }}>Client</span>
          <input style={inputStyle} value={client} onChange={e => setClient(e.target.value)} placeholder="Client name" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...monoSmall, color: PAL.muted }}>Quote Amount (€)</span>
          <input style={inputStyle} type="number" value={quote} onChange={e => setQuote(e.target.value)} placeholder="0.00" />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: `1px solid ${PAL.divider}`,
              cursor: 'pointer',
              ...monoSmall,
              color: PAL.muted,
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={() => { void submit(); }}
            disabled={saving}
            style={{
              padding: '6px 14px',
              background: PAL.accent,
              border: 'none',
              cursor: saving ? 'wait' : 'pointer',
              ...monoSmall,
              color: PAL.white,
            }}
          >
            {saving ? 'SAVING…' : 'CREATE'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Job detail panel
// ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  job: Job;
  onUpdate: (updated: Job) => void;
  onClose: () => void;
}

function DetailPanel({ job, onUpdate, onClose }: DetailPanelProps): JSX.Element {
  const [saving, setSaving] = useState(false);
  // Local draft of the third-party cost line items (task 1). Synced from the
  // job whenever a different job is selected.
  const [costDraft, setCostDraft] = useState<CostItem[]>(job.cost_items ?? []);
  const [dueDraft, setDueDraft] = useState<string>(job.payment_due_date ?? '');
  const [pushing, setPushing] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);
  const [pushingCu, setPushingCu] = useState(false);
  const [pushCuErr, setPushCuErr] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const [serverFiles, setServerFiles] = useState<ServerFile[] | null>(null);
  const [notifications, setNotifications] = useState<JobNotification[] | null>(null);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignErr, setCampaignErr] = useState<string | null>(null);

  // Load notifications raised for this job.
  useEffect(() => {
    let cancelled = false;
    setNotifications(null);
    listJobNotifications(job.id)
      .then((n) => { if (!cancelled) setNotifications(n); })
      .catch(() => { if (!cancelled) setNotifications([]); });
    return () => { cancelled = true; };
  }, [job.id, job.delivery_status, job.poool_status]);

  // Load the server folder's file listing whenever the job's folder is known.
  useEffect(() => {
    let cancelled = false;
    if (job.server_folder_path) {
      setServerFiles(null);
      listServerFiles(job.server_folder_path)
        .then((f) => { if (!cancelled) setServerFiles(f); })
        .catch(() => { if (!cancelled) setServerFiles([]); });
    } else {
      setServerFiles(null);
    }
    return () => { cancelled = true; };
  }, [job.id, job.server_folder_path]);

  useEffect(() => {
    setCostDraft(job.cost_items ?? []);
    setDueDraft(job.payment_due_date ?? '');
  }, [job.id, job.cost_items, job.payment_due_date]);

  const overdue = jobIsOverdue(job);

  const patch = async (body: Parameters<typeof updateJob>[1]): Promise<void> => {
    setSaving(true);
    try {
      const updated = await updateJob(job.id, body);
      onUpdate(updated);
    } finally {
      setSaving(false);
    }
  };

  const setPoool = (status: PooolStatus): Promise<void> => patch({ poool_status: status });
  const setDelivery = (status: DeliveryStatus): Promise<void> => patch({ delivery_status: status });

  const saveCosts = (): Promise<void> => {
    const cleaned = costDraft
      .map(c => ({ vendor: c.vendor.trim(), amount: Number(c.amount) || 0 }))
      .filter(c => c.vendor || c.amount);
    return patch({ cost_items: cleaned });
  };

  const saveDueDate = (value: string): Promise<void> =>
    patch({ payment_due_date: value || null });

  const pushPoool = async (): Promise<void> => {
    setPushing(true);
    setPushErr(null);
    try {
      const updated = await pushJobToPoool(job.id);
      onUpdate(updated);
    } catch (e) {
      setPushErr((e as Error).message);
    } finally {
      setPushing(false);
    }
  };

  const pushClickup = async (): Promise<void> => {
    setPushingCu(true);
    setPushCuErr(null);
    try {
      const updated = await pushJobToClickup(job.id);
      onUpdate(updated);
    } catch (e) {
      setPushCuErr((e as Error).message);
    } finally {
      setPushingCu(false);
    }
  };

  const makeFolder = async (): Promise<void> => {
    setCreatingFolder(true);
    setFolderErr(null);
    try {
      const updated = await createServerFolder(job.id);
      onUpdate(updated);
    } catch (e) {
      setFolderErr((e as Error).message);
    } finally {
      setCreatingFolder(false);
    }
  };

  const makeCampaign = async (): Promise<void> => {
    setCampaignBusy(true);
    setCampaignErr(null);
    try {
      const brief = `${job.title}${job.notes ? ' — ' + job.notes : ''} (Kunde: ${job.client || '—'})`;
      setCampaign(await generateCampaign(brief, ['linkedin', 'instagram'], true));
    } catch (e) {
      setCampaignErr((e as Error).message);
    } finally {
      setCampaignBusy(false);
    }
  };

  const netCosts = costItemsTotal(costDraft);
  const grossCosts = withProductionFee(netCosts);
  const costsDirty =
    JSON.stringify(costDraft.map(c => ({ vendor: c.vendor, amount: Number(c.amount) || 0 }))) !==
    JSON.stringify((job.cost_items ?? []).map(c => ({ vendor: c.vendor, amount: c.amount })));

  const row = (label: string, value: React.ReactNode): JSX.Element => (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
      <div style={{ ...monoSmall, color: PAL.muted, width: 130, flexShrink: 0 }}>{label}</div>
      <div style={{ ...sans, fontSize: 12, color: PAL.ink, flex: 1 }}>{value}</div>
    </div>
  );

  const POOOL_STATUSES: PooolStatus[] = [
    'quote_pending', 'quote_sent', 'quote_approved', 'invoiced', 'partially_paid', 'paid', 'overdue',
  ];

  const DELIVERY_STATUSES: DeliveryStatus[] = ['in_progress', 'delivered', 'archived'];

  const costInput: React.CSSProperties = {
    padding: '4px 8px',
    border: `1px solid ${PAL.divider}`,
    background: PAL.panel,
    ...sans,
    fontSize: 11,
    color: PAL.ink,
    outline: 'none',
    boxSizing: 'border-box',
    borderRadius: 6,
  };

  return (
    <div
      style={{
        flex: 1,
        padding: '20px 24px',
        overflowY: 'auto',
        borderLeft: `1px solid ${PAL.divider}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...monoSmall, color: PAL.muted }}>JOB {job.job_number}</span>
            {overdue && (
              <span style={{ ...pill('#EF4444'), fontSize: 8 }}>OVERDUE</span>
            )}
          </div>
          <div style={{ ...sansBold, fontSize: 15, color: PAL.ink, marginTop: 4 }}>{job.title}</div>
          {job.client && <div style={{ ...sans, fontSize: 12, color: PAL.muted, marginTop: 2 }}>{job.client}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: `1px solid ${PAL.divider}`,
            padding: '4px 10px',
            cursor: 'pointer',
            ...monoSmall,
            color: PAL.muted,
          }}
        >
          CLOSE
        </button>
      </div>

      {/* POOOL track */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>POOOL — FINANCE</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {row('Status', (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {POOOL_STATUSES.map(s => (
              <button
                key={s}
                type="button"
                disabled={saving}
                onClick={() => { void setPoool(s); }}
                style={{
                  padding: '3px 8px',
                  border: `1px solid ${job.poool_status === s ? POOOL_COLOR[s] : PAL.divider}`,
                  background: job.poool_status === s ? `${POOOL_COLOR[s]}22` : 'transparent',
                  color: job.poool_status === s ? POOOL_COLOR[s] : PAL.muted,
                  cursor: 'pointer',
                  ...monoSmall,
                  fontSize: 8,
                }}
              >
                {pooolLabel(s)}
              </button>
            ))}
          </div>
        ))}
        {row('Quote', fmtEur(job.quote_amount))}
        {row('Invoice', fmtEur(job.invoice_amount))}
        {row('Payment due', (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="date"
              value={dueDraft}
              disabled={saving}
              onChange={e => setDueDraft(e.target.value)}
              onBlur={() => {
                if (dueDraft !== (job.payment_due_date ?? '')) void saveDueDate(dueDraft);
              }}
              style={{ ...costInput, width: 150 }}
            />
            {overdue && <span style={{ ...monoSmall, color: '#EF4444', fontSize: 8 }}>PAST DUE</span>}
          </div>
        ))}
        {row('POOOL ID', (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{job.poool_job_id || '—'}</span>
            {!job.poool_job_id && (
              <button
                type="button"
                disabled={pushing}
                onClick={() => { void pushPoool(); }}
                style={{
                  border: 'none',
                  background: '#34D399',
                  color: PAL.white,
                  cursor: pushing ? 'wait' : 'pointer',
                  ...monoSmall,
                  fontSize: 8,
                  padding: '4px 10px',
                }}
              >
                {pushing ? 'PUSHING…' : '↗ PUSH TO POOOL'}
              </button>
            )}
          </div>
        ))}
        {pushErr && (
          <div style={{ ...sans, fontSize: 11, color: '#B45309', marginTop: 2 }}>{pushErr}</div>
        )}
      </div>

      {/* Third-party costs (task 1) */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>
        THIRD-PARTY COSTS · FREMDKOSTEN
      </div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {costDraft.length === 0 && (
            <div style={{ ...sans, fontSize: 11, color: PAL.muted, fontStyle: 'italic' }}>
              No third-party costs yet.
            </div>
          )}
          {costDraft.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                placeholder="Vendor / Lieferant"
                value={c.vendor}
                disabled={saving}
                onChange={e => {
                  const vendor = e.target.value;
                  setCostDraft(costDraft.map((it, j) => (j === i ? { ...it, vendor } : it)));
                }}
                style={{ ...costInput, flex: 1 }}
              />
              <input
                type="number"
                placeholder="0.00"
                value={c.amount === 0 ? '' : String(c.amount)}
                disabled={saving}
                onChange={e => {
                  const amount = parseFloat(e.target.value) || 0;
                  setCostDraft(costDraft.map((it, j) => (j === i ? { ...it, amount } : it)));
                }}
                style={{ ...costInput, width: 90, textAlign: 'right' }}
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => setCostDraft(costDraft.filter((_, j) => j !== i))}
                style={{
                  border: `1px solid ${PAL.divider}`,
                  background: 'transparent',
                  color: PAL.muted,
                  cursor: 'pointer',
                  ...monoSmall,
                  fontSize: 9,
                  padding: '4px 7px',
                }}
                aria-label="Remove cost line"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            disabled={saving}
            onClick={() => setCostDraft([...costDraft, { vendor: '', amount: 0 }])}
            style={{
              border: `1px dashed ${PAL.divider}`,
              background: 'transparent',
              color: PAL.muted,
              cursor: 'pointer',
              ...monoSmall,
              fontSize: 8,
              padding: '5px 10px',
            }}
          >
            + ADD COST
          </button>
          {costsDirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { void saveCosts(); }}
              style={{
                border: 'none',
                background: PAL.accent,
                color: PAL.white,
                cursor: saving ? 'wait' : 'pointer',
                ...monoSmall,
                fontSize: 8,
                padding: '5px 12px',
              }}
            >
              {saving ? 'SAVING…' : 'SAVE COSTS'}
            </button>
          )}
        </div>

        {row('Net costs', fmtEur(netCosts))}
        {row(`+ ${Math.round(PRODUCTION_FEE_RATE * 100)}% fee`, (
          <span style={{ ...sansBold, fontSize: 12, color: PAL.ink }}>{fmtEur(grossCosts)}</span>
        ))}
      </div>

      {/* ClickUp track */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>CLICKUP — TASKS</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {row('Folder ID', job.clickup_folder_id ?? '—')}
        {row('Tickets', (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{job.clickup_ticket_ids.length > 0 ? job.clickup_ticket_ids.join(', ') : '—'}</span>
            <button
              type="button"
              disabled={pushingCu}
              onClick={() => { void pushClickup(); }}
              style={{
                border: 'none',
                background: '#818CF8',
                color: PAL.white,
                cursor: pushingCu ? 'wait' : 'pointer',
                ...monoSmall,
                fontSize: 8,
                padding: '4px 10px',
              }}
            >
              {pushingCu ? 'PUSHING…' : '↗ PUSH TO CLICKUP'}
            </button>
          </div>
        ))}
        {row('Revisions', String(job.revision_count))}
        {pushCuErr && (
          <div style={{ ...sans, fontSize: 11, color: '#B45309', marginTop: 2 }}>{pushCuErr}</div>
        )}
      </div>

      {/* GenAI marketing — Admin ↔ GenAI convergence: a full brand campaign for this job */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>MARKETING — CAMPAIGN</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {!campaign ? (
          <button
            type="button"
            disabled={campaignBusy}
            onClick={() => { void makeCampaign(); }}
            style={{ border: 'none', background: PAL.accent, color: PAL.white, cursor: campaignBusy ? 'wait' : 'pointer', ...monoSmall, fontSize: 9, padding: '6px 12px' }}
          >
            {campaignBusy ? 'BUILDING CAMPAIGN…' : '✦ CREATE CAMPAIGN FOR THIS JOB'}
          </button>
        ) : (
          <div style={{ ...sans, fontSize: 12, color: PAL.ink }}>
            <div style={{ ...sansBold, fontSize: 13 }}>{campaign.headline}</div>
            <div style={{ color: PAL.muted, marginTop: 4 }}>
              {campaign.deck_slides} slides · {campaign.social.length} posts · key visual · brand-locked
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {campaign.od_project_url && (
                <a href={campaign.od_project_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', background: PAL.accent, color: PAL.white, textDecoration: 'none', ...monoSmall, fontSize: 8, padding: '5px 10px', borderRadius: 6 }}>
                  ↗ OPEN IN OPEN DESIGN
                </a>
              )}
              <button type="button" onClick={() => openCampaignKit(campaign, false)}
                style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.ink, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '5px 10px', borderRadius: 6 }}>
                ↗ CAMPAIGN KIT
              </button>
              <button type="button" onClick={() => openCampaignKit(campaign, true)}
                style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.ink, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '5px 10px', borderRadius: 6 }}>
                ⬇ KIT
              </button>
            </div>
          </div>
        )}
        {campaignErr && <div style={{ ...sans, fontSize: 11, color: '#B45309', marginTop: 6 }}>{campaignErr}</div>}
      </div>

      {/* Server track */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>SERVER — FILES</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {row('Folder', (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
              {job.server_folder_path ?? '—'}
            </span>
            {!job.server_folder_path && (
              <button
                type="button"
                disabled={creatingFolder}
                onClick={() => { void makeFolder(); }}
                style={{
                  border: 'none',
                  background: '#F472B6',
                  color: PAL.white,
                  cursor: creatingFolder ? 'wait' : 'pointer',
                  ...monoSmall,
                  fontSize: 8,
                  padding: '4px 10px',
                }}
              >
                {creatingFolder ? 'CREATING…' : '+ CREATE FOLDER'}
              </button>
            )}
          </div>
        ))}
        {folderErr && (
          <div style={{ ...sans, fontSize: 11, color: '#B45309', marginBottom: 6 }}>{folderErr}</div>
        )}
        {job.server_folder_path && (
          row('Files', (
            serverFiles === null
              ? <span style={{ ...sans, fontSize: 11, color: PAL.muted }}>loading…</span>
              : serverFiles.length === 0
                ? <span style={{ ...sans, fontSize: 11, color: PAL.muted, fontStyle: 'italic' }}>empty</span>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {serverFiles.map((f) => (
                      <div key={f.name} style={{ ...sans, fontSize: 11, color: PAL.ink, display: 'flex', gap: 8 }}>
                        <span>{f.dir ? '📁' : '📄'} {f.name}</span>
                        {!f.dir && <span style={{ color: PAL.muted }}>{f.size} B</span>}
                      </div>
                    ))}
                  </div>
                )
          ))
        )}
        {row('Delivery', (
          <div style={{ display: 'flex', gap: 4 }}>
            {DELIVERY_STATUSES.map(s => (
              <button
                key={s}
                type="button"
                disabled={saving}
                onClick={() => { void setDelivery(s); }}
                style={{
                  padding: '3px 8px',
                  border: `1px solid ${job.delivery_status === s ? DELIVERY_COLOR[s] : PAL.divider}`,
                  background: job.delivery_status === s ? `${DELIVERY_COLOR[s]}22` : 'transparent',
                  color: job.delivery_status === s ? DELIVERY_COLOR[s] : PAL.muted,
                  cursor: 'pointer',
                  ...monoSmall,
                  fontSize: 8,
                }}
              >
                {deliveryLabel(s)}
              </button>
            ))}
          </div>
        ))}
        {job.delivered_at && row('Delivered', formatDate(job.delivered_at))}
        {/* Mark as Delivered — one-click action (task 3) */}
        {job.delivery_status !== 'delivered' && (
          <button
            type="button"
            disabled={saving}
            onClick={() => { void setDelivery('delivered'); }}
            style={{
              marginTop: 6,
              width: '100%',
              border: 'none',
              background: '#10B981',
              color: PAL.white,
              cursor: saving ? 'wait' : 'pointer',
              ...monoSmall,
              fontSize: 9,
              padding: '8px 12px',
            }}
          >
            {saving ? 'SAVING…' : '✓ MARK AS DELIVERED'}
          </button>
        )}
      </div>

      {/* Notifications (Track A6) */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>NOTIFICATIONS</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {notifications === null && (
          <span style={{ ...sans, fontSize: 11, color: PAL.muted }}>loading…</span>
        )}
        {notifications && notifications.length === 0 && (
          <span style={{ ...sans, fontSize: 11, color: PAL.muted, fontStyle: 'italic' }}>
            No notifications yet. Delivering a job or an overdue payment raises one.
          </span>
        )}
        {notifications && notifications.map((n) => (
          <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ ...pill(n.kind === 'delivery' ? '#10B981' : '#EF4444'), fontSize: 8 }}>
              {n.kind.replace(/_/g, ' ')}
            </span>
            <span style={{ ...sans, fontSize: 12, color: PAL.ink, flex: 1 }}>{n.subject}</span>
            <span style={{ ...monoSmall, color: PAL.muted, fontSize: 8 }}>{n.status}</span>
            {n.created_at && (
              <span style={{ ...monoSmall, color: PAL.muted, fontSize: 8 }}>{formatDate(n.created_at)}</span>
            )}
          </div>
        ))}
      </div>

      {job.notes && (
        <>
          <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 8 }}>NOTES</div>
          <div style={{ ...sans, fontSize: 12, color: PAL.ink, lineHeight: 1.5 }}>{job.notes}</div>
        </>
      )}

      <div style={{ ...monoSmall, color: PAL.muted, marginTop: 20 }}>
        Created {formatDate(job.created_at)} · Updated {formatDate(job.updated_at)}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main JobBoard
// ──────────────────────────────────────────────────────────────

export default function JobBoard(): JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    listJobs()
      .then(j => setJobs(j))
      .catch((e: Error) => setError(e.message));
  }, []);

  const handleCreated = (job: Job): void => {
    setJobs(prev => (prev ? [job, ...prev] : [job]));
    setShowNew(false);
    setSelected(job);
  };

  const handleUpdate = (updated: Job): void => {
    setJobs(prev => prev ? prev.map(j => j.id === updated.id ? updated : j) : prev);
    setSelected(updated);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {showNew && (
        <NewJobModal onCreated={handleCreated} onClose={() => setShowNew(false)} />
      )}

      {/* Job list */}
      <div
        style={{
          flex: selected ? '0 0 400px' : 1,
          padding: 20,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ ...title }}>Jobs</span>
            <span style={{ ...monoSmall, color: PAL.muted }}>
              {jobs ? `${jobs.length} · TRI-TRACK` : 'TRI-TRACK'}
            </span>
          </div>
          <button
            type="button"
            className="bq-btn"
            onClick={() => setShowNew(true)}
            style={{
              padding: '6px 14px',
              background: PAL.accent,
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
              ...monoSmall,
              color: PAL.white,
            }}
          >
            + NEW JOB
          </button>
        </div>

        {error && <ErrorBanner message={error} />}
        {!jobs && !error && <SkeletonList />}
        {jobs && jobs.length === 0 && (
          <div style={emptyText}>No jobs yet. Create one to get started.</div>
        )}

        {jobs && jobs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map(job => {
              const active = selected?.id === job.id;
              const pc = POOOL_COLOR[job.poool_status] ?? PAL.muted;
              const dc = DELIVERY_COLOR[job.delivery_status] ?? PAL.muted;

              const overdue = jobIsOverdue(job);
              return (
                <button
                  key={job.id}
                  type="button"
                  className={`bq-card${active ? ' is-active' : ''}`}
                  onClick={() => setSelected(job)}
                  style={{
                    ...card(active),
                    textAlign: 'left',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 14,
                  }}
                >
                  {/* Left: identity + status */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ ...monoSmall, color: active ? 'rgba(255,255,255,0.55)' : PAL.muted, fontSize: 8 }}>
                        {job.job_number}
                      </span>
                      <span style={{ ...sansBold, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.title}
                      </span>
                    </div>

                    {job.client && (
                      <span style={{ ...sans, fontSize: 11.5, color: active ? 'rgba(255,255,255,0.7)' : PAL.muted }}>
                        {job.client}
                      </span>
                    )}

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 1 }}>
                      <span style={{ ...pill(pc) }}>
                        {pooolLabel(job.poool_status)}
                      </span>
                      {overdue && job.poool_status !== 'overdue' && (
                        <span style={{ ...pill(PAL.danger) }}>overdue</span>
                      )}
                      <span style={{ ...pill(PAL.muted) }}>
                        {job.revision_count > 0 ? `rev ${job.revision_count}` : 'no revisions'}
                      </span>
                      <span style={{ ...pill(dc) }}>
                        {deliveryLabel(job.delivery_status)}
                      </span>
                    </div>
                  </div>

                  {/* Right: the money — prominent, was buried in tiny mono */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                    {job.quote_amount != null ? (
                      <>
                        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink, whiteSpace: 'nowrap' }}>
                          {fmtEur(job.quote_amount)}
                        </span>
                        <span style={{ ...monoSmall, color: active ? 'rgba(255,255,255,0.5)' : PAL.muted, fontSize: 7 }}>QUOTE</span>
                      </>
                    ) : (
                      <span style={{ ...monoSmall, color: active ? 'rgba(255,255,255,0.5)' : PAL.muted, fontSize: 8 }}>NO QUOTE</span>
                    )}
                    {overdue && (
                      <span style={{ ...monoSmall, color: PAL.danger, fontSize: 7, marginTop: 2 }}>● PAST DUE</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          job={selected}
          onUpdate={handleUpdate}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'rgba(220,38,38,0.08)',
        border: '1px solid rgba(220,38,38,0.25)',
        color: '#DC2626',
        ...sans,
        fontSize: 12,
        marginBottom: 12,
      }}
    >
      {message}
    </div>
  );
}

export function SkeletonList(): JSX.Element {
  return (
    <div>
      <span style={skeletonBar('60%', 14)} />
      <span style={skeletonBar('80%', 14)} />
      <span style={skeletonBar('40%', 14)} />
    </div>
  );
}
