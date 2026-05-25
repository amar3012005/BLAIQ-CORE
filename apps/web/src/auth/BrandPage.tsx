// BLAIQ Brand page — edit Brand DNA + Brand Tone + Hivemind config.
// Pure inline-style implementation matching BLAIQ theme.

'use client';

import React, { useEffect, useState, type CSSProperties } from 'react';
import { Save, Check, X, Loader2, Eye, EyeOff, Zap } from 'lucide-react';

const P = {
  bg: '#F1F0EC',
  card: '#FAFAF7',
  ink: '#111111',
  muted: '#6E6A63',
  divider: '#D8D3CB',
  accent: '#FF6A2A',
  hover: '#EDE9E3',
  green: '#22C55E',
  red: '#DC2626',
  white: '#FFFFFF',
};

const mono: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
};

interface BrandData {
  brand_dna_md: string;
  brand_tone_md: string;
  hivemind_url: string;
  hivemind_api_key_set: boolean;
  hivemind_api_key_preview: string;
  hivemind_enabled: boolean;
  updated_at: number;
}

type Tab = 'dna' | 'tone' | 'hivemind';

export default function BrandPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('dna');
  const [brand, setBrand] = useState<BrandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  const [dnaDraft, setDnaDraft] = useState('');
  const [toneDraft, setToneDraft] = useState('');
  const [hvUrl, setHvUrl] = useState('');
  const [hvKey, setHvKey] = useState('');
  const [hvEnabled, setHvEnabled] = useState(false);
  const [hvKeyVisible, setHvKeyVisible] = useState(false);
  const [hvTesting, setHvTesting] = useState(false);
  const [hvTestResult, setHvTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void loadBrand();
  }, []);

  async function loadBrand(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/v1/org/brand', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as BrandData;
      setBrand(data);
      setDnaDraft(data.brand_dna_md);
      setToneDraft(data.brand_tone_md);
      setHvUrl(data.hivemind_url);
      setHvEnabled(data.hivemind_enabled);
      setHvKey('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveStatus('idle');
    setError('');
    try {
      const body: Record<string, unknown> = {
        brand_dna_md: dnaDraft,
        brand_tone_md: toneDraft,
        hivemind_url: hvUrl,
        hivemind_enabled: hvEnabled,
      };
      // Only send API key if user typed a new one (don't clobber with empty)
      if (hvKey.trim().length > 0) body.hivemind_api_key = hvKey.trim();
      const r = await fetch('/api/v1/org/brand', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as BrandData;
      setBrand(data);
      setHvKey(''); // clear after save
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setError((err as Error).message);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  async function testHivemind(): Promise<void> {
    setHvTesting(true);
    setHvTestResult(null);
    try {
      // Save first if there's a new key
      if (hvKey.trim().length > 0) {
        await fetch('/api/v1/org/brand', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hivemind_api_key: hvKey.trim(), hivemind_url: hvUrl }),
        });
      }
      const r = await fetch('/api/v1/org/brand/hivemind/test', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await r.json()) as { ok: boolean; status?: number; error?: string };
      if (data.ok) {
        setHvTestResult({ ok: true, msg: `OK (HTTP ${data.status})` });
      } else {
        setHvTestResult({ ok: false, msg: data.error ?? `HTTP ${data.status ?? '?'}` });
      }
    } catch (err) {
      setHvTestResult({ ok: false, msg: (err as Error).message });
    } finally {
      setHvTesting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={20} color={P.muted} style={{ animation: 'brandSpin 1s linear infinite' }} />
        <style>{`@keyframes brandSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes brandSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 32px',
        borderBottom: `1px solid ${P.divider}`,
        flexShrink: 0,
      }}>
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 4 }}>
            ORGANIZATION SETTINGS
          </div>
          <h1 style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 26,
            fontWeight: 700,
            color: P.ink,
            margin: 0,
            letterSpacing: '-0.01em',
          }}>
            Brand Identity
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveStatus === 'saved' && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              ...mono,
              color: P.green,
            }}>
              <Check size={12} /> SAVED
            </span>
          )}
          {saveStatus === 'error' && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              ...mono,
              color: P.red,
            }}>
              <X size={12} /> ERROR
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 18px',
              background: P.ink,
              color: P.white,
              border: 'none',
              cursor: saving ? 'wait' : 'pointer',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              fontFamily: '"Inter", sans-serif',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? <Loader2 size={12} style={{ animation: 'brandSpin 1s linear infinite' }} /> : <Save size={12} />}
            {saving ? 'SAVING…' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        padding: '0 32px',
        borderBottom: `1px solid ${P.divider}`,
        flexShrink: 0,
      }}>
        {(['dna', 'tone', 'hivemind'] as const).map((id) => {
          const active = tab === id;
          const label = id === 'dna' ? 'Brand DNA · Visual' : id === 'tone' ? 'Brand Tone · Voice' : 'Hivemind · Memory';
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: '14px 0',
                marginRight: 28,
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? P.accent : 'transparent'}`,
                cursor: 'pointer',
                fontFamily: '"Inter", sans-serif',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                color: active ? P.ink : P.muted,
                transition: 'all 150ms',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '10px 32px',
          background: 'rgba(220,38,38,0.08)',
          borderBottom: `1px solid rgba(220,38,38,0.2)`,
          fontFamily: '"Inter", sans-serif',
          fontSize: 12,
          color: P.red,
          flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* Content */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '24px 32px 32px',
      }}>
        {tab === 'dna' && (
          <EditorSection
            title="Brand DNA — Visual Identity"
            hint="Logo, colors, typography, texture. Used on every artifact generated. Markdown supported."
            value={dnaDraft}
            onChange={setDnaDraft}
            placeholder="# Brand DNA\n\n## Logo\n- Primary mark: ..."
          />
        )}
        {tab === 'tone' && (
          <EditorSection
            title="Brand Tone — Voice & Messaging"
            hint="Personality, vocabulary, grammar rules. Used for every word written in artifacts and replies. Markdown supported."
            value={toneDraft}
            onChange={setToneDraft}
            placeholder="# Brand Tone\n\n## Personality\n- ..."
          />
        )}
        {tab === 'hivemind' && (
          <HivemindSection
            url={hvUrl}
            onUrlChange={setHvUrl}
            keyInput={hvKey}
            onKeyChange={setHvKey}
            keySet={brand?.hivemind_api_key_set ?? false}
            keyPreview={brand?.hivemind_api_key_preview ?? ''}
            enabled={hvEnabled}
            onEnabledChange={setHvEnabled}
            visible={hvKeyVisible}
            onVisibleChange={setHvKeyVisible}
            onTest={testHivemind}
            testing={hvTesting}
            testResult={hvTestResult}
          />
        )}
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  background: P.bg,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

function EditorSection({
  title,
  hint,
  value,
  onChange,
  placeholder,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 920 }}>
      <div>
        <h2 style={{
          fontFamily: '"Inter", sans-serif',
          fontSize: 16,
          fontWeight: 700,
          color: P.ink,
          margin: 0,
        }}>
          {title}
        </h2>
        <p style={{
          fontFamily: '"Inter", sans-serif',
          fontSize: 12,
          color: P.muted,
          margin: '4px 0 0',
          lineHeight: 1.55,
        }}>
          {hint}
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          minHeight: 420,
          padding: '16px 18px',
          background: P.card,
          border: `1px solid ${P.divider}`,
          fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.6,
          color: P.ink,
          resize: 'vertical',
          outline: 'none',
          transition: 'border-color 150ms',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = P.accent; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = P.divider; }}
      />
      <div style={{ ...mono, color: P.muted, fontSize: 9 }}>
        {value.length.toLocaleString()} characters
      </div>
    </div>
  );
}

