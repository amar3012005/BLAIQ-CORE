// Shared BLAIQ palette + type tokens for the admin surface.

import type { CSSProperties } from 'react';

export const PAL = {
  bg: '#F1F0EC',
  ink: '#111111',
  inkSoft: '#3E3A35',
  muted: '#6E6A63',
  divider: '#D8D3CB',
  panel: '#F7F4EF',
  accent: '#FF6A2A',
  accentSoft: '#FFF1E9',
  hover: '#EDE9E3',
  white: '#FFFFFF',
  // Semantic — single source of truth (was scattered hex across boards)
  ok: '#0F6E56',
  okBg: 'rgba(15,110,86,0.10)',
  danger: '#B91C1C',
  dangerBg: 'rgba(185,28,28,0.08)',
  warn: '#B45309',
  warnBg: 'rgba(180,83,9,0.10)',
  info: '#2563EB',
} as const;

export const radius = { sm: 6, md: 10, lg: 14 } as const;

export const shadow = {
  sm: '0 1px 2px rgba(17,17,17,0.05)',
  md: '0 6px 20px rgba(17,17,17,0.08)',
} as const;

export const transition = 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, color 160ms ease';

export const monoSmall: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

export const sansBold: CSSProperties = {
  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
  fontSize: 11,
  fontWeight: 600,
};

export const sans: CSSProperties = {
  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
};

// Page/section title used across boards (was ad-hoc fontSize:14 everywhere).
export const title: CSSProperties = {
  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
  fontWeight: 600,
  fontSize: 16,
  letterSpacing: '-0.01em',
  color: PAL.ink,
};

export function pill(color: string = PAL.accent): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    background: `${color}1F`, // ~12% alpha
    color,
    ...monoSmall,
    fontSize: 8,
    letterSpacing: '0.14em',
    borderRadius: 999,
  };
}

// A standard surface card. Pass active for the selected/inverted treatment.
export function card(active = false): CSSProperties {
  return {
    background: active ? PAL.ink : PAL.white,
    color: active ? PAL.white : PAL.ink,
    border: `1px solid ${active ? PAL.ink : PAL.divider}`,
    borderRadius: radius.md,
    boxShadow: shadow.sm,
    transition,
  };
}

export function skeletonBar(width: string | number = '100%', height = 10): CSSProperties {
  return {
    display: 'block',
    width,
    height,
    background: PAL.divider,
    opacity: 0.6,
    margin: '6px 0',
    borderRadius: radius.sm,
  };
}

export const emptyText: CSSProperties = {
  ...sans,
  fontSize: 12,
  fontStyle: 'italic',
  color: PAL.muted,
};

// Global hover/transition classes. Inline React styles can't express :hover,
// so cards/rows/nav items opt in via className and these rules (with
// !important to win over the inline base style on hover only).
export const THEME_CSS = `
  .bq-card { transition: ${transition}; }
  .bq-card:hover { border-color: ${PAL.accent} !important; box-shadow: ${shadow.md} !important; transform: translateY(-1px); }
  .bq-card.is-active:hover { transform: none; }
  .bq-row { transition: ${transition}; }
  .bq-row:hover { background: ${PAL.hover} !important; }
  .bq-nav { transition: ${transition}; }
  .bq-nav:hover { background: ${PAL.hover} !important; }
  .bq-nav.is-active:hover { background: ${PAL.white} !important; }
  .bq-btn { transition: ${transition}; }
  .bq-btn:hover { filter: brightness(0.94); }
  .bq-icon-btn { transition: ${transition}; }
  .bq-icon-btn:hover { background: ${PAL.hover} !important; border-color: ${PAL.muted} !important; }
  @keyframes blaiqFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`;
