// BLAIQ LoginPage v2 — dark cinematic redesign.
// Full-screen dark canvas with violet gradient sphere, glass-morphism card.

'use client';

import React, { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';
import apiClient from '../shared/api-client';

const P = {
  bg: '#09090D',
  panel: '#111120',
  panelBorder: '#252540',
  ink: '#EEEEF5',
  muted: '#666680',
  soft: '#9999BB',
  accent: '#8B5CF6',
  accentDim: '#7C3AED',
  accentBright: '#A78BFA',
  danger: '#EF4444',
  divider: '#1E1E35',
} as const;

const GRAD = `linear-gradient(135deg, ${P.accentDim} 0%, ${P.accentBright} 100%)`;

export default function LoginPage(): JSX.Element {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams?.get('next') ?? '/chat';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) router.replace(nextPath);
  }, [isAuthenticated, nextPath, router]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 1000);
    return () => clearInterval(id);
  }, []);

  const fillDemo = (): void => {
    setEmail('admin@blaiq.ai');
    setPassword('admin123');
    setError('');
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiClient.login({ email: email.trim().toLowerCase(), password });
      window.location.replace(nextPath || '/');
    } catch (err) {
      const ev = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(ev?.response?.data?.detail || ev?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const timeStr = now.toTimeString().slice(0, 5);

  return (
    <div style={{ height: '100vh', width: '100vw', overflow: 'hidden', background: P.bg, color: P.ink, fontFamily: '"Inter","Helvetica Neue",Arial,sans-serif', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;700&display=swap');

        @keyframes blaiqSphereFloat {
          0%,100% { transform: translate(-50%,-50%) scale(1); }
          50%      { transform: translate(-50%,-50%) scale(1.04); }
        }
        @keyframes blaiqRise {
          from { opacity:0; transform:translateY(20px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes blaiqFade { from{opacity:0} to{opacity:1} }
        @keyframes blaiqSpin {
          from { transform:rotate(0deg); }
          to   { transform:rotate(360deg); }
        }

        .bl-rise  { animation: blaiqRise 600ms cubic-bezier(.2,.8,.2,1) both; }
        .bl-fade  { animation: blaiqFade 800ms ease both; }
        .bl-mono  { font-family:"JetBrains Mono","IBM Plex Mono",ui-monospace,Menlo,monospace; }
        .bl-spin  { animation: blaiqSpin 1s linear infinite; }

        .bl-input {
          width:100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid ${P.panelBorder};
          border-radius: 10px;
          padding: 13px 16px;
          font-size: 14px;
          color: ${P.ink};
          outline: none;
          font-family: inherit;
          transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
        }
        .bl-input::placeholder { color: ${P.muted}; }
        .bl-input:focus {
          border-color: ${P.accent}99;
          background: rgba(139,92,246,0.06);
          box-shadow: 0 0 0 3px rgba(139,92,246,0.15);
        }
        .bl-cta {
          width:100%; padding:14px; border:none; border-radius:10px;
          background: ${GRAD};
          color:#fff; font-size:14px; font-weight:600; letter-spacing:0.02em;
          cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px;
          transition: filter 200ms ease, transform 160ms ease, box-shadow 200ms ease;
          box-shadow: 0 4px 20px rgba(139,92,246,0.35);
        }
        .bl-cta:hover:not(:disabled) { filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 8px 30px rgba(139,92,246,0.45); }
        .bl-cta:active { transform:translateY(0); }
        .bl-cta:disabled { opacity:0.6; cursor:not-allowed; }

        .bl-demo {
          width:100%; background:transparent; border:1px solid ${P.panelBorder};
          border-radius:10px; padding:11px; color:${P.muted}; font-size:12px;
          letter-spacing:0.06em; cursor:pointer; transition:all 180ms ease;
          font-family:"JetBrains Mono",monospace;
        }
        .bl-demo:hover { border-color:${P.accent}55; color:${P.soft}; background:rgba(139,92,246,0.04); }

        /* Dot grid overlay */
        .bl-grid-bg {
          position:absolute; inset:0; pointer-events:none;
          background-image: radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 28px 28px;
        }
      `}</style>

      {/* Ambient violet sphere */}
      <div style={{
        position: 'absolute', left: '28%', top: '40%',
        width: 600, height: 600, borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
        background: `radial-gradient(circle, rgba(139,92,246,0.22) 0%, rgba(124,58,237,0.10) 45%, transparent 70%)`,
        transform: 'translate(-50%,-50%)',
        animation: 'blaiqSphereFloat 7s ease-in-out infinite',
        filter: 'blur(40px)',
      }} />
      <div className="bl-grid-bg" />

      {/* Top bar */}
      <div className="bl-fade bl-mono" style={{
        position: 'relative', zIndex: 1, flexShrink: 0,
        height: 44, borderBottom: `1px solid ${P.divider}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px',
      }}>
        <span style={{ fontSize: 9, letterSpacing: '0.26em', color: P.muted }}>
          BLAIQ · STUDIO ACCESS
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 6px #10B98188' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.20em', color: P.muted }}>{stamp} · {timeStr}</span>
        </div>
        <span className="bl-mono" style={{ fontSize: 9, letterSpacing: '0.20em', color: P.muted }}>
          FRAME {String(tick).padStart(5, '0')}
        </span>
      </div>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1, padding: '24px 16px' }}>
        <div className="bl-rise" style={{ animationDelay: '80ms', width: '100%', maxWidth: 420 }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              display: 'inline-block',
              fontSize: 48, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1,
              background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              BLAIQ
            </div>
            <div className="bl-mono" style={{ fontSize: 9, letterSpacing: '0.28em', color: P.muted, marginTop: 8 }}>
              AI OPERATIONS STUDIO
            </div>
          </div>

          {/* Card */}
          <div style={{
            background: 'rgba(17,17,32,0.85)',
            border: `1px solid ${P.panelBorder}`,
            borderRadius: 20,
            padding: '32px 32px 28px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)',
          }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: P.ink, marginBottom: 6 }}>
                Welcome back
              </div>
              <div style={{ fontSize: 13, color: P.muted }}>
                Sign in to continue to the studio
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: P.soft, marginBottom: 7, letterSpacing: '0.04em' }}>
                  Email address
                </label>
                <input
                  type="email"
                  className="bl-input"
                  placeholder="name@firma.de"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: P.soft, marginBottom: 7, letterSpacing: '0.04em' }}>
                  Password
                </label>
                <input
                  type="password"
                  className="bl-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  required
                />
              </div>

              {error && (
                <div style={{
                  fontSize: 12, color: P.danger,
                  background: 'rgba(239,68,68,0.10)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  borderRadius: 8, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}

              <button type="submit" disabled={submitting} className="bl-cta" style={{ marginTop: 4 }}>
                {submitting ? (
                  <svg className="bl-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                ) : (
                  <>
                    Sign in
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
              <div style={{ flex: 1, height: 1, background: P.divider }} />
              <span className="bl-mono" style={{ fontSize: 9, letterSpacing: '0.22em', color: P.muted }}>OR</span>
              <div style={{ flex: 1, height: 1, background: P.divider }} />
            </div>

            <button type="button" onClick={fillDemo} className="bl-demo">
              USE DEMO CREDENTIALS
            </button>
          </div>

          {/* Footer note */}
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <span className="bl-mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: P.muted }}>
              MULTI-TENANT · BCRYPT AUTH · TLS ONLY
            </span>
          </div>
        </div>
      </main>

      {/* Bottom bar */}
      <div className="bl-mono" style={{
        position: 'relative', zIndex: 1, flexShrink: 0,
        height: 36, borderTop: `1px solid ${P.divider}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', background: 'rgba(9,9,13,0.8)',
      }}>
        <span style={{ fontSize: 9, letterSpacing: '0.22em', color: P.muted }}>⬤ BLAIQ · v2.0</span>
        <span style={{ fontSize: 9, letterSpacing: '0.22em', color: P.muted }}>
          LAYER 02 · AI OPERATIONS
        </span>
      </div>
    </div>
  );
}
