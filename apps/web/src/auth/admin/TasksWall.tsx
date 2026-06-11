// BLAIQ Admin · Tasks wall (3 horizon columns).

'use client';

import React, { useEffect, useState } from 'react';
import {
  listProjects,
  listTasksForTeam,
  type AdminProject,
  type AdminTask,
} from './api';
import { PAL, monoSmall, sansBold, sans, pill, emptyText } from './theme';
import { ErrorBanner, SkeletonList } from './ProjectsBoard';

const HORIZONS: Array<{ id: string; label: string }> = [
  { id: 'short', label: 'Short horizon' },
  { id: 'mid', label: 'Mid horizon' },
  { id: 'long', label: 'Long horizon' },
];

export default function TasksWall(): JSX.Element {
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const projects = await listProjects();
        const teamIds = Array.from(
          new Set(projects.map((p) => p.team_id).filter((x): x is string => Boolean(x))),
        );
        const all: AdminTask[] = [];
        for (const tid of teamIds) {
          try {
            const t = await listTasksForTeam(tid);
            all.push(...t);
          } catch {
            // skip team-level failures so a single bad team doesn't blank the wall
          }
        }
        if (!cancelled) setTasks(all);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 16 }}>
        TASK WALL · ALL TEAMS
      </div>
      {error && <ErrorBanner message={error} />}
      {!tasks && !error && <SkeletonList />}
      {tasks && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 16,
          }}
        >
          {HORIZONS.map((h) => {
            const items = tasks.filter((t) => (t.horizon ?? 'short') === h.id);
            return (
              <div
                key={h.id}
                style={{
                  background: PAL.panel,
                  border: `1px solid ${PAL.divider}`,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 200,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ ...monoSmall, color: PAL.ink }}>{h.label}</span>
                  <span style={{ ...monoSmall, color: PAL.muted }}>{items.length}</span>
                </div>
                {items.length === 0 && <div style={emptyText}>Empty.</div>}
                {items.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      background: PAL.white,
                      border: `1px solid ${PAL.divider}`,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ ...sansBold, fontSize: 12, color: PAL.ink }}>{t.title}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {t.priority !== undefined && <span style={pill()}>P:{String(t.priority)}</span>}
                      {t.assignee && (
                        <span style={{ ...sans, fontSize: 10, color: PAL.muted }}>{t.assignee}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
