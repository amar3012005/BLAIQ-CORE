// Shared BLAIQ palette + type tokens for the admin surface.

import type { CSSProperties } from 'react';

export const PAL = {
  bg: '#F1F0EC',
  ink: '#111111',
  muted: '#6E6A63',
  divider: '#D8D3CB',
  panel: '#F7F4EF',
  accent: '#FF6A2A',
  hover: '#EDE9E3',
  white: '#FFFFFF',
} as const;

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
  };
}

export const emptyText: CSSProperties = {
  ...sans,
  fontSize: 12,
  fontStyle: 'italic',
  color: PAL.muted,
};
