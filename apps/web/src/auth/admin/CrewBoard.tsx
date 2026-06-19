// BLAIQ Admin · AI Crew (Track AA, phase AA5).
// Instead of one Copilot, a crew of specialist agents — Finance, Delivery,
// Account — reviews ONE job in parallel, each from its own remit, and may
// propose an action. Proposals run through the same HITL approval + job-action
// endpoints as the Copilot (AA2). The agency org-chart, as agents.

'use client';

import React, { useEffect, useState } from 'react';
import {
  crewDeliberate, runProposedAction, listJobs,
  type CrewDeliberation, type CrewFinding, type Job,
} from './api';
import { PAL, monoSmall, sansBold, sans } from './theme';

const AUTO = '__auto__';

export default function CrewBoard(): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pick, setPick] = useState<string>(AUTO);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CrewDeliberation | null>(null);
  const [error, setError] = useState<string | null>(null);
  // proposal lifecycle, keyed by finding id: running | done | dismissed
  const [state, setState] = useState<Record<string, 'running' | 'done' | 'dismissed'>>({});

  useEffect(() => {
    void (async () => {
      try { setJobs(await listJobs()); } catch { /* picker stays auto-only */ }
    })();
  }, []);

  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setState({});
    try {
      const r = await crewDeliberate(pick === AUTO ? undefined : pick);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (f: CrewFinding): Promise<void> => {
    if (!f.proposed) return;
    setState(s => ({ ...s, [f.id]: 'running' }));
    try {
      await runProposedAction(f.proposed);
      setState(s => ({ ...s, [f.id]: 'done' }));
    } catch (e) {
      setError(`${f.agent}'s action failed: ${(e as Error).message}`);
      setState(s => { const n = { ...s }; delete n[f.id]; return n; });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>✦ AI Crew</span>
        <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>SPECIALISTS DELIBERATE · YOU APPROVE</span>
      </div>

      {/* Control row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sans, fontSize: 12.5, color: PAL.muted }}>Review</span>
        <select
          value={pick}
          disabled={busy}
          onChange={e => setPick(e.target.value)}
          style={{ padding: '7px 10px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 12.5, color: PAL.ink, borderRadius: 6, outline: 'none' }}
        >
          <option value={AUTO}>Most at-risk job (auto)</option>
          {jobs.map(j => (
            <option key={j.id} value={j.job_number}>{j.job_number} · {j.client || j.title}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => { void run(); }}
          style={{ padding: '8px 16px', background: PAL.accent, border: 'none', cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}
        >
          {busy ? 'DELIBERATING…' : 'CONVENE CREW'}
        </button>
        {result ? <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>{result.model}</span> : null}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>
            {error}
          </div>
        )}

        {!result && !busy && !error && (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 460 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>💰 📦 🤝</div>
            <div style={{ ...sansBold, fontSize: 15, color: PAL.ink, marginBottom: 6 }}>Convene your AI crew</div>
            <div style={{ ...sans, fontSize: 13, color: PAL.muted }}>
              Three specialists — Finance, Delivery, and Account — each review a job from their own angle and propose what to do. You approve.
            </div>
          </div>
        )}

        {busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['💰 Mara · Finance Lead', '📦 Tomas · Delivery Lead', '🤝 Lena · Account Manager'].map(label => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, ...sans, fontSize: 13, color: PAL.muted, border: `1px dashed ${PAL.divider}`, borderRadius: 10, padding: '12px 14px' }}>
                <span>{label}</span>
                <span style={{ ...monoSmall, marginLeft: 'auto' }}>REVIEWING…</span>
              </div>
            ))}
          </div>
        )}

        {result && (
          <>
            <div style={{ ...sans, fontSize: 13, color: PAL.muted }}>
              Crew reviewed <strong style={{ color: PAL.ink }}>{result.job_number}</strong> — {result.title}
            </div>
            {result.findings.map(f => {
              const st = state[f.id];
              return (
                <div key={f.id} style={{ background: PAL.white, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${PAL.accent}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{f.emoji}</span>
                    <span style={{ ...sansBold, fontSize: 13.5, color: PAL.ink }}>{f.agent}</span>
                    <span style={{ ...monoSmall, color: PAL.muted }}>{f.role.toUpperCase()}</span>
                  </div>
                  <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, lineHeight: 1.6, marginBottom: f.proposed ? 12 : 0 }}>
                    {f.assessment}
                  </div>
                  {f.proposed && (
                    st === 'done' ? (
                      <div style={{ ...monoSmall, color: '#0F6E56', background: '#E1F5EE', display: 'inline-block', padding: '6px 12px', borderRadius: 6, fontSize: 9 }}>
                        ✓ DONE — {f.proposed.summary}
                      </div>
                    ) : st === 'dismissed' ? (
                      <div style={{ ...monoSmall, color: PAL.muted, fontSize: 9 }}>DISMISSED</div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ ...monoSmall, color: PAL.accent, fontSize: 8, marginRight: 4 }}>⚡ PROPOSES</span>
                        <span style={{ ...sans, fontSize: 12.5, color: PAL.ink, flex: 1 }}>{f.proposed.summary}</span>
                        <button
                          type="button"
                          disabled={st === 'running'}
                          onClick={() => { void approve(f); }}
                          style={{ border: 'none', background: PAL.accent, color: PAL.white, cursor: st === 'running' ? 'wait' : 'pointer', ...monoSmall, fontSize: 9, padding: '7px 14px', borderRadius: 6 }}
                        >
                          {st === 'running' ? 'RUNNING…' : '✓ APPROVE & RUN'}
                        </button>
                        <button
                          type="button"
                          disabled={st === 'running'}
                          onClick={() => setState(s => ({ ...s, [f.id]: 'dismissed' }))}
                          style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '7px 14px', borderRadius: 6 }}
                        >
                          DISMISS
                        </button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
