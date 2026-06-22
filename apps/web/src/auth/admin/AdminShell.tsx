// BLAIQ Admin Shell v2 — dark cinematic sidebar + content area.

'use client';

import React, { useState, type CSSProperties, type ReactNode } from 'react';
import { PAL, monoSmall, sansBold, THEME_CSS, ACCENT_GRADIENT } from './theme';
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
import ClientsBoard from './ClientsBoard';
import ArtifactsBoard from './ArtifactsBoard';
import SchedulerBoard from './SchedulerBoard';
import ErrorBoundary from './ErrorBoundary';
import AnalyticsBoard from './AnalyticsBoard';

type TabId =
  | 'briefing' | 'copilot' | 'crew' | 'studio'
  | 'intake' | 'jobs' | 'clients' | 'finance' | 'work'
  | 'artifacts' | 'scheduler'
  | 'activity' | 'analytics'
  | 'settings';

// ── SVG icon components ────────────────────────────────────────────
function Icon({ path, viewBox = '0 0 24 24' }: { path: ReactNode; viewBox?: string }): JSX.Element {
  return (
    <svg width="15" height="15" viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

const ICONS: Record<TabId, JSX.Element> = {
  briefing: <Icon path={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>} />,
  copilot:  <Icon path={<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>} />,
  crew:     <Icon path={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>} />,
  studio:   <Icon path={<><path d="M12 3l1.912 5.813L19 10.735l-5.088 1.921L12 18.468l-1.912-5.812L5 10.735l5.088-1.922z"/><path d="M5 3l.946 2.875L8.75 7l-2.804.875L5 10.75l-.946-2.875L1.25 7l2.804-.875z"/></>} />,
  intake:   <Icon path={<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>} />,
  jobs:     <Icon path={<><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>} />,
  clients:  <Icon path={<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 22v-4h6v4"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><line x1="9" y1="14" x2="9.01" y2="14"/><line x1="15" y1="14" x2="15.01" y2="14"/></>} />,
  finance:  <Icon path={<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>} />,
  work:     <Icon path={<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>} />,
  artifacts:<Icon path={<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>} />,
  scheduler:<Icon path={<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>} />,
  activity: <Icon path={<><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>} />,
  analytics:<Icon path={<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>} />,
  settings: <Icon path={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />,
};

type Section = {
  heading: string;
  icon: JSX.Element;
  items: Array<{ id: TabId; label: string; hint: string }>;
};

const SECTIONS: Section[] = [
  {
    heading: 'AI',
    icon: <Icon path={<><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l3 3"/><circle cx="19" cy="5" r="3"/></>} />,
    items: [
      { id: 'briefing',  label: 'Briefing',  hint: 'Chief-of-staff digest' },
      { id: 'copilot',   label: 'Copilot',   hint: 'Ask + act on agency' },
      { id: 'crew',      label: 'Crew',       hint: 'Specialist agents' },
      { id: 'studio',    label: 'Studio',     hint: 'Decks · social · video' },
    ],
  },
  {
    heading: 'Project',
    icon: <Icon path={<><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>} />,
    items: [
      { id: 'intake',   label: 'Intake',   hint: 'Inquiry → job' },
      { id: 'jobs',     label: 'Jobs',     hint: 'All jobs · tri-track' },
      { id: 'clients',  label: 'Clients',  hint: 'Per-client book' },
      { id: 'finance',  label: 'Finance',  hint: 'POOOL · quotes · invoices' },
      { id: 'work',     label: 'Work',     hint: 'ClickUp · tickets' },
    ],
  },
  {
    heading: 'Studio',
    icon: <Icon path={<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>} />,
    items: [
      { id: 'artifacts', label: 'Artifacts', hint: 'Images · video · decks' },
      { id: 'scheduler', label: 'Scheduler', hint: 'Recurring content' },
    ],
  },
  {
    heading: 'Insight',
    icon: <Icon path={<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>} />,
    items: [
      { id: 'activity',  label: 'Activity',  hint: 'Live event stream' },
      { id: 'analytics', label: 'Analytics', hint: 'KPIs + trends' },
    ],
  },
  {
    heading: 'Config',
    icon: <Icon path={<><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>} />,
    items: [
      { id: 'settings', label: 'Settings', hint: 'Integrations · SMTP · caps' },
    ],
  },
];

const NAV_WIDTH = 228;

export default function AdminShell(): JSX.Element {
  const [tab, setTab] = useState<TabId>('briefing');

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%', background: PAL.bg }}>
      <style>{THEME_CSS}</style>

      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside style={{
        width: NAV_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid ${PAL.divider}`,
        background: PAL.surface,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Logo */}
        <div style={{
          padding: '18px 18px 16px',
          borderBottom: `1px solid ${PAL.divider}`,
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            background: ACCENT_GRADIENT,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            lineHeight: 1,
            marginBottom: 3,
          }}>
            BLAIQ
          </div>
          <div style={{ ...monoSmall, color: PAL.muted, fontSize: 7.5, letterSpacing: '0.20em' }}>
            AI OPERATIONS · ADMIN
          </div>
        </div>

        {/* Nav sections */}
        <nav style={{ flex: 1, padding: '10px 0 20px', overflowY: 'auto' }}>
          {SECTIONS.map((section) => (
            <div key={section.heading} style={{ marginBottom: 4 }}>
              {/* Section heading */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '10px 16px 5px',
                ...monoSmall, fontSize: 7.5, letterSpacing: '0.22em',
                color: PAL.muted,
              }}>
                <span style={{ color: PAL.divider, opacity: 0.8 }}>{section.icon}</span>
                {section.heading}
              </div>

              {/* Nav items */}
              {section.items.map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`bq-nav${active ? ' is-active' : ''}`}
                    onClick={() => setTab(item.id)}
                    style={navItemStyle(active)}
                  >
                    {/* Active indicator bar */}
                    <span style={{
                      width: 2.5,
                      alignSelf: 'stretch',
                      background: active ? PAL.accent : 'transparent',
                      borderRadius: 1,
                      flexShrink: 0,
                      boxShadow: active ? `0 0 8px ${PAL.accent}` : 'none',
                      transition: 'background 160ms ease, box-shadow 160ms ease',
                    }} />

                    {/* Icon */}
                    <span
                      className="bq-nav-icon"
                      style={{
                        color: active ? PAL.accent : PAL.muted,
                        flexShrink: 0,
                        transition: 'color 160ms ease',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      {ICONS[item.id]}
                    </span>

                    {/* Label + hint */}
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1, minWidth: 0 }}>
                      <span
                        className="bq-nav-label"
                        style={{
                          ...sansBold,
                          fontSize: 12,
                          color: active ? PAL.ink : PAL.inkSoft,
                          transition: 'color 160ms ease',
                        }}
                      >
                        {item.label}
                      </span>
                      <span style={{
                        fontFamily: '"Inter", Arial, sans-serif',
                        fontSize: 10,
                        color: PAL.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {item.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${PAL.divider}`,
          padding: '12px 16px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar */}
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: `linear-gradient(135deg, ${PAL.accentDim}, ${PAL.accentBright})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              boxShadow: `0 0 10px ${PAL.accentGlow}`,
            }}>
              <span style={{ ...monoSmall, fontSize: 10, color: '#fff' }}>A</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...sansBold, fontSize: 11, color: PAL.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Admin
              </div>
              <div style={{ ...monoSmall, fontSize: 7, color: PAL.muted }}>
                BLAIQ · LIVE
              </div>
            </div>
            <div style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B98188' }} />
          </div>
        </div>
      </aside>

      {/* ── Content area ─────────────────────────────────────── */}
      <div style={{
        flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden',
        background: PAL.bg,
      }}>
        <ErrorBoundary resetKey={tab}>
          {tab === 'briefing'  && <BriefingBoard />}
          {tab === 'copilot'   && <CopilotBoard />}
          {tab === 'crew'      && <CrewBoard />}
          {tab === 'studio'    && <StudioBoard />}
          {tab === 'intake'    && <IntakeBoard />}
          {tab === 'jobs'      && <JobBoard />}
          {tab === 'clients'   && <ClientsBoard />}
          {tab === 'finance'   && <FinanceBoard />}
          {tab === 'work'      && <TasksWall />}
          {tab === 'artifacts' && <ArtifactsBoard />}
          {tab === 'scheduler' && <SchedulerBoard />}
          {tab === 'activity'  && <ActivityFeed />}
          {tab === 'analytics' && <AnalyticsBoard />}
          {tab === 'settings'  && <SettingsBoard />}
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
    gap: 9,
    padding: '8px 14px 8px 0',
    margin: '1px 8px 1px 0',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: 'calc(100% - 8px)',
    borderRadius: '0 10px 10px 0',
  };
}
