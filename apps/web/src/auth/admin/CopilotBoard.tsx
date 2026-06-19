// BLAIQ Admin · Copilot (Track AA) — grounded chat over the agency's live jobs.
// Read-only assistant: answers about overdue invoices, margins, delivery, and
// "what to do next". Agentic actions land in a later phase.

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { askCopilot, type CopilotTurn } from './api';
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
}

export default function CopilotBoard(): JSX.Element {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text: string): Promise<void> => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const history: CopilotTurn[] = messages
      .filter(m => !m.error)
      .map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const reply = await askCopilot(q, history);
      setMessages(prev => [...prev, { role: 'assistant', content: reply.answer }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Copilot unavailable: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
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
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
              background: m.role === 'user' ? PAL.ink : (m.error ? 'rgba(220,38,38,0.06)' : PAL.panel),
              color: m.role === 'user' ? PAL.white : (m.error ? '#B91C1C' : PAL.ink),
              border: m.role === 'user' ? 'none' : `1px solid ${m.error ? 'rgba(220,38,38,0.25)' : PAL.divider}`,
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
        ))}

        {busy && (
          <div style={{ alignSelf: 'flex-start', ...monoSmall, color: PAL.muted, padding: '6px 4px' }}>
            THINKING…
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
