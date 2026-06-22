// BLAIQ Admin · Artifacts — the library of every generated asset across the
// agency's GenAI projects (images, videos, decks, spokespersons). Read-only;
// composes the tenant-scoped /api/projects + /api/projects/:id/files.

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { listArtifacts, type ArtifactItem, type ArtifactKind } from './api';
import { PAL, monoSmall, sansBold, sans, emptyText, title, radius, shadow, pill } from './theme';

const KIND_LABEL: Record<ArtifactKind, string> = {
  image: 'IMAGE', video: 'VIDEO', deck: 'DECK', spokesperson: 'SPOKESPERSON',
};
const KIND_COLOR: Record<ArtifactKind, string> = {
  image: PAL.accent, video: '#2563EB', deck: '#0F6E56', spokesperson: '#7C3AED',
};
const KINDS: Array<ArtifactKind | 'all'> = ['all', 'image', 'video', 'deck', 'spokesperson'];

export default function ArtifactsBoard(): JSX.Element {
  const [items, setItems] = useState<ArtifactItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArtifactKind | 'all'>('all');

  useEffect(() => {
    listArtifacts().then(setItems).catch((e: Error) => setError(e.message));
  }, []);

  const shown = useMemo(
    () => (items ?? []).filter((a) => filter === 'all' || a.kind === filter),
    [items, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of items ?? []) c[a.kind] = (c[a.kind] || 0) + 1;
    return c;
  }, [items]);

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <span style={{ ...title }}>Artifacts</span>
        <span style={{ ...monoSmall, color: PAL.muted }}>GENAI LIBRARY</span>
        {items && <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>{items.length} assets · {Object.keys(counts).length} types</span>}
      </div>

      {/* Kind filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {KINDS.map((k) => {
          const on = filter === k;
          const n = k === 'all' ? (items?.length ?? 0) : (counts[k] || 0);
          return (
            <button key={k} type="button" onClick={() => setFilter(k)}
              style={{ ...monoSmall, fontSize: 9, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? PAL.accent : PAL.divider}`,
                background: on ? PAL.accent : 'transparent', color: on ? PAL.white : PAL.muted }}>
              {k === 'all' ? 'ALL' : KIND_LABEL[k]} {n ? `· ${n}` : ''}
            </button>
          );
        })}
      </div>

      {error && <div style={{ ...sans, fontSize: 12, color: PAL.danger }}>{error}</div>}
      {!items && !error && <div style={emptyText}>Loading the library…</div>}
      {items && items.length === 0 && <div style={emptyText}>No artifacts yet. Generate images, videos, or decks and they appear here.</div>}
      {items && items.length > 0 && shown.length === 0 && <div style={emptyText}>No {filter} artifacts.</div>}

      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
          {shown.map((a) => (
            <a key={`${a.project_id}/${a.name}`} href={a.url} target="_blank" rel="noreferrer"
              className="bq-card"
              style={{ display: 'flex', flexDirection: 'column', background: PAL.white, border: `1px solid ${PAL.divider}`, borderRadius: radius.md, boxShadow: shadow.sm, overflow: 'hidden', textDecoration: 'none' }}>
              <div style={{ aspectRatio: '1 / 1', background: PAL.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {a.kind === 'image' || a.kind === 'spokesperson' ? (
                  <img src={a.url} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : a.kind === 'video' ? (
                  <video src={a.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted preload="metadata" />
                ) : (
                  <span style={{ ...monoSmall, fontSize: 18, color: KIND_COLOR.deck }}>HTML</span>
                )}
              </div>
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...pill(KIND_COLOR[a.kind]) }}>{KIND_LABEL[a.kind]}</span>
                <span style={{ ...sansBold, fontSize: 11.5, color: PAL.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.project_name}</span>
                <span style={{ ...sans, fontSize: 10, color: PAL.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
