// Polished markdown renderer for text artifacts.
// Ported from HIVE-MIND TalkToHiveMobile.jsx renderMarkdownMobile.
// Inline-style (no Tailwind), supports:
//   - Headings (h1-h4)
//   - Bullet + numbered lists
//   - Blockquote
//   - Code fence + inline code
//   - GitHub-style tables (| a | b |)
//   - Bold / italic / links / inline code

'use client';

import React, { type CSSProperties, type ReactNode } from 'react';

const P = {
  ink: '#111111',
  muted: '#6E6A63',
  faint: '#A3A3A3',
  card: '#FAFAF7',
  bg: '#F1F0EC',
  border: '#D8D3CB',
  rowAlt: '#F7F6F1',
  codeBg: '#0a0a0a',
  codeFg: '#e5e5e5',
  accent: '#FF6A2A',
};

function inlineMd(s: string, keyPrefix = 'i'): ReactNode[] {
  if (!s) return [];
  const out: ReactNode[] = [];
  let rest = String(s);
  let k = 0;
  while (rest.length) {
    const patterns: Array<{ re: RegExp; tag: 'b' | 'i' | 'code' | 'a' }> = [
      { re: /\*\*([^*]+)\*\*/, tag: 'b' },
      { re: /(?<!\*)\*([^*\n]+)\*(?!\*)/, tag: 'i' },
      { re: /`([^`]+)`/, tag: 'code' },
      { re: /\[([^\]]+)\]\(([^)]+)\)/, tag: 'a' },
    ];
    let first: { tag: 'b' | 'i' | 'code' | 'a'; match: RegExpMatchArray } | null = null;
    for (const p of patterns) {
      const m = rest.match(p.re);
      if (m && m.index !== undefined && (first === null || m.index < first.match.index!)) {
        first = { tag: p.tag, match: m };
      }
    }
    if (!first) {
      out.push(rest);
      break;
    }
    if (first.match.index! > 0) out.push(rest.slice(0, first.match.index));
    const v = first.match;
    if (first.tag === 'b') {
      out.push(<strong key={`${keyPrefix}-b-${k++}`}>{v[1]}</strong>);
    } else if (first.tag === 'i') {
      out.push(<em key={`${keyPrefix}-i-${k++}`}>{v[1]}</em>);
    } else if (first.tag === 'code') {
      out.push(
        <code
          key={`${keyPrefix}-c-${k++}`}
          style={{
            padding: '1px 5px',
            background: 'rgba(17,17,17,0.06)',
            fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
            fontSize: '0.92em',
            borderRadius: 2,
          }}
        >
          {v[1]}
        </code>,
      );
    } else if (first.tag === 'a') {
      out.push(
        <a
          key={`${keyPrefix}-a-${k++}`}
          href={v[2]}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: P.accent, textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          {v[1]}
        </a>,
      );
    }
    rest = rest.slice(v.index! + v[0].length);
  }
  return out;
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}
function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function MarkdownRenderer({ source }: { source: string }): JSX.Element {
  return <>{renderMarkdown(source)}</>;
}

export function renderMarkdown(raw: string): ReactNode[] {
  if (!raw) return [];
  const text = String(raw).replace(/^\s+|\s+$/g, '');
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  let key = 0;

  const headingStyle = (level: number): CSSProperties => {
    if (level === 1) {
      return {
        fontFamily: '"Inter", sans-serif',
        fontSize: 24,
        fontWeight: 800,
        margin: '18px 0 10px',
        color: P.ink,
        letterSpacing: '-0.01em',
        lineHeight: 1.2,
      };
    }
    if (level === 2) {
      return {
        fontFamily: '"Inter", sans-serif',
        fontSize: 18,
        fontWeight: 700,
        margin: '16px 0 8px',
        color: P.ink,
        lineHeight: 1.25,
      };
    }
    if (level === 3) {
      return {
        fontFamily: '"Inter", sans-serif',
        fontSize: 15,
        fontWeight: 700,
        margin: '14px 0 6px',
        color: P.ink,
      };
    }
    return {
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      margin: '12px 0 6px',
      color: P.muted,
    };
  };

  while (i < lines.length) {
    const line = (lines[i] ?? '') ?? '';
    const trimmed = line.trim();

    // Code fence
    if (/^```/.test(trimmed)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        buf.push((lines[i] ?? ''));
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre
          key={key++}
          style={{
            margin: '12px 0',
            padding: '14px 16px',
            background: P.codeBg,
            color: P.codeFg,
            fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.55,
            overflowX: 'auto',
            border: `1px solid ${P.border}`,
          }}
        >
          {buf.join('\n')}
        </pre>,
      );
      continue;
    }

    if (!trimmed) {
      i++;
      continue;
    }

    // Table
    if (isTableRow(line) && i + 1 < lines.length && isTableSep((lines[i + 1] ?? ""))) {
      const header = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow((lines[i] ?? ''))) {
        rows.push(parseTableRow((lines[i] ?? '')));
        i++;
      }
      blocks.push(
        <div key={key++} style={{ margin: '14px 0', overflowX: 'auto' }}>
          <table
            style={{
              minWidth: '100%',
              fontSize: 13,
              borderCollapse: 'collapse',
              fontFamily: '"Inter", sans-serif',
            }}
          >
            <thead>
              <tr style={{ background: P.bg }}>
                {header.map((h, hx) => (
                  <th
                    key={hx}
                    style={{
                      textAlign: 'left',
                      fontWeight: 700,
                      padding: '10px 12px',
                      border: `1px solid ${P.border}`,
                      color: P.ink,
                      fontSize: 12,
                    }}
                  >
                    {inlineMd(h, `th-${hx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rx) => (
                <tr key={rx} style={{ background: rx % 2 ? P.card : P.rowAlt }}>
                  {r.map((c, cx) => (
                    <td
                      key={cx}
                      style={{
                        padding: '10px 12px',
                        border: `1px solid ${P.border}`,
                        verticalAlign: 'top',
                        color: P.ink,
                      }}
                    >
                      {inlineMd(c, `td-${rx}-${cx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Heading
    const h = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (h && h[1] && h[2]) {
      const level = h[1].length;
      blocks.push(
        <div key={key++} style={headingStyle(level)}>
          {inlineMd(h[2], `h-${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push(
        <hr
          key={key++}
          style={{
            margin: '16px 0',
            border: 'none',
            borderTop: `1px solid ${P.border}`,
          }}
        />,
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[*-]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[*-]\s+/.test((lines[i] ?? ''))) {
        items.push((lines[i] ?? '').replace(/^\s*[*-]\s+/, ''));
        i++;
      }
      const myKey = key++;
      blocks.push(
        <ul
          key={myKey}
          style={{
            paddingLeft: 22,
            margin: '6px 0 10px',
            fontFamily: '"Inter", sans-serif',
            fontSize: 14,
            lineHeight: 1.7,
            color: P.ink,
          }}
        >
          {items.map((it, ix) => (
            <li key={ix} style={{ marginBottom: 4 }}>
              {inlineMd(it, `li-${myKey}-${ix}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test((lines[i] ?? ''))) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      const myKey = key++;
      blocks.push(
        <ol
          key={myKey}
          style={{
            paddingLeft: 22,
            margin: '6px 0 10px',
            fontFamily: '"Inter", sans-serif',
            fontSize: 14,
            lineHeight: 1.7,
            color: P.ink,
          }}
        >
          {items.map((it, ix) => (
            <li key={ix} style={{ marginBottom: 4 }}>
              {inlineMd(it, `ol-${myKey}-${ix}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test((lines[i] ?? ''))) {
        buf.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          style={{
            margin: '10px 0',
            paddingLeft: 14,
            borderLeft: `3px solid ${P.accent}`,
            color: P.muted,
            fontStyle: 'italic',
            fontFamily: '"Inter", sans-serif',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {inlineMd(buf.join(' '), `bq-${key}`)}
        </blockquote>,
      );
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,4}\s|\s*[*-]\s+|\s*\d+\.\s+|```|>\s?|---+$|\*\*\*+$)/.test((lines[i] ?? '')) &&
      !(isTableRow((lines[i] ?? '')) && i + 1 < lines.length && isTableSep((lines[i + 1] ?? "")))
    ) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    if (para.length) {
      blocks.push(
        <p
          key={key++}
          style={{
            margin: '8px 0',
            fontFamily: '"Inter", sans-serif',
            fontSize: 14.5,
            lineHeight: 1.65,
            color: P.ink,
          }}
        >
          {inlineMd(para.join(' '), `p-${key}`)}
        </p>,
      );
    }
  }
  return blocks;
}

export default MarkdownRenderer;
