// BLAIQ Admin · error boundary — keeps one board's crash from blanking the
// whole admin. Shows a recoverable fallback with a reset button.

'use client';

import React from 'react';
import { PAL, monoSmall, sansBold, sans } from './theme';

interface Props {
  children: React.ReactNode;
  /** Bump this (e.g. the active tab id) to auto-reset the boundary on nav. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    // Reset when the caller switches surfaces.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[admin] surface crashed:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, maxWidth: 520 }}>
          <div style={{ ...monoSmall, color: '#B91C1C', marginBottom: 8 }}>SURFACE ERROR</div>
          <div style={{ ...sansBold, fontSize: 15, color: PAL.ink, marginBottom: 6 }}>
            This view hit a problem.
          </div>
          <div style={{ ...sans, fontSize: 12, color: PAL.muted, marginBottom: 16, wordBreak: 'break-word' }}>
            {this.state.error.message}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '7px 16px',
              background: PAL.accent,
              border: 'none',
              cursor: 'pointer',
              ...monoSmall,
              color: PAL.white,
            }}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
