// BLAIQ Admin · GenAI Studio (Track B).
// Brand-locked creative output: social artifacts (Instagram/LinkedIn/X/Facebook/
// report) with a one-click "post" to the platform's prefilled composer, plus
// deck generation + export. All driven by Brand DNA + Brand Tone.

'use client';

import React, { useState } from 'react';
import { generateSocial, generateDeck, type SocialArtifact, type SocialPlatform, type DeckResult } from './api';
import { PAL, monoSmall, sansBold, sans } from './theme';

const PLATFORMS: { id: SocialPlatform; label: string; canPost: boolean }[] = [
  { id: 'linkedin', label: 'LinkedIn', canPost: true },
  { id: 'instagram', label: 'Instagram', canPost: false },
  { id: 'x', label: 'X', canPost: true },
  { id: 'facebook', label: 'Facebook', canPost: true },
  { id: 'report', label: 'Report', canPost: false },
];

export default function StudioBoard(): JSX.Element {
  const [mode, setMode] = useState<'social' | 'deck'>('social');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>✦ GenAI Studio</span>
        <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>BRAND DNA + TONE · ON-BRAND BY DEFAULT</span>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '12px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        {(['social', 'deck'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ ...monoSmall, fontSize: 9, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${mode === m ? PAL.accent : PAL.divider}`,
              background: mode === m ? PAL.accent : 'transparent', color: mode === m ? PAL.white : PAL.muted }}>
            {m === 'social' ? 'SOCIAL & CONTENT' : 'DECKS'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mode === 'social' ? <Social /> : <Deck />}
      </div>
    </div>
  );
}

function Social(): JSX.Element {
  const [platform, setPlatform] = useState<SocialPlatform>('linkedin');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [art, setArt] = useState<SocialArtifact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (): Promise<void> => {
    if (!topic.trim() || busy) return;
    setBusy(true); setErr(null); setArt(null); setCopied(false);
    try { setArt(await generateSocial(platform, topic.trim())); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const copy = async (): Promise<void> => {
    if (!art) return;
    const full = art.body + (art.hashtags.length ? '\n\n' + art.hashtags.join(' ') : '');
    try { await navigator.clipboard.writeText(full); setCopied(true); } catch { /* ignore */ }
  };

  const meta = PLATFORMS.find(p => p.id === art?.platform);

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PLATFORMS.map(p => (
          <button key={p.id} type="button" disabled={busy} onClick={() => setPlatform(p.id)}
            style={{ ...sans, fontSize: 12.5, padding: '6px 12px', borderRadius: 16, cursor: 'pointer',
              border: `1px solid ${platform === p.id ? PAL.accent : PAL.divider}`,
              background: platform === p.id ? 'rgba(255,96,8,0.08)' : PAL.panel,
              color: platform === p.id ? PAL.ink : PAL.muted }}>
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={topic} disabled={busy} onChange={e => setTopic(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void run(); }}
          placeholder={`What should the ${platform} post be about?`}
          style={{ flex: 1, padding: '9px 12px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 13, color: PAL.ink, outline: 'none', borderRadius: 6 }} />
        <button type="button" disabled={busy || !topic.trim()} onClick={() => { void run(); }}
          style={{ padding: '9px 16px', background: PAL.accent, border: 'none', cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}>
          {busy ? 'WRITING…' : '✦ GENERATE'}
        </button>
      </div>

      {err && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>{err}</div>}

      {art && (
        <div style={{ background: PAL.white, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${PAL.accent}`, borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ ...monoSmall, fontSize: 8, color: PAL.accent }}>{art.platform.toUpperCase()}</span>
            <span style={{ ...sansBold, fontSize: 13.5, color: PAL.ink }}>{art.title}</span>
            <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto', fontSize: 8 }}>{art.char_count} chars · {art.model}</span>
          </div>
          <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{art.body}</div>
          {art.hashtags.length > 0 && (
            <div style={{ ...sans, fontSize: 13, color: PAL.accent, marginTop: 10 }}>{art.hashtags.join(' ')}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {art.share_url ? (
              <a href={art.share_url} target="_blank" rel="noreferrer"
                style={{ textDecoration: 'none', border: 'none', background: PAL.accent, color: PAL.white, ...monoSmall, fontSize: 9, padding: '8px 14px', borderRadius: 6 }}>
                ↗ POST TO {meta?.label.toUpperCase()}
              </a>
            ) : (
              <span style={{ ...monoSmall, fontSize: 8, color: PAL.muted, alignSelf: 'center' }}>
                {art.platform === 'report' ? 'REPORT — COPY OR EXPORT' : 'INSTAGRAM — COPY, THEN PASTE IN APP'}
              </span>
            )}
            <button type="button" onClick={() => { void copy(); }}
              style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '8px 14px', borderRadius: 6 }}>
              {copied ? '✓ COPIED' : 'COPY'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Deck(): JSX.Element {
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [deck, setDeck] = useState<DeckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (!topic.trim() || busy) return;
    setBusy(true); setErr(null); setDeck(null);
    try { setDeck(await generateDeck(topic.trim())); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const openOrDownload = (download: boolean): void => {
    if (!deck) return;
    const blob = new Blob([deck.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    if (download) {
      const a = document.createElement('a');
      a.href = url; a.download = `${deck.title.replace(/[^\w-]+/g, '_')}.html`;
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      window.open(url, '_blank');
    }
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={topic} disabled={busy} onChange={e => setTopic(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void run(); }}
          placeholder="Deck topic — e.g. Markenstrategie 2026"
          style={{ flex: 1, padding: '9px 12px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 13, color: PAL.ink, outline: 'none', borderRadius: 6 }} />
        <button type="button" disabled={busy || !topic.trim()} onClick={() => { void run(); }}
          style={{ padding: '9px 16px', background: PAL.accent, border: 'none', cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}>
          {busy ? 'DESIGNING…' : '✦ GENERATE DECK'}
        </button>
      </div>

      {err && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>{err}</div>}

      {deck && (
        <div style={{ background: PAL.white, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${PAL.accent}`, borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ ...sansBold, fontSize: 14, color: PAL.ink, marginBottom: 4 }}>{deck.title}</div>
          <div style={{ ...sans, fontSize: 12.5, color: PAL.muted, marginBottom: 14 }}>{deck.slide_count} slides · brand-locked · {deck.model}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => openOrDownload(false)}
              style={{ border: 'none', background: PAL.accent, color: PAL.white, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '8px 14px', borderRadius: 6 }}>
              ↗ OPEN
            </button>
            <button type="button" onClick={() => openOrDownload(true)}
              style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '8px 14px', borderRadius: 6 }}>
              ⬇ DOWNLOAD .HTML
            </button>
          </div>
          <div style={{ ...sans, fontSize: 11.5, color: PAL.muted, marginTop: 10 }}>Tip: open → browser “Save as PDF” for a deck PDF.</div>
        </div>
      )}
    </div>
  );
}
