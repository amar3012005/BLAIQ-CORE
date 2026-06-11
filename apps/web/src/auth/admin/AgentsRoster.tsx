// BLAIQ Admin · Agents roster (templates left, hired roster right).

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  listAgentTemplates,
  listAgentsForTeam,
  listProjects,
  type AdminAgent,
  type AdminAgentTemplate,
} from './api';
import { PAL, monoSmall, sansBold, sans, emptyText } from './theme';
import { ErrorBanner, SkeletonList } from './ProjectsBoard';

export default function AgentsRoster(): JSX.Element {
  const [templates, setTemplates] = useState<AdminAgentTemplate[] | null>(null);
  const [agents, setAgents] = useState<AdminAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgentTemplates()
      .then((t) => setTemplates(t))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    (async (): Promise<void> => {
      try {
        const projects = await listProjects();
        const teamIds = Array.from(
          new Set(projects.map((p) => p.team_id).filter((x): x is string => Boolean(x))),
        );
        const all: AdminAgent[] = [];
        for (const tid of teamIds) {
          try {
            all.push(...(await listAgentsForTeam(tid)));
          } catch {
            // ignore individual team failures
          }
        }
        setAgents(all);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const grouped = useMemo((): Record<string, AdminAgentTemplate[]> => {
    const out: Record<string, AdminAgentTemplate[]> = {};
    for (const t of templates ?? []) {
      const cat = t.category ?? 'uncategorized';
      if (!out[cat]) out[cat] = [];
      out[cat].push(t);
    }
    return out;
  }, [templates]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto', borderRight: `1px solid ${PAL.divider}` }}>
        <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 12 }}>TEMPLATE LIBRARY</div>
        {error && <ErrorBanner message={error} />}
        {!templates && !error && <SkeletonList />}
        {templates && templates.length === 0 && <div style={emptyText}>No templates.</div>}
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} style={{ marginBottom: 16 }}>
            <div style={{ ...monoSmall, color: PAL.accent, marginBottom: 6 }}>{category}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: '8px 12px',
                    background: PAL.panel,
                    border: `1px solid ${PAL.divider}`,
                  }}
                >
                  <div style={{ ...sansBold, fontSize: 12 }}>{t.name}</div>
                  {t.description && (
                    <div style={{ ...sans, fontSize: 11, color: PAL.muted, marginTop: 2 }}>
                      {t.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 12 }}>
          HIRED ROSTER {agents ? `· ${agents.length}` : ''}
        </div>
        {!agents && !error && <SkeletonList />}
        {agents && agents.length === 0 && <div style={emptyText}>No agents hired.</div>}
        {agents && agents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {agents.map((a) => {
              const trust = clamp01(a.trust_score ?? 0);
              return (
                <div
                  key={a.id}
                  style={{
                    padding: '10px 12px',
                    background: PAL.panel,
                    border: `1px solid ${PAL.divider}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ ...sansBold, fontSize: 12 }}>{a.name}</div>
                    {a.role && <div style={{ ...monoSmall, color: PAL.muted }}>{a.role}</div>}
                  </div>
                  <div>
                    <div style={{ ...monoSmall, color: PAL.muted, fontSize: 8, marginBottom: 2 }}>
                      TRUST · {(trust * 100).toFixed(0)}%
                    </div>
                    <div style={{ width: '100%', height: 4, background: PAL.divider }}>
                      <div
                        style={{
                          width: `${trust * 100}%`,
                          height: '100%',
                          background: PAL.accent,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return n > 100 ? 1 : n / 100;
  return n;
}