function HivemindSection({
  url, onUrlChange,
  keyInput, onKeyChange,
  keySet, keyPreview,
  enabled, onEnabledChange,
  visible, onVisibleChange,
  onTest, testing, testResult,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  keyInput: string;
  onKeyChange: (v: string) => void;
  keySet: boolean;
  keyPreview: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  visible: boolean;
  onVisibleChange: (v: boolean) => void;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; msg: string } | null;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680 }}>
      <div>
        <h2 style={{
          fontFamily: '"Inter", sans-serif',
          fontSize: 16,
          fontWeight: 700,
          color: P.ink,
          margin: 0,
        }}>
          Hivemind — Company Brain
        </h2>
        <p style={{
          fontFamily: '"Inter", sans-serif',
          fontSize: 12,
          color: P.muted,
          margin: '4px 0 0',
          lineHeight: 1.55,
        }}>
          Connect your Hivemind MCP server. When enabled, every agent run calls <code style={{ fontFamily: 'JetBrains Mono', fontSize: 11, padding: '1px 4px', background: P.card, border: `1px solid ${P.divider}` }}>hivemind_recall</code> first to fetch org context before answering. 22 tools available: memory save/recall, web search, code intelligence, time-travel.
        </p>
      </div>

      {/* Enabled toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        background: P.card,
        border: `1.5px solid ${enabled ? P.accent : P.divider}`,
        transition: 'border-color 150ms',
      }}>
        <div>
          <div style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 13,
            fontWeight: 600,
            color: P.ink,
          }}>
            Hivemind integration
          </div>
          <div style={{
            fontFamily: '"Inter", sans-serif',
            fontSize: 11,
            color: P.muted,
            marginTop: 2,
          }}>
            {enabled ? 'Active — agents query Hivemind first on every run.' : 'Disabled — Hivemind tools not attached to runs.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            background: enabled ? P.accent : P.divider,
            border: 'none',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background 150ms',
            flexShrink: 0,
          }}
        >
          <span style={{
            position: 'absolute',
            top: 2,
            left: enabled ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: P.white,
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transition: 'left 150ms',
          }} />
        </button>
      </div>

      {/* URL */}
      <FieldRow label="MCP SERVER URL">
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://core.hivemind.davinciai.eu:8050/api/mcp"
          style={inputStyle}
        />
      </FieldRow>

      {/* API Key */}
      <FieldRow label="API KEY">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type={visible ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => onKeyChange(e.target.value)}
              placeholder={keySet ? `Current: ${keyPreview} (paste to replace)` : 'Paste your Hivemind API key'}
              style={{ ...inputStyle, paddingRight: 36 }}
            />
            <button
              type="button"
              onClick={() => onVisibleChange(!visible)}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: P.muted,
                padding: 4,
              }}
            >
              {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            type="button"
            onClick={onTest}
            disabled={testing || (!keyInput && !keySet)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              background: P.card,
              border: `1px solid ${P.divider}`,
              cursor: testing ? 'wait' : 'pointer',
              fontFamily: '"Inter", sans-serif',
              fontSize: 12,
              fontWeight: 600,
              color: P.ink,
              opacity: testing || (!keyInput && !keySet) ? 0.5 : 1,
            }}
          >
            {testing ? <Loader2 size={12} style={{ animation: 'brandSpin 1s linear infinite' }} /> : <Zap size={12} />}
            {testing ? 'TESTING…' : 'TEST'}
          </button>
        </div>
        {testResult && (
          <div style={{
            marginTop: 8,
            padding: '8px 12px',
            background: testResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(220,38,38,0.08)',
            border: `1px solid ${testResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(220,38,38,0.3)'}`,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 10,
            color: testResult.ok ? P.green : P.red,
          }}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </div>
        )}
        <div style={{
          marginTop: 8,
          fontFamily: '"Inter", sans-serif',
          fontSize: 11,
          color: P.muted,
        }}>
          Stored encrypted in your tenant. Never exposed to other organizations or on read endpoints (only a preview shown).
        </div>
      </FieldRow>

      {/* Tools list */}
      <div>
        <div style={{ ...mono, color: P.muted, marginBottom: 10 }}>
          AVAILABLE TOOLS (22)
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: '14px 16px',
          background: P.card,
          border: `1px solid ${P.divider}`,
        }}>
          {[
            'hivemind_recall · search memories',
            'hivemind_save_memory · persist facts',
            'hivemind_get_memory · by ID',
            'hivemind_list_memories · browse',
            'hivemind_update_memory · modify',
            'hivemind_delete_memory · remove',
            'hivemind_save_conversation · summarize',
            'hivemind_traverse_graph · connections',
            'hivemind_query_with_ai · synthesis',
            'hivemind_web_search · live data',
            'hivemind_web_crawl · scrape page',
            'hivemind_web_job_status · check job',
            'hivemind_web_usage · quota',
            'hivemind_ingest_code · add codebase',
            'hivemind_code_at · file at commit',
            'hivemind_code_diff · between revs',
            'hivemind_code_timeline · history',
            'hivemind_why_code · explain change',
            'hivemind_track_refactor · log refactor',
            'hivemind_test_coverage · coverage',
            'hivemind_recall_bugs · bug history',
            'hivemind_log_decision · record decision',
          ].map((t) => (
            <div key={t} style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 10,
              color: P.muted,
              padding: '2px 0',
            }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div style={{ ...mono, color: P.muted, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: P.card,
  border: `1px solid ${P.divider}`,
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  fontSize: 12,
  color: P.ink,
  outline: 'none',
};
