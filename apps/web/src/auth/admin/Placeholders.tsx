// BLAIQ Admin · Phase-5 placeholder views.

'use client';

import React from 'react';
import { PAL, monoSmall, sans } from './theme';

function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <div
      style={{
        padding: 32,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ ...monoSmall, color: PAL.muted }}>{title}</div>
      <div style={{ ...sans, fontSize: 13, fontStyle: 'italic', color: PAL.muted }}>
        Coming in Phase 5
      </div>
    </div>
  );
}

export function CapacityView(): JSX.Element {
  return <Placeholder title="CAPACITY" />;
}

export function PricingView(): JSX.Element {
  return <Placeholder title="PRICING" />;
}

export function AnalyticsView(): JSX.Element {
  return <Placeholder title="ANALYTICS" />;
}
