// BLAIQ Admin · Settings — integration credentials for the real-data sync.
// POOOL (finance) + ClickUp (tasks). Saving persists to tenant_brand via the
// daemon; the ops-brain pollers pick the config up and start syncing.

'use client';

import React, { useEffect, useState } from 'react';
import {
  getOrgIntegrations,
  updateOrgIntegrations,
  type OrgIntegrations,
  type OrgIntegrationsUpdate,
} from './api';
import { PAL, monoSmall, sansBold, sans, emptyText } from './theme';
import { ErrorBanner, SkeletonList } from './JobBoard';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: `1px solid ${PAL.divider}`,
  background: PAL.panel,
  ...sans,
  fontSize: 12,
  color: PAL.ink,
  outline: 'none',
  boxSizing: 'border-box',
  borderRadius: 8,
  transition: 'border-color 160ms ease, box-shadow 160ms ease',
};

function Toggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 42,
        height: 22,
        borderRadius: 11,
        border: `1px solid ${on ? '#10B981' : PAL.divider}`,
        background: on ? '#10B981' : PAL.bg,
        position: 'relative',
        cursor: disabled ? 'wait' : 'pointer',
        flexShrink: 0,
        transition: 'background 0.12s',
      }}
      aria-pressed={on}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: PAL.white,
          transition: 'left 0.12s',
        }}
      />
    </button>
  );
}

function ConnectRow({
  connected,
  saving,
  onToggle,
}: {
  connected: boolean;
  saving: boolean;
  onToggle: (next: boolean) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <span
        style={{
          ...monoSmall,
          fontSize: 9,
          color: connected ? '#0F6E56' : PAL.muted,
          background: connected ? '#E1F5EE' : PAL.bg,
          padding: '4px 10px',
          borderRadius: 12,
        }}
      >
        {connected ? '● CONNECTED' : '○ NOT CONNECTED'}
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={() => onToggle(!connected)}
        style={{
          marginLeft: 'auto',
          border: 'none',
          background: connected ? 'transparent' : PAL.accent,
          color: connected ? PAL.muted : '#fff',
          boxShadow: connected ? `inset 0 0 0 1px ${PAL.divider}` : `0 2px 12px ${PAL.accentGlow}`,
          cursor: saving ? 'wait' : 'pointer',
          ...monoSmall,
          fontSize: 9,
          padding: '7px 16px',
        }}
      >
        {saving ? '…' : connected ? 'DISCONNECT' : 'CONNECT'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
      <span style={{ ...monoSmall, color: PAL.muted }}>{label}</span>
      {children}
    </label>
  );
}

function Card({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: PAL.panel,
        border: `1px solid ${PAL.divider}`,
        borderRadius: 14,
        padding: 20,
        marginBottom: 16,
        maxWidth: 560,
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{ ...sansBold, fontSize: 13, color: PAL.ink, marginBottom: 2 }}>{title}</div>
      <div style={{ ...sans, fontSize: 11, color: PAL.muted, marginBottom: 14 }}>{hint}</div>
      {children}
    </div>
  );
}

