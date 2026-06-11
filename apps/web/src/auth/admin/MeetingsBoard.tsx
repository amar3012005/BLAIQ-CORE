// BLAIQ Admin · Meetings board.

'use client';

import React, { useEffect, useState } from 'react';
import {
  getMeetingMessages,
  listMeetingsForTeam,
  listProjects,
  type AdminMeeting,
  type AdminMeetingMessage,
} from './api';
import { PAL, monoSmall, sansBold, sans, pill, emptyText } from './theme';
import { ErrorBanner, SkeletonList } from './ProjectsBoard';

export default function MeetingsBoard(): JSX.Element {
  const [meetings, setMeetings] = useState<AdminMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminMeeting | null>(null);
  const [messages, setMessages] = useState<AdminMeetingMessage[] | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);

  useEffect(() => {
    (async (): Promise<void> => {
      try {
        const projects = await listProjects();
        const teamIds = Array.from(
          new Set(projects.map((p) => p.team_id).filter((x): x is string => Boolean(x))),
        );
        const all: AdminMeeting[] = [];
        for (const tid of teamIds) {
          try {
            all.push(...(await listMeetingsForTeam(tid)));
          } catch {
            // ignore
          }
        }
        setMeetings(all);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!open) {
      setMessages(null);
      return;
    }
    setMessages(null);
    setMsgError(null);
    getMeetingMessages(open.id)
      .then((m) => setMessages(m))
      .catch((e: Error) => setMsgError(e.message));
  }, [open]);

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto', position: 'relative' }}>
      <div style={{ ...monoSmall, color: PAL.muted, marginBottom: 12 }}>
        MEETINGS {meetings ? `· ${meetings.length}` : ''}
      </div>
      {error && <ErrorBanner message={error} />}
      {!meetings && !error && <SkeletonList />}
      {meetings && meetings.length === 0 && <div style={emptyText}>No meetings yet.</div>}
      {meetings && meetings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {meetings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setOpen(m)}
              style={{
                textAlign: 'left',
                padding: '12px 14px',
                background: PAL.panel,
                border: `1px solid ${PAL.divider}`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div>
                <div style={{ ...sansBold, fontSize: 12 }}>{m.topic}</div>
                {m.template && (
                  <div style={{ ...monoSmall, color: PAL.muted, marginTop: 4 }}>{m.template}</div>
                )}
              </div>
              {m.status && <span style={pill()}>{m.status}</span>}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,17,17,0.45)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setOpen(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '90vh',
              background: PAL.bg,
              border: `1px solid ${PAL.ink}`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderBottom: `1px solid ${PAL.divider}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ ...monoSmall, color: PAL.muted }}>MEETING</div>
                <div style={{ ...sansBold, fontSize: 14, marginTop: 4 }}>{open.topic}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(null)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${PAL.divider}`,
                  padding: '4px 10px',
                  ...monoSmall,
                  cursor: 'pointer',
                  color: PAL.ink,
                }}
              >
                CLOSE
              </button>
            </div>
            <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
              {msgError && <ErrorBanner message={msgError} />}
              {!messages && !msgError && <SkeletonList />}
              {messages && messages.length === 0 && (
                <div style={emptyText}>No transcript available.</div>
              )}
              {messages && messages.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        padding: '10px 12px',
                        background: PAL.panel,
                        border: `1px solid ${PAL.divider}`,
                      }}
                    >
                      <div
                        style={{
                          ...monoSmall,
                          color: PAL.accent,
                          marginBottom: 4,
                        }}
                      >
                        {msg.agent ?? msg.role ?? 'speaker'}
                      </div>
                      <div style={{ ...sans, fontSize: 12, color: PAL.ink, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
