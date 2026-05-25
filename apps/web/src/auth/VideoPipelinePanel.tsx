// Video pipeline panel — SSE-driven, shows progress + thumbnails + final video.

'use client';

import React, { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { Play, RefreshCcw, CheckCircle2, Loader2, AlertTriangle, Image as ImageIcon, Video as VideoIcon, Music, FileText, Film, LayoutGrid } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

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
  onScript?: (markdown: string) => void;
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

export default function VideoPipelinePanel({ projectId, brief, onScript }: Props): JSX.Element {
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
  const [subjectSheets, setSubjectSheets] = useState<Array<{ id: string; url: string }>>([]);
  const [scenerySheet, setScenerySheet] = useState<string | null>(null);
  const [scriptMd, setScriptMd] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'script' | 'references' | 'shots' | 'final'>('script');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [hitl, setHitl] = useState<null | {
    gate: 'discovery' | 'script' | 'references' | 'frames';
    title: string;
    questions?: Array<{ id: string; question: string; hint?: string }>;
    previewMarkdown?: string;
    previewImages?: string[];
  }>(null);
  const [hitlAnswers, setHitlAnswers] = useState<Record<string, string>>({});
  const [hitlNotes, setHitlNotes] = useState('');
  const [hitlSubmitting, setHitlSubmitting] = useState(false);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    setFinalUrl(null);
    setShots([]);
    setSubjectSheets([]);
    setScenerySheet(null);
    setHitl(null);
    setHitlAnswers({});
    setHitlNotes('');
    setScriptMd('');
    setActiveTab('script');
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

  const handleEvent = useCallback((evName: string, payload: { stage?: StageKey | 'error' | 'chat-script' | 'video-error' | 'subject-sheet' | 'scenery-sheet' | 'hitl'; status?: string; shot?: number; path?: string; chars?: number; storyboard?: { title?: string; narration?: string; shots?: Array<{ shot: number; image_prompt?: string; narration_chunk?: string }> }; final_path?: string; message?: string; markdown?: string; subjectId?: string; gate?: 'discovery' | 'script' | 'references' | 'frames'; title?: string; questions?: Array<{ id: string; question: string; hint?: string }>; previewMarkdown?: string; previewImages?: string[] }) => {
    if (evName === 'progress' && payload.stage) {
      const stage = payload.stage as StageKey | 'error' | 'chat-script' | 'video-error' | 'subject-sheet' | 'scenery-sheet' | 'hitl';
      if (stage === 'hitl' && payload.gate) {
        setHitl({
          gate: payload.gate,
          title: payload.title || 'Review',
          ...(payload.questions ? { questions: payload.questions } : {}),
          ...(payload.previewMarkdown ? { previewMarkdown: payload.previewMarkdown } : {}),
          ...(payload.previewImages ? { previewImages: payload.previewImages } : {}),
        });
        setHitlAnswers({});
        setHitlNotes('');
        return;
      }
      if (stage === 'error') {
        setError(payload.message || 'unknown error');
        return;
      }
      if (stage === 'chat-script') {
        if (payload.markdown) {
          setScriptMd(payload.markdown);
          if (onScript) onScript(payload.markdown);
        }
        return;
      }
      if (stage === 'video-error') {
        setError(`shot ${payload.shot}: ${payload.message || 'i2v failed, used image fallback'}`);
        return;
      }
      if (stage === 'subject-sheet') {
        if (payload.status === 'done' && payload.path) {
          const url = `/api/projects/${projectId}/files/${path2name(payload.path)}`;
          const id = payload.subjectId || 'subject';
          setSubjectSheets((prev) => {
            const filtered = prev.filter((s) => s.id !== id);
            return [...filtered, { id, url }];
          });
          setActiveTab('references');
        }
        return;
      }
      if (stage === 'scenery-sheet') {
        if (payload.status === 'done' && payload.path) {
          setScenerySheet(`/api/projects/${projectId}/files/${path2name(payload.path)}`);
          setActiveTab('references');
        }
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
        if (stage === 'ref-frames' || stage === 'video') setActiveTab('shots');
      }
    } else if (evName === 'done' && payload.final_path) {
      setFinalUrl(payload.final_path);
      setActiveTab('final');
      setStageStatus((s) => ({ ...s, final: 'done' }));
      setRunning(false);
    } else if (evName === 'error') {
      setError(payload.message || 'unknown error');
      setRunning(false);
    }
  }, [projectId, onScript]);

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

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 0,
        padding: '0 12px',
        borderBottom: `1px solid ${P.border}`,
        background: P.bg,
        flexShrink: 0,
      }}>
        {([
          { key: 'script', label: 'Script', Icon: FileText, badge: scriptMd ? '•' : '' },
          { key: 'references', label: 'Reference Sheets', Icon: ImageIcon, badge: subjectSheets.length + (scenerySheet ? 1 : 0) || '' },
          { key: 'shots', label: 'Shot Frames', Icon: LayoutGrid, badge: shots.length || '' },
          { key: 'final', label: 'Final Video', Icon: Film, badge: finalUrl ? '•' : '' },
        ] as const).map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? P.ink : 'transparent'}`,
                color: active ? P.ink : P.muted,
                fontFamily: '"Inter", sans-serif',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              <t.Icon size={13} />
              {t.label}
              {t.badge ? (
                <span style={{ ...mono, fontSize: 9, color: P.muted, marginLeft: 2 }}>{t.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Body — single active tab */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
        {activeTab === 'script' && (
          <div>
            {scriptMd ? (
              <MarkdownRenderer source={scriptMd} />
            ) : narration ? (
              <div>
                <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>NARRATION</div>
                <div style={{ padding: '12px 16px', background: P.card, border: `1px solid ${P.border}`, fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.6, color: P.ink }}>
                  {narration}
                </div>
              </div>
            ) : (
              <EmptyTab icon={<FileText size={32} color={P.border} />} title="Script appears here" hint="The full storyboard (title, presenter, world, narration, shot table) renders here once the script stage finishes." />
            )}
          </div>
        )}

        {activeTab === 'references' && (
          <div>
            {(subjectSheets.length > 0 || scenerySheet) ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
                {subjectSheets.map((s) => (
                  <div key={s.id} style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', borderBottom: `1px solid ${P.border}`, ...mono, color: P.muted }}>
                      SUBJECT — {s.id} · 4-photo grid
                    </div>
                    <img src={s.url} alt={`subject ${s.id}`} style={{ width: '100%', display: 'block' }} />
                  </div>
                ))}
                {scenerySheet && (
                  <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', borderBottom: `1px solid ${P.border}`, ...mono, color: P.muted }}>
                      SCENERY — establishing location
                    </div>
                    <img src={scenerySheet} alt="scenery" style={{ width: '100%', display: 'block' }} />
                  </div>
                )}
                <div style={{ ...mono, color: P.muted, fontSize: 8 }}>
                  Per-shot frame gen receives only the subject sheets for subjects appearing in that shot (per subject_ids) plus the scenery sheet, with strict per-subject identity + location lock clauses.
                </div>
              </div>
            ) : (
              <EmptyTab icon={<ImageIcon size={32} color={P.border} />} title="Reference sheets appear here" hint="One 4-photo subject grid is generated per subject in the script (host, customer, etc.) plus a scenery establishing shot. Each shot frame only uses the sheets for subjects in that shot." />
            )}
          </div>
        )}

        {activeTab === 'shots' && (
          <div>
            {shots.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {shots.map((s) => (
                  <div key={s.shot} style={{ background: P.card, border: `1px solid ${P.border}`, overflow: 'hidden' }}>
                    <div style={{ aspectRatio: brief.aspect === '9:16' ? '9 / 16' : '16 / 9', background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {s.videoClip ? (
                        <video src={s.videoClip} muted autoPlay loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : s.refFrame ? (
                        <img src={s.refFrame} alt={`shot ${s.shot}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Loader2 size={20} color={P.muted} style={{ animation: 'spin 1s linear infinite' }} />
                      )}
                      <div style={{ position: 'absolute', top: 6, left: 6, padding: '2px 6px', background: 'rgba(0,0,0,0.7)', color: P.white, ...mono, fontSize: 8 }}>
                        SHOT {s.shot}
                      </div>
                    </div>
                    <div style={{ padding: 10, fontFamily: '"Inter", sans-serif', fontSize: 11, color: P.ink, lineHeight: 1.4, maxHeight: 60, overflow: 'hidden' }}>
                      {s.narration || s.imagePrompt?.slice(0, 80)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyTab icon={<LayoutGrid size={32} color={P.border} />} title="Shot frames appear here" hint="Each shot's reference frame renders first (image gen with both sheets as input), then its i2v video clip replaces the still." />
            )}
          </div>
        )}

        {activeTab === 'final' && (
          <div>
            {finalUrl ? (
              <div>
                <video src={finalUrl} controls style={{ width: '100%', maxHeight: 600, background: '#000', border: `1px solid ${P.border}` }} />
                {narration && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>NARRATION</div>
                    <div style={{ padding: '12px 16px', background: P.card, border: `1px solid ${P.border}`, fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.6, color: P.ink }}>
                      {narration}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyTab icon={<Film size={32} color={P.border} />} title="Final video appears here" hint="After all per-shot i2v clips finish, FFmpeg stitches them with the voiceover and the final MP4 lands here." />
            )}
          </div>
        )}

        {/* Empty initial state across all tabs */}
        {!scriptMd && subjectSheets.length === 0 && !scenerySheet && shots.length === 0 && !finalUrl && !running && !error && activeTab === 'script' && (
          <div style={{ marginTop: 30 }}>
            <EmptyTab
              icon={<VideoIcon size={32} color={P.border} />}
              title="Ready to render"
              hint="Click START RENDER to run the pipeline: script → subject sheet → scenery sheet → shot frames (locked to both sheets) → per-shot i2v → stitch + voice."
            />
          </div>
        )}
      </div>

      {/* HITL gate overlay */}
      {hitl && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(17,17,17,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 }}>
          <div style={{ background: P.bg, border: `1px solid ${P.border}`, borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ ...mono, fontSize: 9, color: P.accent }}>HITL · {hitl.gate.toUpperCase()}</div>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 700, color: P.ink, marginBottom: 14 }}>
                {hitl.title}
              </div>

              {hitl.questions && hitl.questions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                  {hitl.questions.map((q) => (
                    <div key={q.id}>
                      <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, fontWeight: 600, color: P.ink, marginBottom: 4 }}>{q.question}</div>
                      {q.hint && <div style={{ fontSize: 11, color: P.muted, marginBottom: 6 }}>{q.hint}</div>}
                      <textarea
                        value={hitlAnswers[q.id] || ''}
                        onChange={(e) => setHitlAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        placeholder="Your answer…"
                        style={{ width: '100%', minHeight: 60, padding: '8px 10px', background: P.card, border: `1px solid ${P.border}`, fontSize: 12, fontFamily: '"Inter", sans-serif', color: P.ink, resize: 'vertical', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {hitl.previewMarkdown && (
                <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 8, padding: 12, fontSize: 11, lineHeight: 1.55, color: P.ink, maxHeight: 240, overflowY: 'auto', marginBottom: 14, whiteSpace: 'pre-wrap', fontFamily: '"Inter", sans-serif' }}>
                  {hitl.previewMarkdown}
                </div>
              )}

              {hitl.previewImages && hitl.previewImages.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
                  {hitl.previewImages.map((name) => (
                    <img key={name} src={`/api/projects/${projectId}/files/${name}`} alt={name} style={{ width: '100%', borderRadius: 6, border: `1px solid ${P.border}` }} />
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <div style={{ ...mono, fontSize: 9, color: P.muted, marginBottom: 6 }}>NOTES / CHANGE REQUEST (optional)</div>
                <textarea
                  value={hitlNotes}
                  onChange={(e) => setHitlNotes(e.target.value)}
                  placeholder={hitl.gate === 'discovery' ? 'Anything else we should know…' : 'What should change? Leave empty to approve.'}
                  style={{ width: '100%', minHeight: 70, padding: '8px 10px', background: P.card, border: `1px solid ${P.border}`, fontSize: 12, fontFamily: '"Inter", sans-serif', color: P.ink, resize: 'vertical', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {hitl.gate !== 'discovery' && (
                  <button
                    type="button"
                    disabled={hitlSubmitting}
                    onClick={async () => {
                      setHitlSubmitting(true);
                      try {
                        await fetch(`/api/v1/video/${projectId}/hitl/${hitl.gate}`, {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ approve: false, notes: hitlNotes || '' }),
                        });
                        setHitl(null);
                      } finally { setHitlSubmitting(false); }
                    }}
                    style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${P.border}`, color: P.ink, cursor: 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: 600 }}
                  >Regenerate with notes</button>
                )}
                <button
                  type="button"
                  disabled={hitlSubmitting}
                  onClick={async () => {
                    setHitlSubmitting(true);
                    try {
                      await fetch(`/api/v1/video/${projectId}/hitl/${hitl.gate}`, {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ approve: true, notes: hitlNotes || '', answers: hitlAnswers }),
                      });
                      setHitl(null);
                    } finally { setHitlSubmitting(false); }
                  }}
                  style={{ padding: '8px 14px', background: P.ink, border: 'none', color: P.white, cursor: 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: 700 }}
                >{hitl.gate === 'discovery' ? 'Submit & continue' : 'Approve & continue'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function path2name(p: string): string {
  return p.split('/').pop() ?? p;
}

function EmptyTab({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 40px', textAlign: 'center', color: '#6E6A63' }}>
      {icon}
      <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, color: '#111' }}>{title}</div>
      <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, maxWidth: 380 }}>{hint}</div>
    </div>
  );
}
