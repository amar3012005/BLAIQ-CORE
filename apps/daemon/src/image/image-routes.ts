// Image pipeline routes — text-to-image with versioned output per project.
//
// POST /api/v1/image/render
//   { project_id, prompt, model?, aspect?, ref_image?, mask? }
// Returns JSON { version, path } and writes `image_v<n>.png` into the
// project directory. Each call increments the version, mirroring the
// pitch-deck "version per chat turn" pattern.

import type { Request, Response, Router } from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AuthenticatedRequest } from '../db/tenant-context.js';

const OR_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OR_KEY = (): string => process.env.OPENROUTER_API_KEY || '';

const PROJECTS_DIR = process.env.OD_DATA_DIR
  ? path.join(process.env.OD_DATA_DIR, 'projects')
  : path.join(process.cwd(), '.od', 'projects');

const DEFAULT_IMAGE_MODEL = process.env.BLAIQ_IMAGE_DEFAULT_MODEL
  || 'google/gemini-3.1-flash-image-preview';

async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (m && m[1]) return Buffer.from(m[1], 'base64');
    throw new Error('malformed data URI');
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image url ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function generateImage(
  prompt: string,
  model: string,
  refImages: string[] = [],
): Promise<Buffer> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const u of refImages) content.push({ type: 'image_url', image_url: { url: u } });
  const body = {
    model,
    modalities: ['image', 'text'],
    messages: [{ role: 'user', content: refImages.length ? content : prompt }],
  };
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OR_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

  for (const img of msg.images ?? []) {
    const u = typeof img.image_url === 'string'
      ? img.image_url
      : (img.image_url as { url?: string } | undefined)?.url ?? img.url;
    if (u) return await fetchImageBuffer(u);
  }
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      const u = typeof part.image_url === 'string'
        ? part.image_url
        : (part.image_url as { url?: string } | undefined)?.url;
      if (u) return await fetchImageBuffer(u);
    }
  }
  if (typeof msg.content === 'string') {
    const dataUri = msg.content.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/);
    if (dataUri && dataUri[1]) return Buffer.from(dataUri[1], 'base64');
    const md = msg.content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (md && md[1]) return await fetchImageBuffer(md[1]);
  }
  throw new Error('openrouter image: no image in response');
}

async function nextVersion(projectDir: string): Promise<number> {
  try {
    const files = await fs.readdir(projectDir);
    let max = 0;
    for (const f of files) {
      const m = f.match(/^image_v(\d+)\.png$/);
      if (m && m[1]) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
    return max + 1;
  } catch {
    return 1;
  }
}

export function registerImageRoutes(router: Router): void {
  router.post('/api/v1/image/render', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const body = (req.body ?? {}) as {
      project_id?: string;
      prompt?: string;
      model?: string;
      aspect?: string;
      ref_image?: string; // data URI of previous version for refinement
      mask?: string;      // data URI of a drawn mask (white = edit, black = keep)
    };
    if (!body.project_id || !body.prompt) {
      res.status(400).json({ error: 'project_id and prompt required' });
      return;
    }
    const projectDir = path.join(PROJECTS_DIR, body.project_id);
    await fs.mkdir(projectDir, { recursive: true });

    const model = body.model || DEFAULT_IMAGE_MODEL;
    const aspect = body.aspect || '1:1';
    const refs: string[] = [];
    if (body.ref_image) refs.push(body.ref_image);
    if (body.mask) refs.push(body.mask);

    let prompt = body.prompt.trim();
    if (refs.length === 1 && body.ref_image) {
      prompt = `Refine the attached image based on this instruction (keep identity, composition, palette intact unless instructed otherwise):\n${prompt}\n\nAspect ${aspect}. Photoreal, sharp.`;
    } else if (refs.length === 2) {
      prompt = `Refine the FIRST attached image using the SECOND attached image as an EDIT MASK (white = areas to change, black = areas to keep). Instruction:\n${prompt}\n\nAspect ${aspect}. Photoreal, sharp.`;
    } else {
      prompt = `${prompt}\n\nAspect ${aspect}. Photoreal, sharp, high detail, no text, no watermark.`;
    }

    try {
      const buf = await generateImage(prompt, model, refs);
      const version = await nextVersion(projectDir);
      const fileName = `image_v${version}.png`;
      const filePath = path.join(projectDir, fileName);
      await fs.writeFile(filePath, buf);
      // Persist the prompt + model alongside for history
      await fs.writeFile(
        path.join(projectDir, `image_v${version}.meta.json`),
        JSON.stringify({ version, prompt: body.prompt, model, aspect, ts: Date.now() }, null, 2),
      );
      res.json({
        ok: true,
        version,
        file_name: fileName,
        file_path: `/api/projects/${body.project_id}/files/${fileName}`,
        model,
      });
    } catch (err) {
      const msg = (err as Error).message;
      // eslint-disable-next-line no-console
      console.error('[image-pipeline] failed:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Lightweight model list — keep the same OpenRouter image models the video
  // pipeline knows about plus a couple of well-known generators.
  router.get('/api/v1/image/models', (_req: Request, res: Response) => {
    res.json({
      models: [
        { id: 'google/gemini-3.1-flash-image-preview', label: 'Nano Banana 2 (fast)', default: true },
        { id: 'openai/gpt-5.4-image-2', label: 'GPT Image 2' },
        { id: 'black-forest-labs/flux-1.1-pro', label: 'FLUX 1.1 Pro' },
        { id: 'stability-ai/stable-diffusion-3.5', label: 'Stable Diffusion 3.5' },
      ],
    });
  });
}