export default function SettingsBoard(): JSX.Element {
  const [data, setData] = useState<OrgIntegrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Drafts
  const [pooolUrl, setPooolUrl] = useState('');
  const [pooolKey, setPooolKey] = useState(''); // only sent if non-empty
  const [pooolEnabled, setPooolEnabled] = useState(false);
  const [clickupEnabled, setClickupEnabled] = useState(false);
  const [clickupListId, setClickupListId] = useState('');
  const [hfUrl, setHfUrl] = useState('');
  const [hfKey, setHfKey] = useState(''); // only sent if non-empty
  const [hfEnabled, setHfEnabled] = useState(false);
  // Usage guardrails
  const [dailyCap, setDailyCap] = useState(100);
  const [genPerHour, setGenPerHour] = useState(20);
  // SMTP notifications
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState(''); // only sent if non-empty
  const [notifyFrom, setNotifyFrom] = useState('');
  const [notifyRedirect, setNotifyRedirect] = useState('');

  const hydrate = (d: OrgIntegrations): void => {
    setData(d);
    setPooolUrl(d.poool_url);
    setPooolKey('');
    setPooolEnabled(d.poool_enabled);
    setClickupEnabled(d.clickup_enabled);
    setClickupListId(d.clickup_list_id);
    setHfUrl(d.higgsfield_url);
    setHfKey('');
    setHfEnabled(d.higgsfield_enabled);
    setDailyCap(d.ops_daily_cap_usd);
    setGenPerHour(d.studio_gen_per_hour);
    setNotifyEnabled(d.notify_email_enabled);
    setSmtpHost(d.notify_smtp_host);
    setSmtpPort(d.notify_smtp_port);
    setSmtpUser(d.notify_smtp_user);
    setSmtpPass('');
    setNotifyFrom(d.notify_from);
    setNotifyRedirect(d.notify_redirect_to);
  };

  useEffect(() => {
    getOrgIntegrations().then(hydrate).catch((e: Error) => setError(e.message));
  }, []);

  // One-click connect/disconnect for an integration.
  const connectOne = async (which: 'poool' | 'clickup' | 'higgsfield', enable: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const body: OrgIntegrationsUpdate =
        which === 'poool'
          ? { poool_enabled: enable, poool_url: pooolUrl.trim() || undefined }
          : which === 'higgsfield'
            ? { higgsfield_enabled: enable, higgsfield_url: hfUrl.trim() || undefined }
            : { clickup_enabled: enable, clickup_list_id: clickupListId.trim() || undefined };
      const updated = await updateOrgIntegrations(body);
      hydrate(updated);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const body: OrgIntegrationsUpdate = {
        poool_url: pooolUrl.trim(),
        poool_enabled: pooolEnabled,
        clickup_enabled: clickupEnabled,
        clickup_list_id: clickupListId.trim(),
        higgsfield_url: hfUrl.trim(),
        higgsfield_enabled: hfEnabled,
        notify_email_enabled: notifyEnabled,
        notify_smtp_host: smtpHost.trim(),
        notify_smtp_port: smtpPort,
        notify_smtp_user: smtpUser.trim(),
        notify_from: notifyFrom.trim(),
        notify_redirect_to: notifyRedirect.trim(),
        ops_daily_cap_usd: dailyCap,
        studio_gen_per_hour: genPerHour,
      };
      if (pooolKey.trim()) body.poool_api_key = pooolKey.trim();
      if (hfKey.trim()) body.higgsfield_api_key = hfKey.trim();
      if (smtpPass.trim()) body.notify_smtp_pass = smtpPass.trim();
      const updated = await updateOrgIntegrations(body);
      hydrate(updated);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 16 }}>
        SETTINGS · INTEGRATIONS
      </div>

      {error && <ErrorBanner message={error} />}
      {!data && !error && <SkeletonList />}

      {data && (
        <>
          <Card
            title="POOOL · Finance"
            hint="Connect the POOOL MCP so quotes, invoices, and payment status sync into the finance board automatically (every ~30 min)."
          >
            <ConnectRow connected={pooolEnabled} saving={saving} onToggle={(n) => { setPooolEnabled(n); void connectOne('poool', n); }} />
            <Field label="MCP URL">
              <input
                style={inputStyle}
                value={pooolUrl}
                disabled={saving}
                onChange={(e) => setPooolUrl(e.target.value)}
                placeholder="http://poool-mcp:8000/mcp"
              />
            </Field>
            <Field label={data.poool_api_key_set ? `API Key (set · ${data.poool_api_key_preview})` : 'API Key'}>
              <input
                style={inputStyle}
                type="password"
                value={pooolKey}
                disabled={saving}
                onChange={(e) => setPooolKey(e.target.value)}
                placeholder={data.poool_api_key_set ? 'Leave blank to keep current key' : 'Paste API key'}
              />
            </Field>
          </Card>

          <Card
            title="ClickUp · Tasks"
            hint="When enabled, the poller mirrors ClickUp task status and revisions into the work board. OAuth is held by the workspace connector; set the default list jobs push tickets to."
          >
            <ConnectRow connected={clickupEnabled} saving={saving} onToggle={(n) => { setClickupEnabled(n); void connectOne('clickup', n); }} />
            <Field label="Default List ID">
              <input
                style={inputStyle}
                value={clickupListId}
                disabled={saving}
                onChange={(e) => setClickupListId(e.target.value)}
                placeholder="e.g. 901234567"
              />
            </Field>
          </Card>

          <Card
            title="Premium video · Higgsfield / Seedance"
            hint="Optional. When connected, the video pipeline routes image-to-video through Higgsfield/Seedance (tighter identity lock + character consistency) instead of the default OpenRouter i2v. Leave off to use the included engine."
          >
            <ConnectRow connected={hfEnabled} saving={saving} onToggle={(n) => { setHfEnabled(n); void connectOne('higgsfield', n); }} />
            <Field label="MCP URL">
              <input
                style={inputStyle}
                value={hfUrl}
                disabled={saving}
                onChange={(e) => setHfUrl(e.target.value)}
                placeholder="https://higgsfield.ai/mcp"
              />
            </Field>
            <Field label={data.higgsfield_api_key_set ? `API Key (set · ${data.higgsfield_api_key_preview})` : 'API Key'}>
              <input
                style={inputStyle}
                type="password"
                value={hfKey}
                disabled={saving}
                onChange={(e) => setHfKey(e.target.value)}
                placeholder={data.higgsfield_api_key_set ? 'Leave blank to keep current key' : 'Paste API key'}
              />
            </Field>
          </Card>

          <Card
            title="Usage Guardrails"
            hint="Protect against runaway LLM spend. The daily cap blocks new AI requests once the threshold is hit — existing in-progress tasks still complete."
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Daily AI spend cap (USD)">
                <input style={inputStyle} type="number" min={1} step={1} value={dailyCap} disabled={saving}
                  onChange={(e) => setDailyCap(Number(e.target.value))} />
              </Field>
              <Field label="Studio generations / hour">
                <input style={inputStyle} type="number" min={1} step={1} value={genPerHour} disabled={saving}
                  onChange={(e) => setGenPerHour(Number(e.target.value))} />
              </Field>
            </div>
            <div style={{ ...sans, fontSize: 11, color: PAL.muted }}>
              Current defaults: $100/day · 20 gen/hr. Saved on "SAVE" below.
            </div>
          </Card>

          <Card
            title="Notifications · SMTP"
            hint="When enabled, delivery confirmations and payment-overdue alerts are emailed. Set Redirect-to to an operator inbox during testing — every notification goes there instead of the client."
          >
            <ConnectRow connected={notifyEnabled} saving={saving} onToggle={(n) => { setNotifyEnabled(n); }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
              <Field label="SMTP Host">
                <input style={inputStyle} value={smtpHost} disabled={saving} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
              </Field>
              <Field label="Port">
                <input style={inputStyle} type="number" value={smtpPort} disabled={saving} onChange={(e) => setSmtpPort(Number(e.target.value))} />
              </Field>
            </div>
            <Field label="SMTP User">
              <input style={inputStyle} value={smtpUser} disabled={saving} onChange={(e) => setSmtpUser(e.target.value)} placeholder="user@firma.de" />
            </Field>
            <Field label={data.notify_smtp_pass_set ? `Password (set · ${data.notify_smtp_pass_preview})` : 'Password'}>
              <input style={inputStyle} type="password" value={smtpPass} disabled={saving} onChange={(e) => setSmtpPass(e.target.value)} placeholder={data.notify_smtp_pass_set ? 'Leave blank to keep current' : 'App password or SMTP password'} />
            </Field>
            <Field label="From address">
              <input style={inputStyle} value={notifyFrom} disabled={saving} onChange={(e) => setNotifyFrom(e.target.value)} placeholder="BLAIQ <noreply@firma.de>" />
            </Field>
            <Field label="Redirect-to (operator inbox — leave blank in production)">
              <input style={inputStyle} value={notifyRedirect} disabled={saving} onChange={(e) => setNotifyRedirect(e.target.value)} placeholder="operator@firma.de" />
            </Field>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 560 }}>
            <button
              type="button"
              onClick={() => { void save(); }}
              disabled={saving}
              style={{
                padding: '10px 24px',
                background: `linear-gradient(135deg, ${PAL.accentDim} 0%, ${PAL.accentBright} 100%)`,
                border: 'none',
                borderRadius: 10,
                cursor: saving ? 'wait' : 'pointer',
                ...monoSmall,
                color: '#fff',
                boxShadow: `0 4px 16px ${PAL.accentGlow}`,
                transition: 'filter 200ms ease, transform 160ms ease',
              }}
            >
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
            {savedAt && !saving && (
              <span style={{ ...monoSmall, color: '#10B981' }}>SAVED</span>
            )}
          </div>

          <div style={{ ...emptyText, marginTop: 20, maxWidth: 560 }}>
            Credentials are stored per-tenant and write-only — keys are never shown again, only a masked preview.
          </div>
        </>
      )}
    </div>
  );
}
