// Port of HIVEMIND/BLAIQ LoginPage.jsx to TS + Next.js routing.
// Visual identity preserved verbatim; the email/password form is wired
// to apiClient.login() which posts to /api/v1/auth/login with
// credentials:include so the daemon issues the od_session cookie.

'use client';

import React, { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import apiClient from '../shared/api-client';

const PALETTE = {
  bg: '#f2efe8',
  ink: '#111111',
  sub: '#777777',
  rule: 'rgba(17,17,17,0.14)',
  mustard: '#e0b84f',
  teal: '#7fa7a6',
  red: '#a8322d',
  beige: '#e8e1d6',
};

export default function LoginPage(): JSX.Element {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams?.get('next') ?? '/chat';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [authMethod, setAuthMethod] = useState<'google' | 'phone'>('google');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isAuthenticated) router.replace(nextPath);
  }, [isAuthenticated, nextPath, router]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100000), 1000);
    return () => clearInterval(id);
  }, []);

  const fillSeededCredentials = (): void => {
    setAuthMethod('google');
    setEmail('admin@blaiq.ai');
    setPassword('admin123');
    setError('');
  };

  const handleGoogleLogin = async (): Promise<void> => {
    setError('OAuth not configured; use email/password.');
  };

  const handleSendOtp = (): void => {
    setError('Phone OTP not configured; use email/password.');
  };

  const handleVerifyOtp = async (): Promise<void> => {
    setError('Phone OTP not configured; use email/password.');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiClient.login({ email: email.trim().toLowerCase(), password });
      // Hard reload so AuthProvider re-bootstraps with the new session cookie.
      // router.replace alone keeps the provider mounted with stale 'anonymous'
      // state → ProtectedRoute bounces back to /login.
      window.location.replace(nextPath || '/');
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError(e?.response?.data?.detail || e?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const time = now.toTimeString().slice(0, 5);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${PALETTE.rule}`,
    padding: '12px 0',
    fontSize: 14,
    color: PALETTE.ink,
    outline: 'none',
    fontFamily: 'inherit',
    letterSpacing: '0.01em',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: '0.32em',
    color: PALETTE.sub,
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    display: 'block',
    marginBottom: 6,
  };

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: PALETTE.bg,
        color: PALETTE.ink,
        fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        @keyframes blaiqRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blaiqFade { from { opacity: 0; } to { opacity: 1; } }
        .blaiq-rise { animation: blaiqRise 700ms cubic-bezier(.2,.8,.2,1) both; }
        .blaiq-fade { animation: blaiqFade 900ms ease both; }
        .blaiq-mono { font-family: "JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace; }
        .blaiq-input:focus { border-bottom-color: ${PALETTE.ink} !important; }
        .blaiq-tab-btn { transition: color 180ms ease, background 180ms ease; cursor: pointer; }
        .blaiq-tab-active { background: ${PALETTE.ink}; color: ${PALETTE.bg}; }
        .blaiq-cta { transition: background 200ms ease, color 200ms ease; }
        .blaiq-cta:hover:not(:disabled) { background: ${PALETTE.red} !important; color: ${PALETTE.bg} !important; }
        .blaiq-link { transition: color 180ms ease; cursor: pointer; }
        .blaiq-link:hover { color: ${PALETTE.ink}; }
        @media (max-width: 900px) {
          .blaiq-split { grid-template-columns: 1fr !important; }
          .blaiq-brand-pane { display: none !important; }
        }
      `}</style>

      <div style={{ height: 28, background: PALETTE.ink, flexShrink: 0 }} />

      <div
        style={{
          flexShrink: 0,
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${PALETTE.rule}`,
        }}
      >
        <div className="blaiq-fade blaiq-mono" style={{ fontSize: 11, letterSpacing: '0.28em', color: PALETTE.sub }}>
          BLAIQ &nbsp;№&nbsp; 01 &nbsp;/&nbsp; 2026 &nbsp;·&nbsp; ACCESS
        </div>
        <div
          className="blaiq-fade blaiq-mono"
          onClick={() => router.push('/')}
          style={{
            fontSize: 11,
            letterSpacing: '0.28em',
            color: PALETTE.ink,
            cursor: 'pointer',
            borderBottom: `2px solid ${PALETTE.ink}`,
            paddingBottom: 2,
          }}
        >
          ← BACK TO STUDIO
        </div>
        <div className="blaiq-fade blaiq-mono" style={{ fontSize: 11, letterSpacing: '0.28em', color: PALETTE.sub }}>
          {stamp} · {time}
        </div>
      </div>

      <main className="blaiq-split" style={{ flex: 1, display: 'grid', gridTemplateColumns: '7fr 5fr', minHeight: 0 }}>
        <section
          className="blaiq-brand-pane"
          style={{
            position: 'relative',
            padding: '36px 40px 28px',
            borderRight: `1px solid ${PALETTE.rule}`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div className="blaiq-rise" style={{ animationDelay: '120ms' }}>
            <div className="blaiq-mono" style={{ fontSize: 11, letterSpacing: '0.28em', color: PALETTE.sub, marginBottom: 10 }}>
              ISSUE — RESTRICTED ENTRY
            </div>
            <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '0.02em', maxWidth: 520, lineHeight: 1.35 }}>
              Authenticate to enter the multi-tenant studio.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
            <div className="blaiq-rise" style={{ animationDelay: '260ms' }}>
              <div style={{ fontSize: 'clamp(64px, 9vw, 132px)', fontWeight: 200, letterSpacing: '-0.04em', lineHeight: 0.9 }}>
                BLAIQ
              </div>
              <div className="blaiq-mono" style={{ fontSize: 11, letterSpacing: '0.32em', color: PALETTE.sub, marginTop: 8 }}>
                ACCESS · IDENTITY · STUDIO
              </div>
            </div>
            <div
              className="blaiq-rise"
              style={{
                animationDelay: '340ms',
                marginLeft: 'auto',
                fontSize: 'clamp(120px, 16vw, 240px)',
                fontWeight: 100,
                lineHeight: 0.85,
                letterSpacing: '-0.05em',
                position: 'relative',
              }}
            >
              02
              <span style={{ position: 'absolute', top: 16, right: -10, width: 10, height: 10, background: PALETTE.mustard }} />
            </div>
          </div>

          <div
            className="blaiq-rise"
            style={{
              animationDelay: '440ms',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              borderTop: `1px solid ${PALETTE.rule}`,
              borderBottom: `1px solid ${PALETTE.rule}`,
            }}
          >
            {[
              { c: PALETTE.teal, l: 'SSO' },
              { c: PALETTE.mustard, l: 'OTP' },
              { c: PALETTE.red, l: 'EMAIL' },
              { c: PALETTE.beige, l: 'DEMO' },
            ].map((s, i) => (
              <div
                key={s.l}
                style={{
                  padding: '14px 14px',
                  borderRight: i < 3 ? `1px solid ${PALETTE.rule}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ width: 14, height: 14, background: s.c, flexShrink: 0 }} />
                <span className="blaiq-mono" style={{ fontSize: 10, letterSpacing: '0.32em', color: PALETTE.sub }}>
                  {s.l}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            padding: '36px 44px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          <div className="blaiq-rise" style={{ animationDelay: '160ms', maxWidth: 380, width: '100%', margin: '0 auto' }}>
            <div className="blaiq-mono" style={{ fontSize: 10, letterSpacing: '0.32em', color: PALETTE.sub, marginBottom: 12 }}>
              SECTION · {authMethod === 'google' ? '01 · IDENTITY' : '02 · OTP'}
            </div>
            <div style={{ fontSize: 'clamp(28px, 3.4vw, 44px)', fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1.05, marginBottom: 8 }}>
              {authMethod === 'google' ? 'Sign in.' : 'Verify phone.'}
            </div>
            <div className="blaiq-mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: PALETTE.sub, marginBottom: 24 }}>
              {authMethod === 'google' ? 'Continue with Google or company email.' : 'Receive a one-time code by SMS.'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginBottom: 24, border: `1px solid ${PALETTE.rule}` }}>
              <button
                type="button"
                onClick={() => { setAuthMethod('google'); setError(''); }}
                className={`blaiq-tab-btn blaiq-mono ${authMethod === 'google' ? 'blaiq-tab-active' : ''}`}
                style={{
                  padding: '10px 0',
                  fontSize: 10,
                  letterSpacing: '0.32em',
                  border: 'none',
                  background: authMethod === 'google' ? PALETTE.ink : 'transparent',
                  color: authMethod === 'google' ? PALETTE.bg : PALETTE.sub,
                }}
              >
                GOOGLE
              </button>
              <button
                type="button"
                onClick={() => { setAuthMethod('phone'); setError(''); }}
                className={`blaiq-tab-btn blaiq-mono ${authMethod === 'phone' ? 'blaiq-tab-active' : ''}`}
                style={{
                  padding: '10px 0',
                  fontSize: 10,
                  letterSpacing: '0.32em',
                  border: 'none',
                  borderLeft: `1px solid ${PALETTE.rule}`,
                  background: authMethod === 'phone' ? PALETTE.ink : 'transparent',
                  color: authMethod === 'phone' ? PALETTE.bg : PALETTE.sub,
                }}
              >
                PHONE
              </button>
            </div>

            {authMethod === 'google' ? (
              <div>
                <button
                  onClick={handleGoogleLogin}
                  disabled={submitting}
                  className="blaiq-cta blaiq-mono"
                  style={{
                    width: '100%',
                    padding: '14px 0',
                    background: PALETTE.ink,
                    color: PALETTE.bg,
                    border: 'none',
                    fontSize: 11,
                    letterSpacing: '0.32em',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                  }}
                >
                  CONTINUE WITH GOOGLE
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                  <div style={{ flex: 1, height: 1, background: PALETTE.rule }} />
                  <span className="blaiq-mono" style={{ fontSize: 10, letterSpacing: '0.32em', color: PALETTE.sub }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: PALETTE.rule }} />
                </div>

                <form onSubmit={handleSubmit}>
                  <div style={{ marginBottom: 18 }}>
                    <label style={labelStyle}>EMAIL</label>
                    <input
                      type="email"
                      placeholder="name@firma.de"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="blaiq-input"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={labelStyle}>PASSWORD</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="blaiq-input"
                      style={inputStyle}
                    />
                  </div>

                  {error && (
                    <div
                      className="blaiq-mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.18em',
                        color: PALETTE.red,
                        padding: '8px 12px',
                        border: `1px solid ${PALETTE.red}`,
                        marginBottom: 14,
                      }}
                    >
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="blaiq-cta blaiq-mono"
                    style={{
                      width: '100%',
                      padding: '14px 0',
                      background: PALETTE.ink,
                      color: PALETTE.bg,
                      border: 'none',
                      fontSize: 11,
                      letterSpacing: '0.32em',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                    }}
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : 'SIGN IN →'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={fillSeededCredentials}
                  className="blaiq-link blaiq-mono"
                  style={{
                    marginTop: 18,
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 0',
                    fontSize: 10,
                    letterSpacing: '0.32em',
                    color: PALETTE.sub,
                    cursor: 'pointer',
                  }}
                >
                  USE DEMO CREDENTIALS
                </button>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>PHONE</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <select
                      defaultValue="+49"
                      style={{ ...inputStyle, width: 110, appearance: 'none', cursor: 'pointer', background: 'transparent' }}
                    >
                      <option value="+49">+49 DE</option>
                      <option value="+1">+1 US</option>
                      <option value="+33">+33 FR</option>
                    </select>
                    <input
                      type="tel"
                      placeholder="123 456789"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="blaiq-input"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  </div>
                </div>

                {!otpSent ? (
                  <button
                    onClick={handleSendOtp}
                    disabled={submitting || !phoneNumber}
                    className="blaiq-cta blaiq-mono"
                    style={{
                      width: '100%',
                      padding: '14px 0',
                      background: PALETTE.ink,
                      color: PALETTE.bg,
                      border: 'none',
                      fontSize: 11,
                      letterSpacing: '0.32em',
                      cursor: 'pointer',
                      opacity: !phoneNumber ? 0.5 : 1,
                    }}
                  >
                    SEND CODE →
                  </button>
                ) : (
                  <div>
                    <div style={{ marginBottom: 18 }}>
                      <label style={labelStyle}>VERIFICATION CODE</label>
                      <input
                        type="tel"
                        maxLength={6}
                        placeholder="123456"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        className="blaiq-input"
                        style={{ ...inputStyle, fontSize: 22, letterSpacing: '0.4em' }}
                      />
                    </div>
                    {error && (
                      <div
                        className="blaiq-mono"
                        style={{
                          fontSize: 10,
                          letterSpacing: '0.18em',
                          color: PALETTE.red,
                          padding: '8px 12px',
                          border: `1px solid ${PALETTE.red}`,
                          marginBottom: 14,
                        }}
                      >
                        {error}
                      </div>
                    )}
                    <button
                      onClick={handleVerifyOtp}
                      disabled={submitting || !otp}
                      className="blaiq-cta blaiq-mono"
                      style={{
                        width: '100%',
                        padding: '14px 0',
                        background: PALETTE.ink,
                        color: PALETTE.bg,
                        border: 'none',
                        fontSize: 11,
                        letterSpacing: '0.32em',
                        cursor: 'pointer',
                        opacity: !otp ? 0.5 : 1,
                      }}
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : 'VERIFY →'}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => { setAuthMethod('google'); setOtpSent(false); setPhoneNumber(''); setOtp(''); }}
                  className="blaiq-link blaiq-mono"
                  style={{
                    marginTop: 18,
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 0',
                    fontSize: 10,
                    letterSpacing: '0.32em',
                    color: PALETTE.sub,
                    cursor: 'pointer',
                  }}
                >
                  ← BACK TO GOOGLE
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      <div
        style={{
          height: 28,
          background: PALETTE.ink,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
        }}
      >
        <span className="blaiq-mono" style={{ color: 'rgba(242,239,232,0.55)', fontSize: 9, letterSpacing: '0.32em' }}>
          ⏺ REC · BLAIQ ACCESS
        </span>
        <span className="blaiq-mono" style={{ color: 'rgba(242,239,232,0.55)', fontSize: 9, letterSpacing: '0.32em' }}>
          FRAME {String(tick).padStart(4, '0')} / ∞
        </span>
      </div>
    </div>
  );
}
