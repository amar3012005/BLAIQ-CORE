// BLAIQ Admin · Intake (workflow PDF step 1→2).
// Paste a client inquiry (email / Protonet text); the AI drafts a Job — title,
// client, scope — and creates it in BLAIQ (quote_pending, not yet in POOOL).
// Source-agnostic: this is the manual path; an email/Protonet poller can POST
// the same /api/jobs/intake endpoint later.

'use client';

import React, { useState } from 'react';
import { intakeJob, productIntake, type Job, type ProductProfile } from './api';
import { PAL, monoSmall, sansBold, sans } from './theme';

const SAMPLE = `Betreff: Anfrage Imagebroschüre

Hallo, wir sind die Voss Logistik GmbH und brauchen eine neue 12-seitige
Imagebroschüre für die Messe im Herbst. Budget liegt bei ca. 9.000 €.
Können Sie ein Angebot machen?`;

export default function IntakeBoard(): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Product intake — "paste a link, get an ad".
  const [url, setUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [profile, setProfile] = useState<ProductProfile | null>(null);
  const [urlErr, setUrlErr] = useState<string | null>(null);

  const fetchProduct = async (): Promise<void> => {
    if (!url.trim() || urlBusy) return;
    setUrlBusy(true); setUrlErr(null); setProfile(null);
    try {
      setProfile(await productIntake(url.trim()));
    } catch (e) {
      setUrlErr((e as Error).message);
    } finally {
      setUrlBusy(false);
    }
  };

  const draft = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null); setCreated(null);
    try {
      setCreated(await intakeJob(text.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>✦ Intake</span>
        <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>INQUIRY → DRAFT JOB</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
        <div style={{ ...sans, fontSize: 13, color: PAL.muted }}>
          Paste a client inquiry (email or Protonet). The AI extracts the title, client, and scope and drafts a job — it stays a quote-pending draft in BLAIQ; pushing to POOOL is a separate, explicit step.
        </div>
        <textarea
          value={text}
          disabled={busy}
          onChange={e => setText(e.target.value)}
          placeholder="Paste the client inquiry here…"
          rows={9}
          style={{ width: '100%', padding: '12px 14px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 13, color: PAL.ink, outline: 'none', borderRadius: 8, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => { void draft(); }}
            style={{ padding: '9px 18px', background: PAL.accent, border: 'none', cursor: busy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}
          >
            {busy ? 'DRAFTING…' : '✦ DRAFT JOB FROM INQUIRY'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setText(SAMPLE)}
            style={{ padding: '9px 14px', background: 'transparent', border: `1px solid ${PAL.divider}`, cursor: 'pointer', ...monoSmall, color: PAL.muted, borderRadius: 6 }}
          >
            USE SAMPLE
          </button>
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>
            {error}
          </div>
        )}

        {created && (
          <div style={{ background: PAL.white, border: `1px solid ${PAL.divider}`, borderLeft: '3px solid #0F6E56', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ ...monoSmall, fontSize: 8, color: '#0F6E56', marginBottom: 8 }}>✓ DRAFT JOB CREATED</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{ ...sansBold, fontSize: 15, color: PAL.ink }}>{created.job_number}</span>
              <span style={{ ...sans, fontSize: 14, color: PAL.ink }}>{created.title}</span>
            </div>
            <div style={{ ...sans, fontSize: 13, color: PAL.muted, lineHeight: 1.6 }}>
              Client: <strong style={{ color: PAL.ink }}>{created.client || '—'}</strong> · status: {created.poool_status.replace(/_/g, ' ')}
              {created.quote_amount != null ? <> · suggested quote €{created.quote_amount.toLocaleString('de-DE')}</> : null}
            </div>
            <div style={{ ...sans, fontSize: 12, color: PAL.muted, marginTop: 8, whiteSpace: 'pre-wrap' }}>{created.notes}</div>
          </div>
        )}

        {/* Product intake — paste a link, get an on-brand brief */}
        <div style={{ borderTop: `1px solid ${PAL.divider}`, paddingTop: 16, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ ...sansBold, fontSize: 13, color: PAL.ink }}>Or paste a product / app link</div>
            <div style={{ ...sans, fontSize: 12.5, color: PAL.muted, marginTop: 2 }}>
              The Story Writer reads the page, extracts a product profile, checks it against your Brand DNA, and hands back a ready-to-run brief.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={url}
              disabled={urlBusy}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void fetchProduct(); }}
              placeholder="https://example.com/product"
              style={{ flex: 1, padding: '9px 12px', border: `1px solid ${PAL.divider}`, background: PAL.bg, ...sans, fontSize: 13, color: PAL.ink, outline: 'none', borderRadius: 6 }}
            />
            <button type="button" disabled={urlBusy || !url.trim()} onClick={() => { void fetchProduct(); }}
              style={{ padding: '9px 16px', background: PAL.accent, border: 'none', cursor: urlBusy ? 'wait' : 'pointer', ...monoSmall, color: PAL.white, borderRadius: 6 }}>
              {urlBusy ? 'READING…' : '✦ EXTRACT PROFILE'}
            </button>
          </div>

          {urlErr && (
            <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, ...sans, fontSize: 13 }}>
              {urlErr}
            </div>
          )}

          {profile && (
            <div style={{ background: PAL.white, border: `1px solid ${PAL.divider}`, borderLeft: `3px solid ${PAL.accent}`, borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ ...monoSmall, fontSize: 8, color: PAL.accent, marginBottom: 8 }}>PRODUCT PROFILE · {profile.model}</div>
              <div style={{ ...sansBold, fontSize: 15, color: PAL.ink }}>{profile.product_name || profile.url}</div>
              {profile.one_liner && <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, marginTop: 4 }}>{profile.one_liner}</div>}
              {profile.value_props.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {profile.value_props.map((v, i) => <div key={i} style={{ ...sans, fontSize: 12.5, color: PAL.ink, marginBottom: 3 }}>• {v}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
                {profile.audience && <div style={{ ...sans, fontSize: 12, color: PAL.muted }}>Audience: <strong style={{ color: PAL.ink }}>{profile.audience}</strong></div>}
                {profile.observed_tone && <div style={{ ...sans, fontSize: 12, color: PAL.muted }}>Tone: <strong style={{ color: PAL.ink }}>{profile.observed_tone}</strong></div>}
              </div>
              {profile.observed_colors.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  <span style={{ ...monoSmall, fontSize: 8, color: PAL.muted }}>COLORS</span>
                  {profile.observed_colors.map((c, i) => {
                    const hex = /^#[0-9a-fA-F]{6}$/.test(c);
                    return <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...sans, fontSize: 11, color: PAL.muted }}>
                      {hex && <span style={{ width: 12, height: 12, borderRadius: 3, background: c, border: `1px solid ${PAL.divider}`, display: 'inline-block' }} />}{c}
                    </span>;
                  })}
                </div>
              )}
              {profile.brand_fit && (
                <div style={{ marginTop: 12, background: PAL.bg, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ ...monoSmall, fontSize: 8, color: PAL.muted, marginBottom: 4 }}>BRAND FIT</div>
                  <div style={{ ...sans, fontSize: 12.5, color: PAL.ink, lineHeight: 1.5 }}>{profile.brand_fit}</div>
                </div>
              )}
              {profile.suggested_brief && (
                <div style={{ marginTop: 10, background: PAL.bg, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ ...monoSmall, fontSize: 8, color: PAL.accent }}>SUGGESTED BRIEF — READY TO RUN</span>
                    <button type="button"
                      onClick={() => { void navigator.clipboard.writeText(profile.suggested_brief).catch(() => {}); }}
                      style={{ marginLeft: 'auto', border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '4px 9px', borderRadius: 6 }}>
                      COPY
                    </button>
                  </div>
                  <div style={{ ...sans, fontSize: 12.5, color: PAL.ink, lineHeight: 1.5 }}>{profile.suggested_brief}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
