// BLAIQ Admin · Analytics — KPIs computed from live jobs + POOOL sync.
// Margin, cash exposure, throughput, revision load. No LLM needed.

'use client';

import React, { useEffect, useState } from 'react';
import {
  listJobs,
  getPooolSummary,
  jobIsOverdue,
  costItemsTotal,
  type Job,
  type PooolSyncSummary,
} from './api';
import { PAL, monoSmall, sansBold, sans, skeletonBar } from './theme';
import { ErrorBanner } from './JobBoard';

function fmtEur(v: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }): JSX.Element {
  return (
    <div style={{ background: PAL.panel, border: `1px solid ${PAL.divider}`, padding: '14px 18px', flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ ...monoSmall, color: PAL.muted }}>{label}</div>
      <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 18, fontWeight: 700, color: color ?? PAL.ink }}>{value}</div>
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }): JSX.Element {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...sans, fontSize: 11, color: PAL.muted, marginBottom: 3 }}>
        <span>{label}</span><span>{value}</span>
      </div>
      <div style={{ height: 8, background: PAL.bg, border: `1px solid ${PAL.divider}` }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}

export default function AnalyticsBoard(): JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [poool, setPoool] = useState<PooolSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listJobs().then(setJobs).catch((e: Error) => setError(e.message));
    getPooolSummary().then(setPoool).catch(() => setPoool(null));
  }, []);

  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>;
  if (!jobs) return (
    <div style={{ padding: 20 }}><span style={skeletonBar('60%', 14)} /><span style={skeletonBar('80%', 14)} /></div>
  );

  let quoted = 0, invoiced = 0, paid = 0, overdue = 0, costs = 0, revisions = 0;
  const byStatus: Record<string, number> = {};
  const byDelivery: Record<string, number> = {};
  for (const j of jobs) {
    quoted += j.quote_amount ?? 0;
    invoiced += j.invoice_amount ?? 0;
    if (j.poool_status === 'paid') paid += j.invoice_amount ?? 0;
    if (jobIsOverdue(j)) overdue += j.invoice_amount ?? j.quote_amount ?? 0;
    costs += j.third_party_costs ?? costItemsTotal(j.cost_items);
    revisions += j.revision_count ?? 0;
    byStatus[j.poool_status] = (byStatus[j.poool_status] ?? 0) + 1;
    byDelivery[j.delivery_status] = (byDelivery[j.delivery_status] ?? 0) + 1;
  }
  const revenueBooked = invoiced || quoted;
  const grossMargin = revenueBooked - costs;
  const marginPct = revenueBooked > 0 ? Math.round((grossMargin / revenueBooked) * 100) : 0;
  const maxStatus = Math.max(1, ...Object.values(byStatus));

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 16 }}>ANALYTICS — KPIs &amp; TRENDS</div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <Stat label="JOBS" value={String(jobs.length)} />
        <Stat label="QUOTED" value={fmtEur(quoted)} />
        <Stat label="INVOICED" value={fmtEur(invoiced)} color="#FBBF24" />
        <Stat label="PAID" value={fmtEur(paid)} color="#10B981" />
        <Stat label="OVERDUE" value={fmtEur(overdue)} color="#EF4444" />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
        <Stat label="3RD-PARTY COSTS" value={fmtEur(costs)} />
        <Stat label="GROSS MARGIN" value={fmtEur(grossMargin)} color="#0F6E56" />
        <Stat label="MARGIN %" value={`${marginPct}%`} color="#0F6E56" />
        <Stat label="REVISION LOAD" value={String(revisions)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        <div>
          <div style={{ ...sansBold, fontSize: 12, color: PAL.ink, marginBottom: 10 }}>Jobs by finance stage</div>
          {Object.entries(byStatus).map(([k, v]) => (
            <Bar key={k} label={k.replace(/_/g, ' ')} value={v} max={maxStatus} color="#60A5FA" />
          ))}
        </div>
        <div>
          <div style={{ ...sansBold, fontSize: 12, color: PAL.ink, marginBottom: 10 }}>Delivery</div>
          {Object.entries(byDelivery).map(([k, v]) => (
            <Bar key={k} label={k.replace(/_/g, ' ')} value={v} max={Math.max(1, ...Object.values(byDelivery))} color="#34D399" />
          ))}
        </div>
      </div>

      {poool?.connected && (
        <div style={{ marginTop: 24, ...sans, fontSize: 12, color: PAL.muted }}>
          POOOL synced: <b style={{ color: PAL.ink }}>{poool.projects}</b> projects · <b style={{ color: PAL.ink }}>{poool.orders}</b> orders · <b style={{ color: PAL.ink }}>{poool.clients}</b> clients
        </div>
      )}
    </div>
  );
}
