// Skills library page — bottom-nav destination listing every skill the daemon
// knows about, with mission-type and artifact-type filters. Surfaces the
// LLM-authored skills produced via @create-skill in chat alongside the
// built-in catalog.

'use client';

import React, { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Search, Sparkles, Plus } from 'lucide-react';

const P = {
  bg: '#F1F0EC',
  card: '#FAFAF7',
  ink: '#111111',
  muted: '#6E6A63',
  border: '#D8D3CB',
  accent: '#FF6A2A',
  white: '#FFFFFF',
};

const mono: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
};

interface SkillEntry {
  id: string;
  name?: string;
  description?: string;
  mode?: string;       // image | video | text | deck | prototype | audio | ...
  surface?: string;
  source?: string;     // user | built-in
  category?: string | null;
  triggers?: unknown[];
}

const MISSION_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'prototype', label: 'Prototype' },
  { id: 'deck', label: 'Deck' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'text', label: 'Text' },
];

export default function SkillsPage(): JSX.Element {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState('');
  const [missionTypeForNew, setMissionTypeForNew] = useState('image');
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const fetchSkills = (): void => {
    setLoading(true);
    fetch('/api/skills', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { skills: [] })
      .then((d) => { setSkills(d.skills ?? []); })
      .catch(() => { /* noop */ })
      .finally(() => { setLoading(false); });
  };
  useEffect(() => { fetchSkills(); }, []);

  // Listen for skills generated via @create-skill in chat so the page
  // refreshes automatically.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { ok?: boolean; error?: string; skill?: SkillEntry } | undefined;
      if (detail?.ok) {
        setToast({ kind: 'ok', text: `Skill "${detail.skill?.name || detail.skill?.id}" created` });
        fetchSkills();
      } else if (detail?.error) {
        setToast({ kind: 'err', text: detail.error });
      }
      window.setTimeout(() => setToast(null), 4000);
    };
    window.addEventListener('blaiq:skill-generated', handler);
    return () => window.removeEventListener('blaiq:skill-generated', handler);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return skills.filter((s) => {
      if (filter !== 'all' && (s.mode || '') !== filter) return false;
      if (!needle) return true;
      const blob = `${s.name || ''} ${s.id} ${s.description || ''} ${(s.triggers || []).join(' ')}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [skills, filter, q]);

  const generateFromBrief = async (): Promise<void> => {
    if (!brief.trim() || generating) return;
    setGenerating(true);
    setToast(null);
    try {
      const r = await fetch('/api/v1/skills/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), mission_type: missionTypeForNew }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setToast({ kind: 'err', text: d?.error || `failed (${r.status})` });
        return;
      }
      setToast({ kind: 'ok', text: `Skill "${d.skill?.name || d.skill?.id}" created` });
      setBrief('');
      fetchSkills();
    } catch (err) {
      setToast({ kind: 'err', text: (err as Error).message });
    } finally {
      setGenerating(false);
      window.setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: P.bg }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ ...mono, color: P.muted, marginBottom: 4 }}>SKILLS LIBRARY</div>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 22, fontWeight: 700, color: P.ink }}>
              Global skills · {skills.length}
            </div>
          </div>
          <div style={{ ...mono, color: P.muted, fontSize: 9 }}>
            tip · type <span style={{ color: P.accent }}>@create-skill &lt;brief&gt;</span> in any chat to author a new skill with the LLM
          </div>
        </div>

        {/* Create panel */}
        <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Sparkles size={14} color={P.accent} />
            <div style={{ ...mono, color: P.muted }}>CREATE A NEW SKILL</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe the skill — what should the agent do, when, what shape should the output take?"
              style={{ flex: 1, minHeight: 70, padding: '8px 10px', background: P.white, border: `1px solid ${P.border}`, fontFamily: '"Inter", sans-serif', fontSize: 12, color: P.ink, resize: 'vertical', outline: 'none' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ ...mono, color: P.muted }}>MISSION TYPE</span>
              <select
                value={missionTypeForNew}
                onChange={(e) => setMissionTypeForNew(e.target.value)}
                style={{ padding: '6px 8px', background: P.white, border: `1px solid ${P.border}`, fontFamily: '"Inter", sans-serif', fontSize: 11, color: P.ink, cursor: 'pointer' }}
              >
                {MISSION_FILTERS.filter((m) => m.id !== 'all').map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={generateFromBrief}
                disabled={!brief.trim() || generating}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: generating ? P.muted : P.ink, color: P.white, border: 'none', cursor: generating ? 'wait' : 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: 700 }}
              >
                <Plus size={12} /> {generating ? 'GENERATING…' : 'CREATE SKILL'}
              </button>
            </div>
          </div>
          {toast && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: toast.kind === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(220,38,38,0.08)', color: toast.kind === 'ok' ? '#15803D' : '#B91C1C', fontFamily: '"Inter", sans-serif', fontSize: 12 }}>
              {toast.text}
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            {MISSION_FILTERS.map((m) => {
              const active = filter === m.id;
              const count = m.id === 'all' ? skills.length : skills.filter((s) => (s.mode || '') === m.id).length;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFilter(m.id)}
                  style={{ padding: '6px 10px', background: active ? P.ink : 'transparent', color: active ? P.white : P.ink, border: `1px solid ${active ? P.ink : P.border}`, fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer' }}
                >
                  {m.label} <span style={{ ...mono, fontSize: 9, marginLeft: 4, opacity: 0.7 }}>{count}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: P.white, border: `1px solid ${P.border}`, minWidth: 220 }}>
            <Search size={12} color={P.muted} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: '"Inter", sans-serif', fontSize: 12, color: P.ink }}
            />
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ ...mono, color: P.muted, padding: 20 }}>LOADING…</div>
        ) : filtered.length === 0 ? (
          <div style={{ ...mono, color: P.muted, padding: 20 }}>No skills match these filters.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map((s) => (
              <div key={s.id} style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 13, fontWeight: 700, color: P.ink, lineHeight: 1.3 }}>
                    {s.name || s.id}
                  </div>
                  <span style={{ ...mono, color: s.source === 'user' ? P.accent : P.muted, fontSize: 8 }}>
                    {s.source === 'user' ? 'USER' : 'BUILT-IN'}
                  </span>
                </div>
                <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, color: P.muted, lineHeight: 1.45, minHeight: 36 }}>
                  {s.description || '(no description)'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {s.mode && (
                    <span style={{ ...mono, padding: '2px 6px', background: P.bg, color: P.ink, border: `1px solid ${P.border}`, fontSize: 8 }}>
                      {s.mode}
                    </span>
                  )}
                  {s.category && (
                    <span style={{ ...mono, padding: '2px 6px', background: P.bg, color: P.muted, border: `1px solid ${P.border}`, fontSize: 8 }}>
                      {s.category}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
