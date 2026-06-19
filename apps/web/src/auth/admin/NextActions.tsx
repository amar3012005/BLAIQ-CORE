// BLAIQ Admin · Supervisor next-actions (Track AA). A rule-based queue of the
// agency's most pressing moves — chase overdue payments, invoice delivered
// jobs, follow up aging quotes — each a one-click (HITL) action. No LLM needed.

'use client';

import React, { useEffect, useState } from 'react';
import { listNextActions, executeNextAction, executeNextActionsBatch, type NextAction } from './api';
import { PAL, monoSmall, sansBold, sans, emptyText } from './theme';

const PRIORITY_COLOR: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#9CA3AF',
};

export default function NextActions({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const [actions, setActions] = useState<NextAction[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (): void => {
    listNextActions().then(setActions).catch((e: Error) => setErr(e.message));
  };

  useEffect(load, []);

  const runAll = async (): Promise<void> => {
    if (!actions || actions.length === 0 || runningAll) return;
    setRunningAll(true);
    setErr(null);
    setNote(null);
    const batch = actions.map(a => ({ job_id: a.job_id, kind: a.kind }));
    try {
      const results = await executeNextActionsBatch(batch);
      const done = results.filter(r => r.ok).length;
      setActions([]);
      setNote(`Ran ${done}/${results.length} action${results.length === 1 ? '' : 's'}.`);
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunningAll(false);
    }
  };

  const run = async (a: NextAction): Promise<void> => {
    const key = `${a.job_id}:${a.kind}`;
    setBusy(key);
    setErr(null);
    try {
      await executeNextAction(a.job_id, a.kind);
      setActions(prev => (prev ? prev.filter(x => !(x.job_id === a.job_id && x.kind === a.kind)) : prev));
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}`, background: PAL.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ ...monoSmall, color: PAL.muted }}>SUPERVISOR · NEXT ACTIONS</span>
        {actions && <span style={{ ...monoSmall, color: PAL.muted }}>· {actions.length}</span>}
        {actions && actions.length > 0 && (
          <button
            type="button"
            disabled={runningAll}
            onClick={() => { void runAll(); }}
            style={{ marginLeft: 'auto', border: 'none', background: PAL.accent, color: PAL.white, cursor: runningAll ? 'wait' : 'pointer', ...monoSmall, fontSize: 8, padding: '4px 10px' }}
          >
            {runningAll ? 'RUNNING…' : `⚡ RUN ALL ${actions.length}`}
          </button>
        )}
        <button
          type="button"
          onClick={load}
          style={{ marginLeft: actions && actions.length > 0 ? 6 : 'auto', border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '3px 8px' }}
        >
          REFRESH
        </button>
      </div>

      {note && <div style={{ ...sans, fontSize: 11, color: '#0F6E56', marginBottom: 8 }}>{note}</div>}
      {err && <div style={{ ...sans, fontSize: 11, color: '#B45309', marginBottom: 8 }}>{err}</div>}
      {!actions && !err && <div style={emptyText}>Scanning jobs…</div>}
      {actions && actions.length === 0 && (
        <div style={emptyText}>Nothing needs attention — every job is on track. ✓</div>
      )}

      {actions && actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {actions.map(a => {
            const key = `${a.job_id}:${a.kind}`;
            return (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: PAL.white, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${PRIORITY_COLOR[a.priority] ?? PAL.muted}`, padding: '8px 12px' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ ...sansBold, fontSize: 12, color: PAL.ink }}>{a.label}</span>
                    <span style={{ ...monoSmall, color: PAL.muted, fontSize: 8 }}>{a.job_number} · {a.client}</span>
                  </div>
                  <div style={{ ...sans, fontSize: 11, color: PAL.muted }}>{a.detail}</div>
                </div>
                <button
                  type="button"
                  disabled={busy === key}
                  onClick={() => { void run(a); }}
                  style={{ border: 'none', background: PAL.ink, color: PAL.white, cursor: busy === key ? 'wait' : 'pointer', ...monoSmall, fontSize: 8, padding: '6px 12px' }}
                >
                  {busy === key ? '…' : 'DO IT'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
