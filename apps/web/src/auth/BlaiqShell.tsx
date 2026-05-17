// BLAIQ workbench shell: top system bar + content + bottom global nav.
// Ported from AgentScope-BLAIQ shell/SystemBars.jsx, adapted to TS +
// Next.js routing. Drops framer-motion (use CSS transitions) and the
// past-sessions slide-in (no sessions data wired yet).

'use client';

import React, { useMemo, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Bell,
  ChevronDown,
  Clock,
  MessageSquarePlus,
  Search,
  Users,
} from 'lucide-react';
import { useAuth } from './AuthProvider';

const PALETTE = {
  background: '#F1F0EC',
  gridLines: '#C9C6BD',
  ink: '#111111',
  muted: '#6E6A63',
  paper: '#F4F3EF',
  panel: '#F7F4EF',
  divider: '#D8D3CB',
  accent: '#FF6A2A',
  live: '#9AF000',
};

const NAV_ITEMS: Array<{ id: string; label: string; to: string }> = [
  { id: 'home', label: 'Home', to: '/' },
  { id: 'missions', label: 'Missions', to: '/missions' },
  { id: 'workflows', label: 'Workflows', to: '/workflows' },
  { id: 'swarm', label: 'Swarm', to: '/swarm' },
  { id: 'agents', label: 'Agents', to: '/agents' },
  { id: 'artifacts', label: 'Artifacts', to: '/artifacts' },
  { id: 'memory', label: 'Memory', to: '/memory' },
  { id: 'settings', label: 'Settings', to: '/settings' },
];

const innerBorder = `1px solid ${PALETTE.gridLines}`;

function TopSystemBar({
  missionName = 'New mission',
}: {
  missionName?: string;
}): JSX.Element {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className="relative z-30 h-[44px] shrink-0"
      style={{ backgroundColor: PALETTE.background, borderBottom: innerBorder }}
    >
      <div className="grid h-full grid-cols-[auto_auto_1fr_auto] items-center gap-4 px-4">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="h-3 w-3" style={{ backgroundColor: PALETTE.accent }} />
          <span
            className="text-[11px] font-bold uppercase tracking-[0.32em]"
            style={{ color: PALETTE.ink }}
          >
            BLAIQ
          </span>
        </div>

        {/* Mission selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-7 items-center gap-1.5 px-2 text-left hover:bg-[#EDE9E3]"
            style={{ border: '1px solid transparent' }}
          >
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-[0.16em]"
              style={{ color: PALETTE.muted }}
            >
              Mission:
            </span>
            <span
              className="max-w-[200px] truncate text-[11px] font-semibold"
              style={{ color: PALETTE.ink }}
            >
              {missionName}
            </span>
            <ChevronDown
              size={11}
              style={{ color: PALETTE.muted }}
              className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Search */}
        <label
          className="mx-auto flex h-7 w-full max-w-[320px] items-center gap-2 px-3"
          style={{ border: `1px solid ${PALETTE.divider}`, backgroundColor: PALETTE.panel }}
        >
          <Search size={12} style={{ color: PALETTE.muted }} className="shrink-0" />
          <input
            type="text"
            placeholder="Search anything..."
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-[#9E988F]"
            style={{ color: PALETTE.ink }}
          />
          <span
            className="shrink-0 px-1.5 py-0.5 text-[9px] font-mono"
            style={{ border: `1px solid ${PALETTE.divider}`, color: PALETTE.muted }}
          >
            ⌘K
          </span>
        </label>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
            style={{ color: PALETTE.muted }}
          >
            <span>Mode</span>
            <span className="flex items-center gap-1" style={{ color: PALETTE.ink }}>
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: PALETTE.live }}
              />
              Live
            </span>
          </div>
          <button
            type="button"
            className="px-3 py-1 text-[10px] font-semibold"
            style={{ border: `1px solid ${PALETTE.divider}`, color: PALETTE.ink }}
          >
            Share
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center"
            style={{ border: `1px solid ${PALETTE.divider}`, color: PALETTE.ink }}
          >
            <Users size={13} />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center"
            style={{ border: `1px solid ${PALETTE.divider}`, color: PALETTE.ink }}
          >
            <Bell size={13} />
          </button>
          {user?.role === 'owner' || user?.role === 'admin' ? (
            <button
              type="button"
              className="px-2 py-1 text-[10px] font-semibold"
              style={{ border: `1px solid ${PALETTE.divider}`, color: PALETTE.ink }}
            >
              Admin
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function BottomGlobalNav(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  const activeId = useMemo(() => {
    const match = NAV_ITEMS.find(
      (item) => item.to !== '/' && pathname.startsWith(item.to),
    );
    if (match) return match.id;
    if (pathname === '/' || pathname === '') return 'home';
    return 'missions';
  }, [pathname]);

  return (
    <div
      className="relative z-30 shrink-0"
      style={{ backgroundColor: PALETTE.background, borderTop: innerBorder }}
    >
      <nav className="flex h-[46px] items-center">
        {/* Left: New Chat + clock */}
        <div className="flex shrink-0 items-stretch" style={{ borderRight: innerBorder }}>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="flex h-full items-center gap-1.5 px-3 text-[11px] font-semibold hover:bg-[#EDE9E3]"
            style={{ color: PALETTE.ink, borderRight: innerBorder }}
            title="New Chat"
          >
            <MessageSquarePlus size={14} />
            <span className="hidden sm:inline">New Chat</span>
          </button>
          <button
            type="button"
            className="flex h-full items-center gap-1 px-3 text-[10px] font-medium hover:bg-[#EDE9E3]"
            style={{ color: PALETTE.muted }}
            title="Past Sessions"
          >
            <Clock size={12} />
            <ChevronDown size={10} />
          </button>
        </div>

        {/* Center: nav items */}
        <div className="flex flex-1 items-stretch justify-center">
          {NAV_ITEMS.map((item) => {
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(item.to)}
                className="relative flex h-full items-center px-4 text-[11px] font-medium transition-colors"
                style={{
                  backgroundColor: isActive ? PALETTE.ink : 'transparent',
                  color: isActive ? '#fff' : '#3E3A35',
                  borderRight: innerBorder,
                }}
              >
                {isActive ? (
                  <span
                    className="absolute bottom-0 left-1/2 h-[2px] w-4 -translate-x-1/2"
                    style={{ backgroundColor: PALETTE.accent }}
                  />
                ) : null}
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function BlaiqShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: PALETTE.background,
        color: PALETTE.ink,
        fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TopSystemBar />
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </main>
      <BottomGlobalNav />
    </div>
  );
}
