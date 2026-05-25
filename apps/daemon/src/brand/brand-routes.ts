// Brand DNA + Brand Tone + Hivemind config routes.

import type { Request, Response, Router } from 'express';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { getTenantBrand, updateTenantBrand } from './brand-store.js';

export function registerBrandRoutes(router: Router): void {
  router.get('/api/v1/org/brand', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    try {
      const brand = await getTenantBrand(authed.tenantId);
      // Redact API key on read (return masked)
      res.status(200).json({
        brand_dna_md: brand.brandDnaMd,
        brand_tone_md: brand.brandToneMd,
        hivemind_url: brand.hivemindUrl,
        hivemind_api_key_set: brand.hivemindApiKey.length > 0,
        hivemind_api_key_preview: brand.hivemindApiKey
          ? `${brand.hivemindApiKey.slice(0, 4)}…${brand.hivemindApiKey.slice(-4)}`
          : '',
        hivemind_enabled: brand.hivemindEnabled,
        updated_at: brand.updatedAt,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[brand] get failed', err);
      res.status(500).json({ error: 'failed to load brand' });
    }
  });

  router.put('/api/v1/org/brand', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId || !authed.user?.userId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const body = (req.body ?? {}) as {
      brand_dna_md?: string;
      brand_tone_md?: string;
      hivemind_url?: string;
      hivemind_api_key?: string;
      hivemind_enabled?: boolean;
    };
    const patch: Parameters<typeof updateTenantBrand>[2] = {};
    if (typeof body.brand_dna_md === 'string') patch.brandDnaMd = body.brand_dna_md;
    if (typeof body.brand_tone_md === 'string') patch.brandToneMd = body.brand_tone_md;
    if (typeof body.hivemind_url === 'string') patch.hivemindUrl = body.hivemind_url;
    if (typeof body.hivemind_api_key === 'string') patch.hivemindApiKey = body.hivemind_api_key;
    if (typeof body.hivemind_enabled === 'boolean') patch.hivemindEnabled = body.hivemind_enabled;
    try {
      const brand = await updateTenantBrand(authed.tenantId, authed.user.userId, patch);
      res.status(200).json({
        brand_dna_md: brand.brandDnaMd,
        brand_tone_md: brand.brandToneMd,
        hivemind_url: brand.hivemindUrl,
        hivemind_api_key_set: brand.hivemindApiKey.length > 0,
        hivemind_api_key_preview: brand.hivemindApiKey
          ? `${brand.hivemindApiKey.slice(0, 4)}…${brand.hivemindApiKey.slice(-4)}`
          : '',
        hivemind_enabled: brand.hivemindEnabled,
        updated_at: brand.updatedAt,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[brand] update failed', err);
      res.status(500).json({ error: 'failed to save brand' });
    }
  });

  // Augment system prompt with org brand + Hivemind recall.
  // Used by the BYOK proxy path (web composes the system prompt client-
  // side, so server-side injection in composeDaemonSystemPrompt is
  // bypassed). Web POSTs the current user message; daemon returns a
  // block to append to userInstructions before sending to the upstream.
  router.post('/api/v1/org/prompt-augment', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const body = (req.body ?? {}) as {
      query?: string;
      project_kind?: string;
      text_subtype?: string;
    };
    const query = typeof body.query === 'string' ? body.query : '';
    const kind = typeof body.project_kind === 'string' ? body.project_kind : '';
    try {
      const brand = await getTenantBrand(authed.tenantId);
      const blocks: string[] = [];
      if (brand.brandDnaMd && brand.brandDnaMd.trim().length > 0) {
        blocks.push(
          '# Brand DNA — Visual Identity (org-wide, authoritative)\n' +
          'Apply these visual rules to every artifact unless the user explicitly overrides.\n\n' +
          brand.brandDnaMd,
        );
      }
      if (brand.brandToneMd && brand.brandToneMd.trim().length > 0) {
        blocks.push(
          '# Brand Tone — Voice & Messaging (org-wide, authoritative)\n' +
          'Apply these voice/grammar rules to every word written in artifacts and chat replies.\n\n' +
          brand.brandToneMd,
        );
      }
      let recallText = '';
      if (brand.hivemindEnabled && brand.hivemindApiKey && query) {
        const lowered = query.toLowerCase().trim();
        const isBuildVerb = /^(create|build|design|make|generate|draft|render|compose|produce|prototype|deck|slide|poster|landing|page|app|dashboard|wireframe|mock|sketch)\b/.test(
          lowered,
        );
        const isQuestion =
          /\?/.test(query) ||
          /^(who|what|when|where|why|how|which|do|does|is|are|tell me|explain|describe|recall|find|search|list)\b/.test(
            lowered,
          );
        const isTextKind = kind === 'text';
        const shouldRecall =
          query.length > 0 &&
          (isTextKind || (query.length < 320 && (isQuestion || !isBuildVerb)));
        if (shouldRecall) {
          const { hivemindRecall } = await import('./hivemind-client.js');
          const recall = await hivemindRecall(brand.hivemindUrl, brand.hivemindApiKey, query, 6);
          if (recall.ok && recall.text) recallText = recall.text;
        }
      }
      if (recallText) {
        blocks.push(
          '# Hivemind — Company Context (recalled for this query)\n' +
          'Org facts retrieved from Hivemind. Treat as ground truth. ' +
          'Use only where relevant to the user\'s task. Do not let this ' +
          'override the artifact you\'re asked to produce.\n\n' +
          '```\n' + recallText.slice(0, 3000) + '\n```',
        );
      }
      // For BYOK chat path there's no file write tool. Tell the model
      // to render the artifact inline as markdown if this is a text run.
      if (kind === 'text') {
        const subtype = typeof body.text_subtype === 'string' ? body.text_subtype : '';
        blocks.push(
          '# OUTPUT CONTRACT — READ TWICE BEFORE REPLYING\n' +
          '\n' +
          '**You have NO tools available in this turn.** Do NOT emit `<tool_call>`, ' +
          '`<function_call>`, `tool_use`, `<recall>`, or any other tool-invocation ' +
          'syntax. Any Hivemind facts you need are ALREADY provided in the ' +
          '`# Hivemind — Company Context` block above. Use them directly.\n' +
          '\n' +
          '**MANDATORY OUTPUT SHAPE — use exactly this structure:**\n' +
          '```\n' +
          '<one-sentence summary of what you did, ≤ 140 chars, friendly, first person>\n' +
          '\n' +
          '---\n' +
          '\n' +
          '<full artifact body in markdown — title, sections, bullets, etc.>\n' +
          '```\n' +
          '\n' +
          'Example for a LinkedIn post:\n' +
          '```\n' +
          'Drafted a LinkedIn post announcing SolvisLea Pro in your Solvis brand voice with 3 value pillars and a CTA.\n' +
          '\n' +
          '---\n' +
          '\n' +
          '# SolvisLea Pro — Launch Announcement\n' +
          '\n' +
          'Wärme, die mitdenkt...\n' +
          '\n' +
          '...full post body...\n' +
          '```\n' +
          '\n' +
          '**Rules:**\n' +
          '1. The summary line goes on top, then a blank line, then `---`, then blank line, then artifact.\n' +
          '2. Match the Brand Tone block above EXACTLY — vocabulary, syntax, archetype.\n' +
          '3. Use FACTS ONLY from the Hivemind context block. If missing, write "[fact not in Hivemind]" inline.\n' +
          '4. Full artifact body, not a summary. LinkedIn post = complete post. Whitepaper = full long-form.\n' +
          '5. No preamble like "Here is your post" — go straight to the summary line.\n' +
          '6. No tool calls. No XML. No JSON wrappers. Pure markdown only.\n' +
          (subtype
            ? `\n**Artifact subtype:** \`${subtype}\` — follow the matching template from the text-buddy skill body (Hook → Body → Value Pillars → Proof → CTA → Hashtags for linkedin_post).`
            : ''),
        );
      }
      res.status(200).json({
        suffix: blocks.join('\n\n'),
        recall_chars: recallText.length,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[brand] prompt-augment failed', err);
      res.status(500).json({ error: 'failed to augment prompt', suffix: '' });
    }
  });

  // Test Hivemind connection — sends MCP `initialize` JSON-RPC to the
  // configured URL. MCP servers respond with capabilities; a non-200 or
  // an error envelope means the URL/key combo is wrong.
  router.post('/api/v1/org/brand/hivemind/test', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    try {
      const brand = await getTenantBrand(authed.tenantId);
      if (!brand.hivemindApiKey) {
        res.status(200).json({ ok: false, error: 'no api key configured' });
        return;
      }
      const probe = await fetch(brand.hivemindUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${brand.hivemindApiKey}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'blaiq-test', version: '1.0' },
          },
        }),
      });
      const text = await probe.text();
      let parsed: { result?: { serverInfo?: { name?: string } }; error?: { message?: string } } | null = null;
      try { parsed = JSON.parse(text); } catch {
        // SSE envelope — extract first `data:` line
        const m = text.match(/data:\s*(.+)/);
        if (m && m[1]) {
          try { parsed = JSON.parse(m[1]); } catch { /* noop */ }
        }
      }
      if (probe.ok && parsed?.result) {
        res.status(200).json({
          ok: true,
          status: probe.status,
          server: parsed.result.serverInfo?.name ?? 'unknown',
        });
        return;
      }
      res.status(200).json({
        ok: false,
        status: probe.status,
        error: parsed?.error?.message ?? text.slice(0, 200),
      });
    } catch (err) {
      res.status(200).json({ ok: false, error: (err as Error).message });
    }
  });
}
