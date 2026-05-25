// BLAIQ video pipeline — Higgsfield-style multi-stage orchestrator.
// All LLM/image/video calls route through OpenRouter using the tenant's
// (or env-configured) OPENROUTER_API_KEY.
//
// Stages:
//   1. Skill router (LLM)
//   2. Hivemind recall (tool)
//   3. Script + storyboard (LLM, returns JSON)
//   4. Reference image per shot (OpenRouter image gen)
//   5. Voiceover (OpenRouter TTS or skip)
//   6. Video per shot (OpenRouter video model with i2v)
//   7. FFmpeg stitch + voice + music

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { jsonrepair } from 'jsonrepair';

const OR_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OR_KEY = () => process.env.OPENROUTER_API_KEY || '';

const SCRIPT_MODEL = process.env.BLAIQ_VIDEO_SCRIPT_MODEL || 'anthropic/claude-sonnet-4.6';
const ROUTER_MODEL = process.env.BLAIQ_VIDEO_ROUTER_MODEL || 'google/gemini-2.5-flash';
const IMAGE_MODEL = process.env.BLAIQ_VIDEO_IMAGE_MODEL || 'google/gemini-3.1-flash-image-preview';
const VIDEO_MODEL = process.env.BLAIQ_VIDEO_I2V_MODEL || 'x-ai/grok-imagine-video';

export interface VideoBrief {
  subject: string;
  style: string;
  voiceover: boolean;
  music: boolean;
  aspect: string;
  length: number;
  userPrompt: string;
}

export interface SubjectDef {
  id: string;          // short slug e.g. "host", "customer_a"
  name?: string;
  persona: string;     // detailed persona description
  specJson?: string;   // JSON spec built per subject
  sheetPath?: string;
  sheetDataUri?: string;
}

export interface Shot {
  shot: number;
  duration_s: number;
  segment?: string;
  visual: string;
  camera?: string;
  presenter_action?: string;
  subject_ids?: string[];  // which subjects appear in this shot
  image_prompt: string;
  motion_prompt: string;
  narration_chunk: string;
  on_screen_text?: string;
  refFramePath?: string;
  videoPath?: string;
}

export interface Storyboard {
  title: string;
  duration_s: number;
  presenter_persona?: string;       // legacy single-subject fallback
  visual_world?: string;
  subjects?: SubjectDef[];          // multi-subject
  narration: string;
  music_brief: string;
  color_grade: string;
  shots: Shot[];
}

export type ProgressEvent =
  | { stage: 'router'; status: 'start' | 'done'; skill?: string }
  | { stage: 'recall'; status: 'start' | 'done'; chars?: number }
  | { stage: 'script'; status: 'start' | 'done'; storyboard?: Storyboard }
  | { stage: 'chat-script'; markdown: string }
  | { stage: 'subject-sheet'; status: 'start' | 'done' | 'skip'; path?: string; subjectId?: string }
  | { stage: 'scenery-sheet'; status: 'start' | 'done' | 'skip'; path?: string }
  | { stage: 'video-error'; shot: number; message: string }
  | { stage: 'ref-frames'; status: 'start' | 'done' | 'shot-done'; shot?: number; path?: string }
  | { stage: 'voice'; status: 'start' | 'done' | 'skip'; path?: string }
  | { stage: 'video'; status: 'start' | 'done' | 'shot-done'; shot?: number; path?: string }
  | { stage: 'stitch'; status: 'start' | 'done'; path?: string }
  | { stage: 'error'; message: string }
  | { stage: 'final'; path: string; absolutePath: string };

export type ProgressCallback = (e: ProgressEvent) => void;

