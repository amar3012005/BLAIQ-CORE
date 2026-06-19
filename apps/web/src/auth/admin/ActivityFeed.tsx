// BLAIQ Admin · activity feed — tenant-wide timeline of notifications
// (deliveries, payment reminders, overdue flips, invoices raised). Polls the
// ops.notifications-backed endpoint.

'use client';

import React, { useEffect, useState } from 'react';
import { getActivity, type ActivityItem } from './api';
import { PAL, monoSmall, sans, sansBold, emptyText } from './theme';

const KIND_COLOR: Record<string, string> = {
  delivery: '#10B981',
  payment_overdue: '#EF4444',
  payment_reminder: '#F59E0B',
  quote_followup: '#60A5FA',
  invoice_raised: '#FBBF24',
};

function kindLabel(k: string): string {
  return k.replace(/_/g, ' ');
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ActivityFeed(): JSX.Element {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      getActivity()
        .then((x) => { if (!cancelled) { setItems(x); setError(null); } })
        .catch((e: Error) => { if (!cancelled) setError(e.message); });
    };
    load();
    const t = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ ...monoSmall, color: PAL.muted }}>ACTIVITY · NOTIFICATIONS</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: error ? '#DC2626' : '#22C55E' }} />
      </div>

      {error && <div style={{ ...sans, fontSize: 11, color: '#B45309', marginBottom: 12 }}>{error}</div>}
      {!items && !error && <div style={emptyText}>Loading…</div>}
      {items && items.length === 0 && (
        <div style={emptyText}>No activity yet — deliveries, reminders and overdue flips appear here.</div>
      )}

      {items && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {items.map((it) => {
            const color = KIND_COLOR[it.kind] ?? PAL.muted;
            return (
              <div key={it.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: `1px solid ${PAL.divider}` }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ ...monoSmall, fontSize: 8, color, background: `${color}1A`, padding: '2px 7px' }}>{kindLabel(it.kind)}</span>
                    <span style={{ ...sansBold, fontSize: 12, color: PAL.ink }}>{it.subject}</span>
                  </div>
                </div>
                <span style={{ ...monoSmall, color: PAL.muted, fontSize: 8, flexShrink: 0 }}>{relTime(it.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
