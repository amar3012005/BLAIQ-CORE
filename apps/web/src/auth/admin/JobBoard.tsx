// BLAIQ Admin · Job Board — tri-track view of all active jobs.
// Each job row shows live status across POOOL (finance), ClickUp (tasks), Server (files).

'use client';

import React, { useEffect, useState } from 'react';
import {
  listJobs,
  updateJob,
  createJob,
  type Job,
  type PooolStatus,
  type DeliveryStatus,
} from './api';
import { PAL, monoSmall, sansBold, sans, pill, skeletonBar, emptyText } from './theme';

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
    padding: '7px 10px',
    border: `1px solid ${PAL.divider}`,
    background: PAL.bg,
    ...sans,
    fontSize: 12,
    color: PAL.ink,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: PAL.panel,
          border: `1px solid ${PAL.divider}`,
          padding: 24,
          width: 380,
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

  const setPoool = async (status: PooolStatus): Promise<void> => {
    setSaving(true);
    try {
      const updated = await updateJob(job.id, { poool_status: status });
      onUpdate(updated);
    } finally {
      setSaving(false);
    }
  };

  const setDelivery = async (status: DeliveryStatus): Promise<void> => {
    setSaving(true);
    try {
      const updated = await updateJob(job.id, { delivery_status: status });
      onUpdate(updated);
    } finally {
      setSaving(false);
    }
  };

  const row = (label: string, value: React.ReactNode): JSX.Element => (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
      <div style={{ ...monoSmall, color: PAL.muted, width: 130, flexShrink: 0 }}>{label}</div>
      <div style={{ ...sans, fontSize: 12, color: PAL.ink }}>{value}</div>
    </div>
  );

  const POOOL_STATUSES: PooolStatus[] = [
    'quote_pending', 'quote_sent', 'quote_approved', 'invoiced', 'partially_paid', 'paid', 'overdue',
  ];

  const DELIVERY_STATUSES: DeliveryStatus[] = ['in_progress', 'delivered', 'archived'];

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
          <div style={{ ...monoSmall, color: PAL.muted }}>JOB {job.job_number}</div>
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
        {row('3rd-party + 15%', job.third_party_costs != null
          ? fmtEur((job.third_party_costs ?? 0) * 1.15)
          : '—')}
        {row('Invoice', fmtEur(job.invoice_amount))}
      </div>

      {/* ClickUp track */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>CLICKUP — TASKS</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {row('Folder ID', job.clickup_folder_id ?? '—')}
        {row('Tickets', job.clickup_ticket_ids.length > 0
          ? job.clickup_ticket_ids.join(', ')
          : '—')}
        {row('Revisions', String(job.revision_count))}
      </div>

      {/* Server track */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 10 }}>SERVER — FILES</div>
      <div style={{ background: PAL.bg, border: `1px solid ${PAL.divider}`, padding: 14, marginBottom: 16 }}>
        {row('Folder', job.server_folder_path ?? '—')}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ ...monoSmall, color: PAL.muted }}>
            JOBS {jobs ? `· ${jobs.length}` : ''}
          </div>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            style={{
              padding: '4px 12px',
              background: PAL.accent,
              border: 'none',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {jobs.map(job => {
              const active = selected?.id === job.id;
              const pc = POOOL_COLOR[job.poool_status] ?? PAL.muted;
              const dc = DELIVERY_COLOR[job.delivery_status] ?? PAL.muted;

              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelected(job)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    background: active ? PAL.ink : PAL.panel,
                    color: active ? PAL.white : PAL.ink,
                    border: `1px solid ${active ? PAL.ink : PAL.divider}`,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {/* Top row: job number + title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...monoSmall, color: active ? PAL.divider : PAL.muted, fontSize: 8 }}>
                      {job.job_number}
                    </span>
                    <span style={{ ...sansBold, fontSize: 12 }}>{job.title}</span>
                  </div>

                  {/* Client */}
                  {job.client && (
                    <span style={{ ...sans, fontSize: 11, color: active ? PAL.divider : PAL.muted }}>
                      {job.client}
                    </span>
                  )}

                  {/* Track status pills */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {/* POOOL */}
                    <span style={{ ...pill(active ? PAL.white : pc) }}>
                      {pooolLabel(job.poool_status)}
                    </span>
                    {/* ClickUp */}
                    <span style={{ ...pill(active ? PAL.divider : PAL.muted) }}>
                      {job.revision_count > 0 ? `rev ${job.revision_count}` : 'no revisions'}
                    </span>
                    {/* Delivery */}
                    <span style={{ ...pill(active ? PAL.white : dc) }}>
                      {deliveryLabel(job.delivery_status)}
                    </span>
                  </div>

                  {/* Quote amount */}
                  {job.quote_amount != null && (
                    <span style={{ ...monoSmall, color: active ? PAL.divider : PAL.muted, fontSize: 8 }}>
                      Quote {fmtEur(job.quote_amount)}
                    </span>
                  )}
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
