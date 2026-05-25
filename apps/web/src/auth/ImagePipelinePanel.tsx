// Image pipeline panel — text-to-image with chat-driven prompts, version tabs
// on the right (sketch-zone style), and a draw tool for corrections.
//
// Mirrors the pitch-deck pattern: the user types in chat (left), each prompt
// becomes a new version on the right; the active version can be edited by
// drawing a correction mask + an inline instruction, which produces the next
// version.

'use client';

import React, { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import {
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  Send,
  Pen,
  Eraser,
  Download,
  RefreshCcw,
} from 'lucide-react';

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

interface ImageVersion {
  version: number;
  url: string;
  prompt: string;
  model: string;
}

interface ImageModel {
  id: string;
  label: string;
  default?: boolean;
}

interface Props {
  projectId: string;
  aspect?: string;
}

export default function ImagePipelinePanel({ projectId, aspect = '1:1' }: Props): JSX.Element {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [model, setModel] = useState<string>('');
  const [versions, setVersions] = useState<ImageVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [strokes, setStrokes] = useState<Array<{ x: number; y: number; size: number; erase: boolean }[]>>([]);
  const [brushSize, setBrushSize] = useState(24);
  const [erasing, setErasing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ x: number; y: number; size: number; erase: boolean }[] | null>(null);

  // Fetch available image models on mount
  useEffect(() => {
    fetch('/api/v1/image/models', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { models: [] })
      .then((d) => {
        const m: ImageModel[] = d.models || [];
        setModels(m);
        const def = m.find((x) => x.default) || m[0];
        if (def) setModel(def.id);
      })
      .catch(() => { /* noop */ });
  }, []);

  const activeImage = activeVersion != null
    ? versions.find((v) => v.version === activeVersion)
    : null;

  // Redraw mask overlay whenever strokes change
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const w = cvs.width;
    const h = cvs.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const pt of stroke) ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = stroke[0]!.erase ? 'rgba(0,0,0,1)' : 'rgba(255,106,42,0.5)';
      ctx.globalCompositeOperation = stroke[0]!.erase ? 'destination-out' : 'source-over';
      ctx.lineWidth = stroke[0]!.size;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [strokes]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    cvs.setPointerCapture(e.pointerId);
    const rect = cvs.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cvs.width;
    const y = ((e.clientY - rect.top) / rect.height) * cvs.height;
    drawingRef.current = [{ x, y, size: brushSize, erase: erasing }];
    setStrokes((prev) => [...prev, drawingRef.current!]);
  }, [drawMode, brushSize, erasing]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode || !drawingRef.current) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cvs.width;
    const y = ((e.clientY - rect.top) / rect.height) * cvs.height;
    drawingRef.current.push({ x, y, size: brushSize, erase: erasing });
    setStrokes((prev) => [...prev]); // trigger redraw
  }, [drawMode, brushSize, erasing]);

  const onPointerUp = useCallback(() => {
    drawingRef.current = null;
  }, []);

  const clearMask = useCallback(() => {
    setStrokes([]);
  }, []);

  const exportMaskDataUri = useCallback(async (): Promise<string | null> => {
    if (strokes.length === 0) return null;
    const cvs = canvasRef.current;
    if (!cvs) return null;
    // Build a black/white mask: white where strokes are (areas to edit),
    // black elsewhere (areas to keep).
    const mask = document.createElement('canvas');
    mask.width = cvs.width;
    mask.height = cvs.height;
    const mctx = mask.getContext('2d');
    if (!mctx) return null;
    mctx.fillStyle = 'black';
    mctx.fillRect(0, 0, mask.width, mask.height);
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    mctx.strokeStyle = 'white';
    mctx.globalCompositeOperation = 'source-over';
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      mctx.beginPath();
      mctx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const pt of stroke) mctx.lineTo(pt.x, pt.y);
      mctx.lineWidth = stroke[0]!.size;
      mctx.globalCompositeOperation = stroke[0]!.erase ? 'destination-out' : 'source-over';
      mctx.stroke();
    }
    return mask.toDataURL('image/png');
  }, [strokes]);

  const fetchAsDataUri = async (url: string): Promise<string> => {
    const r = await fetch(url, { credentials: 'include' });
    const blob = await r.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  };

  const generate = useCallback(async () => {
    if (!prompt.trim() || !model || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        prompt: prompt.trim(),
        model,
        aspect,
      };
      // If we have an active image AND the user drew on it, send as refine.
      if (activeImage && strokes.length > 0) {
        body.ref_image = await fetchAsDataUri(activeImage.url);
        const mask = await exportMaskDataUri();
        if (mask) body.mask = mask;
      } else if (activeImage) {
        // Plain refine (no mask) — model decides what to change.
        body.ref_image = await fetchAsDataUri(activeImage.url);
      }
      const r = await fetch('/api/v1/image/render', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setError(d.error || `render failed (${r.status})`);
        return;
      }
      const v: ImageVersion = {
        version: d.version,
        url: d.file_path,
        prompt: prompt.trim(),
        model,
      };
      setVersions((prev) => [...prev, v]);
      setActiveVersion(v.version);
      setPrompt('');
      setStrokes([]);
      setDrawMode(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [prompt, model, generating, projectId, aspect, activeImage, strokes, exportMaskDataUri]);

  // Listen for Enter on the prompt textarea (Cmd/Ctrl+Enter to submit)
  const onPromptKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      generate();
    }
  }, [generate]);

  return (
    <div style={{
      position: 'relative',
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
          <ImageIcon size={16} color={P.muted} />
          <div>
            <div style={{ ...mono, color: P.muted, marginBottom: 2 }}>IMAGE PIPELINE</div>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 700, color: P.ink }}>
              {versions.length === 0 ? 'New canvas' : `v${activeVersion} / ${versions.length}`}
            </div>
          </div>
        </div>
        {activeImage && (
          <a
            href={activeImage.url}
            download={`image_v${activeImage.version}.png`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              border: `1px solid ${P.border}`,
              color: P.ink,
              fontFamily: '"Inter", sans-serif',
              fontSize: 11,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <Download size={12} /> Download
          </a>
        )}
      </div>

      {/* Version tabs */}
      {versions.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '10px 20px',
          borderBottom: `1px solid ${P.border}`,
          flexShrink: 0,
          overflowX: 'auto',
        }}>
          {versions.map((v) => {
            const active = v.version === activeVersion;
            return (
              <button
                key={v.version}
                type="button"
                onClick={() => { setActiveVersion(v.version); setStrokes([]); setDrawMode(false); }}
                title={v.prompt}
                style={{
                  padding: '6px 12px',
                  background: active ? P.ink : P.card,
                  border: `1px solid ${active ? P.ink : P.border}`,
                  color: active ? P.white : P.ink,
                  fontFamily: '"Inter", sans-serif',
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                v{v.version}
              </button>
            );
          })}
        </div>
      )}

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

      {/* Canvas / sketch zone */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative' }}>
        {activeImage ? (
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <img
              src={activeImage.url}
              alt={`v${activeImage.version}`}
              style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 320px)', objectFit: 'contain' }}
              onLoad={(e) => {
                const img = e.currentTarget;
                const cvs = canvasRef.current;
                if (cvs) {
                  cvs.width = img.naturalWidth;
                  cvs.height = img.naturalHeight;
                }
              }}
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                cursor: drawMode ? (erasing ? 'cell' : 'crosshair') : 'default',
                touchAction: 'none',
              }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: P.muted, textAlign: 'center' }}>
            <ImageIcon size={32} color={P.border} />
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, color: P.ink }}>Start the canvas</div>
            <div style={{ fontFamily: '"Inter", sans-serif', fontSize: 12, maxWidth: 360 }}>
              Type a prompt below, choose a model, hit send. Each prompt creates a new version tab. Draw on a version to mark areas to change.
            </div>
          </div>
        )}
      </div>

      {/* Draw toolbar — only when an image exists */}
      {activeImage && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '8px 20px',
          borderTop: `1px solid ${P.border}`,
          flexShrink: 0,
          alignItems: 'center',
        }}>
          <button
            type="button"
            onClick={() => { setDrawMode((d) => !d); setErasing(false); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              background: drawMode && !erasing ? P.ink : 'transparent',
              border: `1px solid ${drawMode && !erasing ? P.ink : P.border}`,
              color: drawMode && !erasing ? P.white : P.ink,
              cursor: 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: 600,
            }}
          >
            <Pen size={12} /> Mark area to edit
          </button>
          <button
            type="button"
            onClick={() => { setDrawMode(true); setErasing(true); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              background: erasing ? P.ink : 'transparent',
              border: `1px solid ${erasing ? P.ink : P.border}`,
              color: erasing ? P.white : P.ink,
              cursor: 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: 600,
            }}
          >
            <Eraser size={12} /> Erase mark
          </button>
          <button
            type="button"
            onClick={clearMask}
            disabled={strokes.length === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
              background: 'transparent',
              border: `1px solid ${P.border}`,
              color: P.ink,
              opacity: strokes.length === 0 ? 0.5 : 1,
              cursor: strokes.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: '"Inter", sans-serif', fontSize: 11, fontWeight: 600,
            }}
          >
            <RefreshCcw size={12} /> Clear mask
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...mono, color: P.muted, fontSize: 9 }}>BRUSH</span>
            <input
              type="range"
              min={4}
              max={120}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              style={{ width: 90 }}
            />
          </div>
        </div>
      )}

      {/* Chat composer (left in panel) */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 20px 16px 20px',
        borderTop: `1px solid ${P.border}`,
        background: P.card,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...mono, color: P.muted }}>MODEL</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              padding: '6px 8px',
              background: P.white,
              border: `1px solid ${P.border}`,
              fontFamily: '"Inter", sans-serif',
              fontSize: 11,
              color: P.ink,
              cursor: 'pointer',
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <span style={{ ...mono, color: P.muted, marginLeft: 12 }}>ASPECT</span>
          <span style={{ fontFamily: '"Inter", sans-serif', fontSize: 11, color: P.ink }}>{aspect}</span>
          {activeImage && strokes.length > 0 && (
            <span style={{ ...mono, color: P.accent, marginLeft: 12 }}>
              MASK · {strokes.length} {strokes.length === 1 ? 'STROKE' : 'STROKES'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            placeholder={activeImage
              ? (strokes.length > 0
                  ? 'Describe what should change in the marked area… (Cmd/Ctrl+Enter to send)'
                  : 'Refine the current image, or write a new prompt to add a fresh version… (Cmd/Ctrl+Enter to send)')
              : 'Describe the image you want to generate… (Cmd/Ctrl+Enter to send)'}
            style={{
              flex: 1,
              minHeight: 60,
              padding: '10px 12px',
              background: P.white,
              border: `1px solid ${P.border}`,
              fontFamily: '"Inter", sans-serif',
              fontSize: 12,
              color: P.ink,
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={generate}
            disabled={generating || !prompt.trim() || !model}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              background: generating ? P.muted : P.ink,
              color: P.white,
              border: 'none',
              cursor: generating ? 'wait' : 'pointer',
              fontFamily: '"Inter", sans-serif',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {generating
              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <Send size={12} />}
            {generating ? 'GENERATING…' : 'SEND'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