async function orChat(messages: Array<{ role: string; content: string }>, model: string, opts: { maxTokens?: number; jsonMode?: boolean } = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4000,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`openrouter ${r.status}: ${text.slice(0, 300)}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  };
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || '';
}

async function orImage(prompt: string, model: string, refImages: string[] = []): Promise<Buffer> {
  // OpenRouter image gen lives behind /chat/completions with
  // `modalities: ["image","text"]`. Response messages can carry image
  // bytes inline as data: URIs OR as image_url objects.
  // Optional refImages (data: URIs) are attached as image_url content blocks
  // so the provider (gemini-flash-image / nano-banana) locks identity from refs.
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const ref of refImages) {
    content.push({ type: 'image_url', image_url: { url: ref } });
  }
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: refImages.length ? content : prompt }],
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`openrouter image ${r.status}: ${text.slice(0, 300)}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; image_url?: { url?: string } | string; text?: string }>;
        images?: Array<{ image_url?: { url?: string } | string; url?: string }>;
      };
    }>;
  };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('openrouter image: no message in response');

  // 1) Structured `images` array (gemini-flash-image, nano banana shape)
  for (const img of msg.images ?? []) {
    const u = typeof img.image_url === 'string'
      ? img.image_url
      : (img.image_url as { url?: string } | undefined)?.url ?? img.url;
    if (u) return await fetchImageUrl(u);
  }

  // 2) Content array with type=image_url
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      const u = typeof part.image_url === 'string'
        ? part.image_url
        : (part.image_url as { url?: string } | undefined)?.url;
      if (u) return await fetchImageUrl(u);
    }
  }

  // 3) Content string with markdown image ![](url) or data: URI
  if (typeof msg.content === 'string') {
    const dataUri = msg.content.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/);
    if (dataUri && dataUri[1]) return Buffer.from(dataUri[1], 'base64');
    const md = msg.content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (md && md[1]) return await fetchImageUrl(md[1]);
  }

  throw new Error('openrouter image: no image in response');
}

