// BLAIQ workbench shell — top system bar + content + bottom global nav.
// Pure inline-style implementation (no Tailwind, no framer-motion).

'use client';

import React, { useMemo, useState, type ReactNode, type CSSProperties } from 'react';
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

const PAL = {
  bg: '#F1F0EC',
  grid: '#C9C6BD',
  ink: '#111111',
  muted: '#6E6A63',
  divider: '#D8D3CB',
  panel: '#F7F4EF',
  accent: '#FF6A2A',
  live: '#9AF000',
  hoverBg: '#EDE9E3',
};

const innerBorder = `1px solid ${PAL.grid}`;

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

const monoSmall: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

const sansBold: CSSProperties = {
  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
  fontSize: 11,
  fontWeight: 600,
};

function TopSystemBar(): JSX.Element {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        position: 'relative',
        zIndex: 30,
        height: 44,
        flexShrink: 0,
        background: PAL.bg,
        borderBottom: innerBorder,
        display: 'grid',
        gridTemplateColumns: 'auto auto 1fr auto',
        alignItems: 'center',
        gap: 16,
        padding: '0 16px',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 12, height: 12, background: PAL.accent }} />
        <span
          style={{
            ...monoSmall,
            fontSize: 11,
            letterSpacing: '0.32em',
            color: PAL.ink,
          }}
        >
          BLAIQ
        </span>
      </div>

      {/* Mission selector */}
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        style={{
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          background: 'transparent',
          border: '1px solid transparent',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = PAL.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ ...monoSmall, color: PAL.muted }}>Mission:</span>
        <span style={{ ...sansBold, color: PAL.ink, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          New mission
        </span>
        <ChevronDown size={11} color={PAL.muted} style={{ transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease' }} />
      </button>

      {/* Search */}
      <label
        style={{
          margin: '0 auto',
          height: 28,
          width: '100%',
          maxWidth: 320,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          border: `1px solid ${PAL.divider}`,
          background: PAL.panel,
        }}
      >
        <Search size={12} color={PAL.muted} style={{ flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search anything..."
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 12,
            color: PAL.ink,
            fontFamily: '"Inter", sans-serif',
          }}
        />
        <span
          style={{
            flexShrink: 0,
            padding: '2px 6px',
            border: `1px solid ${PAL.divider}`,
            color: PAL.muted,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 9,
          }}
        >
          ⌘K
        </span>
      </label>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...monoSmall, fontWeight: 700, letterSpacing: '0.14em', color: PAL.muted }}>
          <span>Mode</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: PAL.ink }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: PAL.live,
                animation: 'blaiqPulse 1.6s ease-in-out infinite',
              }}
            />
            Live
          </span>
        </div>
        <button type="button" style={pillBtn()}>Share</button>
        <button type="button" style={iconBtn()}>
          <Users size={13} />
        </button>
        <button type="button" style={iconBtn()}>
          <Bell size={13} />
        </button>
        {(user?.role === 'owner' || user?.role === 'admin') && (
          <button type="button" style={pillBtn()}>Admin</button>
        )}
      </div>
    </header>
  );
}

function pillBtn(): CSSProperties {
  return {
    border: `1px solid ${PAL.divider}`,
    background: 'transparent',
    padding: '4px 12px',
    fontSize: 10,
    fontWeight: 600,
    color: PAL.ink,
    cursor: 'pointer',
    fontFamily: '"Inter", sans-serif',
  };
}

function iconBtn(): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${PAL.divider}`,
    background: 'transparent',
    color: PAL.ink,
    cursor: 'pointer',
  };
}

function BottomGlobalNav(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  const activeId = useMemo(() => {
    const match = NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to));
    if (match) return match.id;
    if (pathname === '/' || pathname === '') return 'home';
    return 'missions';
  }, [pathname]);

  return (
    <nav
      style={{
        position: 'relative',
        zIndex: 30,
        flexShrink: 0,
        height: 46,
        background: PAL.bg,
        borderTop: innerBorder,
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      {/* Left cluster */}
      <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, borderRight: innerBorder }}>
        <button
          type="button"
          onClick={() => router.push('/')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 12px',
            ...sansBold,
            color: PAL.ink,
            background: 'transparent',
            border: 'none',
            borderRight: innerBorder,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = PAL.hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <MessageSquarePlus size={14} />
          <span>New Chat</span>
        </button>
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 12px',
            fontSize: 10,
            color: PAL.muted,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: '"Inter", sans-serif',
          }}
        >
          <Clock size={12} />
          <ChevronDown size={10} />
        </button>
      </div>

      {/* Center nav */}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, justifyContent: 'center' }}>
        {NAV_ITEMS.map((item) => {
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => router.push(item.to)}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 16px',
                fontSize: 11,
                fontWeight: 500,
                color: active ? '#fff' : '#3E3A35',
                background: active ? PAL.ink : 'transparent',
                border: 'none',
                borderRight: innerBorder,
                cursor: 'pointer',
                fontFamily: '"Inter", sans-serif',
                transition: 'background 180ms ease, color 180ms ease',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = PAL.hoverBg;
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
            >
              {item.label}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: '50%',
                    height: 2,
                    width: 16,
                    transform: 'translateX(-50%)',
                    background: PAL.accent,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function BlaiqShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: PAL.bg,
        color: PAL.ink,
        fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        @keyframes blaiqPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
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
