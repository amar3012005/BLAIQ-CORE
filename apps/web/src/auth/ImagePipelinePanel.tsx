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
  LayoutGrid,
  Square,
  Sparkles,
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

// Pill toggle used by the format / mode / variant selectors.
function chip(on: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 9px',
    background: on ? P.ink : P.white,
    color: on ? P.white : P.ink,
    border: `1px solid ${on ? P.ink : P.border}`,
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: '"Inter", sans-serif',
    fontSize: 10,
    fontWeight: 600,
    transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
  };
}

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

// ── Higgsfield-parity: format presets (ad-format templates) + mode presets.
// A format sets the aspect and a brand-locked composition scaffold; a mode
// prepends a production-style directive. Both are appended to the user's
// prompt before the daemon brand-locks it (Brand DNA + Tone + Hivemind).
interface FormatPreset { id: string; label: string; aspect: string; scaffold: string; }
interface ModePreset { id: string; label: string; directive: string; }

const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'ig-post', label: 'IG Post', aspect: '1:1', scaffold: 'Composed as a polished Instagram feed post — square 1:1, one clear focal subject, social-ready, room for a short caption overlay.' },
  { id: 'ig-story', label: 'Story / Reel', aspect: '9:16', scaffold: 'Vertical 9:16 Instagram Story / Reel cover — bold full-bleed composition, thumb-stopping, safe margins top and bottom for UI.' },
  { id: 'linkedin', label: 'LinkedIn', aspect: '16:9', scaffold: 'Professional LinkedIn visual — landscape 16:9, confident credible B2B tone, uncluttered, considered.' },
  { id: 'billboard', label: 'OOH Billboard', aspect: '16:9', scaffold: 'Out-of-home billboard / poster — ultra high-impact, legible from a distance, one dominant idea, generous negative space for a headline.' },
  { id: 'product-hero', label: 'Product Hero', aspect: '1:1', scaffold: 'Studio product hero shot on a clean seamless backdrop — controlled soft lighting, crisp reflections, premium e-commerce quality.' },
];

const MODE_PRESETS: ModePreset[] = [
  { id: 'studio', label: 'Studio', directive: 'Clean studio aesthetic, controlled lighting, premium and precise.' },
  { id: 'cgi', label: 'CGI', directive: 'Hyper-real 3D CGI render, art-directed materials and physics, dramatic.' },
  { id: 'ugc', label: 'UGC', directive: 'Authentic user-generated-content look — candid, handheld, natural light, relatable.' },
  { id: 'cinematic', label: 'Cinematic', directive: 'Cinematic film still — shallow depth of field, colour-graded, atmospheric.' },
];

