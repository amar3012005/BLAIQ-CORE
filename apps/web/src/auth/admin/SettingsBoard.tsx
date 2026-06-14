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
  padding: '7px 10px',
  border: `1px solid ${PAL.divider}`,
  background: PAL.white,
  ...sans,
  fontSize: 12,
  color: PAL.ink,
  outline: 'none',
  boxSizing: 'border-box',
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
        padding: 18,
        marginBottom: 16,
        maxWidth: 560,
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

  const hydrate = (d: OrgIntegrations): void => {
    setData(d);
    setPooolUrl(d.poool_url);
    setPooolKey('');
    setPooolEnabled(d.poool_enabled);
    setClickupEnabled(d.clickup_enabled);
    setClickupListId(d.clickup_list_id);
  };

  useEffect(() => {
    getOrgIntegrations().then(hydrate).catch((e: Error) => setError(e.message));
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const body: OrgIntegrationsUpdate = {
        poool_url: pooolUrl.trim(),
        poool_enabled: pooolEnabled,
        clickup_enabled: clickupEnabled,
        clickup_list_id: clickupListId.trim(),
      };
      if (pooolKey.trim()) body.poool_api_key = pooolKey.trim();
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
            <Field label="MCP URL">
              <input
                style={inputStyle}
                value={pooolUrl}
                disabled={saving}
                onChange={(e) => setPooolUrl(e.target.value)}
                placeholder="http://poool-mcp:8888"
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Toggle on={pooolEnabled} disabled={saving} onChange={setPooolEnabled} />
              <span style={{ ...sans, fontSize: 12, color: PAL.ink }}>
                {pooolEnabled ? 'Sync enabled' : 'Sync disabled'}
              </span>
            </div>
          </Card>

          <Card
            title="ClickUp · Tasks"
            hint="When enabled, the poller mirrors ClickUp task status and revisions into the work board. OAuth is held by the workspace connector; set the default list jobs push tickets to."
          >
            <Field label="Default List ID">
              <input
                style={inputStyle}
                value={clickupListId}
                disabled={saving}
                onChange={(e) => setClickupListId(e.target.value)}
                placeholder="e.g. 901234567"
              />
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Toggle on={clickupEnabled} disabled={saving} onChange={setClickupEnabled} />
              <span style={{ ...sans, fontSize: 12, color: PAL.ink }}>
                {clickupEnabled ? 'Sync enabled' : 'Sync disabled'}
              </span>
            </div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 560 }}>
            <button
              type="button"
              onClick={() => { void save(); }}
              disabled={saving}
              style={{
                padding: '8px 18px',
                background: PAL.accent,
                border: 'none',
                cursor: saving ? 'wait' : 'pointer',
                ...monoSmall,
                color: PAL.white,
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
