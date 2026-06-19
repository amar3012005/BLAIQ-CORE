// BLAIQ Admin · Finance Board — POOOL track summary across all jobs.
// Shows outstanding quotes, invoices, overdue payments, and totals.

'use client';

import React, { useEffect, useState } from 'react';
import { listJobs, jobIsOverdue, getPooolSummary, type Job, type PooolStatus, type PooolSyncSummary } from './api';
import { PAL, monoSmall, sansBold, sans, skeletonBar, emptyText } from './theme';
import { ErrorBanner } from './JobBoard';

const POOOL_COLOR: Record<PooolStatus, string> = {
  quote_pending: '#9CA3AF',
  quote_sent: '#60A5FA',
  quote_approved: '#34D399',
  invoiced: '#FBBF24',
  partially_paid: '#F97316',
  paid: '#10B981',
  overdue: '#EF4444',
};

function fmtEur(v: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
}

interface FinanceSummary {
  total_quote: number;
  total_invoice: number;
  total_paid: number;
  total_overdue: number;
  open_quotes: Job[];
  invoiced: Job[];
  overdue: Job[];
  paid: Job[];
}

function buildSummary(jobs: Job[]): FinanceSummary {
  const s: FinanceSummary = {
    total_quote: 0,
    total_invoice: 0,
    total_paid: 0,
    total_overdue: 0,
    open_quotes: [],
    invoiced: [],
    overdue: [],
    paid: [],
  };
  for (const j of jobs) {
    const overdue = jobIsOverdue(j);
    if (j.quote_amount) s.total_quote += j.quote_amount;
    if (j.invoice_amount) s.total_invoice += j.invoice_amount;
    if (j.poool_status === 'paid' && j.invoice_amount) s.total_paid += j.invoice_amount;
    if (overdue && j.invoice_amount) s.total_overdue += j.invoice_amount;

    if (j.poool_status === 'quote_pending' || j.poool_status === 'quote_sent') s.open_quotes.push(j);
    else if (overdue) s.overdue.push(j);
    else if (j.poool_status === 'invoiced' || j.poool_status === 'partially_paid') s.invoiced.push(j);
    else if (j.poool_status === 'paid') s.paid.push(j);
  }
  return s;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }): JSX.Element {
  return (
    <div
      style={{
        background: PAL.panel,
        border: `1px solid ${PAL.divider}`,
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flex: '1 1 160px',
      }}
    >
      <div style={{ ...monoSmall, color: PAL.muted }}>{label}</div>
      <div
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 18,
          fontWeight: 700,
          color: color ?? PAL.ink,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: Job }): JSX.Element {
  const color = POOOL_COLOR[job.poool_status] ?? PAL.muted;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: PAL.panel,
        border: `1px solid ${PAL.divider}`,
        marginBottom: 4,
      }}
    >
      <div style={{ ...monoSmall, color: PAL.muted, width: 80, flexShrink: 0 }}>
        {job.job_number}
      </div>
      <div style={{ ...sans, fontSize: 12, color: PAL.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {job.title}
      </div>
      {job.client && (
        <div style={{ ...sans, fontSize: 11, color: PAL.muted, width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.client}
        </div>
      )}
      <div
        style={{
          ...monoSmall,
          fontSize: 9,
          color,
          background: `${color}1A`,
          padding: '2px 8px',
          flexShrink: 0,
        }}
      >
        {job.poool_status.replace(/_/g, ' ')}
      </div>
      <div
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11,
          color: PAL.ink,
          width: 110,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {job.invoice_amount != null
          ? fmtEur(job.invoice_amount)
          : job.quote_amount != null
            ? fmtEur(job.quote_amount)
            : '—'}
      </div>
    </div>
  );
}

function Section({ title, jobs, color }: { title: string; jobs: Job[]; color?: string }): JSX.Element {
  if (jobs.length === 0) return <></>;
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          ...monoSmall,
          color: color ?? PAL.muted,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {title}
        <span style={{ ...monoSmall, color: PAL.muted }}>· {jobs.length}</span>
      </div>
      {jobs.map(j => <JobRow key={j.id} job={j} />)}
    </div>
  );
}

export default function FinanceBoard(): JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poool, setPoool] = useState<PooolSyncSummary | null>(null);

  useEffect(() => {
    listJobs()
      .then(j => setJobs(j))
      .catch((e: Error) => setError(e.message));
    getPooolSummary().then(setPoool).catch(() => setPoool(null));
  }, []);

  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>;
  if (!jobs) return (
    <div style={{ padding: 20 }}>
      <span style={skeletonBar('60%', 14)} />
      <span style={skeletonBar('80%', 14)} />
    </div>
  );

  const s = buildSummary(jobs);

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%' }}>
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 16 }}>FINANCE — POOOL OVERVIEW</div>

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard label="QUOTES OPEN" value={fmtEur(s.total_quote)} />
        <StatCard label="INVOICED" value={fmtEur(s.total_invoice)} color="#FBBF24" />
        <StatCard label="PAID" value={fmtEur(s.total_paid)} color="#10B981" />
        <StatCard label="OVERDUE" value={fmtEur(s.total_overdue)} color="#EF4444" />
      </div>

      {/* Live POOOL sync (real ops.poool_cache data) */}
      {poool && (
        <div style={{ background: PAL.panel, border: `1px solid ${PAL.divider}`, padding: '12px 16px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: poool.connected ? 8 : 0 }}>
            <span style={{ ...monoSmall, color: PAL.muted }}>POOOL · LIVE SYNC</span>
            <span style={{ ...monoSmall, fontSize: 8, color: poool.connected ? '#0F6E56' : PAL.muted, background: poool.connected ? '#E1F5EE' : PAL.bg, padding: '3px 8px', borderRadius: 10 }}>
              {poool.connected ? '● CONNECTED' : '○ NOT SYNCED'}
            </span>
            {poool.connected && (
              <span style={{ ...monoSmall, color: PAL.muted, fontSize: 8, marginLeft: 'auto' }}>
                {poool.projects} projects · {poool.orders} orders · {poool.clients} clients
              </span>
            )}
          </div>
          {poool.connected && poool.recent_orders.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {poool.recent_orders.map(o => (
                <span key={o.id} style={{ ...sans, fontSize: 11, color: PAL.ink, background: PAL.white, border: `1px solid ${PAL.divider}`, padding: '3px 8px' }}>
                  #{o.id} {o.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {jobs.length === 0 && <div style={emptyText}>No jobs with finance data yet.</div>}

      <Section title="OVERDUE" jobs={s.overdue} color="#EF4444" />
      <Section title="INVOICED / PARTIALLY PAID" jobs={s.invoiced} color="#FBBF24" />
      <Section title="OPEN QUOTES" jobs={s.open_quotes} color="#60A5FA" />
      <Section title="PAID" jobs={s.paid} color="#10B981" />
    </div>
  );
}
