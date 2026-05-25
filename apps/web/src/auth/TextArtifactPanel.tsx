// TextArtifactPanel — polished right-side render of text artifacts.
// Listens for assistant messages on a project's conversation, renders
// each as a tab in a side panel. Uses MarkdownRenderer.

'use client';

import React, { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { Copy, Download, Check, FileText, Maximize2, X } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

const P = {
  bg: '#F1F0EC',
  card: '#FAFAF7',
  ink: '#111111',
  muted: '#6E6A63',
  border: '#D8D3CB',
  accent: '#FF6A2A',
  hover: '#EDE9E3',
  white: '#FFFFFF',
};

const mono: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
};

interface ArtifactTab {
  id: string;
  ts: number;
  title: string;
  subtype: string;
  summary: string;
  body: string;
}

interface Props {
  projectId: string;
  conversationId: string;
  subtype?: string;
}

/**
 * Parse assistant message into chat summary + artifact body.
 * Convention: model writes one-line summary, blank line, then artifact.
 * Fallback: whole message becomes both summary (truncated) + body.
 */
function parseMessage(content: string, subtype: string): { summary: string; body: string; title: string } {
  const trimmed = (content || '').trim();
  if (!trimmed) return { summary: '', body: '', title: subtype || 'Artifact' };

  // Look for an explicit `---` divider between summary and artifact.
  const dividerMatch = trimmed.match(/^([\s\S]*?)\n\s*---\s*\n([\s\S]*)$/);
  if (dividerMatch && dividerMatch[1] && dividerMatch[2]) {
    const summary = (dividerMatch[1].trim().split('\n')[0] ?? '').slice(0, 200);
    const body = dividerMatch[2].trim();
    const title = extractTitle(body) ?? humanSubtype(subtype);
    return { summary, body, title };
  }

  // No divider — first line = summary, whole = body.
  const firstLine = (trimmed.split('\n')[0] ?? '').slice(0, 200);
  const title = extractTitle(trimmed) ?? humanSubtype(subtype);
  return { summary: firstLine, body: trimmed, title };
}

function extractTitle(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m && m[1] ? m[1].trim().slice(0, 80) : null;
}

function humanSubtype(s: string): string {
  if (!s) return 'Text Artifact';
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TextArtifactPanel({ projectId, conversationId, subtype = '' }: Props): JSX.Element {
  const [tabs, setTabs] = useState<ArtifactTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const fetchMessages = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        { credentials: 'include' },
      );
      if (!r.ok) return;
      const data = (await r.json()) as { messages?: Array<{ id: string; role: string; content: string; createdAt?: number }> };
      const assistants = (data.messages ?? []).filter((m) => m.role === 'assistant' && m.content);
      const built: ArtifactTab[] = assistants.map((m) => {
        const parsed = parseMessage(m.content, subtype);
        return {
          id: m.id,
          ts: m.createdAt ?? 0,
          title: parsed.title,
          subtype,
          summary: parsed.summary,
          body: parsed.body,
        };
      });
      setTabs(built);
      const latest = built[built.length - 1];
      if (latest) {
        if (!activeId) setActiveId(latest.id);
        else if (!built.find((t) => t.id === activeId)) setActiveId(latest.id);
      }
    } catch {
      // non-fatal
    }
  }, [projectId, conversationId, subtype, activeId]);

  useEffect(() => {
    void fetchMessages();
    const id = setInterval(() => void fetchMessages(), 3000);
    return () => clearInterval(id);
  }, [fetchMessages]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1] ?? null;

  const handleCopy = useCallback(async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  }, [active]);

  const handleDownload = useCallback(() => {
    if (!active) return;
    const blob = new Blob([active.body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [active]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: P.bg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: fullscreen ? 'fixed' : 'relative',
        inset: fullscreen ? 0 : undefined,
        zIndex: fullscreen ? 200 : undefined,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: `1px solid ${P.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={14} color={P.muted} />
          <span style={{ ...mono, color: P.muted }}>ARTIFACT PREVIEW</span>
          {subtype && (
            <span
              style={{
                ...mono,
                fontSize: 9,
                color: P.accent,
                background: 'rgba(255,106,42,0.1)',
                border: '1px solid rgba(255,106,42,0.25)',
                padding: '2px 6px',
              }}
            >
              {subtype.replace(/_/g, ' ').toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!active}
            style={iconBtn(!!active)}
            title="Copy markdown"
          >
            {copied ? <Check size={13} color={P.accent} /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!active}
            style={iconBtn(!!active)}
            title="Download .md"
          >
            <Download size={13} />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            style={iconBtn(true)}
            title="Fullscreen"
          >
            {fullscreen ? <X size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Tab strip */}
      {tabs.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 14px',
            borderBottom: `1px solid ${P.border}`,
            overflowX: 'auto',
            flexShrink: 0,
            background: P.card,
          }}
        >
          {tabs.map((t, i) => {
            const isActive = t.id === activeId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                style={{
                  padding: '6px 12px',
                  fontFamily: '"Inter", sans-serif',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? P.ink : P.muted,
                  background: isActive ? P.bg : 'transparent',
                  border: `1px solid ${isActive ? P.accent : P.border}`,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                v{i + 1} · {t.title.slice(0, 32)}
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '0',
        }}
      >
        {!active ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 10,
              color: P.muted,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <FileText size={28} color={P.border} />
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 13 }}>
              No artifact yet
            </div>
            <div style={{ ...mono, color: P.muted, fontSize: 9 }}>
              Send a prompt to generate one
            </div>
          </div>
        ) : (
          <article
            style={{
              maxWidth: 760,
              margin: '0 auto',
              padding: '32px 40px',
              background: P.white,
              minHeight: '100%',
              fontFamily: '"Inter", sans-serif',
              color: P.ink,
              boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
            }}
          >
            <MarkdownRenderer source={active.body} />
          </article>
        )}
      </div>
    </div>
  );
}

function iconBtn(enabled: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: `1px solid ${P.border}`,
    cursor: enabled ? 'pointer' : 'not-allowed',
    color: P.ink,
    opacity: enabled ? 1 : 0.4,
  };
}
