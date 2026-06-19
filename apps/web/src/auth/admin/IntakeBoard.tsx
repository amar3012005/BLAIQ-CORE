// BLAIQ Admin · Intake (workflow PDF step 1→2).
// Paste a client inquiry (email / Protonet text); the AI drafts a Job — title,
// client, scope — and creates it in BLAIQ (quote_pending, not yet in POOOL).
// Source-agnostic: this is the manual path; an email/Protonet poller can POST
// the same /api/jobs/intake endpoint later.

'use client';

import React, { useState } from 'react';
import { intakeJob, type Job } from './api';
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
      </div>
    </div>
  );
}
