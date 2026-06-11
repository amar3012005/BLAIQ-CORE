// BLAIQ Admin · Projects board.

'use client';

import React, { useEffect, useState } from 'react';
import {
  listProjects,
  listTasksForTeam,
  type AdminProject,
  type AdminTask,
} from './api';
import { PAL, monoSmall, sansBold, sans, pill, skeletonBar, emptyText } from './theme';

export default function ProjectsBoard(): JSX.Element {
  const [projects, setProjects] = useState<AdminProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminProject | null>(null);
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then((p) => setProjects(p))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected?.team_id) {
      setTasks(null);
      return;
    }
    setTasks(null);
    setTasksError(null);
    listTasksForTeam(selected.team_id)
      .then((t) => setTasks(t))
      .catch((e: Error) => setTasksError(e.message));
  }, [selected]);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div
        style={{
          flex: selected ? '0 0 380px' : 1,
          padding: 20,
          overflowY: 'auto',
          borderRight: selected ? `1px solid ${PAL.divider}` : undefined,
        }}
      >
        <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 12 }}>
          PROJECTS {projects ? `· ${projects.length}` : ''}
        </div>
        {error && <ErrorBanner message={error} />}
        {!projects && !error && <SkeletonList />}
        {projects && projects.length === 0 && (
          <div style={emptyText}>No projects yet.</div>
        )}
        {projects && projects.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {projects.map((p) => {
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    background: active ? PAL.ink : PAL.panel,
                    color: active ? PAL.white : PAL.ink,
                    border: `1px solid ${active ? PAL.ink : PAL.divider}`,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ ...sansBold, fontSize: 12 }}>{p.name}</span>
                    {p.status && <span style={pill(active ? PAL.white : PAL.accent)}>{p.status}</span>}
                  </div>
                  {p.description && (
                    <div style={{ ...sans, fontSize: 11, color: active ? PAL.divider : PAL.muted, lineHeight: 1.4 }}>
                      {p.description}
                    </div>
                  )}
                  {p.created_at && (
                    <div style={{ ...monoSmall, color: active ? PAL.divider : PAL.muted }}>
                      {formatDate(p.created_at)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selected && (
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ ...monoSmall, color: PAL.muted }}>PROJECT DETAIL</div>
              <div style={{ ...sansBold, fontSize: 16, marginTop: 4 }}>{selected.name}</div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{
                background: 'transparent',
                border: `1px solid ${PAL.divider}`,
                padding: '4px 10px',
                cursor: 'pointer',
                ...monoSmall,
                color: PAL.ink,
              }}
            >
              CLOSE
            </button>
          </div>
          <div style={{ ...monoSmall, color: PAL.muted, marginTop: 16, marginBottom: 8 }}>
            TASKS {tasks ? `· ${tasks.length}` : ''}
          </div>
          {tasksError && <ErrorBanner message={tasksError} />}
          {!selected.team_id && (
            <div style={emptyText}>This project has no team attached.</div>
          )}
          {selected.team_id && !tasks && !tasksError && <SkeletonList />}
          {tasks && tasks.length === 0 && <div style={emptyText}>No tasks.</div>}
          {tasks && tasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tasks.map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: '8px 12px',
                    background: PAL.panel,
                    border: `1px solid ${PAL.divider}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div style={{ ...sans, fontSize: 12, color: PAL.ink }}>{t.title}</div>
                  {t.priority !== undefined && (
                    <span style={pill()}>{String(t.priority)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'rgba(220,38,38,0.08)',
        border: '1px solid rgba(220,38,38,0.25)',
        color: '#DC2626',
        ...sans,
        fontSize: 12,
        marginBottom: 12,
      }}
    >
      {message}
    </div>
  );
}

export function SkeletonList(): JSX.Element {
  return (
    <div>
      <span style={skeletonBar('60%', 14)} />
      <span style={skeletonBar('80%', 14)} />
      <span style={skeletonBar('40%', 14)} />
    </div>
  );
}

function formatDate(value: string | number): string {
  try {
    const d = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(value);
  }
}
