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

export interface Shot {
  shot: number;
  duration_s: number;
  segment?: string;
  visual: string;
  camera?: string;
  presenter_action?: string;
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
  presenter_persona?: string;
  visual_world?: string;
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
  | { stage: 'character-sheet'; status: 'start' | 'done' | 'skip'; path?: string }
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
  const payload: Record<string, unknown> = {
    model,
    prompt: motionPrompt,
    image_url: imageDataUri,
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
  const system = `You are a senior creative director crafting a cinematic, Higgsfield-style brand promo video.
Think like a film director: plot arc (hook → tension → reveal → CTA), camera grammar (wide / medium / close / push-in / dolly / handheld), presenter persona, and a unified visual world across shots.

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
  "presenter_persona": "1-sentence persona: age range, demeanor, wardrobe (locked across all shots for visual identity)",
  "visual_world": "1-sentence world description: location, lighting, color palette tied to brand (locked across all shots)",
  "narration": "${brief.voiceover ? 'full voiceover script in brand tone, ~150 words/min, with hook + 2-3 message pillars + CTA' : ''}",
  "music_brief": "what music feels like — tempo, instrumentation, energy (1 sentence)",
  "color_grade": "color grade direction tied to brand palette (1 sentence)",
  "shots": [
    {
      "shot": 1,
      "duration_s": <int seconds, sum across all shots EXACTLY = ${brief.length}>,
      "segment": "hook | pillar_1 | pillar_2 | pillar_3 | broll | cta",
      "visual": "1-sentence what-we-see",
      "camera": "shot size + move (e.g. 'wide static', 'medium 2s push-in', 'close handheld', 'low-angle dolly')",
      "presenter_action": "what presenter does on screen (or 'no presenter' for b-roll)",
      "image_prompt": "detailed image-gen prompt — MUST repeat presenter_persona + visual_world verbatim each shot for identity lock, plus shot-specific framing, lens, lighting, brand color hex codes",
      "motion_prompt": "i2v motion direction — camera move + subject motion (e.g. 'subject smiles and gestures right, camera slow push-in 5%')",
      "narration_chunk": "${brief.voiceover ? 'spoken text aligned to this shot duration' : ''}",
      "on_screen_text": "lower-third / supers / logo cue or empty string"
    }
  ]
}

Constraints:
- Total shots: ${shotCount}. Each shot 3-8 seconds. Durations sum EXACTLY to ${brief.length}.
- Plot arc: shot 1 = hook (curiosity); middle shots = message pillars with evidence; final shot = CTA + logo.
- Lock presenter_persona and visual_world verbatim in every shot's image_prompt — guarantees identity consistency across generated frames.
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
    { maxTokens: 6000, jsonMode: true },
  );
  // Strip code fences if model still wraps
  let jsonText = raw.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch && fenceMatch[1]) jsonText = fenceMatch[1].trim();
  try {
    return JSON.parse(jsonText) as Storyboard;
  } catch (err) {
    throw new Error(`script JSON parse failed: ${(err as Error).message}\nraw: ${jsonText.slice(0, 500)}`);
  }
}

function storyboardToMarkdown(sb: Storyboard, brief: VideoBrief): string {
  const lines: string[] = [];
  lines.push(`# ${sb.title}`);
  lines.push('');
  lines.push(`**Duration:** ${sb.duration_s}s · **Style:** ${brief.style} · **Aspect:** ${brief.aspect}`);
  lines.push('');
  if (sb.presenter_persona) lines.push(`**Presenter:** ${sb.presenter_persona}`);
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
  lines.push('| Shot | Dur | Segment | Camera | Visual | On-screen |');
  lines.push('|------|-----|---------|--------|--------|-----------|');
  for (const s of sb.shots) {
    const row = [
      String(s.shot),
      `${s.duration_s}s`,
      s.segment || '',
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

  // Stage 3.5: character sheet (if presenter persona present) — single portrait
  // generated once, then passed as image reference to every shot's image gen
  // so identity (face, wardrobe, build) locks across all frames.
  let characterSheetDataUri: string | undefined;
  if (storyboard.presenter_persona && storyboard.presenter_persona.trim()) {
    onProgress({ stage: 'character-sheet', status: 'start' });
    const sheetPrompt = `Character reference sheet, neutral studio lighting, soft seamless backdrop. Subject: ${storyboard.presenter_persona}. Visual world cues: ${storyboard.visual_world || ''}. Color grade: ${storyboard.color_grade}. Single full-body + headshot composite, photoreal, ${brief.aspect}, sharp, no text, no logo.`;
    try {
      const buf = await orImage(sheetPrompt, IMAGE_MODEL);
      const sheetPath = path.join(projectDir, 'character_sheet.png');
      await fs.writeFile(sheetPath, buf);
      characterSheetDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      onProgress({ stage: 'character-sheet', status: 'done', path: sheetPath });
    } catch (err) {
      console.warn('[video-pipeline] character sheet failed:', (err as Error).message);
      onProgress({ stage: 'character-sheet', status: 'skip' });
    }
  } else {
    onProgress({ stage: 'character-sheet', status: 'skip' });
  }

  // Stage 4: ref frames per shot (parallel). Each shot's gen receives the
  // character sheet as image reference (when available) to lock identity.
  onProgress({ stage: 'ref-frames', status: 'start' });
  const refImagesForShot = characterSheetDataUri ? [characterSheetDataUri] : [];
  await Promise.all(
    storyboard.shots.map(async (shot) => {
      const identityClause = characterSheetDataUri
        ? ' SAME subject as the attached reference image — match face, hair, build, wardrobe exactly.'
        : '';
      const prompt = `${shot.image_prompt}.${identityClause} Style: ${brief.style}. Color grade: ${storyboard.color_grade}. Aspect ${brief.aspect}. Photoreal, cinematic, no text, no watermark.`;
      const buf = await orImage(prompt, IMAGE_MODEL, refImagesForShot);
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
      const motion = `${shot.motion_prompt}. Camera: ${brief.style}. Maintain identity from reference frame: subject, wardrobe, environment, palette.`;
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
