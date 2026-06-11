// BLAIQ Administration tile — native React shell that talks to the
// Ops Brain via the daemon proxy at /api/v1/admin/*. No iframe.

'use client';

import React, { type CSSProperties } from 'react';
import AdminShell from './admin/AdminShell';

const PAL = {
  bg: '#F1F0EC',
  ink: '#111111',
  muted: '#6E6A63',
  divider: '#D8D3CB',
  panel: '#F7F4EF',
  accent: '#FF6A2A',
};

const monoSmall: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

export default function AdminPage(): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: PAL.bg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${PAL.divider}`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          background: PAL.panel,
          flexShrink: 0,
        }}
      >
        <div style={{ ...monoSmall, color: PAL.accent }}>LAYER 02 · AI OPERATIONS</div>
        <div
          style={{
            fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            color: PAL.ink,
          }}
        >
          Administration
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ ...monoSmall, color: PAL.muted }}>OPS BRAIN</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <AdminShell />
      </div>
    </div>
  );
}
