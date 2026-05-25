// Minimal HTTP MCP client for Hivemind.
// Used in startChatRun as a preflight: query company brain with user
// message → inject result into system prompt. Works for every agent
// (Claude CLI, Codex, Gemini, API fallback) since the recall happens
// daemon-side before spawn.

interface McpJsonRpcResponse<T = unknown> {
  jsonrpc?: '2.0';
  id?: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolsCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

let nextId = 1;

async function postMcp<T>(
  url: string,
  apiKey: string,
  method: string,
  params: unknown,
): Promise<McpJsonRpcResponse<T>> {
  const body = {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  // MCP can return either plain JSON or an SSE stream with a `data:` line.
  // Parse both shapes.
  try {
    return JSON.parse(text) as McpJsonRpcResponse<T>;
  } catch {
    const m = text.match(/data:\s*(.+)/);
    if (m && m[1]) {
      try {
        return JSON.parse(m[1]) as McpJsonRpcResponse<T>;
      } catch {
        // fallthrough
      }
    }
    return { error: { code: -1, message: text.slice(0, 200) } };
  }
}

export interface HivemindRecallResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Call `hivemind_recall` with the user query. Returns concatenated text
 * content from the tool result. Treats every failure mode (network,
 * non-200, JSON-RPC error, empty result) as non-fatal — the caller
 * just skips the injection block.
 */
export async function hivemindRecall(
  url: string,
  apiKey: string,
  query: string,
  limit = 8,
): Promise<HivemindRecallResult> {
  if (!url || !apiKey || !query || query.trim().length === 0) {
    return { ok: false, text: '', error: 'missing url/key/query' };
  }
  try {
    const resp = await postMcp<ToolsCallResult>(url, apiKey, 'tools/call', {
      name: 'hivemind_recall',
      arguments: { query, limit },
    });
    if (resp.error) {
      return { ok: false, text: '', error: resp.error.message };
    }
    const content = resp.result?.content ?? [];
    const text = content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n\n')
      .trim();
    if (!text) {
      return { ok: true, text: '', error: 'empty result' };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: '', error: (err as Error).message };
  }
}

/** Save a fact to Hivemind. Non-blocking; failures are logged not thrown. */
export async function hivemindSave(
  url: string,
  apiKey: string,
  fact: string,
  tags: string[] = [],
): Promise<{ ok: boolean; error?: string }> {
  if (!url || !apiKey || !fact) return { ok: false, error: 'missing args' };
  try {
    const resp = await postMcp(url, apiKey, 'tools/call', {
      name: 'hivemind_save_memory',
      arguments: { content: fact, tags },
    });
    if (resp.error) return { ok: false, error: resp.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
