// BLAIQ Admin shell — side-nav native UI for the Ops Brain.

'use client';

import React, { useState, type CSSProperties } from 'react';
import { PAL, monoSmall, sansBold } from './theme';
import ProjectsBoard from './ProjectsBoard';
import TasksWall from './TasksWall';
import AgentsRoster from './AgentsRoster';
import MeetingsBoard from './MeetingsBoard';
import ActivityFeed from './ActivityFeed';
import { CapacityView, PricingView, AnalyticsView } from './Placeholders';

type TabId =
  | 'projects'
  | 'tasks'
  | 'agents'
  | 'meetings'
  | 'activity'
  | 'pricing'
  | 'capacity'
  | 'analytics';

type Section = { heading: string; items: Array<{ id: TabId; label: string; hint?: string }> };

const SECTIONS: Section[] = [
  {
    heading: 'Operate',
    items: [
      { id: 'projects', label: 'Projects', hint: 'Active engagements' },
      { id: 'tasks', label: 'Task Wall', hint: 'Short / mid / long horizon' },
      { id: 'meetings', label: 'Meetings', hint: 'Standups · Decisions · Reviews' },
    ],
  },
  {
    heading: 'Workforce',
    items: [
      { id: 'agents', label: 'Agents', hint: 'Roster + templates + trust' },
      { id: 'capacity', label: 'Capacity', hint: 'Utilization + slots' },
    ],
  },
  {
    heading: 'Insight',
    items: [
      { id: 'activity', label: 'Activity', hint: 'Live event stream' },
      { id: 'pricing', label: 'Pricing', hint: 'Margins + invoices' },
      { id: 'analytics', label: 'Analytics', hint: 'KPIs + trends' },
    ],
  },
];

const NAV_WIDTH = 220;

export default function AdminShell(): JSX.Element {
  const [tab, setTab] = useState<TabId>('projects');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        background: PAL.bg,
      }}
    >
      <aside
        style={{
          width: NAV_WIDTH,
          flexShrink: 0,
          borderRight: `1px solid ${PAL.divider}`,
          background: PAL.panel,
          overflowY: 'auto',
          padding: '14px 0 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {SECTIONS.map((section) => (
          <div key={section.heading} style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                ...monoSmall,
                color: PAL.muted,
                padding: '6px 18px',
                marginBottom: 4,
              }}
            >
              {section.heading}
            </div>
            {section.items.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  style={navItemStyle(active)}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 3,
                      alignSelf: 'stretch',
                      background: active ? PAL.accent : 'transparent',
                      borderRadius: 1,
                    }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <span
                      style={{
                        ...sansBold,
                        color: active ? PAL.ink : PAL.muted,
                      }}
                    >
                      {item.label}
                    </span>
                    {item.hint ? (
                      <span
                        style={{
                          fontFamily: '"Inter", Arial, sans-serif',
                          fontSize: 10,
                          color: PAL.muted,
                          opacity: active ? 0.9 : 0.6,
                        }}
                      >
                        {item.hint}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </aside>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        {tab === 'projects' && <ProjectsBoard />}
        {tab === 'tasks' && <TasksWall />}
        {tab === 'agents' && <AgentsRoster />}
        {tab === 'meetings' && <MeetingsBoard />}
        {tab === 'activity' && <ActivityFeed />}
        {tab === 'pricing' && <PricingView />}
        {tab === 'capacity' && <CapacityView />}
        {tab === 'analytics' && <AnalyticsView />}
      </div>
    </div>
  );
}

function navItemStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: '8px 18px 8px 0',
    background: active ? PAL.bg : 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
  };
}
