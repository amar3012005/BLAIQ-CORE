// BLAIQ Mission Builder — guided step-by-step project creation wizard.
// Pure inline-style implementation (no Tailwind).

'use client';

import React, { useState, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Layout,
  Monitor,
  Smartphone,
  Tablet,
  Tv,
  Image,
  Video,
  Music,
  Layers,
  Zap,
  Rocket,
  X,
  SkipForward,
  FileText,
} from 'lucide-react';
import type { DesignSystemSummary, SkillSummary, ProjectMetadata, ProjectPlatform } from '../types';
import type { CreateInput, CreateTab } from '../components/NewProjectPanel';

/* ── palette ─────────────────────────────── */
const P = {
  bg: '#F1F0EC',
  card: '#FAFAF7',
  ink: '#111111',
  muted: '#6E6A63',
  divider: '#D8D3CB',
  accent: '#FF6A2A',
  accentHover: '#E8561D',
  accentLight: 'rgba(255,106,42,0.08)',
  accentBorder: 'rgba(255,106,42,0.25)',
  selected: 'rgba(255,106,42,0.12)',
  hover: '#EDE9E3',
  white: '#FFFFFF',
  overlay: 'rgba(17,17,17,0.55)',
  green: '#22C55E',
};

const mono: CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
};

const sans: CSSProperties = {
  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
};

/* ── types ───────────────────────────────── */
type MissionType = 'prototype' | 'deck' | 'image' | 'video' | 'audio' | 'text' | 'other';

type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
type VideoLength = 5 | 10 | 15 | 20 | 30;
type AudioKindLocal = 'speech' | 'sfx' | 'music';

type TextSubtype =
  | 'linkedin_post'
  | 'linkedin_weekly_post_generator'
  | 'instagram_post'
  | 'social_post'
  | 'professional_email'
  | 'memo'
  | 'proposal'
  | 'invoice'
  | 'letter'
  | 'report'
  | 'summary'
  | 'technical_whitepaper'
  | 'industrial_whitepaper'
  | 'competitor_market_analysis'
  | 'product_review_pro'
  | 'brand_poetry_generator'
  | 'romantic_poetry_generator';

const TEXT_SUBTYPES: Array<{ id: TextSubtype; label: string; hint: string }> = [
  { id: 'linkedin_post', label: 'LinkedIn Post', hint: 'Scroll-stopping B2B/B2C post' },
  { id: 'linkedin_weekly_post_generator', label: 'LinkedIn Weekly', hint: '5-post weekly series' },
  { id: 'instagram_post', label: 'Instagram Caption', hint: 'IG feed caption + hashtags' },
  { id: 'social_post', label: 'Social Post', hint: 'Tweet / X / generic short' },
  { id: 'professional_email', label: 'Professional Email', hint: 'Formal business email' },
  { id: 'memo', label: 'Memo', hint: 'Internal TO/FROM/RE memo' },
  { id: 'proposal', label: 'Proposal', hint: 'Client project proposal' },
  { id: 'invoice', label: 'Invoice', hint: 'Line-item invoice' },
  { id: 'letter', label: 'Letter', hint: 'Formal letter' },
  { id: 'report', label: 'Report', hint: 'Period report with metrics' },
  { id: 'summary', label: 'Summary', hint: 'Tight bullet summary' },
  { id: 'technical_whitepaper', label: 'Technical Whitepaper', hint: 'Long-form technical doc' },
  { id: 'industrial_whitepaper', label: 'Industrial Whitepaper', hint: 'Operations / process doc' },
  { id: 'competitor_market_analysis', label: 'Competitor Analysis', hint: 'Market + competitor matrix' },
  { id: 'product_review_pro', label: 'Product Review', hint: 'Pros/cons scored review' },
  { id: 'brand_poetry_generator', label: 'Brand Poetry', hint: 'Brand-anchored verse' },
  { id: 'romantic_poetry_generator', label: 'Romantic Poetry', hint: 'Brand romance verse' },
];
type Fidelity = 'wireframe' | 'high-fidelity';
type PlatformKey = Exclude<ProjectPlatform, 'auto'>;

interface MissionState {
  type: MissionType;
  name: string;
  designSystemId: string | null;
  inspirationIds: string[];
  platforms: PlatformKey[];
  fidelity: Fidelity;
  includeLandingPage: boolean;
  includeOsWidgets: boolean;
  skillId: string | null;
  textSubtype: TextSubtype;
  mediaModel: string;
  aspect: AspectRatio;
  videoLength: VideoLength;
  audioKind: AudioKindLocal;
  audioDuration: number;
  voice: string;
  // Video HITL discovery answers
  videoSubject: string;
  videoStyle: string;
  videoVoiceover: boolean;
  videoMusic: boolean;
}

interface Props {
  open: boolean;
  onClose?: () => void;
  onCreate: (input: CreateInput) => void;
  skills: SkillSummary[];
  designSystems: DesignSystemSummary[];
  defaultDesignSystemId?: string | null;
  /** If true, render as inline sidebar instead of overlay. */
  inline?: boolean;
}

