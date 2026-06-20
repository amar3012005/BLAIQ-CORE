// BLAIQ Admin shell — project workflow nav.
// Nav mirrors the tri-track job lifecycle:
//   Jobs (POOOL+ClickUp+Server), Finance (POOOL), Work (ClickUp tasks),
//   Deliverables (Server), Activity (live stream), Analytics.

'use client';

import React, { useState, type CSSProperties } from 'react';
import { PAL, monoSmall, sansBold } from './theme';
import JobBoard from './JobBoard';
import FinanceBoard from './FinanceBoard';
import TasksWall from './TasksWall';
import ActivityFeed from './ActivityFeed';
import SettingsBoard from './SettingsBoard';
import CopilotBoard from './CopilotBoard';
import CrewBoard from './CrewBoard';
import BriefingBoard from './BriefingBoard';
import StudioBoard from './StudioBoard';
import IntakeBoard from './IntakeBoard';
import ErrorBoundary from './ErrorBoundary';
import AnalyticsBoard from './AnalyticsBoard';

type TabId =
  | 'briefing'
  | 'copilot'
  | 'crew'
  | 'studio'
  | 'intake'
  | 'jobs'
  | 'finance'
  | 'work'
  | 'activity'
  | 'analytics'
  | 'settings';

type Section = {
  heading: string;
  items: Array<{ id: TabId; label: string; hint?: string }>;
};

const SECTIONS: Section[] = [
  {
    heading: 'AI',
    items: [
      { id: 'briefing', label: 'Briefing', hint: 'Daily Chief-of-Staff digest' },
      { id: 'copilot', label: 'Copilot', hint: 'Ask + act on your agency' },
      { id: 'crew', label: 'Crew', hint: 'Specialist agents deliberate' },
      { id: 'studio', label: 'Studio', hint: 'Decks + social, one-click post' },
    ],
  },
  {
    heading: 'Project',
    items: [
      { id: 'intake', label: 'Intake', hint: 'Inquiry → drafted job' },
      { id: 'jobs', label: 'Jobs', hint: 'All jobs · tri-track status' },
      { id: 'finance', label: 'Finance', hint: 'POOOL · quotes, invoices, payments' },
      { id: 'work', label: 'Work', hint: 'ClickUp · tickets + revision rounds' },
    ],
  },
  {
    heading: 'Insight',
    items: [
      { id: 'activity', label: 'Activity', hint: 'Live event stream' },
      { id: 'analytics', label: 'Analytics', hint: 'KPIs + trends' },
    ],
  },
  {
    heading: 'Config',
    items: [
      { id: 'settings', label: 'Settings', hint: 'POOOL + ClickUp integrations' },
    ],
  },
];

const NAV_WIDTH = 220;

export default function AdminShell(): JSX.Element {
  const [tab, setTab] = useState<TabId>('briefing');

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
        {/* Logo / wordmark */}
        <div
          style={{
            ...monoSmall,
            color: PAL.accent,
            padding: '0 18px 10px 18px',
            fontSize: 11,
            letterSpacing: '0.2em',
            borderBottom: `1px solid ${PAL.divider}`,
          }}
        >
          BLAIQ ADMIN
        </div>

        {SECTIONS.map(section => (
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
            {section.items.map(item => {
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
                    <span style={{ ...sansBold, color: active ? PAL.ink : PAL.muted }}>
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
        <ErrorBoundary resetKey={tab}>
          {tab === 'briefing' && <BriefingBoard />}
          {tab === 'copilot' && <CopilotBoard />}
          {tab === 'crew' && <CrewBoard />}
          {tab === 'studio' && <StudioBoard />}
          {tab === 'intake' && <IntakeBoard />}
          {tab === 'jobs' && <JobBoard />}
          {tab === 'finance' && <FinanceBoard />}
          {tab === 'work' && <TasksWall />}
          {tab === 'activity' && <ActivityFeed />}
          {tab === 'analytics' && <AnalyticsBoard />}
          {tab === 'settings' && <SettingsBoard />}
        </ErrorBoundary>
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
