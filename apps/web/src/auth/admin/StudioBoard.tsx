// BLAIQ Admin · GenAI Studio (Track B).
// Brand-locked creative output: social artifacts (Instagram/LinkedIn/X/Facebook/
// report) with a one-click "post" to the platform's prefilled composer, plus
// deck generation + export. All driven by Brand DNA + Brand Tone.

'use client';

import React, { useState } from 'react';
import { generateSocial, generateDeck, generateCampaign, generateHooks, type SocialArtifact, type SocialPlatform, type DeckResult, type Campaign, type HooksResult } from './api';
import { PAL, monoSmall, sansBold, sans } from './theme';
import { openCampaignKit } from './campaignKit';

const LANGS: { id: string; label: string }[] = [
  { id: '', label: 'Brand default' },
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'nl', label: 'Nederlands' },
];

function LangSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }): JSX.Element {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      title="Output language"
      style={{ padding: '9px 10px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 12.5, color: PAL.ink, outline: 'none', borderRadius: 6, cursor: 'pointer' }}>
      {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
    </select>
  );
}

const PLATFORMS: { id: SocialPlatform; label: string; canPost: boolean }[] = [
  { id: 'linkedin', label: 'LinkedIn', canPost: true },
  { id: 'instagram', label: 'Instagram', canPost: false },
  { id: 'x', label: 'X', canPost: true },
  { id: 'facebook', label: 'Facebook', canPost: true },
  { id: 'report', label: 'Report', canPost: false },
];

export default function StudioBoard(): JSX.Element {
  const [mode, setMode] = useState<'campaign' | 'social' | 'deck' | 'hooks'>('campaign');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>✦ GenAI Studio</span>
        <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>BRAND DNA + TONE · ON-BRAND BY DEFAULT</span>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '12px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        {(['campaign', 'social', 'deck', 'hooks'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ ...monoSmall, fontSize: 9, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${mode === m ? PAL.accent : PAL.divider}`,
              background: mode === m ? PAL.accent : 'transparent', color: mode === m ? PAL.white : PAL.muted }}>
            {m === 'campaign' ? '✦ CAMPAIGN' : m === 'social' ? 'SOCIAL & CONTENT' : m === 'deck' ? 'DECKS' : 'HOOKS & VIRALITY'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mode === 'campaign' ? <CampaignView /> : mode === 'social' ? <Social /> : mode === 'deck' ? <Deck /> : <Hooks />}
      </div>
    </div>
  );
}

