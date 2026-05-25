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
const IMAGE_MODEL = process.env.BLAIQ_VIDEO_IMAGE_MODEL || 'openai/gpt-5.4-image-2';
const VIDEO_MODEL = process.env.BLAIQ_VIDEO_I2V_MODEL || 'google/veo-3';

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
  visual: string;
  image_prompt: string;
  motion_prompt: string;
  narration_chunk: string;
  refFramePath?: string;
  videoPath?: string;
}

export interface Storyboard {
  title: string;
  duration_s: number;
  narration: string;
  music_brief: string;
  color_grade: string;
  shots: Shot[];
}

export type ProgressEvent =
  | { stage: 'router'; status: 'start' | 'done'; skill?: string }
  | { stage: 'recall'; status: 'start' | 'done'; chars?: number }
  | { stage: 'script'; status: 'start' | 'done'; storyboard?: Storyboard }
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

async function orImage(prompt: string, model: string): Promise<Buffer> {
  // OpenRouter image gen lives behind /chat/completions with
  // `modalities: ["image","text"]`. Response messages can carry image
  // bytes inline as data: URIs OR as image_url objects.
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: prompt }],
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
  imageBase64: string,
  motionPrompt: string,
  model: string,
  durationS: number,
): Promise<Buffer> {
  // OpenRouter video gen — model-specific. Generic shape:
  const r = await fetch(`${OR_BASE}/videos/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: motionPrompt,
      image: imageBase64,
      duration: durationS,
      aspect_ratio: '16:9',
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`openrouter video ${r.status}: ${text.slice(0, 300)}`);
  }
  const data = (await r.json()) as { data?: Array<{ url?: string }> };
  const url = data.data?.[0]?.url;
  if (!url) throw new Error('openrouter video returned no url');
  const vidRes = await fetch(url);
  return Buffer.from(await vidRes.arrayBuffer());
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
  const system = `You are a senior content director writing a JSON storyboard for a brand promo video.

# Brand DNA (visual identity)
${brandDna}

# Brand Tone (voice)
${brandTone}

# Hivemind facts (org context — use only these for product/people/customer claims)
${hivemindContext}

# Output contract
Return ONLY valid JSON, no preamble, no markdown fence. Schema:
{
  "title": string,
  "duration_s": ${brief.length},
  "narration": "full voiceover script, ${brief.voiceover ? 'matching brand tone' : 'leave empty string'}",
  "music_brief": "what music should feel like (1 sentence)",
  "color_grade": "color grade direction tied to brand palette (1 sentence)",
  "shots": [
    {
      "shot": 1,
      "duration_s": <int seconds, sum of all shots = ${brief.length}>,
      "visual": "what we see, single sentence",
      "image_prompt": "detailed prompt for image gen including brand colors + style",
      "motion_prompt": "what motion happens in the shot (camera move, action)",
      "narration_chunk": "${brief.voiceover ? 'spoken text for this shot' : 'leave empty string'}"
    }
  ]
}

Constraints:
- Total shots: ${Math.max(3, Math.min(8, Math.ceil(brief.length / 5)))}
- Each shot 3-8 seconds
- Style: ${brief.style}
- Aspect: ${brief.aspect}
- Use Brand Tone vocabulary for narration. Never invent facts.`;

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

  // Stage 4: ref frames per shot (parallel)
  onProgress({ stage: 'ref-frames', status: 'start' });
  await Promise.all(
    storyboard.shots.map(async (shot) => {
      const prompt = `${shot.image_prompt}. Style: ${brief.style}. Color grade: ${storyboard.color_grade}. Aspect ${brief.aspect}. Consistent style across all shots.`;
      const buf = await orImage(prompt, IMAGE_MODEL);
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
      const imgB64 = imgBuf.toString('base64');
      const motion = `${shot.motion_prompt}. Camera: smooth, ${brief.style}.`;
      try {
        const vidBuf = await orVideo(imgB64, motion, VIDEO_MODEL, shot.duration_s);
        const vp = path.join(projectDir, `shot${shot.shot}.mp4`);
        await fs.writeFile(vp, vidBuf);
        shot.videoPath = vp;
        onProgress({ stage: 'video', status: 'shot-done', shot: shot.shot, path: vp });
      } catch (err) {
        console.warn(`[video-pipeline] shot ${shot.shot} i2v failed:`, (err as Error).message);
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
