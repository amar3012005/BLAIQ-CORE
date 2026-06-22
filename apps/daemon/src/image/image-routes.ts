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
import { getTenantBrand } from '../brand/brand-store.js';
import { hivemindRecall } from '../brand/hivemind-client.js';
import { listSpokespersons, saveSpokesperson, readSpokespersonImage } from './spokesperson-store.js';

const OR_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OR_KEY = (): string => process.env.OPENROUTER_API_KEY || '';

const PROJECTS_DIR = process.env.OD_DATA_DIR
  ? path.join(process.env.OD_DATA_DIR, 'projects')
  : path.join(process.cwd(), '.od', 'projects');

const DEFAULT_IMAGE_MODEL = process.env.BLAIQ_IMAGE_DEFAULT_MODEL
  || 'google/gemini-3.1-flash-image-preview';
const SCRIPT_MODEL = process.env.BLAIQ_VIDEO_SCRIPT_MODEL || 'anthropic/claude-sonnet-4.6';

async function orChat(messages: Array<{ role: string; content: string }>, model: string, maxTokens = 2000): Promise<string> {
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OR_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`openrouter ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  };
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || '';
}

async function enrichPrompt(
  brief: string,
  brandTone: string,
  brandDna: string,
  hivemindContext: string,
  aspect: string,
): Promise<string> {
  // Expand the user's terse brief into a richly-specified visual prompt
  // grounded in brand tone + DNA + Hivemind facts. Plain text out, no JSON.
  const system = `You are a senior art director. Transform the user's short brief into a single richly detailed visual prompt for a text-to-image model.

Output:
- Plain prose, one to two paragraphs, English.
- Specify subject, composition, framing, camera/lens feel, lighting, mood, color palette (use brand colors from Brand DNA verbatim where relevant), materials/textures, environmental details, and any typography/layout the brief implies.
- Photoreal, cinematic, sharp, no text/watermark/logo unless the brief asks for typography.
- Do NOT invent product names, customer quotes, or features beyond the Hivemind facts.
- No preamble. No headings. No "Sure, here is…". Output ONLY the prompt itself.`;
  const user = `User brief:
${brief}

Aspect ratio: ${aspect}

Brand DNA (visual identity, palette, materials):
${brandDna.slice(0, 2000)}

Brand tone (voice):
${brandTone.slice(0, 800)}

Hivemind org facts (use ONLY these for product/people/customer claims):
${hivemindContext.slice(0, 2000) || '(none)'}

Write the expanded visual prompt now.`;
  try {
    const out = await orChat(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      SCRIPT_MODEL,
      1800,
    );
    const trimmed = out.trim().replace(/^["'`]+|["'`]+$/g, '');
    return trimmed || brief;
  } catch (err) {
    console.warn('[image-pipeline] prompt enrich failed:', (err as Error).message);
    return brief;
  }
}

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

    const rawBrief = body.prompt.trim();
    let prompt = rawBrief;
    let enrichedPrompt = '';
    if (refs.length === 1 && body.ref_image) {
      prompt = `Refine the attached image based on this instruction (keep identity, composition, palette intact unless instructed otherwise):\n${rawBrief}\n\nAspect ${aspect}. Photoreal, sharp.`;
    } else if (refs.length === 2) {
      prompt = `Refine the FIRST attached image using the SECOND attached image as an EDIT MASK (white = areas to change, black = areas to keep). Apply the instruction ONLY inside the white regions; leave black regions byte-for-byte unchanged.\n\nInstruction:\n${rawBrief}\n\nAspect ${aspect}. Photoreal, sharp.`;
    } else {
      // First gen (no ref) — enrich the user's brief with brand DNA + Hivemind
      // facts so the model has the rich context the user expects.
      try {
        const brand = await getTenantBrand(authed.tenantId);
        let hivemindContext = '';
        if (brand.hivemindEnabled && brand.hivemindApiKey) {
          const recall = await hivemindRecall(
            brand.hivemindUrl,
            brand.hivemindApiKey,
            rawBrief,
            6,
          );
          if (recall.ok && recall.text) hivemindContext = recall.text.slice(0, 4000);
        }
        enrichedPrompt = await enrichPrompt(rawBrief, brand.brandToneMd || '', brand.brandDnaMd || '', hivemindContext, aspect);
      } catch (err) {
        console.warn('[image-pipeline] enrich path failed:', (err as Error).message);
      }
      const finalBrief = enrichedPrompt || rawBrief;
      prompt = `${finalBrief}\n\nAspect ${aspect}. Photoreal, sharp, high detail, no text overlay or watermark unless the prompt explicitly asks for typography.`;
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
        JSON.stringify({
          version,
          prompt: rawBrief,
          enriched_prompt: enrichedPrompt || undefined,
          model,
          aspect,
          had_ref: Boolean(body.ref_image),
          had_mask: Boolean(body.mask),
          ts: Date.now(),
        }, null, 2),
      );
      res.json({
        ok: true,
        version,
        file_name: fileName,
        file_path: `/api/projects/${body.project_id}/files/${fileName}`,
        model,
        enriched_prompt: enrichedPrompt || undefined,
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

  // ── Spokespersons: pin a reusable on-brand presenter (tenant-scoped) ──
  // List the tenant's pinned spokespersons.
  router.get('/api/v1/spokespersons', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) { res.status(401).json({ error: 'not authenticated' }); return; }
    res.json({ spokespersons: await listSpokespersons(authed.tenantId) });
  });

  // Pin a new spokesperson from a rendered image (data URI).
  router.post('/api/v1/spokespersons', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) { res.status(401).json({ error: 'not authenticated' }); return; }
    const body = (req.body ?? {}) as { name?: string; image_data?: string };
    try {
      const entry = await saveSpokesperson(authed.tenantId, body.name || '', body.image_data || '');
      res.json({ ok: true, spokesperson: { id: entry.id, name: entry.name, url: `/api/v1/spokespersons/${entry.id}/image`, created_at: entry.created_at } });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Serve a pinned spokesperson's image.
  router.get('/api/v1/spokespersons/:id/image', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) { res.status(401).json({ error: 'not authenticated' }); return; }
    const buf = await readSpokespersonImage(authed.tenantId, String(req.params.id || ''));
    if (!buf) { res.status(404).json({ error: 'not found' }); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(buf);
  });
}