function Social(): JSX.Element {
  const [platform, setPlatform] = useState<SocialPlatform>('linkedin');
  const [topic, setTopic] = useState('');
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState(false);
  const [art, setArt] = useState<SocialArtifact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (): Promise<void> => {
    if (!topic.trim() || busy) return;
    setBusy(true); setErr(null); setArt(null); setCopied(false);
    try { setArt(await generateSocial(platform, topic.trim(), lang)); }
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
        <LangSelect value={lang} onChange={setLang} disabled={busy} />
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

function openHtml(html: string, title: string, download: boolean): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  if (download) {
    const a = document.createElement('a');
    a.href = url; a.download = `${title.replace(/[^\w-]+/g, '_')}.html`;
    document.body.appendChild(a); a.click(); a.remove();
  } else {
    window.open(url, '_blank');
  }
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Hooks(): JSX.Element {
  const [concept, setConcept] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<HooksResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const run = async (): Promise<void> => {
    if (!concept.trim() || busy) return;
    setBusy(true); setErr(null); setRes(null); setCopied(null);
    try { setRes(await generateHooks(concept.trim())); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: PAL.white, border: `1px solid ${PAL.divider}`, borderRadius: 10, padding: '14px 16px' };
  const scoreColor = (s: number): string => (s >= 75 ? '#0F6E56' : s >= 50 ? '#B45309' : '#B91C1C');

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...sans, fontSize: 13, color: PAL.muted }}>
        Felix, the crew Editor, runs a final QA: proven 3-second openers + an honest stop-the-scroll score — in your Brand Tone.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={concept} disabled={busy} onChange={e => setConcept(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void run(); }}
          placeholder="Paste a concept, script, or campaign idea to QA"
          style={{ flex: 1, padding: '9px 12px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 13, color: PAL.ink, outline: 'none', borderRadius: 6 }} />
        <button type="button" disabled={busy || !concept.trim()} onClick={() => { void run(); }}
          style={{ padding: '9px 16px', background: PAL.accent, border: 'none', cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}>
          {busy ? 'SCORING…' : '✦ QA THIS'}
        </button>
      </div>

      {err && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>{err}</div>}

      {res && (
        <>
          {/* Virality score */}
          <div style={{ background: PAL.ink, color: PAL.white, borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ ...sansBold, fontSize: 34, color: scoreColor(res.virality.score) }}>{res.virality.score}</span>
              <span style={{ ...monoSmall, opacity: 0.6 }}>/ 100 VIRALITY</span>
            </div>
            <div style={{ ...sans, fontSize: 13.5, opacity: 0.92, marginTop: 8 }}>{res.virality.verdict}</div>
            <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
              {res.virality.strengths.length > 0 && (
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ ...monoSmall, opacity: 0.6, marginBottom: 6 }}>STRENGTHS</div>
                  {res.virality.strengths.map((s, i) => <div key={i} style={{ ...sans, fontSize: 12.5, opacity: 0.9, marginBottom: 4 }}>+ {s}</div>)}
                </div>
              )}
              {res.virality.improvements.length > 0 && (
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ ...monoSmall, opacity: 0.6, marginBottom: 6 }}>RAISE THE SCORE</div>
                  {res.virality.improvements.map((s, i) => <div key={i} style={{ ...sans, fontSize: 12.5, opacity: 0.9, marginBottom: 4 }}>→ {s}</div>)}
                </div>
              )}
            </div>
          </div>

          {/* Hook variants */}
          {res.hooks.map((h, i) => (
            <div key={i} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ ...monoSmall, fontSize: 8, color: PAL.accent }}>{(h.angle || 'HOOK').toUpperCase()}</span>
                <button type="button"
                  onClick={() => { void navigator.clipboard.writeText(h.text).then(() => setCopied(i)).catch(() => {}); }}
                  style={{ marginLeft: 'auto', border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '4px 9px', borderRadius: 6 }}>
                  {copied === i ? '✓ COPIED' : 'COPY'}
                </button>
              </div>
              <div style={{ ...sansBold, fontSize: 15, color: PAL.ink, lineHeight: 1.4 }}>“{h.text}”</div>
              {h.why && <div style={{ ...sans, fontSize: 12.5, color: PAL.muted, marginTop: 6 }}>{h.why}</div>}
            </div>
          ))}
          <div style={{ ...monoSmall, color: PAL.muted, fontSize: 8 }}>EDITOR · {res.model}</div>
        </>
      )}
    </div>
  );
}

