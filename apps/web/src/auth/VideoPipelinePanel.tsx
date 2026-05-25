// Video pipeline panel — SSE-driven, shows progress + thumbnails + final video.

'use client';

import React, { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { Play, RefreshCcw, CheckCircle2, Loader2, AlertTriangle, Image as ImageIcon, Video as VideoIcon, Music } from 'lucide-react';

const P = {
  bg: '#F1F0EC',
  card: '#FAFAF7',
  ink: '#111111',
  muted: '#6E6A63',
  border: '#D8D3CB',
  accent: '#FF6A2A',
  green: '#22C55E',
  red: '#DC2626',
  white: '#FFFFFF',
};

const mono: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
};

interface Props {
  projectId: string;
  brief: {
    subject: string;
    style: string;
    voiceover: boolean;
    music: boolean;
    aspect: string;
    length: number;
    userPrompt: string;
  };
}

type StageKey = 'recall' | 'script' | 'ref-frames' | 'voice' | 'video' | 'stitch' | 'final';
const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'recall', label: 'Recall' },
  { key: 'script', label: 'Script' },
  { key: 'ref-frames', label: 'Frames' },
  { key: 'voice', label: 'Voice' },
  { key: 'video', label: 'Video' },
  { key: 'stitch', label: 'Stitch' },
  { key: 'final', label: 'Final' },
];

interface ShotState {
  shot: number;
  refFrame?: string;
  videoClip?: string;
  imagePrompt?: string;
  narration?: string;
}

