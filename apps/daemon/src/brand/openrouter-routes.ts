// OpenRouter model listing — proxies /models/user using server-side env key.
// Cached in-memory for 5 minutes to avoid hammering OR on every modality switch.

import type { Request, Response, Router } from 'express';

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number | null;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    modality?: string | null;
  };
  pricing?: Record<string, string>;
}

interface CachedModels {
  ts: number;
  models: OpenRouterModel[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CachedModels | null = null;

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.models;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const r = await fetch(`${baseUrl}/models/user`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`openrouter ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = (await r.json()) as { data: OpenRouterModel[] };
  cache = { ts: Date.now(), models: data.data ?? [] };
  return cache.models;
}

export function registerOpenRouterRoutes(router: Router): void {
  router.get('/api/v1/openrouter/models', async (req: Request, res: Response) => {
    const modality = String(req.query.output ?? '').toLowerCase();
    const input = String(req.query.input ?? '').toLowerCase();
    try {
      let models = await fetchOpenRouterModels();
      if (modality) {
        models = models.filter((m) =>
          (m.architecture?.output_modalities ?? []).includes(modality),
        );
      }
      if (input) {
        models = models.filter((m) =>
          (m.architecture?.input_modalities ?? []).includes(input),
        );
      }
      // Slim payload — drop heavy fields web doesn't need.
      const slim = models.map((m) => ({
        id: m.id,
        name: m.name,
        description: (m.description ?? '').slice(0, 200),
        context_length: m.context_length ?? null,
        input_modalities: m.architecture?.input_modalities ?? [],
        output_modalities: m.architecture?.output_modalities ?? [],
        pricing: m.pricing
          ? { prompt: m.pricing.prompt, completion: m.pricing.completion }
          : undefined,
      }));
      res.status(200).json({ data: slim });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[openrouter] models fetch failed', (err as Error).message);
      res.status(502).json({ error: (err as Error).message, data: [] });
    }
  });
}