async function fetchImageUrl(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (m && m[1]) return Buffer.from(m[1], 'base64');
    throw new Error('malformed data URI');
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image url ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function orVideo(
  imageDataUri: string,
  motionPrompt: string,
  model: string,
  _durationS: number,
): Promise<Buffer> {
  // OpenRouter async video gen: POST /videos → polling_url → poll until completed.
  // Reference image attached as image_url + OpenAI multi-modal content blocks
  // so the provider can route as image-to-video (AgentScope-BLAIQ pattern).
  // Providers across OpenRouter vary on which field they read the init / first
  // frame image from. Send all common aliases so whichever the provider parses
  // ends up using the same image. grok-imagine-video uses image_url; veo
  // uses first_frame; runway uses init_image; kling uses image; minimax uses
  // first_frame_image. Multi-modal messages block is the canonical OpenAI shape.
  const payload: Record<string, unknown> = {
    model,
    prompt: motionPrompt,
    image_url: imageDataUri,
    image: imageDataUri,
    first_frame: imageDataUri,
    first_frame_image: imageDataUri,
    init_image: imageDataUri,
    start_frame: imageDataUri,
    reference_image: imageDataUri,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: motionPrompt },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ],
      },
    ],
  };
  const submit = await fetch(`${OR_BASE}/videos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!submit.ok) {
    const text = await submit.text();
    throw new Error(`openrouter video submit ${submit.status}: ${text.slice(0, 300)}`);
  }
  const job = (await submit.json()) as {
    polling_url?: string;
    status_url?: string;
    poll_url?: string;
    id?: string;
  };
  const pollingUrl = job.polling_url || job.status_url || job.poll_url;
  if (!pollingUrl) throw new Error('openrouter video: no polling_url');

  const maxAttempts = 120; // ~10 min at 5s
  const intervalMs = 5000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const pr = await fetch(pollingUrl, {
      headers: { Authorization: `Bearer ${OR_KEY()}` },
    });
    if (!pr.ok) continue;
    const status = (await pr.json()) as {
      status?: string;
      unsigned_urls?: string[];
      urls?: string[];
      output?: string[] | string;
      outputs?: string[];
      video_urls?: string[];
      videos?: Array<{ url?: string; video_url?: string; src?: string } | string>;
      error?: string;
    };
    if (status.status === 'failed') throw new Error(`openrouter video failed: ${status.error || 'unknown'}`);
    if (status.status !== 'completed') continue;

    const urls: string[] = [];
    for (const f of ['unsigned_urls', 'urls', 'output', 'outputs', 'video_urls'] as const) {
      const v = status[f];
      if (Array.isArray(v)) urls.push(...v.filter(Boolean).map(String));
      else if (typeof v === 'string' && v) urls.push(v);
    }
    if (Array.isArray(status.videos)) {
      for (const e of status.videos) {
        if (typeof e === 'string') urls.push(e);
        else if (e && typeof e === 'object') {
          const u = e.url || e.video_url || e.src;
          if (u) urls.push(u);
        }
      }
    }
    if (!urls.length) throw new Error('openrouter video completed but no URLs');
    // Auth header only for openrouter.ai-hosted URLs; pre-signed CDN URLs (S3/GCS)
    // reject Authorization headers.
    const dlUrl = urls[0]!;
    let host = '';
    try { host = new URL(dlUrl).hostname.toLowerCase(); } catch { /* noop */ }
    const dlHeaders: Record<string, string> = host.endsWith('openrouter.ai')
      ? { Authorization: `Bearer ${OR_KEY()}` }
      : {};
    const vidRes = await fetch(dlUrl, { headers: dlHeaders });
    if (!vidRes.ok) throw new Error(`fetch video ${vidRes.status} host=${host}`);
    return Buffer.from(await vidRes.arrayBuffer());
  }
  throw new Error('openrouter video poll timeout');
}

async function orTts(text: string, voice: string): Promise<Buffer> {
  // Try OpenRouter audio/speech (OpenAI shape).
  const r = await fetch(`${OR_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/tts-1',
      voice: voice || 'alloy',
      input: text.slice(0, 4000),
      response_format: 'mp3',
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`openrouter tts ${r.status}: ${text.slice(0, 300)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

async function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

/** Build script + storyboard from brief, brand, and Hivemind recall. */
async function generateStoryboard(
  brief: VideoBrief,
  brandTone: string,
  brandDna: string,
  hivemindContext: string,
): Promise<Storyboard> {
  const shotCount = Math.max(4, Math.min(8, Math.ceil(brief.length / 6)));
  const system = `You are a senior creative director + cinematographer crafting a cinematic, Higgsfield-style brand promo video.
Think like a working film director — every shot MUST have ACTION. No static "person stands and smiles" frames. Every shot specifies movement: subject motion (gesture, walk, turn, reach, react) and camera motion (dolly, push-in, tilt, pan, orbit, handheld float). Plot arc with momentum: hook → tension → reveal → CTA.

# Brand DNA (visual identity)
${brandDna}

# Brand Tone (voice)
${brandTone}

# Hivemind facts (org context — use only these for product/people/customer claims; never invent)
${hivemindContext}

# Output contract
Return ONLY valid JSON, no preamble, no markdown fence. Schema:
{
  "title": "compelling title",
  "duration_s": ${brief.length},
  "presenter_persona": "1-sentence persona for the PRIMARY subject (used when subjects array is empty). Detail: age range, gender, demeanor, wardrobe.",
  "visual_world": "1-sentence world description: location, lighting, color palette tied to brand (locked across all shots)",
  "subjects": [
    {
      "id": "<short-slug e.g. 'host', 'customer_a', 'engineer'>",
      "name": "<display name or empty>",
      "persona": "Detailed persona — age, gender, ethnicity hint, build, hair colour+style, wardrobe top/bottom/shoes/accessories, demeanor, occupation. Be specific enough that two renders produce the same person."
    }
  ],
  "narration": "${brief.voiceover ? 'FULL voiceover script in brand tone. ~150 words/min. Open with a HOOK question or punchy statement, then 2-3 message pillars with concrete evidence (numbers, names, customer quotes) from Hivemind facts above, end with a clear CTA. 6-8 complete sentences minimum. No filler.' : ''}",
  "music_brief": "what music feels like — tempo BPM, instrumentation, energy arc across the runtime (1-2 sentences)",
  "color_grade": "color grade direction tied to brand palette + lighting mood (1 sentence)",
  "shots": [
    {
      "shot": 1,
      "duration_s": <int seconds, sum across all shots EXACTLY = ${brief.length}>,
      "segment": "hook | pillar_1 | pillar_2 | pillar_3 | broll | cta",
      "visual": "1-sentence what-we-see in this shot",
      "camera": "shot size + lens + camera move. Format: '<size> <lens> <move>'. Examples: 'wide 24mm slow dolly-in', 'medium 50mm handheld follow', 'close 85mm static rack-focus', 'low-angle 35mm orbit-left'.",
      "subject_ids": ["<which subject ids from the subjects array appear in this shot — empty array for b-roll/product>"],
      "presenter_action": "EXACT physical action the subject performs across this shot (not a static pose): 'walks across kitchen toward the device, places hand on its surface, looks up into camera' OR 'no presenter — product close-up' for b-roll",
      "image_prompt": "Vivid paragraph image prompt — cinematic mood, lighting setup (key/fill/practicals), composition (rule-of-thirds, negative space), color palette, depth-of-field, emotional tone. Repeat presenter_persona + visual_world verbatim for identity lock. 3-5 sentences.",
      "motion_prompt": "DETAILED i2v animation directive. Must include: (a) camera motion with magnitude (e.g. 'slow dolly-in 5cm over 4 seconds'); (b) subject motion (e.g. 'subject turns head left, smiles, then walks forward 1 step'); (c) environmental motion (e.g. 'curtains billow softly, dust motes drift in light shaft, steam rises from cup'); (d) physics realism cues (gravity, weight, fabric drape); (e) mood filters (lens flare, soft bloom, light leaks). 4-6 sentences. ACTION-FIRST — no static descriptions.",
      "narration_chunk": "${brief.voiceover ? 'Spoken text aligned to this shot duration — must be a complete, on-brand sentence with substance (concrete claim + evidence). No filler phrases.' : ''}",
      "on_screen_text": "lower-third / supers / logo cue or empty string"
    }
  ]
}

Constraints:
- Total shots: ${shotCount}. Each shot 3-8 seconds. Durations sum EXACTLY to ${brief.length}.
- Plot arc: shot 1 = hook (curiosity); middle shots = message pillars with concrete evidence; final shot = CTA + brand mark.
- Every shot MUST have motion. If a shot describes a still pose, it is INVALID — add subject action and camera move.
- ALWAYS populate the subjects array with 1-3 distinct subjects (1 = solo presenter, 2-3 = host + customer or multi-character story). Reuse the SAME subject id across all shots they appear in for identity continuity.
- Every shot must list which subject_ids appear. Use [] only for pure b-roll (product, scenery, abstract).
- Lock subjects (by id) and visual_world verbatim in every shot's image_prompt — guarantees identity consistency across generated frames.
- Style: ${brief.style}. Aspect: ${brief.aspect}.
- Use Brand Tone vocabulary for narration. Never invent facts beyond Hivemind context.`;

  const user = `Build a ${brief.length}-second promo video about: ${brief.subject}

Additional user notes: ${brief.userPrompt}

Return the storyboard JSON now.`;

  const raw = await orChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    SCRIPT_MODEL,
    { maxTokens: 16000, jsonMode: true },
  );
  // Strip code fences if model still wraps
  let jsonText = raw.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch && fenceMatch[1]) jsonText = fenceMatch[1].trim();

  // Pre-clean: strip JS-style comments and trailing commas the model sometimes
  // emits. Done before any parse attempt so jsonrepair has less to do.
  const stripComments = (s: string): string => s
    .replace(/\/\*[\s\S]*?\*\//g, '')           // /* ... */
    .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')     // // ...  (skip URLs after `:`)
    .replace(/,(\s*[}\]])/g, '$1');             // trailing commas
  jsonText = stripComments(jsonText);

  // Try direct parse first
  try {
    return JSON.parse(jsonText) as Storyboard;
  } catch (_e1) {
    // Pass 1 — programmatic repair (jsonrepair): handles unescaped quotes,
    // smart quotes, trailing commas, unterminated strings, missing brackets.
    // Cheap, deterministic, no LLM round-trip.
    try {
      const fixed = jsonrepair(jsonText);
      return JSON.parse(fixed) as Storyboard;
    } catch (_e2) {
      // Pass 2 — LLM repair as last resort.
      try {
        const repaired = await orChat(
          [
            { role: 'system', content: 'You are a JSON repair tool. Output ONLY valid JSON that matches the original intent. Do not add commentary. Do not wrap in code fences. If the input is truncated, complete the missing fields with empty strings or sensible defaults so the JSON parses.' },
            { role: 'user', content: `Repair this JSON so it parses with JSON.parse. Preserve all data. Close any unterminated strings, balance brackets, escape inner quotes, replace smart quotes with straight quotes.\n\n${jsonText}` },
          ],
          SCRIPT_MODEL,
          { maxTokens: 16000, jsonMode: true },
        );
        let repairedText = repaired.trim();
        const rf = repairedText.match(/```(?:json)?\s*([\s\S]+?)```/);
        if (rf && rf[1]) repairedText = rf[1].trim();
        try {
          return JSON.parse(repairedText) as Storyboard;
        } catch {
          // Last-ditch — run jsonrepair on the LLM repair output too.
          return JSON.parse(jsonrepair(repairedText)) as Storyboard;
        }
      } catch (e3) {
        throw new Error(`script JSON parse failed after all repairs: ${(e3 as Error).message}\nraw head: ${jsonText.slice(0, 400)}\nraw tail: ${jsonText.slice(-200)}`);
      }
    }
  }
}

function storyboardToMarkdown(sb: Storyboard, brief: VideoBrief): string {
  const lines: string[] = [];
  lines.push(`# ${sb.title}`);
  lines.push('');
  lines.push(`**Duration:** ${sb.duration_s}s · **Style:** ${brief.style} · **Aspect:** ${brief.aspect}`);
  lines.push('');
  if (sb.subjects && sb.subjects.length > 0) {
    lines.push('## Subjects');
    lines.push('');
    for (const s of sb.subjects) {
      lines.push(`- **${s.id}**${s.name ? ` (${s.name})` : ''}: ${s.persona}`);
    }
    lines.push('');
  } else if (sb.presenter_persona) {
    lines.push(`**Presenter:** ${sb.presenter_persona}`);
  }
  if (sb.visual_world) lines.push(`**Visual world:** ${sb.visual_world}`);
  if (sb.color_grade) lines.push(`**Color grade:** ${sb.color_grade}`);
  if (sb.music_brief) lines.push(`**Music:** ${sb.music_brief}`);
  lines.push('');
  if (sb.narration) {
    lines.push('## Narration');
    lines.push('');
    lines.push(sb.narration);
    lines.push('');
  }
  lines.push('## Storyboard');
  lines.push('');
  lines.push('| Shot | Dur | Segment | Subjects | Camera | Visual | On-screen |');
  lines.push('|------|-----|---------|----------|--------|--------|-----------|');
  for (const s of sb.shots) {
    const row = [
      String(s.shot),
      `${s.duration_s}s`,
      s.segment || '',
      (s.subject_ids || []).join(', ') || '—',
      (s.camera || '').replace(/\|/g, '/'),
      (s.visual || '').replace(/\|/g, '/'),
      (s.on_screen_text || '').replace(/\|/g, '/'),
    ];
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Shot details');
  lines.push('');
  for (const s of sb.shots) {
    lines.push(`### Shot ${s.shot} — ${s.segment || ''} (${s.duration_s}s)`);
    if (s.presenter_action) lines.push(`- **Action:** ${s.presenter_action}`);
    if (s.camera) lines.push(`- **Camera:** ${s.camera}`);
    if (s.motion_prompt) lines.push(`- **Motion:** ${s.motion_prompt}`);
    if (s.narration_chunk) lines.push(`- **Narration:** "${s.narration_chunk}"`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Main pipeline. */
export async function renderVideo(
  brief: VideoBrief,
  projectDir: string,
  ctx: {
    brandTone: string;
    brandDna: string;
    hivemindContext: string;
    voice?: string;
  },
  onProgress: ProgressCallback,
): Promise<{ finalPath: string; storyboard: Storyboard }> {
  if (!OR_KEY()) throw new Error('OPENROUTER_API_KEY not set');
  await fs.mkdir(projectDir, { recursive: true });

  // Stage 3: script + storyboard
  onProgress({ stage: 'script', status: 'start' });
  const storyboard = await generateStoryboard(brief, ctx.brandTone, ctx.brandDna, ctx.hivemindContext);
  await fs.writeFile(path.join(projectDir, 'storyboard.json'), JSON.stringify(storyboard, null, 2));
  onProgress({ stage: 'script', status: 'done', storyboard });

  // Push human-readable script to chat (renders in left chat pane while frames generate)
  const md = storyboardToMarkdown(storyboard, brief);
  await fs.writeFile(path.join(projectDir, 'script.md'), md);
  onProgress({ stage: 'chat-script', markdown: md });

  // Build script context summary used by reference sheets so identity + world
  // reflect what the narration requires.
  const shotVisualsDigest = storyboard.shots
    .map((s) => `Shot ${s.shot} (${s.segment || ''}) subjects=${(s.subject_ids || []).join(',') || '-'}: ${s.visual}`)
    .join('\n');
  const scriptContext = `# Script narration\n${storyboard.narration || '(no narration)'}\n\n# Shot visuals\n${shotVisualsDigest}\n\n# Title: ${storyboard.title}`;

  // Stage 3.5a: per-subject sheets. Supports 1-3 distinct subjects.
  // Legacy fallback: if subjects[] empty but presenter_persona set, build a
  // single synthetic subject from it.
  const subjects: SubjectDef[] = Array.isArray(storyboard.subjects) && storyboard.subjects.length > 0
    ? storyboard.subjects.slice(0, 3)
    : (storyboard.presenter_persona && storyboard.presenter_persona.trim()
        ? [{ id: 'host', persona: storyboard.presenter_persona }]
        : []);
  storyboard.subjects = subjects;

  const specSchema = `{
  "subject": {
    "gender": "<>", "age": "<specific>", "aesthetic": "<3-5 adjectives>",
    "appearance": {
      "skin_tone": "<>", "face": "<>", "expression": "<>", "eyes": "<>",
      "hair": { "color": "<>", "style": "<>", "texture": "<>" },
      "makeup": "<>"
    },
    "outfit": { "top": "<>", "bottom": "<>", "shoes": "<>", "outerwear": "<>", "accessories": "<>", "style": "<>" },
    "pose_style": "<>", "body_language": "<>"
  },
  "style": { "photography_type": "<>", "visual_tone": "<>", "mood": "<>", "color_palette": "<>", "contrast": "<>", "grain": "<>" },
  "rendering": { "realism": "ultra-realistic", "detail_level": "high", "sharpness": "high", "depth_of_field": "natural", "post_processing": "minimal" },
  "atmosphere": "<>"
}`;

  for (const subj of subjects) {
    onProgress({ stage: 'subject-sheet', status: 'start', subjectId: subj.id });
    // Build per-subject spec JSON
    try {
      const specSystem = `You are a casting + wardrobe director. Output ONLY a single valid JSON object matching the schema. No prose, no code fence. Pick concrete specific details (no placeholders). Same person will render consistently across many shots, so be specific.`;
      const specUser = `Subject id: ${subj.id} (${subj.name || ''})
Persona: ${subj.persona}

${scriptContext}

Brand tone (voice): ${ctx.brandTone.slice(0, 600)}
Visual world: ${storyboard.visual_world || ''}
Color grade: ${storyboard.color_grade}

Fill this schema with concrete locked-in details:
${specSchema}`;
      const raw = await orChat(
        [
          { role: 'system', content: specSystem },
          { role: 'user', content: specUser },
        ],
        SCRIPT_MODEL,
        { maxTokens: 3000, jsonMode: true },
      );
      let cleaned = raw.trim();
      const fence = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (fence && fence[1]) cleaned = fence[1].trim();
      try { JSON.parse(cleaned); } catch { cleaned = jsonrepair(cleaned); JSON.parse(cleaned); }
      subj.specJson = cleaned;
      await fs.writeFile(path.join(projectDir, `subject_${subj.id}_spec.json`), cleaned);
    } catch (err) {
      console.warn(`[video-pipeline] spec for subject ${subj.id} failed:`, (err as Error).message);
    }

    // Generate 4-photo grid sheet
    const subjectPrompt = `Subject reference sheet for "${subj.id}" — 4-photo grid collage (2x2), smartphone-photography style, neutral light-grey seamless studio backdrop, soft diffused lighting.

# Strict subject specification (USE EXACTLY — do NOT improvise hair, face, wardrobe, age, body)
${subj.specJson || `Persona: ${subj.persona}`}

# 4-photo grid (same individual every panel)
Panel 1 (top-left): full body STANDING front view, arms relaxed.
Panel 2 (top-right): CROUCHING pose, looking toward camera.
Panel 3 (bottom-left): casual SEATED pose on floor or low surface.
Panel 4 (bottom-right): UPPER BODY portrait, eye-level, soft natural smile.

Identical subject in all four panels — same face, hair, skin tone, wardrobe, age, build. Treat the JSON above as the locked identity contract.

Style: photoreal, ultra-realistic, high skin and fabric texture detail, sharp focus, smartphone editorial. No text, no labels, no watermark. Aspect ${brief.aspect}.`;
    try {
      const buf = await orImage(subjectPrompt, IMAGE_MODEL);
      const p = path.join(projectDir, `subject_${subj.id}_sheet.png`);
      await fs.writeFile(p, buf);
      subj.sheetPath = p;
      subj.sheetDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      onProgress({ stage: 'subject-sheet', status: 'done', path: p, subjectId: subj.id });
    } catch (err) {
      console.warn(`[video-pipeline] sheet for subject ${subj.id} failed:`, (err as Error).message);
      onProgress({ stage: 'subject-sheet', status: 'skip', subjectId: subj.id });
    }
  }
  if (subjects.length === 0) onProgress({ stage: 'subject-sheet', status: 'skip' });

  // Stage 3.5b: scenery / location reference sheet — single establishing
  // image of the world the video lives in. Used as second image reference
  // for per-shot frame gen so location, palette, props stay consistent.
  let scenerySheetDataUri: string | undefined;
  if (storyboard.visual_world && storyboard.visual_world.trim()) {
    onProgress({ stage: 'scenery-sheet', status: 'start' });
    const sceneryPrompt = `Cinematic establishing shot of the LOCATION ONLY, NO PEOPLE in frame.

# Location
${storyboard.visual_world}

# Script context (use this to choose props, time of day, weather, signage, set dressing — match what the shots and narration describe)
${scriptContext}

# Style
Color grade: ${storyboard.color_grade}. Style: ${brief.style}. Wide angle, photoreal, natural lighting, sharp focus, no text, no watermark. Aspect ${brief.aspect}.`;
    try {
      const buf = await orImage(sceneryPrompt, IMAGE_MODEL);
      const p = path.join(projectDir, 'scenery_sheet.png');
      await fs.writeFile(p, buf);
      scenerySheetDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      onProgress({ stage: 'scenery-sheet', status: 'done', path: p });
    } catch (err) {
      console.warn('[video-pipeline] scenery sheet failed:', (err as Error).message);
      onProgress({ stage: 'scenery-sheet', status: 'skip' });
    }
  } else {
    onProgress({ stage: 'scenery-sheet', status: 'skip' });
  }

  // Stage 4: ref frames per shot (parallel). Each shot gets ONLY the subject
  // sheets for subjects appearing in that shot (per subject_ids) + scenery
  // sheet as image_url refs. Strict per-subject identity lock + narration.
  onProgress({ stage: 'ref-frames', status: 'start' });
  const subjectsById = new Map(subjects.map((s) => [s.id, s]));
  await Promise.all(
    storyboard.shots.map(async (shot) => {
      const shotSubjects: SubjectDef[] = (shot.subject_ids || [])
        .map((id) => subjectsById.get(id))
        .filter((s): s is SubjectDef => Boolean(s && s.sheetDataUri));
      const refs: string[] = [];
      shotSubjects.forEach((s) => { if (s.sheetDataUri) refs.push(s.sheetDataUri); });
      if (scenerySheetDataUri) refs.push(scenerySheetDataUri);

      const subjectClauses: string[] = [];
      shotSubjects.forEach((s, idx) => {
        const ordinal = ['FIRST', 'SECOND', 'THIRD'][idx] || `#${idx + 1}`;
        subjectClauses.push(`STRICT IDENTITY LOCK — subject "${s.id}" appears in this shot and is the SAME individual shown in the ${ordinal} attached reference image. Match face, skin tone, hair, build, height, age, AND wardrobe exactly from any of its four panels. Do NOT invent a different person, do NOT change wardrobe or hair.`);
      });
      if (scenerySheetDataUri) {
        const ord = ['FIRST', 'SECOND', 'THIRD', 'FOURTH'][shotSubjects.length] || `#${shotSubjects.length + 1}`;
        subjectClauses.push(`STRICT LOCATION LOCK — the environment is the SAME location shown in the ${ord} attached reference image. Match architecture, materials, color palette, props, signage, time of day, and lighting direction exactly.`);
      }

      const subjectSpecBlocks = shotSubjects
        .filter((s) => s.specJson)
        .map((s) => `# Locked spec for subject "${s.id}" (must match attached reference)\n${s.specJson}`)
        .join('\n\n');

      const narrationCue = shot.narration_chunk
        ? `\n\n# Narration line for this shot (visual must match the emotional beat)\n"${shot.narration_chunk}"`
        : '';

      const lockBlock = subjectClauses.length ? '\n\n' + subjectClauses.join('\n') : '';
      const specBlock = subjectSpecBlocks ? '\n\n' + subjectSpecBlocks : '';

      const prompt = `${shot.image_prompt}${specBlock}${lockBlock}${narrationCue}\n\nStyle: ${brief.style}. Color grade: ${storyboard.color_grade}. Aspect ${brief.aspect}. Photoreal, cinematic, no text, no watermark.`;
      const buf = await orImage(prompt, IMAGE_MODEL, refs);
      const p = path.join(projectDir, `ref_shot${shot.shot}.png`);
      await fs.writeFile(p, buf);
      shot.refFramePath = p;
      onProgress({ stage: 'ref-frames', status: 'shot-done', shot: shot.shot, path: p });
    }),
  );
  onProgress({ stage: 'ref-frames', status: 'done' });

  // Stage 5: voiceover (optional)
  let voicePath: string | undefined;
  if (brief.voiceover && storyboard.narration) {
    onProgress({ stage: 'voice', status: 'start' });
    try {
      const buf = await orTts(storyboard.narration, ctx.voice || 'alloy');
      voicePath = path.join(projectDir, 'voiceover.mp3');
      await fs.writeFile(voicePath, buf);
      onProgress({ stage: 'voice', status: 'done', path: voicePath });
    } catch (err) {
      // Voice not critical — log and continue
      console.warn('[video-pipeline] tts failed:', (err as Error).message);
      onProgress({ stage: 'voice', status: 'skip' });
    }
  } else {
    onProgress({ stage: 'voice', status: 'skip' });
  }

  // Stage 6: video per shot (parallel)
  onProgress({ stage: 'video', status: 'start' });
  await Promise.all(
    storyboard.shots.map(async (shot) => {
      if (!shot.refFramePath) return;
      const imgBuf = await fs.readFile(shot.refFramePath);
      const imgDataUri = `data:image/png;base64,${imgBuf.toString('base64')}`;
      // Keep i2v prompt < 4096 chars (grok-imagine-video hard limit).
      // Identity lock travels via the attached first-frame image; verbose
      // spec JSON is unnecessary here and explodes the prompt size.
      const trim = (s: string | undefined, n: number): string => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
      const motionParts = [
        'Image-to-video: animate the attached image as FIRST FRAME. Keep subject identity, wardrobe, location, lighting, and palette identical to the frame.',
        `Action: ${trim(shot.motion_prompt, 700)}`,
        `Camera: ${trim(shot.camera || brief.style, 200)}`,
        `Style: ${trim(brief.style, 80)}. Color grade: ${trim(storyboard.color_grade, 200)}.`,
      ];
      let motion = motionParts.join(' ');
      if (motion.length > 3900) motion = motion.slice(0, 3900);
      try {
        const vidBuf = await orVideo(imgDataUri, motion, VIDEO_MODEL, shot.duration_s);
        const vp = path.join(projectDir, `shot${shot.shot}.mp4`);
        await fs.writeFile(vp, vidBuf);
        shot.videoPath = vp;
        onProgress({ stage: 'video', status: 'shot-done', shot: shot.shot, path: vp });
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`[video-pipeline] shot ${shot.shot} i2v failed:`, msg);
        onProgress({ stage: 'video-error', shot: shot.shot, message: msg.slice(0, 400) });
        // Fallback: convert static image to N-second video clip via ffmpeg
        const vp = path.join(projectDir, `shot${shot.shot}.mp4`);
        await ffmpeg([
          '-loop', '1',
          '-i', shot.refFramePath,
          '-c:v', 'libx264',
          '-t', String(shot.duration_s),
          '-pix_fmt', 'yuv420p',
          '-vf', 'scale=1920:1080,zoompan=z=\'min(zoom+0.0015,1.2)\':d=' + String(shot.duration_s * 25),
          vp,
        ]);
        shot.videoPath = vp;
        onProgress({ stage: 'video', status: 'shot-done', shot: shot.shot, path: vp });
      }
    }),
  );
  onProgress({ stage: 'video', status: 'done' });

  // Stage 7: stitch
  onProgress({ stage: 'stitch', status: 'start' });
  const concatListPath = path.join(projectDir, 'concat.txt');
  const concatContent = storyboard.shots
    .filter((s) => s.videoPath)
    .map((s) => `file '${s.videoPath!.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(concatListPath, concatContent);
  const stitchedNoAudio = path.join(projectDir, 'stitched_silent.mp4');
  await ffmpeg([
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    stitchedNoAudio,
  ]);

  const finalPath = path.join(projectDir, 'final.mp4');
  if (voicePath) {
    await ffmpeg([
      '-i', stitchedNoAudio,
      '-i', voicePath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-map', '0:v:0',
      '-map', '1:a:0',
      finalPath,
    ]);
  } else {
    await fs.rename(stitchedNoAudio, finalPath);
  }
  onProgress({ stage: 'stitch', status: 'done', path: finalPath });
  onProgress({ stage: 'final', path: 'final.mp4', absolutePath: finalPath });

  return { finalPath, storyboard };
}