const VARIANT_NOTES = [
  'Variation A — distinct composition and crop.',
  'Variation B — alternative angle and lighting.',
  'Variation C — different focal treatment.',
  'Variation D — bolder art direction.',
];

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
  // Higgsfield-parity controls: live aspect (presets can change it), format +
  // mode presets, variant count (batch), and a grid view to compare a batch.
  const [aspectState, setAspectState] = useState<string>(aspect);
  const [formatId, setFormatId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string | null>(null);
  const [variantCount, setVariantCount] = useState<number>(1);
  const [view, setView] = useState<'single' | 'grid'>('single');
  const [lastBatch, setLastBatch] = useState<number[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [useRef_, setUseRef] = useState(true);   // false = fresh gen ignoring active version
  const [strokes, setStrokes] = useState<Array<{ x: number; y: number; size: number; erase: boolean }[]>>([]);
  const [brushSize, setBrushSize] = useState(24);
  const [erasing, setErasing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ x: number; y: number; size: number; erase: boolean }[] | null>(null);
  const generateRef = useRef<(() => Promise<void>) | null>(null);

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

  // Cross-component bridge: AssistantMessage's "Generate Image" button
  // dispatches a `blaiq:image-gen` CustomEvent. We pick it up, paste the
  // prompt into the composer, and (when detail.autorun === true) auto-fire.
  useEffect(() => {
    const onGen = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { prompt?: string; autorun?: boolean } | undefined;
      const p = typeof detail?.prompt === 'string' ? detail.prompt.trim() : '';
      if (!p) return;
      setPrompt(p);
      if (detail?.autorun) {
        // queue one tick so prompt state lands before generate runs
        setTimeout(() => { generateRef.current?.(); }, 0);
      }
    };
    window.addEventListener('blaiq:image-gen', onGen);
    return () => window.removeEventListener('blaiq:image-gen', onGen);
  }, []);

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

  // When the active version changes, also fully clear the canvas. The img
  // onLoad resizes the canvas which wipes its bitmap, but on quick tab
  // toggles the old strokes can flash through; force a blank render here.
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, cvs.width, cvs.height);
  }, [activeVersion]);

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

  // Composite the ref image with the drawn mask BLACKED OUT. Sending a single
  // image-with-hole to the model gets cleaner edits than sending a separate
  // mask image, which gemini-3.1-flash-image sometimes paints in literally.
  const buildMaskedRefDataUri = useCallback(async (refUrl: string): Promise<string | null> => {
    if (strokes.length === 0) return null;
    // Load ref image natural size
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = refUrl;
    });
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(img, 0, 0);
    // Erase the painted regions so the model sees a hole.
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    octx.globalCompositeOperation = 'destination-out';
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      if (stroke[0]!.erase) continue; // erase strokes don't punch holes
      octx.beginPath();
      octx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const pt of stroke) octx.lineTo(pt.x, pt.y);
      octx.lineWidth = stroke[0]!.size;
      octx.stroke();
    }
    octx.globalCompositeOperation = 'source-over';
    // Paint the transparent area solid neutral grey so the model has a clean
    // target to fill (some models ignore alpha and prefer an explicit colour).
    const composited = document.createElement('canvas');
    composited.width = out.width;
    composited.height = out.height;
    const cctx = composited.getContext('2d');
    if (!cctx) return null;
    cctx.fillStyle = '#888888';
    cctx.fillRect(0, 0, composited.width, composited.height);
    cctx.drawImage(out, 0, 0);
    return composited.toDataURL('image/png');
  }, [strokes]);

  // Compose the prompt actually sent: mode directive + user prompt + format
  // scaffold (+ optional per-variant nudge). The daemon then brand-locks it.
  const composePrompt = useCallback((base: string, variantNote?: string): string => {
    const mode = MODE_PRESETS.find((m) => m.id === modeId)?.directive;
    const fmt = FORMAT_PRESETS.find((f) => f.id === formatId)?.scaffold;
    return [mode, base, fmt, variantNote].filter(Boolean).join('\n\n');
  }, [modeId, formatId]);

  // Render a single image and return the new version (throws on failure).
  const renderOne = useCallback(async (promptText: string, refImage?: string): Promise<ImageVersion> => {
    const body: Record<string, unknown> = {
      project_id: projectId,
      prompt: promptText,
      model,
      aspect: aspectState,
    };
    if (refImage) body.ref_image = refImage;
    const r = await fetch('/api/v1/image/render', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `render failed (${r.status})`);
    return { version: d.version, url: d.file_path, prompt: promptText, model };
  }, [projectId, model, aspectState]);

  const generate = useCallback(async () => {
    if (!prompt.trim() || !model || generating) return;
    setGenerating(true);
    setError(null);
    try {
      // A mask edit is always a single, targeted render — variants don't apply.
      const hasMask = useRef_ && !!activeImage && strokes.some((s) => s[0] && !s[0].erase);
      // Build the ref image once; shared across a variant batch.
      //   - Fresh: useRef_=false → no ref → daemon enriches prompt.
      //   - Refine (no mask): send the active version as ref.
      //   - Masked edit: composite the mask into the ref (black out the region).
      let refImage: string | undefined;
      if (useRef_ && activeImage) {
        if (hasMask) {
          const refUri = await fetchAsDataUri(activeImage.url);
          refImage = (await buildMaskedRefDataUri(refUri)) || refUri;
        } else {
          refImage = await fetchAsDataUri(activeImage.url);
        }
      }

      const n = hasMask ? 1 : Math.min(Math.max(variantCount, 1), 4);
      const base = prompt.trim();
      setProgress({ done: 0, total: n });

      const settled = await Promise.allSettled(
        Array.from({ length: n }, (_, i) =>
          renderOne(composePrompt(base, n > 1 ? VARIANT_NOTES[i] : undefined), refImage)
            .then((v) => { setProgress((p) => (p ? { ...p, done: p.done + 1 } : p)); return v; }),
        ),
      );
      const made = settled.filter((s): s is PromiseFulfilledResult<ImageVersion> => s.status === 'fulfilled').map((s) => s.value);
      const failed = settled.length - made.length;

      if (made.length === 0) {
        const firstErr = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
        setError(firstErr ? String(firstErr.reason?.message || firstErr.reason) : 'render failed');
        return;
      }
      made.sort((a, b) => a.version - b.version);
      setVersions((prev) => [...prev, ...made]);
      setActiveVersion(made[0]!.version);
      setLastBatch(made.map((v) => v.version));
      setView(made.length > 1 ? 'grid' : 'single');
      if (failed > 0) setError(`${failed} of ${n} variants failed — showing the ${made.length} that rendered.`);
      setPrompt('');
      setStrokes([]);
      setDrawMode(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }, [prompt, model, generating, activeImage, strokes, useRef_, variantCount, buildMaskedRefDataUri, composePrompt, renderOne]);

  // Keep generateRef pointing at the latest generate closure so the
  // event-listener effect (mounted once) always invokes the current one.
  useEffect(() => {
    generateRef.current = generate;
  }, [generate]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastBatch.length > 1 && (
            <div style={{ display: 'inline-flex', border: `1px solid ${P.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setView('grid')}
                title="Compare variants"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: view === 'grid' ? P.ink : 'transparent', color: view === 'grid' ? P.white : P.ink, border: 'none', cursor: 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 10, fontWeight: 600 }}
              >
                <LayoutGrid size={12} /> Grid
              </button>
              <button
                type="button"
                onClick={() => setView('single')}
                title="Single view"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: view === 'single' ? P.ink : 'transparent', color: view === 'single' ? P.white : P.ink, border: 'none', borderLeft: `1px solid ${P.border}`, cursor: 'pointer', fontFamily: '"Inter", sans-serif', fontSize: 10, fontWeight: 600 }}
              >
                <Square size={12} /> Single
              </button>
            </div>
          )}
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
                borderRadius: 8,
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
                onClick={() => { setActiveVersion(v.version); setStrokes([]); setDrawMode(false); setView('single'); }}
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

      {/* Variant grid — compare a batch, pick one to refine */}
      {view === 'grid' && lastBatch.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
          <div style={{ ...mono, color: P.muted, marginBottom: 14 }}>
            {versions.filter((v) => lastBatch.includes(v.version)).length} VARIANTS · BRAND-LOCKED · PICK ONE TO REFINE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {versions.filter((v) => lastBatch.includes(v.version)).map((v) => {
              const isActive = v.version === activeVersion;
              return (
                <button
                  key={v.version}
                  type="button"
                  onClick={() => { setActiveVersion(v.version); setView('single'); setStrokes([]); setDrawMode(false); }}
                  style={{
                    position: 'relative',
                    padding: 0,
                    background: P.white,
                    border: `2px solid ${isActive ? P.accent : P.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  }}
                >
                  <img src={v.url} alt={`v${v.version}`} style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
                  <div style={{ ...mono, position: 'absolute', top: 8, left: 8, padding: '3px 7px', background: 'rgba(17,17,17,0.7)', color: P.white, borderRadius: 6, fontSize: 8 }}>
                    v{v.version}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Canvas / sketch zone */}
      <div style={{ flex: 1, minHeight: 0, display: view === 'grid' && lastBatch.length > 0 ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative' }}>
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
        {/* Format presets — set aspect + a brand-locked composition scaffold */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ ...mono, color: P.muted, marginRight: 2 }}>FORMAT</span>
          {FORMAT_PRESETS.map((f) => {
            const on = formatId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                title={f.scaffold}
                onClick={() => {
                  if (on) { setFormatId(null); }
                  else { setFormatId(f.id); setAspectState(f.aspect); }
                }}
                style={chip(on)}
              >
                {f.label}
                <span style={{ ...mono, fontSize: 7, opacity: 0.6, marginLeft: 5 }}>{f.aspect}</span>
              </button>
            );
          })}
        </div>
        {/* Mode presets — production-style directive */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ ...mono, color: P.muted, marginRight: 2 }}>MODE</span>
          {MODE_PRESETS.map((m) => {
            const on = modeId === m.id;
            return (
              <button key={m.id} type="button" title={m.directive} onClick={() => setModeId(on ? null : m.id)} style={chip(on)}>
                {m.label}
              </button>
            );
          })}
          <span style={{ ...mono, color: P.muted, marginLeft: 'auto', marginRight: 2 }}>VARIANTS</span>
          {[1, 2, 4].map((n) => {
            const on = variantCount === n;
            return (
              <button key={n} type="button" onClick={() => setVariantCount(n)} style={chip(on)}>
                {n === 1 ? '1' : `${n}×`}
              </button>
            );
          })}
        </div>
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
          <span style={{ fontFamily: '"Inter", sans-serif', fontSize: 11, color: P.ink }}>{aspectState}</span>
          {activeImage && (
            <>
              <span style={{ ...mono, color: P.muted, marginLeft: 12 }}>MODE</span>
              <div style={{ display: 'inline-flex', border: `1px solid ${P.border}` }}>
                <button
                  type="button"
                  onClick={() => setUseRef(true)}
                  style={{
                    padding: '4px 10px',
                    background: useRef_ ? P.ink : 'transparent',
                    color: useRef_ ? P.white : P.ink,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: '"Inter", sans-serif', fontSize: 10, fontWeight: 600,
                  }}
                >Refine v{activeVersion}</button>
                <button
                  type="button"
                  onClick={() => setUseRef(false)}
                  style={{
                    padding: '4px 10px',
                    background: !useRef_ ? P.ink : 'transparent',
                    color: !useRef_ ? P.white : P.ink,
                    border: 'none',
                    borderLeft: `1px solid ${P.border}`,
                    cursor: 'pointer',
                    fontFamily: '"Inter", sans-serif', fontSize: 10, fontWeight: 600,
                  }}
                >Fresh gen</button>
              </div>
            </>
          )}
          {activeImage && strokes.length > 0 && useRef_ && (
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
              : variantCount > 1 ? <Sparkles size={12} /> : <Send size={12} />}
            {generating
              ? (progress ? `RENDERING ${progress.done}/${progress.total}…` : 'GENERATING…')
              : variantCount > 1 ? `GENERATE ${variantCount}×` : 'SEND'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
