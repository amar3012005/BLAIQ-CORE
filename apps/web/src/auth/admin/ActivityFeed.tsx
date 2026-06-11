// BLAIQ Admin · live activity feed.

'use client';

import React, { useEffect, useState } from 'react';
import { streamActivities, type AdminActivity } from './api';
import { PAL, monoSmall, sans, emptyText } from './theme';

const MAX_EVENTS = 50;

export default function ActivityFeed(): JSX.Element {
  const [events, setEvents] = useState<AdminActivity[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = streamActivities(
      (ev) => {
        setReady(true);
        setEvents((prev) => {
          const next = [ev, ...prev.filter((p) => p.id !== ev.id)];
          if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
          return next;
        });
      },
      (err) => {
        setError(err.message);
        setReady(true);
      },
    );
    return (): void => handle.close();
  }, []);

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span style={{ ...monoSmall, color: PAL.muted }}>ACTIVITY · LAST {MAX_EVENTS}</span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: error ? '#DC2626' : '#22C55E',
          }}
        />
      </div>
      {error && (
        <div style={{ ...sans, fontSize: 11, color: PAL.muted, marginBottom: 12 }}>
          stream error · falling back to poll · {error}
        </div>
      )}
      {ready && events.length === 0 && <div style={emptyText}>No activity yet.</div>}
      {!ready && <div style={emptyText}>Connecting…</div>}
      {events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.map((ev) => (
            <div
              key={ev.id}
              style={{
                padding: '6px 10px',
                background: PAL.panel,
                border: `1px solid ${PAL.divider}`,
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                ...sans,
                fontSize: 11,
              }}
            >
              <span style={{ ...monoSmall, color: PAL.muted, fontSize: 8, minWidth: 80 }}>
                {formatTime(ev.created_at)}
              </span>
              <span style={{ ...monoSmall, color: PAL.accent, fontSize: 8, minWidth: 100 }}>
                {ev.type}
              </span>
              {ev.agent && (
                <span style={{ color: PAL.ink, fontWeight: 600, minWidth: 100 }}>{ev.agent}</span>
              )}
              <span style={{ color: PAL.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {renderDetails(ev.details)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(value: string | number | undefined): string {
  if (value === undefined) return '--:--:--';
  try {
    const d = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(11, 19);
  } catch {
    return String(value);
  }
}

function renderDetails(details: unknown): string {
  if (details === null || details === undefined) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
