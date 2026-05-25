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
      const ctxOpts: { brandTone: string; brandDna: string; hivemindContext: string; voice?: string; projectId: string; hitlEnabled?: boolean } = {
        brandTone: brand.brandToneMd || '',
        brandDna: brand.brandDnaMd || '',
        hivemindContext,
        projectId: body.project_id,
        hitlEnabled: true,
      };
      if (voiceMatch) ctxOpts.voice = voiceMatch;
      const result = await renderVideo(brief, projectDir, ctxOpts, onProgress);

      send('done', {
        final_path: `/api/projects/${body.project_id}/files/final.mp4`,
        storyboard_path: 'storyboard.json',
      });
      res.end();
    } catch (err) {
      const msg = (err as Error).message;
      // eslint-disable-next-line no-console
      console.error('[video-pipeline] failed:', msg);
      send('error', { message: msg });
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
}