const TYPE_OPTIONS: Array<{
  id: MissionType;
  label: string;
  desc: string;
  icon: typeof Globe;
}> = [
  { id: 'prototype', label: 'PROTOTYPE', desc: 'Interactive web screens', icon: Layout },
  { id: 'deck', label: 'SLIDE DECK', desc: 'Presentation slides', icon: Layers },
  { id: 'image', label: 'IMAGE', desc: 'Generate posters, art, photos', icon: Image },
  { id: 'video', label: 'VIDEO', desc: 'Generate videos (HITL discovery)', icon: Video },
  { id: 'audio', label: 'AUDIO', desc: 'Speech, SFX, or music', icon: Music },
  { id: 'text', label: 'TEXT', desc: 'Posts, emails, memos, whitepapers', icon: FileText },
  { id: 'other', label: 'FREEFORM', desc: 'Custom build, no constraints', icon: Zap },
];

const PLATFORM_OPTIONS: Array<{ id: PlatformKey; label: string; icon: typeof Globe }> = [
  { id: 'responsive', label: 'Responsive', icon: Globe },
  { id: 'web-desktop', label: 'Desktop Web', icon: Monitor },
  { id: 'mobile-ios', label: 'iOS', icon: Smartphone },
  { id: 'mobile-android', label: 'Android', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'desktop-app', label: 'Desktop App', icon: Tv },
];

/* ── component ───────────────────────────── */
interface ORModel {
  id: string;
  name: string;
  description?: string;
  output_modalities?: string[];
  input_modalities?: string[];
}