export default function VideoPipelinePanel({ projectId, brief }: Props): JSX.Element {
  const [stageStatus, setStageStatus] = useState<Record<StageKey, 'pending' | 'running' | 'done' | 'skipped'>>({
    recall: 'pending',
    script: 'pending',
    'ref-frames': 'pending',
    voice: 'pending',
    video: 'pending',
    stitch: 'pending',
    final: 'pending',
  });
  const [shots, setShots] = useState<ShotState[]>([]);
  const [storyboardTitle, setStoryboardTitle] = useState('');
  const [narration, setNarration] = useState('');
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    setFinalUrl(null);
    setShots([]);
    setStageStatus({
      recall: 'pending',
      script: 'pending',
      'ref-frames': 'pending',
      voice: 'pending',
      video: 'pending',
      stitch: 'pending',
      final: 'pending',
    });

    try {
      const r = await fetch('/api/v1/video/render', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          subject: brief.subject,
          style: brief.style,
          voiceover: brief.voiceover,
          music: brief.music,
          aspect: brief.aspect,
          length: brief.length,
          user_prompt: brief.userPrompt,
        }),
      });
      if (!r.body) throw new Error('no response stream');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          const lines = ev.split('\n');
          let evName = 'message';
          let data = '';
          for (const ln of lines) {
            if (ln.startsWith('event: ')) evName = ln.slice(7);
            else if (ln.startsWith('data: ')) data += ln.slice(6);
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            handleEvent(evName, parsed);
          } catch {
            // ignore
          }
        }
      }
      setRunning(false);
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
    }
  }, [projectId, brief]);

  const handleEvent = useCallback((evName: string, payload: { stage?: StageKey | 'error'; status?: string; shot?: number; path?: string; chars?: number; storyboard?: { title?: string; narration?: string; shots?: Array<{ shot: number; image_prompt?: string; narration_chunk?: string }> }; final_path?: string; message?: string }) => {
    if (evName === 'progress' && payload.stage) {
      const stage = payload.stage as StageKey | 'error';
      if (stage === 'error') {
        setError(payload.message || 'unknown error');
        return;
      }
      if (payload.status === 'start') {
        setStageStatus((s) => ({ ...s, [stage]: 'running' }));
      } else if (payload.status === 'done') {
        setStageStatus((s) => ({ ...s, [stage]: 'done' }));
        if (stage === 'script' && payload.storyboard) {
          setStoryboardTitle(payload.storyboard.title ?? '');
          setNarration(payload.storyboard.narration ?? '');
          setShots(
            (payload.storyboard.shots ?? []).map((s) => ({
              shot: s.shot,
              imagePrompt: s.image_prompt,
              narration: s.narration_chunk,
            })),
          );
        }
      } else if (payload.status === 'skip') {
        setStageStatus((s) => ({ ...s, [stage]: 'skipped' }));
      } else if (payload.status === 'shot-done') {
        const shotNum = payload.shot ?? 0;
        const url = payload.path ? `/api/projects/${projectId}/files/${path2name(payload.path)}` : undefined;
        setShots((prev) =>
          prev.map((s) =>
            s.shot === shotNum
              ? {
                  ...s,
                  ...(stage === 'ref-frames' ? { refFrame: url } : {}),
                  ...(stage === 'video' ? { videoClip: url } : {}),
                }
              : s,
          ),
        );
      }
    } else if (evName === 'done' && payload.final_path) {
      setFinalUrl(payload.final_path);
      setStageStatus((s) => ({ ...s, final: 'done' }));
      setRunning(false);
    } else if (evName === 'error') {
      setError(payload.message || 'unknown error');
      setRunning(false);
    }
  }, [projectId]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: P.bg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: `1px solid ${P.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <VideoIcon size={16} color={P.muted} />
          <div>
            <div style={{ ...mono, color: P.muted, marginBottom: 2 }}>VIDEO PIPELINE</div>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 700, color: P.ink }}>
              {storyboardTitle || brief.subject}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={running}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: running ? P.muted : P.ink,
            color: P.white,
            border: 'none',
            cursor: running ? 'wait' : 'pointer',
            fontFamily: '"Inter", sans-serif',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          {running ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={12} />}
          {running ? 'RENDERING…' : finalUrl ? 'RE-RENDER' : 'START RENDER'}
        </button>
      </div>

      {/* Stage progress bar */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '12px 20px',
        borderBottom: `1px solid ${P.border}`,
        flexShrink: 0,
        background: P.card,
      }}>
        {STAGES.map((s, i) => {
          const status = stageStatus[s.key];
          const color =
            status === 'done' ? P.green :
            status === 'running' ? P.accent :
            status === 'skipped' ? P.muted :
            P.border;
          return (
            <div key={s.key} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: status === 'pending' ? 'transparent' : color,
                border: `1.5px solid ${color}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {status === 'done' && <CheckCircle2 size={11} color={P.white} />}
                {status === 'running' && <Loader2 size={10} color={P.white} style={{ animation: 'spin 1s linear infinite' }} />}
              </div>
              <div style={{
                ...mono,
                color: status === 'pending' ? P.muted : P.ink,
                fontSize: 8,
              }}>
                {s.label}
              </div>
              {i < STAGES.length - 1 && (
                <div style={{
                  flex: 1,
                  height: 1,
                  background: status === 'done' ? P.green : P.border,
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '10px 20px',
          background: 'rgba(220,38,38,0.08)',
          borderBottom: `1px solid rgba(220,38,38,0.2)`,
          color: P.red,
          fontFamily: '"Inter", sans-serif',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
        {/* Final video player */}
        {finalUrl && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>FINAL VIDEO</div>
            <video
              src={finalUrl}
              controls
              style={{
                width: '100%',
                maxHeight: 480,
                background: '#000',
                border: `1px solid ${P.border}`,
              }}
            />
          </div>
        )}

        {/* Shot grid */}
        {shots.length > 0 && (
          <div>
            <div style={{ ...mono, color: P.muted, marginBottom: 10 }}>
              STORYBOARD · {shots.length} SHOTS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {shots.map((s) => (
                <div key={s.shot} style={{
                  background: P.card,
                  border: `1px solid ${P.border}`,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    aspectRatio: brief.aspect === '9:16' ? '9 / 16' : '16 / 9',
                    background: '#000',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {s.videoClip ? (
                      <video src={s.videoClip} muted autoPlay loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : s.refFrame ? (
                      <img src={s.refFrame} alt={`shot ${s.shot}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ color: P.muted, fontFamily: '"Inter", sans-serif', fontSize: 11 }}>
                        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                      </div>
                    )}
                    <div style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      padding: '2px 6px',
                      background: 'rgba(0,0,0,0.7)',
                      color: P.white,
                      ...mono,
                      fontSize: 8,
                    }}>
                      SHOT {s.shot}
                    </div>
                  </div>
                  <div style={{ padding: 10 }}>
                    <div style={{
                      fontFamily: '"Inter", sans-serif',
                      fontSize: 11,
                      color: P.ink,
                      lineHeight: 1.4,
                      maxHeight: 50,
                      overflow: 'hidden',
                    }}>
                      {s.narration || s.imagePrompt?.slice(0, 80)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Narration */}
        {narration && (
          <div style={{ marginTop: 24 }}>
            <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>NARRATION</div>
            <div style={{
              padding: '12px 16px',
              background: P.card,
              border: `1px solid ${P.border}`,
              fontFamily: '"Inter", sans-serif',
              fontSize: 13,
              lineHeight: 1.6,
              color: P.ink,
            }}>
              {narration}
            </div>
          </div>
        )}

        {/* Empty state */}
        {shots.length === 0 && !running && !error && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 12,
            color: P.muted,
            textAlign: 'center',
            padding: 40,
          }}>
            <VideoIcon size={32} color={P.border} />
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, color: P.ink }}>
              Ready to render
            </div>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, color: P.muted, maxWidth: 360 }}>
              Click START RENDER to run the 7-stage pipeline: Hivemind recall → script → reference frames → voiceover → i2v → stitch. Uses OpenRouter models throughout.
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function path2name(p: string): string {
  return p.split('/').pop() ?? p;
}
