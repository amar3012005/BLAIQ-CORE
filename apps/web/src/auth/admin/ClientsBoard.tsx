// BLAIQ Admin · Clients — per-client rollup of the agency's book.
// Jobs, quoted/invoiced/paid, overdue, last activity. Read-only, no LLM.

'use client';

import React, { useEffect, useState } from 'react';
import { getClients, type ClientRollup } from './api';
import { PAL, monoSmall, sansBold, sans, emptyText, title, shadow, radius } from './theme';

function eur(v: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);
}

export default function ClientsBoard(): JSX.Element {
  const [rows, setRows] = useState<ClientRollup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClients().then(setRows).catch((e: Error) => setError(e.message));
  }, []);

  const totalQuoted = (rows ?? []).reduce((s, r) => s + r.quoted, 0);
  const totalOverdue = (rows ?? []).reduce((s, r) => s + r.overdue_amount, 0);

  const cell: React.CSSProperties = { ...sans, fontSize: 12.5, color: PAL.ink, padding: '10px 12px', borderBottom: `1px solid ${PAL.divider}` };
  const head: React.CSSProperties = { ...monoSmall, fontSize: 8, color: PAL.muted, padding: '8px 12px', textAlign: 'right', borderBottom: `1px solid ${PAL.divider}` };

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ ...title }}>Clients</span>
        <span style={{ ...monoSmall, color: PAL.muted }}>PER-CLIENT BOOK</span>
        {rows && <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>{rows.length} clients · {eur(totalQuoted)} quoted · {eur(totalOverdue)} overdue</span>}
      </div>

      {error && <div style={{ ...sans, fontSize: 12, color: PAL.danger }}>{error}</div>}
      {!rows && !error && <div style={emptyText}>Loading…</div>}
      {rows && rows.length === 0 && <div style={emptyText}>No clients with jobs yet.</div>}

      {rows && rows.length > 0 && (
        <div style={{ background: PAL.white, border: `1px solid ${PAL.divider}`, borderRadius: radius.md, boxShadow: shadow.sm, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: 'left' }}>CLIENT</th>
                <th style={head}>JOBS</th>
                <th style={head}>QUOTED</th>
                <th style={head}>INVOICED</th>
                <th style={head}>PAID</th>
                <th style={head}>OVERDUE</th>
                <th style={{ ...head, textAlign: 'left' }}>LAST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.client} className="bq-row">
                  <td style={{ ...cell, ...sansBold }}>{r.client}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{r.jobs}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{eur(r.quoted)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{eur(r.invoiced)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: r.paid > 0 ? PAL.ok : PAL.muted }}>{eur(r.paid)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: r.overdue_amount > 0 ? PAL.danger : PAL.muted }}>
                    {r.overdue_amount > 0 ? `${eur(r.overdue_amount)} · ${r.overdue_count}` : '—'}
                  </td>
                  <td style={{ ...cell, ...monoSmall, fontSize: 9, color: PAL.muted }}>{r.last_activity ? r.last_activity.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
