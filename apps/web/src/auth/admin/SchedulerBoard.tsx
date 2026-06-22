// BLAIQ Admin · Scheduler — recurring on-brand content automation.
// Define schedules (platform · topic · language · cadence); the ops-brain
// runner generates a brand-locked draft each cycle into the drafts feed for
// review + one-click posting. "Run now" fires immediately.

'use client';

import React, { useEffect, useState } from 'react';
import {
  listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, listContentRuns,
  type ContentSchedule, type ContentRun,
} from './api';
import { PAL, monoSmall, sansBold, sans, emptyText, title, radius, shadow, pill } from './theme';

const PLATFORMS = ['linkedin', 'instagram', 'x', 'facebook'];
const LANGS = [
  { id: '', label: 'Brand default' }, { id: 'de', label: 'Deutsch' }, { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' }, { id: 'es', label: 'Español' },
];

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso.slice(0, 16); }
}

export default function SchedulerBoard(): JSX.Element {
  const [schedules, setSchedules] = useState<ContentSchedule[] | null>(null);
  const [runs, setRuns] = useState<ContentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // schedule id being acted on, or 'create'

  // Create form
  const [platform, setPlatform] = useState('linkedin');
  const [topic, setTopic] = useState('');
  const [lang, setLang] = useState('');
  const [cadence, setCadence] = useState('weekly');

  const reload = async (): Promise<void> => {
    try {
      const [s, r] = await Promise.all([listSchedules(), listContentRuns()]);
      setSchedules(s); setRuns(r);
    } catch (e) { setError((e as Error).message); }
  };

  useEffect(() => { void reload(); }, []);

  const create = async (): Promise<void> => {
    if (!topic.trim() || busy) return;
    setBusy('create'); setError(null);
    try { await createSchedule({ platform, topic: topic.trim(), lang, cadence }); setTopic(''); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const act = async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(id); setError(null);
    try { await fn(); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const inputStyle: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 12.5, color: PAL.ink, outline: 'none', borderRadius: 6 };
  const selStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <span style={{ ...title }}>Scheduler</span>
        <span style={{ ...monoSmall, color: PAL.muted }}>RECURRING ON-BRAND CONTENT</span>
      </div>
      <div style={{ ...sans, fontSize: 12.5, color: PAL.muted, marginBottom: 16, maxWidth: 760 }}>
        Set it once — the studio generates a brand-locked draft on your cadence and drops it in the feed below to review and post. Brand DNA + Tone govern every draft.
      </div>

      {error && <div style={{ ...sans, fontSize: 12, color: PAL.danger, marginBottom: 12 }}>{error}</div>}

      {/* Create */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20, maxWidth: 860 }}>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={selStyle}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
          placeholder="Theme — e.g. weekly brand insight, hiring, case study" style={{ ...inputStyle, flex: 1, minWidth: 240 }} />
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={selStyle}>
          {LANGS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} style={selStyle}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <button type="button" disabled={!topic.trim() || busy === 'create'} onClick={() => { void create(); }}
          style={{ padding: '8px 16px', background: PAL.accent, border: 'none', cursor: busy === 'create' ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}>
          {busy === 'create' ? 'ADDING…' : '+ SCHEDULE'}
        </button>
      </div>

      {/* Schedules */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 8 }}>SCHEDULES {schedules ? `· ${schedules.length}` : ''}</div>
      {!schedules && !error && <div style={emptyText}>Loading…</div>}
      {schedules && schedules.length === 0 && <div style={{ ...emptyText, marginBottom: 20 }}>No schedules yet. Add one above.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {(schedules ?? []).map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: PAL.panel, border: `1px solid ${PAL.divider}`, borderRadius: radius.md, boxShadow: shadow.sm, padding: '12px 14px', maxWidth: 860 }}>
            <span style={{ ...pill(s.enabled ? PAL.ok : PAL.muted) }}>{s.enabled ? 'ON' : 'PAUSED'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...sansBold, fontSize: 13, color: PAL.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</div>
              <div style={{ ...monoSmall, color: PAL.muted, fontSize: 8, marginTop: 3 }}>
                {s.platform.toUpperCase()} · {s.cadence.toUpperCase()}{s.lang ? ` · ${s.lang.toUpperCase()}` : ''} · {s.runs} RUN{s.runs === 1 ? '' : 'S'} · NEXT {fmt(s.next_run_at)}
              </div>
            </div>
            <button type="button" disabled={busy === s.id} onClick={() => { void act(s.id, () => runScheduleNow(s.id)); }}
              style={{ border: `1px solid ${PAL.accent}`, background: 'transparent', color: PAL.accent, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '6px 10px', borderRadius: 6 }}>
              {busy === s.id ? '…' : '▶ RUN NOW'}
            </button>
            <button type="button" disabled={busy === s.id} onClick={() => { void act(s.id, () => updateSchedule(s.id, { enabled: !s.enabled })); }}
              style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '6px 10px', borderRadius: 6 }}>
              {s.enabled ? 'PAUSE' : 'RESUME'}
            </button>
            <button type="button" disabled={busy === s.id} onClick={() => { if (window.confirm(`Delete this schedule?`)) void act(s.id, () => deleteSchedule(s.id)); }}
              style={{ border: 'none', background: 'transparent', color: PAL.muted, cursor: 'pointer', fontSize: 13, padding: '0 4px' }} title="Delete">✕</button>
          </div>
        ))}
      </div>

      {/* Drafts feed */}
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 8 }}>GENERATED DRAFTS {runs.length ? `· ${runs.length}` : ''}</div>
      {runs.length === 0 && <div style={emptyText}>Drafts appear here as schedules run (or hit “Run now”).</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
        {runs.map((r) => (
          <div key={r.id} style={{ background: PAL.panel, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${PAL.accent}`, borderRadius: radius.md, boxShadow: shadow.sm, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ ...monoSmall, fontSize: 8, color: PAL.accent }}>{r.platform.toUpperCase()}</span>
              <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto', fontSize: 8 }}>{fmt(r.created_at)}</span>
            </div>
            <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{r.body}</div>
            {r.hashtags.length > 0 && <div style={{ ...sans, fontSize: 13, color: PAL.accent, marginTop: 8 }}>{r.hashtags.join(' ')}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {r.share_url && (
                <a href={r.share_url} target="_blank" rel="noreferrer"
                  style={{ textDecoration: 'none', background: PAL.accent, color: PAL.white, ...monoSmall, fontSize: 8, padding: '7px 12px', borderRadius: 6 }}>
                  ↗ POST TO {r.platform.toUpperCase()}
                </a>
              )}
              <button type="button" onClick={() => { void navigator.clipboard.writeText(r.body + (r.hashtags.length ? '\n\n' + r.hashtags.join(' ') : '')).catch(() => {}); }}
                style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '7px 12px', borderRadius: 6 }}>
                COPY
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
