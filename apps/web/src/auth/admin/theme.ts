// BLAIQ Design System v2 — dark cinematic palette.
// Inspired by high-end generative-AI studios: deep black canvas,
// violet/purple hero accent, glass-morphism surfaces, neon hover glows.

import type { CSSProperties } from 'react';

export const PAL = {
  // ── Backgrounds (darkest → lightest) ───────────────────────────
  bg: '#09090D',         // deepest — page canvas
  surface: '#0F0F1A',    // slightly elevated content area
  panel: '#141420',      // card / panel background
  panelHover: '#1C1C2E', // card hover / secondary panel

  // ── Text ───────────────────────────────────────────────────────
  ink: '#EEEEF5',        // primary text (near-white)
  inkSoft: '#B0B0CC',    // secondary text
  muted: '#666680',      // muted / placeholder

  // ── Structural ─────────────────────────────────────────────────
  divider: '#22223A',    // borders + dividers
  hover: '#1A1A2C',      // row / item hover background

  // ── Accent — violet (the hero colour) ──────────────────────────
  accent: '#8B5CF6',          // primary violet
  accentDim: '#7C3AED',       // deeper violet (gradient start)
  accentBright: '#A78BFA',    // lighter violet (gradient end / highlight)
  accentGlow: 'rgba(139,92,246,0.22)', // glow on hover/focus
  accentSoft: 'rgba(139,92,246,0.10)', // subtle tint for active states

  // ── Keep for boards that use PAL.white as CTA text colour ──────
  white: '#FFFFFF',

  // ── Semantic ───────────────────────────────────────────────────
  ok: '#10B981',
  okBg: 'rgba(16,185,129,0.12)',
  danger: '#EF4444',
  dangerBg: 'rgba(239,68,68,0.10)',
  warn: '#F59E0B',
  warnBg: 'rgba(245,158,11,0.10)',
  info: '#60A5FA',
} as const;

export const radius = { sm: 6, md: 10, lg: 16 } as const;

export const shadow = {
  sm: '0 1px 3px rgba(0,0,0,0.4)',
  md: '0 8px 32px rgba(0,0,0,0.5)',
  violet: '0 0 0 1px rgba(139,92,246,0.4), 0 4px 24px rgba(139,92,246,0.15)',
} as const;

export const transition = 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, color 160ms ease, opacity 160ms ease';

export const monoSmall: CSSProperties = {
  fontFamily: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace',
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

export const title: CSSProperties = {
  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
  fontWeight: 600,
  fontSize: 16,
  letterSpacing: '-0.01em',
  color: PAL.ink,
};

// ── Accent gradient string (reusable) ──────────────────────────────
export const ACCENT_GRADIENT = `linear-gradient(135deg, ${PAL.accentDim} 0%, ${PAL.accentBright} 100%)`;

// ── Component helpers ──────────────────────────────────────────────

export function pill(color: string = PAL.accent): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    background: `${color}22`,
    color,
    ...monoSmall,
    fontSize: 8,
    letterSpacing: '0.14em',
    borderRadius: 999,
    border: `1px solid ${color}33`,
  };
}

export function card(active = false): CSSProperties {
  return {
    background: active ? PAL.accentSoft : PAL.panel,
    color: PAL.ink,
    border: `1px solid ${active ? PAL.accent + '55' : PAL.divider}`,
    borderRadius: radius.md,
    boxShadow: active ? shadow.violet : shadow.sm,
    transition,
  };
}

export function skeletonBar(width: string | number = '100%', height = 10): CSSProperties {
  return {
    display: 'block',
    width,
    height,
    background: PAL.divider,
    opacity: 0.5,
    margin: '6px 0',
    borderRadius: radius.sm,
    animation: 'blaiqPulse 1.6s ease-in-out infinite',
  };
}

export const emptyText: CSSProperties = {
  ...sans,
  fontSize: 12,
  fontStyle: 'italic',
  color: PAL.muted,
};

// ── Global CSS injected into AdminShell ────────────────────────────
export const THEME_CSS = `
  * { box-sizing: border-box; }

  .bq-card { transition: ${transition}; }
  .bq-card:hover {
    border-color: ${PAL.accent}55 !important;
    box-shadow: ${shadow.violet} !important;
    transform: translateY(-1px);
  }
  .bq-card.is-active:hover { transform: none; }

  .bq-row { transition: ${transition}; }
  .bq-row:hover { background: ${PAL.hover} !important; }

  .bq-nav { transition: ${transition}; }
  .bq-nav:hover { background: ${PAL.hover} !important; }
  .bq-nav:hover .bq-nav-icon { color: ${PAL.accentBright} !important; }
  .bq-nav.is-active { background: ${PAL.accentSoft} !important; }
  .bq-nav.is-active:hover { background: ${PAL.accentSoft} !important; }
  .bq-nav.is-active .bq-nav-icon { color: ${PAL.accent} !important; }
  .bq-nav.is-active .bq-nav-label { color: ${PAL.ink} !important; }

  .bq-btn { transition: ${transition}; }
  .bq-btn:hover { filter: brightness(1.12); }

  .bq-icon-btn { transition: ${transition}; }
  .bq-icon-btn:hover { background: ${PAL.hover} !important; border-color: ${PAL.accent}55 !important; }

  .bq-input:focus {
    outline: none !important;
    border-color: ${PAL.accent}88 !important;
    box-shadow: 0 0 0 3px ${PAL.accentGlow} !important;
  }

  .bq-gradient-text {
    background: ${ACCENT_GRADIENT};
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  @keyframes blaiqFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes blaiqPulse {
    0%, 100% { opacity: 0.35; }
    50%       { opacity: 0.6; }
  }
  @keyframes blaiqGlow {
    0%, 100% { box-shadow: 0 0 12px ${PAL.accentGlow}; }
    50%       { box-shadow: 0 0 24px ${PAL.accent}44; }
  }

  /* Scrollbars */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: ${PAL.bg}; }
  ::-webkit-scrollbar-thumb { background: ${PAL.divider}; border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: ${PAL.muted}; }

  /* Selection */
  ::selection { background: ${PAL.accentGlow}; color: ${PAL.ink}; }
`;
