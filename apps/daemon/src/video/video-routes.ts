// Video pipeline routes — POST /api/v1/video/render with SSE progress.

import type { Request, Response, Router } from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { getTenantBrand } from '../brand/brand-store.js';
import { hivemindRecall } from '../brand/hivemind-client.js';
import { renderVideo, type VideoBrief, type ProgressEvent } from './pipeline.js';
import { submitReply, type HitlGate, type HitlReply } from './hitl-store.js';

const PROJECTS_DIR = process.env.OD_DATA_DIR
  ? path.join(process.env.OD_DATA_DIR, 'projects')
  : path.join(process.cwd(), '.od', 'projects');

export function registerVideoRoutes(router: Router): void {
  router.post('/api/v1/video/render', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const body = (req.body ?? {}) as {
      project_id?: string;
      subject?: string;
      style?: string;
      voiceover?: boolean;
      music?: boolean;
      aspect?: string;
      length?: number;
      user_prompt?: string;
    };
    if (!body.project_id || !body.subject) {
      res.status(400).json({ error: 'project_id and subject required' });
      return;
    }

    const brief: VideoBrief = {
      subject: body.subject,
      style: body.style || 'cinematic',
      voiceover: body.voiceover !== false,
      music: body.music !== false,
      aspect: body.aspect || '16:9',
      length: typeof body.length === 'number' ? body.length : 30,
      userPrompt: body.user_prompt || '',
    };

    const projectDir = path.join(PROJECTS_DIR, body.project_id);
    await fs.mkdir(projectDir, { recursive: true });

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onProgress = (e: ProgressEvent): void => {
      send('progress', e);
    };
    // SSE heartbeat: send a comment line every 15s so reverse proxies
    // (Coolify nginx, Cloudflare, etc.) don't drop the connection during
    // slow stages (subject sheet gen, i2v polling).
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* socket closed */ }
    }, 15000);
    res.on('close', () => clearInterval(heartbeat));

    try {
      // Stage 1+2: brand + Hivemind recall
      const brand = await getTenantBrand(authed.tenantId);
      send('progress', { stage: 'recall', status: 'start' });
      let hivemindContext = '';
      if (brand.hivemindEnabled && brand.hivemindApiKey) {
        const recall = await hivemindRecall(
          brand.hivemindUrl,
          brand.hivemindApiKey,
          `${brief.subject} ${brief.userPrompt}`,
          8,
        );
        if (recall.ok && recall.text) hivemindContext = recall.text.slice(0, 6000);
      }
      send('progress', { stage: 'recall', status: 'done', chars: hivemindContext.length });

      // Stages 3-7
      const voiceMatch = brand.brandToneMd.match(/voice[: ]+([a-z0-9-]+)/i)?.[1];
      const ctxOpts: {
        brandTone: string;
        brandDna: string;
        hivemindContext: string;
        voice?: string;
        projectId: string;
        hitlEnabled?: boolean;
        higgsfield?: { url: string; apiKey: string };
      } = {
        brandTone: brand.brandToneMd || '',
        brandDna: brand.brandDnaMd || '',
        hivemindContext,
        projectId: body.project_id,
        hitlEnabled: true,
      };
      if (voiceMatch) ctxOpts.voice = voiceMatch;
      if (brand.higgsfieldEnabled && brand.higgsfieldApiKey) {
        ctxOpts.higgsfield = {
          url: brand.higgsfieldUrl || 'https://higgsfield.ai/mcp',
          apiKey: brand.higgsfieldApiKey,
        };
      }
      const result = await renderVideo(brief, projectDir, ctxOpts, onProgress);

      send('done', {
        final_path: `/api/projects/${body.project_id}/files/final.mp4`,
        storyboard_path: 'storyboard.json',
      });
      clearInterval(heartbeat);
      res.end();
    } catch (err) {
      const msg = (err as Error).message;
      // eslint-disable-next-line no-console
      console.error('[video-pipeline] failed:', msg);
      send('error', { message: msg });
      clearInterval(heartbeat);
      res.end();
    }
  });

  // POST /api/v1/video/:projectId/hitl/:gate — resolve a pending HITL gate.
  router.post('/api/v1/video/:projectId/hitl/:gate', (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const projectId = req.params.projectId;
    const gate = req.params.gate as HitlGate;
    if (!projectId || !['discovery', 'script', 'references', 'frames'].includes(gate)) {
      res.status(400).json({ error: 'invalid projectId or gate' });
      return;
    }
    const body = (req.body ?? {}) as Partial<HitlReply>;
    const reply: HitlReply = {
      approve: body.approve === true,
      notes: typeof body.notes === 'string' ? body.notes : '',
      answers: typeof body.answers === 'object' && body.answers ? body.answers : {},
    };
    const ok = submitReply(projectId, gate, reply);
    if (!ok) {
      res.status(404).json({ error: 'no pending HITL gate for this projectId+gate' });
      return;
    }
    res.json({ ok: true });
  });

  // POST /api/v1/video/:projectId/asset-edit
  //   body: { file_name: string, prompt: string, masked_ref: string (data URI) }
  // Refines a single video-pipeline asset (subject sheet, scenery sheet, or
  // shot frame) using image-to-image with the user's masked reference. The
  // result OVERWRITES the original file so subsequent stages and the UI's
  // cache-busted reload pick up the edited version.
  router.post('/api/v1/video/:projectId/asset-edit', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const projectId = req.params.projectId;
    const body = (req.body ?? {}) as { file_name?: string; prompt?: string; masked_ref?: string };
    if (!projectId || !body.file_name || !body.prompt || !body.masked_ref) {
      res.status(400).json({ error: 'projectId, file_name, prompt, masked_ref required' });
      return;
    }
    // Whitelist filenames the pipeline produces (no path traversal).
    if (!/^(subject_[A-Za-z0-9_-]+_sheet|scenery_sheet|ref_shot\d+)\.png$/.test(body.file_name)) {
      res.status(400).json({ error: 'invalid file_name' });
      return;
    }
    const projectDir = path.join(PROJECTS_DIR, projectId);
    const filePath = path.join(projectDir, body.file_name);
    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ error: 'asset not found' });
      return;
    }
    try {
      const OR_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      const OR_KEY = process.env.OPENROUTER_API_KEY || '';
      const IMAGE_MODEL = process.env.BLAIQ_VIDEO_IMAGE_MODEL || 'google/gemini-3.1-flash-image-preview';
      if (!OR_KEY) throw new Error('OPENROUTER_API_KEY not set');
      const refineInstruction = `Refine the attached image. The image has a region painted out to neutral grey — fill ONLY that hole, leaving every other pixel byte-for-byte unchanged. Match identity, palette, lighting, and style of the surrounding area exactly.\n\nFill instruction:\n${body.prompt}\n\nPhotoreal, sharp.`;
      const r = await fetch(`${OR_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          modalities: ['image', 'text'],
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: refineInstruction },
              { type: 'image_url', image_url: { url: body.masked_ref } },
            ],
          }],
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`openrouter image ${r.status}: ${text.slice(0, 300)}`);
      }
      const data = (await r.json()) as {
        choices?: Array<{ message?: {
          content?: string | Array<{ image_url?: { url?: string } | string }>;
          images?: Array<{ image_url?: { url?: string } | string; url?: string }>;
        } }>;
      };
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('no message in response');
      const decodeDataOrUrl = async (u: string): Promise<Buffer> => {
        if (u.startsWith('data:')) {
          const m = u.match(/^data:[^;]+;base64,(.+)$/);
          if (m && m[1]) return Buffer.from(m[1], 'base64');
          throw new Error('malformed data URI');
        }
        const rr = await fetch(u);
        if (!rr.ok) throw new Error(`fetch image ${rr.status}`);
        return Buffer.from(await rr.arrayBuffer());
      };
      let buf: Buffer | null = null;
      for (const img of msg.images ?? []) {
        const u = typeof img.image_url === 'string' ? img.image_url
          : (img.image_url as { url?: string } | undefined)?.url ?? img.url;
        if (u) { buf = await decodeDataOrUrl(u); break; }
      }
      if (!buf && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          const u = typeof part.image_url === 'string' ? part.image_url
            : (part.image_url as { url?: string } | undefined)?.url;
          if (u) { buf = await decodeDataOrUrl(u); break; }
        }
      }
      if (!buf && typeof msg.content === 'string') {
        const dataUri = msg.content.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/);
        if (dataUri && dataUri[1]) buf = Buffer.from(dataUri[1], 'base64');
      }
      if (!buf) throw new Error('no image returned');
      await fs.writeFile(filePath, buf);
      res.json({
        ok: true,
        file_path: `/api/projects/${projectId}/files/${body.file_name}?v=${Date.now()}`,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[video-asset-edit] failed:', (err as Error).message);
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
