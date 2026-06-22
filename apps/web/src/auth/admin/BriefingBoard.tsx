// BLAIQ Admin · AI Daily Briefing (Track AA, phase AA4).
// A proactive "Chief of Staff" digest over the whole job book: one LLM pass
// returns the headline, a cash-watch line, and prioritised insights. Read-only
// — the per-job drill-down lives in the Crew (AA5) and one-click fixes in the
// Supervisor queue. This is the agency's morning standup.

'use client';

import React, { useEffect, useState } from 'react';
import { getBriefing, executeNextAction, type Briefing } from './api';
import { PAL, monoSmall, sansBold, sans } from './theme';

interface Sev { bg: string; fg: string; label: string }
const SEV_LOW: Sev = { bg: 'rgba(15,110,86,0.10)', fg: '#0F6E56', label: 'LOW' };
const SEV: Record<string, Sev> = {
  high: { bg: 'rgba(220,38,38,0.08)', fg: '#B91C1C', label: 'HIGH' },
  medium: { bg: 'rgba(217,119,6,0.10)', fg: '#B45309', label: 'MEDIUM' },
  low: SEV_LOW,
};

export default function BriefingBoard(): JSX.Element {
  const [data, setData] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // per-insight action lifecycle, keyed by index
  const [acted, setActed] = useState<Record<number, 'running' | 'done'>>({});

  const load = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setActed({});
    try {
      setData(await getBriefing());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const runAction = async (idx: number, jobId: string, kind: string): Promise<void> => {
    setActed(s => ({ ...s, [idx]: 'running' }));
    try {
      await executeNextAction(jobId, kind);
      setActed(s => ({ ...s, [idx]: 'done' }));
    } catch (e) {
      setError((e as Error).message);
      setActed(s => { const n = { ...s }; delete n[idx]; return n; });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>✦ Daily Briefing</span>
        <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>CHIEF OF STAFF · WHOLE BOOK</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => { void load(); }}
          style={{ marginLeft: 12, padding: '6px 12px', background: 'transparent', border: `1px solid ${PAL.divider}`, cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.muted, borderRadius: 6 }}
        >
          {busy ? 'BRIEFING…' : '↻ REFRESH'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>
            {error}
          </div>
        )}

        {busy && !data && (
          <div style={{ margin: 'auto', ...sans, fontSize: 13, color: PAL.muted }}>Pulling today's briefing together…</div>
        )}

        {data && (
          <>
            {/* Headline */}
            <div style={{ background: PAL.panelHover, color: PAL.ink, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ ...monoSmall, opacity: 0.6, marginBottom: 8 }}>BRIEFING · {data.generated_on}</div>
              <div style={{ ...sansBold, fontSize: 16, lineHeight: 1.5 }}>{data.headline}</div>
              {data.cash_watch ? (
                <div style={{ ...sans, fontSize: 13, opacity: 0.85, marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>💶</span><span>{data.cash_watch}</span>
                </div>
              ) : null}
            </div>

            {/* Insights */}
            {data.insights.map((ins, i) => {
              const sev = SEV[ins.severity] ?? SEV_LOW;
              return (
                <div key={i} style={{ background: PAL.panel, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${sev.fg}`, borderRadius: 10, padding: '13px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ ...monoSmall, fontSize: 8, color: sev.fg, background: sev.bg, padding: '3px 7px', borderRadius: 4 }}>{sev.label}</span>
                    <span style={{ ...sansBold, fontSize: 13.5, color: PAL.ink }}>{ins.title}</span>
                    {ins.job_number ? <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>{ins.job_number}</span> : null}
                  </div>
                  <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, lineHeight: 1.6 }}>{ins.detail}</div>
                  {ins.act_kind && ins.job_id ? (
                    acted[i] === 'done' ? (
                      <div style={{ ...monoSmall, color: '#0F6E56', background: '#E1F5EE', display: 'inline-block', padding: '5px 10px', borderRadius: 6, fontSize: 9, marginTop: 10 }}>
                        ✓ DONE — {ins.act_label ?? ins.act_kind}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                        <span style={{ ...monoSmall, fontSize: 8, color: sev.fg }}>→ NEXT</span>
                        <span style={{ ...sans, fontSize: 12.5, color: PAL.ink, flex: 1 }}>{ins.action ?? ins.act_label}</span>
                        <button
                          type="button"
                          disabled={acted[i] === 'running'}
                          onClick={() => { void runAction(i, ins.job_id!, ins.act_kind!); }}
                          style={{ border: 'none', background: PAL.panelHover, color: PAL.ink, cursor: acted[i] === 'running' ? 'wait' : 'pointer', ...monoSmall, fontSize: 9, padding: '6px 12px', borderRadius: 6 }}
                        >
                          {acted[i] === 'running' ? 'RUNNING…' : `✓ ${(ins.act_label ?? 'DO IT').toUpperCase()}`}
                        </button>
                      </div>
                    )
                  ) : ins.action ? (
                    <div style={{ ...sans, fontSize: 12.5, color: sev.fg, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...monoSmall, fontSize: 8 }}>→ NEXT</span>
                      <span>{ins.action}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div style={{ ...monoSmall, color: PAL.muted, textAlign: 'right' }}>{data.model}</div>
          </>
        )}
      </div>
    </div>
  );
}