export default function MissionBuilder({
  open,
  onClose,
  onCreate,
  skills,
  designSystems,
  defaultDesignSystemId,
  inline = false,
}: Props): JSX.Element | null {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [orModels, setOrModels] = useState<Record<string, ORModel[]>>({});
  const [orLoading, setOrLoading] = useState<Record<string, boolean>>({});

  const [state, setState] = useState<MissionState>(() => ({
    type: 'prototype',
    name: '',
    designSystemId: defaultDesignSystemId ?? null,
    inspirationIds: [],
    platforms: ['responsive'],
    fidelity: 'high-fidelity',
    includeLandingPage: false,
    includeOsWidgets: false,
    skillId: null,
    textSubtype: 'linkedin_post',
    mediaModel: '',
    aspect: '16:9',
    videoLength: 10,
    audioKind: 'speech',
    audioDuration: 30,
    voice: '',
    videoSubject: '',
    videoStyle: 'cinematic',
    videoVoiceover: false,
    videoMusic: true,
  }));

  React.useEffect(() => {
    const want = state.type === 'image' ? 'image'
      : state.type === 'video' ? 'video'
      : state.type === 'audio' ? 'audio'
      : null;
    if (!want) return;
    if (orModels[want] || orLoading[want]) return;
    setOrLoading((l) => ({ ...l, [want]: true }));
    fetch(`/api/v1/openrouter/models?output=${want}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d: { data?: ORModel[] }) => {
        setOrModels((m) => ({ ...m, [want]: d.data ?? [] }));
      })
      .catch(() => {})
      .finally(() => setOrLoading((l) => ({ ...l, [want]: false })));
  }, [state.type, orModels, orLoading]);

  // Resolve step count based on type
  const totalSteps = useMemo(() => {
    if (state.type === 'other') return 3; // type → name → review
    if (state.type === 'text') return 4; // type → name → subtype → review
    if (state.type === 'image') return 3; // type → name → review (model/prompt chosen in chat)
    if (state.type === 'video') return 5; // type → name → model+aspect → HITL → review
    if (state.type === 'audio') return 4; // type → name → kind+model → review
    return 5; // prototype/deck: type → name → brand → configure → review
  }, [state.type]);

  const stepLabels = useMemo(() => {
    if (state.type === 'other') return ['TYPE', 'NAME', 'LAUNCH'];
    if (state.type === 'text') return ['TYPE', 'NAME', 'FORMAT', 'LAUNCH'];
    if (state.type === 'image') return ['TYPE', 'NAME', 'LAUNCH'];
    if (state.type === 'video') return ['TYPE', 'NAME', 'MODEL', 'BRIEF', 'LAUNCH'];
    if (state.type === 'audio') return ['TYPE', 'NAME', 'MODEL', 'LAUNCH'];
    return ['TYPE', 'NAME', 'BRAND', 'CONFIG', 'LAUNCH'];
  }, [state.type]);

  // Resolve skill from type
  const resolvedSkillId = useMemo(() => {
    if (state.type === 'other') return null;
    if (state.type === 'text') {
      const skill = skills.find((s) => s.id === 'text-buddy')
        ?? skills.find((s) => s.mode === 'text');
      return skill?.id ?? 'text-buddy';
    }
    const mode = state.type;
    const skill = skills.find(
      (s) => s.mode === mode && s.defaultFor.includes(mode),
    ) ?? skills.find((s) => s.mode === mode);
    return skill?.id ?? null;
  }, [state.type, skills]);

  const goForward = useCallback(() => {
    setDirection('forward');
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  }, [totalSteps]);

  const goBack = useCallback(() => {
    setDirection('back');
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleLaunch = useCallback(() => {
    const kind = state.type === 'deck' ? 'deck'
      : state.type === 'text' ? 'text'
      : state.type === 'image' ? 'image'
      : state.type === 'video' ? 'video'
      : state.type === 'audio' ? 'audio'
      : state.type === 'other' ? 'prototype'
      : 'prototype';
    const metadata: ProjectMetadata = {
      kind: kind as ProjectMetadata['kind'],
      fidelity: state.fidelity,
      platform: state.platforms[0] ?? 'responsive',
      platformTargets: state.platforms,
      includeLandingPage: state.includeLandingPage,
      includeOsWidgets: state.includeOsWidgets,
      inspirationDesignSystemIds: state.inspirationIds.length > 0 ? state.inspirationIds : undefined,
    };
    if (state.type === 'text') {
      (metadata as unknown as Record<string, string>).textSubtype = state.textSubtype;
    }
    if (state.type === 'image') {
      // Model + aspect chosen in chat composer per generation, not at creation.
      metadata.imageAspect = state.aspect || '1:1';
    }
    if (state.type === 'video') {
      metadata.videoModel = state.mediaModel || undefined;
      metadata.videoAspect = state.aspect;
      metadata.videoLength = state.videoLength;
      // HITL discovery answers as project instructions
      const briefLines = [
        state.videoSubject && `Subject: ${state.videoSubject}`,
        `Style: ${state.videoStyle}`,
        `Voiceover: ${state.videoVoiceover ? 'yes' : 'no'}`,
        `Music: ${state.videoMusic ? 'yes' : 'no'}`,
        `Aspect: ${state.aspect}`,
        `Length: ${state.videoLength}s`,
      ].filter(Boolean).join('\n');
      (metadata as unknown as Record<string, string>).videoBrief = briefLines;
    }
    if (state.type === 'audio') {
      metadata.audioKind = state.audioKind;
      metadata.audioModel = state.mediaModel || undefined;
      metadata.audioDuration = state.audioDuration;
      if (state.voice) metadata.voice = state.voice;
    }

    const today = new Date();
    const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    const typeName = TYPE_OPTIONS.find((t) => t.id === state.type)?.label ?? 'Project';

    onCreate({
      name: state.name.trim() || `${typeName} · ${dateStr}`,
      skillId: resolvedSkillId,
      designSystemId: state.designSystemId,
      metadata,
    });
    onClose?.();
  }, [state, resolvedSkillId, onCreate, onClose]);

  const handleSkip = useCallback(() => {
    // Quick-create with defaults
    const today = new Date();
    const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    onCreate({
      name: `Prototype · ${dateStr}`,
      skillId: skills.find((s) => s.mode === 'prototype' && s.defaultFor.includes('prototype'))?.id ?? null,
      designSystemId: defaultDesignSystemId ?? null,
      metadata: {
        kind: 'prototype',
        fidelity: 'high-fidelity',
        platform: 'responsive',
        platformTargets: ['responsive'],
      },
    });
    onClose?.();
  }, [skills, defaultDesignSystemId, onCreate, onClose]);

  if (!open) return null;

  // Determine which step content to show
  let stepIndex = step;
  // For short flows (other/media), map step indices
  const getStepContent = (): ReactNode => {
    if (step === 0) return renderTypeStep();
    if (step === 1) return renderNameStep();
    if (state.type === 'other') {
      if (step === 2) return renderReviewStep();
      return null;
    }
    if (state.type === 'text') {
      if (step === 2) return renderTextSubtypeStep();
      if (step === 3) return renderReviewStep();
      return null;
    }
    if (state.type === 'image') {
      if (step === 2) return renderReviewStep();
      return null;
    }
    if (state.type === 'video') {
      if (step === 2) return renderImageStep();
      if (step === 3) return renderVideoBriefStep();
      if (step === 4) return renderReviewStep();
      return null;
    }
    if (state.type === 'audio') {
      if (step === 2) return renderAudioStep();
      if (step === 3) return renderReviewStep();
      return null;
    }
    if (step === 2) return renderBrandStep();
    if (step === 3) return renderConfigStep();
    if (step === 4) return renderReviewStep();
    return null;
  };

  const isLastStep = step === totalSteps - 1;

  /* ── Step 1: Type ───────────────────────── */
  function renderTypeStep(): ReactNode {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StepHeader
          label="What should intelligence build today?"
          sub="Choose the type of artifact to generate"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {TYPE_OPTIONS.map((opt) => {
            const active = state.type === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setState((s) => ({ ...s, type: opt.id }));
                  // Auto-advance after short delay
                  setTimeout(goForward, 250);
                }}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '20px 18px',
                  background: active ? P.selected : P.card,
                  border: `1.5px solid ${active ? P.accent : P.divider}`,
                  borderRadius: 10,
                  boxShadow: active ? '0 6px 20px rgba(255,106,42,0.12)' : '0 1px 2px rgba(17,17,17,0.05)',
                  cursor: 'pointer',
                  transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
                  ...sans,
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = P.hover;
                    e.currentTarget.style.borderColor = P.accentBorder;
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(17,17,17,0.08)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = P.card;
                    e.currentTarget.style.borderColor = P.divider;
                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(17,17,17,0.05)';
                    e.currentTarget.style.transform = 'none';
                  }
                }}
              >
                {active && (
                  <span style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: P.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Check size={10} color={P.white} strokeWidth={3} />
                  </span>
                )}
                <Icon size={20} color={active ? P.accent : P.muted} />
                <div>
                  <div style={{ ...mono, fontSize: 10, color: active ? P.accent : P.ink }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 12, color: P.muted, marginTop: 4, ...sans }}>
                    {opt.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Step 2: Name ───────────────────────── */
  function renderNameStep(): ReactNode {
    const typeName = TYPE_OPTIONS.find((t) => t.id === state.type)?.label ?? 'Project';
    const today = new Date();
    const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    const placeholder = `${typeName} · ${dateStr}`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepHeader
          label="Name your mission"
          sub="Give it a codename or leave blank for auto-naming"
        />
        <input
          type="text"
          autoFocus
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') goForward(); }}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 16,
            fontWeight: 500,
            color: P.ink,
            background: P.card,
            border: `1.5px solid ${P.divider}`,
            outline: 'none',
            ...sans,
            transition: 'border-color 150ms',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = P.accent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = P.divider; }}
        />
        <div style={{ ...mono, fontSize: 9, color: P.muted }}>
          Press Enter to continue
        </div>
      </div>
    );
  }

  /* ── Step 3: Brand ──────────────────────── */
  function renderBrandStep(): ReactNode {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StepHeader
          label="Choose brand DNA"
          sub="Select a design system for visual identity"
        />
        <div style={{
          maxHeight: 320,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {designSystems.map((ds) => {
            const active = state.designSystemId === ds.id;
            const isInspiration = state.inspirationIds.includes(ds.id);
            return (
              <button
                key={ds.id}
                type="button"
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    designSystemId: active ? null : ds.id,
                  }));
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  background: active ? P.selected : P.card,
                  border: `1.5px solid ${active ? P.accent : P.divider}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 150ms ease',
                  ...sans,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = P.hover;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = P.card;
                }}
              >
                {/* Swatches */}
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {(ds.swatches ?? ['#111', '#666', '#ccc', '#eee']).slice(0, 4).map((c, i) => (
                    <span
                      key={i}
                      style={{
                        width: 14,
                        height: 14,
                        background: c,
                        border: '1px solid rgba(0,0,0,0.08)',
                      }}
                    />
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: P.ink,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {ds.title}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: P.muted,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {ds.summary || ds.category}
                  </div>
                </div>
                {active && (
                  <Check size={16} color={P.accent} strokeWidth={2.5} style={{ flexShrink: 0 }} />
                )}
              </button>
            );
          })}
          {designSystems.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: P.muted, fontSize: 13, ...sans }}>
              No design systems available
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Step 3 (text): Subtype ─────────────── */
  function renderTextSubtypeStep(): ReactNode {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StepHeader
          label="Choose text format"
          sub="Pick the artifact type. Hivemind facts + brand tone applied automatically."
        />
        <div style={{
          maxHeight: 380,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}>
          {TEXT_SUBTYPES.map((sub) => {
            const active = state.textSubtype === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => setState((s) => ({ ...s, textSubtype: sub.id }))}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  background: active ? P.selected : P.card,
                  border: `1.5px solid ${active ? P.accent : P.divider}`,
                  cursor: 'pointer',
                  transition: 'all 150ms',
                  ...sans,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = P.hover;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = P.card;
                }}
              >
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: active ? P.accent : P.ink,
                  marginBottom: 2,
                }}>
                  {sub.label}
                </div>
                <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.4 }}>
                  {sub.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Step 3 (image/video): Model + aspect ── */
  function renderImageStep(): ReactNode {
    const isVideo = state.type === 'video';
    const aspects: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    const key = isVideo ? 'video' : 'image';
    const fetched = orModels[key] ?? [];
    const models = fetched.length > 0
      ? fetched.map((m) => ({ id: m.id, label: m.name || m.id, hint: m.description ?? '' }))
      : isVideo
      ? [
          { id: 'volcengine/seedance-2.0', label: 'SeeDance 2.0 (Volcengine)', hint: '' },
          { id: 'grok-imagine-video', label: 'Grok Imagine Video', hint: '' },
          { id: 'veo-3', label: 'Google Veo-3', hint: '' },
          { id: 'hyperframes-html', label: 'HyperFrames HTML', hint: '' },
        ]
      : [
          { id: 'gpt-image-1', label: 'GPT-Image-1 (OpenAI)', hint: '' },
          { id: 'nanobanana', label: 'Nanobanana', hint: '' },
          { id: 'volcengine/seedream-4.0', label: 'SeeDream 4.0 (Volcengine)', hint: '' },
          { id: 'grok-2-image-1212', label: 'Grok Image', hint: '' },
        ];
    const isLoading = orLoading[key];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <StepHeader
          label={isVideo ? 'Pick video model' : 'Pick image model'}
          sub={isVideo
            ? 'Choose generation model + aspect + length. Brief follows.'
            : 'Choose generation model + aspect ratio.'}
        />
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>MODEL</span>
            <span style={{ fontSize: 8, opacity: 0.7 }}>
              {isLoading ? 'LOADING…' : `${models.length} AVAILABLE`}
            </span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map((m) => {
              const active = state.mediaModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, mediaModel: m.id }))}
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    background: active ? P.selected : P.card,
                    border: `1.5px solid ${active ? P.accent : P.divider}`,
                    cursor: 'pointer',
                    ...sans,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: active ? P.accent : P.ink }}>
                    {m.label}
                  </div>
                  {m.hint && (
                    <div style={{ fontSize: 10, color: P.muted, marginTop: 2, lineHeight: 1.4 }}>
                      {m.hint.slice(0, 120)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>ASPECT</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {aspects.map((a) => {
              const active = state.aspect === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, aspect: a }))}
                  style={{
                    padding: '8px 16px',
                    background: active ? P.ink : P.card,
                    border: `1px solid ${active ? P.ink : P.divider}`,
                    color: active ? P.white : P.ink,
                    cursor: 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>
        {isVideo && (
          <div>
            <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>LENGTH</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([5, 10, 15, 20, 30] as VideoLength[]).map((s) => {
                const active = state.videoLength === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setState((p) => ({ ...p, videoLength: s }))}
                    style={{
                      padding: '8px 14px',
                      background: active ? P.ink : P.card,
                      border: `1px solid ${active ? P.ink : P.divider}`,
                      color: active ? P.white : P.ink,
                      cursor: 'pointer',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {s}s
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Step 4 (video): HITL brief ─────────── */
  function renderVideoBriefStep(): ReactNode {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <StepHeader
          label="Video brief"
          sub="Answer a few questions. Hivemind facts about your org will fill in the rest."
        />
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 6 }}>SUBJECT / SCENE</div>
          <textarea
            value={state.videoSubject}
            onChange={(e) => setState((s) => ({ ...s, videoSubject: e.target.value }))}
            placeholder="What is the video about? e.g. SolvisLea heat-pump install at a sun-lit family home"
            style={{
              width: '100%',
              minHeight: 80,
              padding: '10px 12px',
              background: P.card,
              border: `1px solid ${P.divider}`,
              fontSize: 12,
              fontFamily: '"Inter", sans-serif',
              color: P.ink,
              resize: 'vertical',
              outline: 'none',
            }}
          />
        </div>
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>STYLE</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['cinematic', 'documentary', 'product-shot', 'abstract', 'editorial'].map((s) => {
              const active = state.videoStyle === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState((p) => ({ ...p, videoStyle: s }))}
                  style={{
                    padding: '8px 14px',
                    background: active ? P.ink : P.card,
                    border: `1px solid ${active ? P.ink : P.divider}`,
                    color: active ? P.white : P.ink,
                    cursor: 'pointer',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
        <ToggleRow
          label="Include voiceover"
          active={state.videoVoiceover}
          onToggle={() => setState((s) => ({ ...s, videoVoiceover: !s.videoVoiceover }))}
        />
        <ToggleRow
          label="Include background music"
          active={state.videoMusic}
          onToggle={() => setState((s) => ({ ...s, videoMusic: !s.videoMusic }))}
        />
      </div>
    );
  }

  /* ── Step 3 (audio): Kind + model ───────── */
  function renderAudioStep(): ReactNode {
    const kinds: Array<{ id: AudioKindLocal; label: string }> = [
      { id: 'speech', label: 'Speech / Voiceover' },
      { id: 'music', label: 'Music' },
      { id: 'sfx', label: 'SFX' },
    ];
    const fetched = orModels['audio'] ?? [];
    const audioFallback =
      state.audioKind === 'speech'
        ? [
            { id: 'elevenlabs-multilingual-v2', label: 'ElevenLabs Multilingual v2' },
            { id: 'openai-tts-1', label: 'OpenAI TTS-1' },
            { id: 'minimax-speech-02', label: 'Minimax Speech 02' },
          ]
        : state.audioKind === 'music'
        ? [
            { id: 'suno-v4', label: 'Suno v4' },
            { id: 'udio-32', label: 'Udio 32' },
          ]
        : [
            { id: 'elevenlabs-sfx-v1', label: 'ElevenLabs SFX' },
            { id: 'fishaudio-sfx', label: 'FishAudio SFX' },
          ];
    const models = fetched.length > 0
      ? fetched.map((m) => ({ id: m.id, label: m.name || m.id }))
      : audioFallback;
    const isLoading = orLoading['audio'];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <StepHeader label="Audio setup" sub="Pick kind, model, duration." />
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>KIND</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {kinds.map((k) => {
              const active = state.audioKind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, audioKind: k.id, mediaModel: '' }))}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: active ? P.ink : P.card,
                    border: `1px solid ${active ? P.ink : P.divider}`,
                    color: active ? P.white : P.ink,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    ...sans,
                  }}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>MODEL</span>
            <span style={{ fontSize: 8, opacity: 0.7 }}>
              {isLoading ? 'LOADING…' : `${models.length} AVAILABLE`}
            </span>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map((m) => {
              const active = state.mediaModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, mediaModel: m.id }))}
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    background: active ? P.selected : P.card,
                    border: `1.5px solid ${active ? P.accent : P.divider}`,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    color: active ? P.accent : P.ink,
                    ...sans,
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 8 }}>DURATION (sec)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[10, 30, 60, 180].map((d) => {
              const active = state.audioDuration === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, audioDuration: d }))}
                  style={{
                    padding: '8px 14px',
                    background: active ? P.ink : P.card,
                    border: `1px solid ${active ? P.ink : P.divider}`,
                    color: active ? P.white : P.ink,
                    cursor: 'pointer',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {d}s
                </button>
              );
            })}
          </div>
        </div>
        {state.audioKind === 'speech' && (
          <div>
            <div style={{ ...mono, color: P.muted, marginBottom: 6 }}>VOICE NAME (optional)</div>
            <input
              type="text"
              value={state.voice}
              onChange={(e) => setState((s) => ({ ...s, voice: e.target.value }))}
              placeholder="e.g. Rachel, Adam, custom-voice-id"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: P.card,
                border: `1px solid ${P.divider}`,
                fontSize: 12,
                fontFamily: '"JetBrains Mono", monospace',
                color: P.ink,
                outline: 'none',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  /* ── Step 4: Configure ──────────────────── */
  function renderConfigStep(): ReactNode {
    const hasMobile = state.platforms.some((p) =>
      ['mobile-ios', 'mobile-android', 'tablet'].includes(p),
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepHeader
          label="Configure deployment"
          sub="Where will this live and at what fidelity?"
        />

        {/* Platforms */}
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 10 }}>
            Target Platforms
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PLATFORM_OPTIONS.map((plat) => {
              const active = state.platforms.includes(plat.id);
              const Icon = plat.icon;
              return (
                <button
                  key={plat.id}
                  type="button"
                  onClick={() => {
                    setState((s) => {
                      const next = active
                        ? s.platforms.filter((p) => p !== plat.id)
                        : [...s.platforms, plat.id];
                      return { ...s, platforms: next.length > 0 ? next : s.platforms };
                    });
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    fontSize: 11,
                    fontWeight: 500,
                    color: active ? P.accent : P.ink,
                    background: active ? P.accentLight : P.card,
                    border: `1.5px solid ${active ? P.accentBorder : P.divider}`,
                    cursor: 'pointer',
                    transition: 'all 150ms',
                    ...sans,
                  }}
                >
                  <Icon size={13} />
                  {plat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fidelity */}
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 10 }}>
            Fidelity
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {(['wireframe', 'high-fidelity'] as const).map((f) => {
              const active = state.fidelity === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, fidelity: f }))}
                  style={{
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    background: active ? P.selected : P.card,
                    border: `1.5px solid ${active ? P.accent : P.divider}`,
                    cursor: 'pointer',
                    transition: 'all 150ms',
                    ...sans,
                  }}
                >
                  {/* Simple visual indicator */}
                  <div style={{
                    width: 48,
                    height: 32,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    padding: 4,
                    background: f === 'wireframe' ? '#E8E5DF' : P.ink,
                    border: `1px solid ${P.divider}`,
                  }}>
                    {f === 'wireframe' ? (
                      <>
                        <div style={{ height: 4, background: '#C9C6BD', width: '60%' }} />
                        <div style={{ height: 3, background: '#C9C6BD', width: '100%' }} />
                        <div style={{ height: 3, background: '#C9C6BD', width: '80%' }} />
                      </>
                    ) : (
                      <>
                        <div style={{ height: 4, background: P.accent, width: '60%' }} />
                        <div style={{ height: 3, background: '#555', width: '100%' }} />
                        <div style={{ height: 3, background: '#444', width: '80%' }} />
                      </>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: active ? P.accent : P.ink,
                  }}>
                    {f === 'wireframe' ? 'Wireframe' : 'High Fidelity'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Companion surfaces */}
        <div>
          <div style={{ ...mono, color: P.muted, marginBottom: 10 }}>
            Companion Surfaces
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ToggleRow
              label="Include landing page"
              active={state.includeLandingPage}
              onToggle={() => setState((s) => ({ ...s, includeLandingPage: !s.includeLandingPage }))}
            />
            {hasMobile && (
              <ToggleRow
                label="Include OS widgets"
                active={state.includeOsWidgets}
                onToggle={() => setState((s) => ({ ...s, includeOsWidgets: !s.includeOsWidgets }))}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Step 5: Review ─────────────────────── */
  function renderReviewStep(): ReactNode {
    const typeName = TYPE_OPTIONS.find((t) => t.id === state.type)?.label ?? 'PROTOTYPE';
    const today = new Date();
    const dateStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    const displayName = state.name.trim() || `${typeName} · ${dateStr}`;
    const ds = designSystems.find((d) => d.id === state.designSystemId);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepHeader
          label="Mission summary"
          sub="Review your configuration before launch"
        />
        <div style={{
          background: P.card,
          border: `1px solid ${P.divider}`,
          padding: 0,
          overflow: 'hidden',
        }}>
          <SummaryRow label="TYPE" value={typeName} />
          <SummaryRow label="CODENAME" value={displayName} />
          {state.type === 'text' && (
            <SummaryRow
              label="FORMAT"
              value={TEXT_SUBTYPES.find((s) => s.id === state.textSubtype)?.label ?? state.textSubtype}
            />
          )}
          {(state.type === 'image' || state.type === 'video' || state.type === 'audio') && (
            <>
              <SummaryRow label="MODEL" value={state.mediaModel || '(default)'} />
              {(state.type === 'image' || state.type === 'video') && (
                <SummaryRow label="ASPECT" value={state.aspect} />
              )}
              {state.type === 'video' && (
                <>
                  <SummaryRow label="LENGTH" value={`${state.videoLength}s`} />
                  <SummaryRow label="STYLE" value={state.videoStyle} />
                  {state.videoSubject && (
                    <SummaryRow label="SUBJECT" value={state.videoSubject.slice(0, 60)} />
                  )}
                </>
              )}
              {state.type === 'audio' && (
                <>
                  <SummaryRow label="KIND" value={state.audioKind} />
                  <SummaryRow label="DURATION" value={`${state.audioDuration}s`} />
                  {state.voice && <SummaryRow label="VOICE" value={state.voice} />}
                </>
              )}
            </>
          )}
          {ds && (
            <SummaryRow
              label="BRAND DNA"
              value={ds.title}
              swatches={ds.swatches}
            />
          )}
          {state.type === 'prototype' && (
            <>
              <SummaryRow
                label="TARGETS"
                value={state.platforms.map((p) =>
                  PLATFORM_OPTIONS.find((o) => o.id === p)?.label ?? p
                ).join(', ')}
              />
              <SummaryRow
                label="FIDELITY"
                value={state.fidelity === 'wireframe' ? 'Wireframe' : 'High Fidelity'}
              />
              {(state.includeLandingPage || state.includeOsWidgets) && (
                <SummaryRow
                  label="SURFACES"
                  value={[
                    state.includeLandingPage && 'Landing page',
                    state.includeOsWidgets && 'OS widgets',
                  ].filter(Boolean).join(', ')}
                />
              )}
            </>
          )}
        </div>

        {/* Launch button */}
        <button
          type="button"
          onClick={handleLaunch}
          style={{
            width: '100%',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: P.ink,
            color: P.white,
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            transition: 'background 150ms',
            ...sans,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#222'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = P.ink; }}
        >
          <Rocket size={14} />
          LAUNCH MISSION
        </button>
      </div>
    );
  }

  /* ── Render ─────────────────────────────── */
  const innerPanel = (
      <div
        style={{
          width: inline ? '100%' : 480,
          maxWidth: inline ? 'none' : '85vw',
          height: '100%',
          overflowY: 'auto',
          background: P.bg,
          borderRight: inline ? `1px solid ${P.divider}` : `1px solid ${P.divider}`,
          boxShadow: inline ? 'none' : '8px 0 32px rgba(0,0,0,0.12)',
          display: 'flex',
          flexDirection: 'column',
          animation: inline
            ? 'missionInlineSlide 360ms cubic-bezier(0.22, 1, 0.36, 1)'
            : 'missionSlideIn 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${P.divider}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, background: P.accent }} />
            <span style={{ ...mono, fontSize: 10, color: P.ink }}>
              MISSION BUILDER
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleSkip}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                background: 'transparent',
                border: `1px solid ${P.divider}`,
                cursor: 'pointer',
                ...mono,
                fontSize: 8,
                color: P.muted,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = P.ink; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = P.muted; }}
            >
              <SkipForward size={10} />
              SKIP
            </button>
            {!inline && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: 28,
                  height: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: `1px solid ${P.divider}`,
                  cursor: 'pointer',
                  color: P.muted,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '0 20px',
          height: 36,
          borderBottom: `1px solid ${P.divider}`,
          flexShrink: 0,
        }}>
          {stepLabels.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <React.Fragment key={i}>
                <button
                  type="button"
                  onClick={() => {
                    if (i <= step) {
                      setDirection(i < step ? 'back' : 'forward');
                      setStep(i);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 2px',
                    background: 'transparent',
                    border: 'none',
                    cursor: i <= step ? 'pointer' : 'default',
                    ...mono,
                    fontSize: 8,
                    color: current ? P.accent : done ? P.ink : P.muted,
                    opacity: current || done ? 1 : 0.5,
                    transition: 'color 150ms',
                  }}
                >
                  <span style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 8,
                    fontWeight: 700,
                    background: done ? P.accent : current ? P.ink : 'transparent',
                    color: done || current ? P.white : P.muted,
                    border: done || current ? 'none' : `1px solid ${P.divider}`,
                  }}>
                    {done ? <Check size={8} strokeWidth={3} /> : i + 1}
                  </span>
                  {label}
                </button>
                {i < stepLabels.length - 1 && (
                  <div style={{
                    flex: 1,
                    height: 1,
                    background: done ? P.accent : P.divider,
                    margin: '0 8px',
                    transition: 'background 200ms',
                  }} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step content */}
        <div
          key={step}
          style={{
            padding: '24px 20px',
            animation: direction === 'forward'
              ? 'missionSlideForward 200ms ease'
              : 'missionSlideBack 200ms ease',
          }}
        >
          {getStepContent()}
        </div>

        {/* Footer nav */}
        {!isLastStep && step > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: `1px solid ${P.divider}`,
            flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={goBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                background: 'transparent',
                border: `1px solid ${P.divider}`,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                color: P.ink,
                ...sans,
              }}
            >
              <ArrowLeft size={13} />
              Back
            </button>
            <button
              type="button"
              onClick={goForward}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                background: P.ink,
                color: P.white,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                ...sans,
              }}
            >
              Continue
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
  );

  if (inline) {
    return (
      <>
        <style>{`
          @keyframes missionInlineSlide {
            from { opacity: 0; transform: translateX(-32px); }
            to { opacity: 1; transform: translateX(0); }
          }
          @keyframes missionSlideForward {
            from { opacity: 0; transform: translateX(16px); }
            to { opacity: 1; transform: translateX(0); }
          }
          @keyframes missionSlideBack {
            from { opacity: 0; transform: translateX(-16px); }
            to { opacity: 1; transform: translateX(0); }
          }
        `}</style>
        {innerPanel}
      </>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 44,
        bottom: 46,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        background: 'rgba(17,17,17,0.25)',
        animation: 'missionFadeIn 200ms ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <style>{`
        @keyframes missionFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes missionSlideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes missionSlideForward {
          from { opacity: 0; transform: translateX(16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes missionSlideBack {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {innerPanel}
    </div>
  );
}

/* ── Subcomponents ───────────────────────── */

function StepHeader({ label, sub }: { label: string; sub: string }): JSX.Element {
  return (
    <div style={{ marginBottom: 4 }}>
      <h2 style={{
        ...{ fontFamily: '"Inter", sans-serif' },
        fontSize: 22,
        fontWeight: 700,
        color: P.ink,
        margin: 0,
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
      }}>
        {label}
      </h2>
      <p style={{
        fontSize: 13,
        color: P.muted,
        margin: '6px 0 0',
        fontFamily: '"Inter", sans-serif',
      }}>
        {sub}
      </p>
    </div>
  );
}

function ToggleRow({ label, active, onToggle }: {
  label: string;
  active: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: P.card,
        border: `1px solid ${P.divider}`,
        cursor: 'pointer',
        fontFamily: '"Inter", sans-serif',
        fontSize: 12,
        color: P.ink,
      }}
    >
      <span>{label}</span>
      <span style={{
        width: 34,
        height: 18,
        borderRadius: 9,
        background: active ? P.accent : P.divider,
        position: 'relative',
        transition: 'background 150ms',
      }}>
        <span style={{
          position: 'absolute',
          top: 2,
          left: active ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: P.white,
          transition: 'left 150ms',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }} />
      </span>
    </button>
  );
}

function SummaryRow({ label, value, swatches }: {
  label: string;
  value: string;
  swatches?: string[];
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderBottom: `1px solid ${P.divider}`,
    }}>
      <span style={{
        ...mono as CSSProperties,
        fontSize: 9,
        color: P.muted,
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {swatches && (
          <div style={{ display: 'flex', gap: 2 }}>
            {swatches.slice(0, 4).map((c, i) => (
              <span key={i} style={{ width: 10, height: 10, background: c }} />
            ))}
          </div>
        )}
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: P.ink,
          fontFamily: '"Inter", sans-serif',
        }}>
          {value}
        </span>
      </div>
    </div>
  );
}
