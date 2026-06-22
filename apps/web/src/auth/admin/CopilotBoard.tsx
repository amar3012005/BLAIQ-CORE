// BLAIQ Admin · Copilot (Track AA) — grounded chat over the agency's live jobs.
// Read-only assistant: answers about overdue invoices, margins, delivery, and
// "what to do next". Agentic actions land in a later phase.

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { copilotAct, runProposedAction, type CopilotTurn, type ProposedAction } from './api';
import NextActions from './NextActions';
import { PAL, monoSmall, sansBold, sans } from './theme';

const SUGGESTIONS = [
  "What's at risk this week?",
  'Which jobs are overdue?',
  'Summarise all jobs',
  'What should I do next?',
];

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  proposed?: ProposedAction;
  done?: boolean;
}

export default function CopilotBoard(): JSX.Element {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [runningIdx, setRunningIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
    setBusy(false);
    setMessages(prev => [...prev, { role: 'assistant', content: 'Cancelled.', error: false }]);
  }, []);

  const send = async (text: string): Promise<void> => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const history: CopilotTurn[] = messages
      .filter(m => !m.error && !m.proposed)
      .map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setBusy(true);
    abortRef.current = new AbortController();
    const timeoutId = setTimeout(() => abortRef.current?.abort(), 90_000);
    try {
      const reply = await copilotAct(q, history);
      if (reply.proposed) {
        setMessages(prev => [...prev, { role: 'assistant', content: reply.proposed!.summary, proposed: reply.proposed! }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: reply.answer ?? '' }]);
      }
    } catch (e) {
      const msg = (e as Error).name === 'AbortError'
        ? 'Request timed out — the copilot took too long. Try a simpler question.'
        : `Copilot unavailable: ${(e as Error).message}`;
      setMessages(prev => [...prev, { role: 'assistant', content: msg, error: true }]);
    } finally {
      clearTimeout(timeoutId);
      setBusy(false);
    }
  };

  const approve = async (idx: number, p: ProposedAction): Promise<void> => {
    setRunningIdx(idx);
    try {
      await runProposedAction(p);
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, done: true, content: `✓ Done — ${p.summary}` } : m));
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Action failed: ${(e as Error).message}`, error: true }]);
    } finally {
      setRunningIdx(null);
    }
  };

  const dismiss = (idx: number): void => {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, proposed: undefined, done: true, content: 'Dismissed.' } : m));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${PAL.divider}` }}>
        <span style={{ ...sansBold, fontSize: 14, color: PAL.ink }}>✦ Admin Copilot</span>
        <span style={{ ...monoSmall, color: PAL.muted, marginLeft: 'auto' }}>GROUNDED IN LIVE JOBS</span>
      </div>

      <NextActions />


      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 460 }}>
            <div style={{ ...sansBold, fontSize: 15, color: PAL.ink, marginBottom: 6 }}>Ask about your agency</div>
            <div style={{ ...sans, fontSize: 13, color: PAL.muted, marginBottom: 18 }}>
              I read every job's finance, task, and delivery state. Ask a question or pick one:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { void send(s); }}
                  style={{
                    border: `1px solid ${PAL.divider}`,
                    background: PAL.panel,
                    color: PAL.ink,
                    cursor: 'pointer',
                    ...sans,
                    fontSize: 12,
                    padding: '7px 12px',
                    borderRadius: 16,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          m.proposed && !m.done ? (
            <div
              key={i}
              style={{
                alignSelf: "flex-start", maxWidth: "88%", background: PAL.panel,
                border: `1px solid ${PAL.divider}`, borderLeft: '3px solid #818CF8',
                padding: '12px 14px', borderRadius: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <span style={{ ...monoSmall, color: '#4F46E5', fontSize: 8 }}>⚡ PROPOSED ACTION · NEEDS APPROVAL</span>
              </div>
              <div style={{ ...sans, fontSize: 13.5, color: PAL.ink, marginBottom: 12 }}>{m.proposed.summary}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={runningIdx === i}
                  onClick={() => { void approve(i, m.proposed!); }}
                  style={{ border: 'none', background: '#4F46E5', color: PAL.white, cursor: runningIdx === i ? 'wait' : 'pointer', ...monoSmall, fontSize: 9, padding: '7px 14px' }}
                >
                  {runningIdx === i ? 'RUNNING…' : '✓ APPROVE & RUN'}
                </button>
                <button
                  type="button"
                  disabled={runningIdx === i}
                  onClick={() => dismiss(i)}
                  style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 9, padding: '7px 14px' }}
                >
                  DISMISS
                </button>
              </div>
            </div>
          ) : (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '82%',
                background: m.role === 'user' ? PAL.accentDim : (m.error ? 'rgba(220,38,38,0.06)' : (m.done ? 'rgba(16,185,129,0.08)' : PAL.panel)),
                color: m.role === 'user' ? '#FFFFFF' : (m.error ? '#F87171' : (m.done ? '#34D399' : PAL.ink)),
                border: m.role === 'user' ? `1px solid ${PAL.accentBright}44` : `1px solid ${m.error ? 'rgba(220,38,38,0.25)' : PAL.divider}`,
                padding: '10px 14px',
                borderRadius: 12,
                ...sans,
                fontSize: 13.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          )
        ))}

        {busy && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${PAL.divider}`, borderTopColor: PAL.accent, animation: 'bq-spin 0.8s linear infinite', flexShrink: 0 }} />
            <span style={{ ...monoSmall, color: PAL.muted }}>THINKING…</span>
            <button type="button" onClick={cancel} style={{ border: `1px solid ${PAL.divider}`, background: 'transparent', color: PAL.muted, cursor: 'pointer', ...monoSmall, fontSize: 8, padding: '3px 8px', borderRadius: 4 }}>CANCEL</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderTop: `1px solid ${PAL.divider}` }}>
        <input
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(input); }}
          placeholder="Ask the copilot…"
          style={{
            flex: 1,
            padding: '9px 12px',
            border: `1px solid ${PAL.divider}`,
            background: PAL.bg,
            ...sans,
            fontSize: 13,
            color: PAL.ink,
            outline: 'none',
          }}
        />
        <button
          type="button"
          disabled={busy || !input.trim()}
          onClick={() => { void send(input); }}
          style={{
            padding: '9px 16px',
            background: PAL.accent,
            border: 'none',
            cursor: busy ? 'wait' : 'pointer',
            ...monoSmall,
            color: PAL.white,
          }}
        >
          SEND
        </button>
      </div>
    </div>
  );
}