function CampaignView(): JSX.Element {
  const [brief, setBrief] = useState('');
  const [lang, setLang] = useState('');
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState<Campaign | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (!brief.trim() || busy) return;
    setBusy(true); setErr(null); setC(null);
    try { setC(await generateCampaign(brief.trim(), ['linkedin', 'instagram'], true, lang)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const card: React.CSSProperties = { background: PAL.white, border: `1px solid ${PAL.divider}`, borderRadius: 10, padding: '14px 16px' };
  const lbl: React.CSSProperties = { ...monoSmall, fontSize: 8, color: PAL.accent, marginBottom: 6 };

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...sans, fontSize: 13, color: PAL.muted }}>
        One brief → a full on-brand campaign: concept, deck, social posts, and image/video briefs — all from your Brand DNA + Tone.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={brief} disabled={busy} onChange={e => setBrief(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void run(); }}
          placeholder="Campaign brief — e.g. Launch our new AI brand platform"
          style={{ flex: 1, padding: '9px 12px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 13, color: PAL.ink, outline: 'none', borderRadius: 6 }} />
        <LangSelect value={lang} onChange={setLang} disabled={busy} />
        <button type="button" disabled={busy || !brief.trim()} onClick={() => { void run(); }}
          style={{ padding: '9px 18px', background: PAL.accent, border: 'none', cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}>
          {busy ? 'ORCHESTRATING…' : '✦ BUILD CAMPAIGN'}
        </button>
      </div>

      {err && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>{err}</div>}

      {c && (
        <>
          {/* Concept */}
          <div style={{ background: PAL.ink, color: PAL.white, borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ ...monoSmall, opacity: 0.6, marginBottom: 8 }}>CAMPAIGN · {c.model}</div>
            <div style={{ ...sansBold, fontSize: 18, lineHeight: 1.3 }}>{c.headline}</div>
            <div style={{ ...sans, fontSize: 13.5, opacity: 0.9, marginTop: 10 }}>{c.big_idea}</div>
            <div style={{ ...sans, fontSize: 12.5, opacity: 0.7, marginTop: 8 }}>Key message: {c.key_message}</div>
            {c.channels.length > 0 && <div style={{ ...monoSmall, opacity: 0.6, marginTop: 10 }}>{c.channels.join(' · ')}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              {c.od_project_url && (
                <a href={c.od_project_url} target="_blank" rel="noreferrer"
                  style={{ textDecoration: 'none', background: PAL.accent, color: PAL.white, ...monoSmall, fontSize: 9, padding: '7px 14px', borderRadius: 6 }}>
                  ↗ OPEN IN OPEN DESIGN
                </a>
              )}
              {c.job_number && <span style={{ ...monoSmall, opacity: 0.7, fontSize: 8 }}>LINKED JOB · {c.job_number}</span>}
              <button type="button" onClick={() => openCampaignKit(c, false)}
                style={{ border: `1px solid rgba(255,255,255,0.3)`, background: 'transparent', color: PAL.white, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '7px 12px', borderRadius: 6 }}>
                ↗ CAMPAIGN KIT
              </button>
              <button type="button" onClick={() => openCampaignKit(c, true)}
                style={{ border: `1px solid rgba(255,255,255,0.3)`, background: 'transparent', color: PAL.white, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '7px 12px', borderRadius: 6 }}>
                ⬇ DOWNLOAD KIT
              </button>
              {c.od_project_id && <span style={{ ...monoSmall, opacity: 0.5, fontSize: 8 }}>saved as a real OD project · deck.html + campaign.md</span>}
            </div>
          </div>

          {/* Hero key visual (real rendered brand image) */}
          {c.hero_image_path && (
            <div style={card}>
              <div style={lbl}>KEY VISUAL — RENDERED</div>
              <img src={c.hero_image_path} alt="campaign key visual" style={{ width: '100%', maxWidth: 640, borderRadius: 8, display: 'block' }} />
            </div>
          )}

          {/* Deck */}
          {c.deck_html && (
            <div style={card}>
              <div style={lbl}>DECK · {c.deck_slides} SLIDES</div>
              <div style={{ ...sansBold, fontSize: 13.5, color: PAL.ink, marginBottom: 10 }}>{c.deck_title}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => openHtml(c.deck_html!, c.deck_title || 'deck', false)}
                  style={{ border: 'none', background: PAL.accent, color: PAL.white, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '7px 14px', borderRadius: 6 }}>↗ OPEN</button>
                <button type="button" onClick={() => openHtml(c.deck_html!, c.deck_title || 'deck', true)}
                  style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '7px 14px', borderRadius: 6 }}>⬇ DOWNLOAD</button>
              </div>
            </div>
          )}

          {/* Social */}
          {c.social.map((s, i) => (
            <div key={i} style={card}>
              <div style={lbl}>{s.platform.toUpperCase()}</div>
              <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{s.body}</div>
              {s.hashtags.length > 0 && <div style={{ ...sans, fontSize: 13, color: PAL.accent, marginTop: 8 }}>{s.hashtags.join(' ')}</div>}
              {s.share_url && (
                <a href={s.share_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none', background: PAL.accent, color: PAL.white, ...monoSmall, fontSize: 9, padding: '7px 14px', borderRadius: 6 }}>
                  ↗ POST TO {s.platform.toUpperCase()}
                </a>
              )}
            </div>
          ))}

          {/* Briefs for image + video (ready to render) */}
          {c.image_brief && (
            <div style={card}><div style={lbl}>KEY VISUAL — IMAGE BRIEF</div>
              <div style={{ ...sans, fontSize: 13, color: PAL.ink, lineHeight: 1.6 }}>{c.image_brief}</div></div>
          )}
          {c.video_brief && (
            <div style={card}><div style={lbl}>VIDEO — TEASER BRIEF</div>
              <div style={{ ...sans, fontSize: 13, color: PAL.ink, lineHeight: 1.6 }}>{c.video_brief}</div></div>
          )}
        </>
      )}
    </div>
  );
}
