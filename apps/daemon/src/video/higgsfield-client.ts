// Higgsfield MCP HTTP client. Talks JSON-RPC over a Streamable HTTP MCP
// endpoint (default https://higgsfield.ai/mcp). Used by the video pipeline
// as an alternative i2v provider — when tenant_brand.higgsfieldEnabled is
// true the pipeline routes per-shot video gen through this client instead
// of OpenRouter's /videos endpoint.
//
// Tool name reference (deferred-tool list confirmed on the MCP side):
//   - generate_video      → submit an i2v job
//   - generate_image      → text-to-image
//   - show_generations    → poll status, returns medias[]
//   - show_medias         → list all media for the workspace
//   - models_explore      → list models
//   - presets_show        → list cinematic presets
//   - show_characters     → list saved character refs
//   - virality_predictor  → score a media for virality
//   - balance             → check credits

interface McpToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

interface McpRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let rpcId = 1;

async function rpc<T>(
  endpoint: string,
  apiKey: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method,
      params,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`higgsfield mcp ${r.status}: ${text.slice(0, 300)}`);
  }
  const ct = r.headers.get('content-type') || '';
  // Streamable HTTP can return SSE — find the JSON-RPC line.
  let payload: McpRpcResponse<T>;
  if (ct.includes('text/event-stream')) {
    const text = await r.text();
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const dataLine = lines.reverse().find((l) => l.startsWith('data:'));
    if (!dataLine) throw new Error('higgsfield mcp: empty SSE response');
    payload = JSON.parse(dataLine.slice(5).trim()) as McpRpcResponse<T>;
  } else {
    payload = (await r.json()) as McpRpcResponse<T>;
  }
  if (payload.error) {
    throw new Error(`higgsfield mcp error ${payload.error.code}: ${payload.error.message}`);
  }
  if (payload.result === undefined) {
    throw new Error('higgsfield mcp: missing result');
  }
  return payload.result;
}

export async function callTool(
  endpoint: string,
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  return rpc<McpToolCallResult>(endpoint, apiKey, 'tools/call', {
    name,
    arguments: args,
  });
}

/**
 * Submit an image-to-video job. Returns the raw tool result so the caller
 * can extract whichever id/url the server provides — Higgsfield's schema
 * has evolved, so we don't lock to a specific field name.
 */
export async function generateVideo(
  endpoint: string,
  apiKey: string,
  args: {
    prompt: string;
    image_url?: string;        // first-frame reference (data: URI or http URL)
    duration_s?: number;
    aspect?: string;
    model?: string;
    preset?: string;
    character_id?: string;     // saved character ref (locked identity)
    seed?: number;
  },
): Promise<McpToolCallResult> {
  return callTool(endpoint, apiKey, 'generate_video', args as Record<string, unknown>);
}

/**
 * Poll a generation by id. Returns the structured content from the tool
 * call; caller pulls the media URL out of medias[] when status === ready.
 */
export async function pollGeneration(
  endpoint: string,
  apiKey: string,
  generationId: string,
): Promise<McpToolCallResult> {
  return callTool(endpoint, apiKey, 'show_generations', { id: generationId });
}

/**
 * Convenience helper: submit + poll until ready, return mp4 buffer.
 */
export async function renderVideoOnce(
  endpoint: string,
  apiKey: string,
  args: Parameters<typeof generateVideo>[2],
  opts: { pollIntervalMs?: number; maxAttempts?: number } = {},
): Promise<Buffer> {
  const submit = await generateVideo(endpoint, apiKey, args);
  // Extract a job id from any of the shapes the MCP might return.
  const raw = submit.structuredContent
    ?? (submit.content?.[0]?.text ? safeJson(submit.content[0].text) : null);
  const r = raw as Record<string, unknown> | null;
  const jobId = String(
    (r?.id || r?.job_id || r?.generation_id || r?.media_id || '') as string,
  );
  if (!jobId) throw new Error(`higgsfield generate_video: no job id returned (raw: ${JSON.stringify(raw).slice(0, 200)})`);

  const interval = opts.pollIntervalMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 120;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((res) => setTimeout(res, interval));
    const poll = await pollGeneration(endpoint, apiKey, jobId);
    const pRaw = poll.structuredContent
      ?? (poll.content?.[0]?.text ? safeJson(poll.content[0].text) : null);
    const p = pRaw as Record<string, unknown> | null;
    if (!p) continue;
    const status = String((p.status || p.state || '') as string).toLowerCase();
    if (status === 'failed' || status === 'error') {
      throw new Error(`higgsfield job failed: ${String((p.error || p.message || 'unknown') as string)}`);
    }
    if (status !== 'ready' && status !== 'completed' && status !== 'done') continue;
    const url = extractMediaUrl(p);
    if (!url) throw new Error(`higgsfield job ready but no url (keys: ${Object.keys(p).join(',')})`);
    const vidRes = await fetch(url);
    if (!vidRes.ok) throw new Error(`fetch higgsfield video ${vidRes.status}`);
    return Buffer.from(await vidRes.arrayBuffer());
  }
  throw new Error('higgsfield poll timeout');
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function extractMediaUrl(p: Record<string, unknown>): string | null {
  const direct = (p.url || p.video_url || p.mp4_url || p.output_url) as string | undefined;
  if (typeof direct === 'string' && direct) return direct;
  const medias = p.medias as unknown;
  if (Array.isArray(medias)) {
    for (const m of medias) {
      if (!m || typeof m !== 'object') continue;
      const mo = m as Record<string, unknown>;
      const u = (mo.url || mo.video_url || mo.mp4_url || mo.output_url) as string | undefined;
      if (typeof u === 'string' && u) return u;
    }
  }
  const outputs = p.outputs as unknown;
  if (Array.isArray(outputs)) {
    for (const o of outputs) {
      if (typeof o === 'string' && o.startsWith('http')) return o;
      if (o && typeof o === 'object') {
        const u = (o as Record<string, unknown>).url as string | undefined;
        if (typeof u === 'string' && u) return u;
      }
    }
  }
  return null;
}
