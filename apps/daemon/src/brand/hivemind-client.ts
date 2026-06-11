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
  projectId?: string,
  memoryType?: string,
): Promise<HivemindRecallResult> {
  if (!url || !apiKey || !query || query.trim().length === 0) {
    return { ok: false, text: '', error: 'missing url/key/query' };
  }
  try {
    const args: Record<string, unknown> = { query, limit };
    if (projectId) args.project_id = projectId;
    if (memoryType) args.memory_type = memoryType;
    const resp = await postMcp<ToolsCallResult>(url, apiKey, 'tools/call', {
      name: 'hivemind_recall',
      arguments: args,
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
  projectId?: string,
  memoryType?: string,
  title?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!url || !apiKey || !fact) return { ok: false, error: 'missing args' };
  try {
    const args: Record<string, unknown> = { content: fact, tags };
    if (projectId) args.project_id = projectId;
    if (memoryType) args.memory_type = memoryType;
    if (title) args.title = title;
    const resp = await postMcp(url, apiKey, 'tools/call', {
      name: 'hivemind_save_memory',
      arguments: args,
    });
    if (resp.error) return { ok: false, error: resp.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface HivemindListResult {
  ok: boolean;
  text: string;
  error?: string;
}

/** List memories scoped to a project, optionally filtered. */
export async function hivemindListByProject(
  url: string,
  apiKey: string,
  projectId: string,
  filters?: { memoryType?: string; tags?: string[]; limit?: number },
): Promise<HivemindListResult> {
  if (!url || !apiKey || !projectId) {
    return { ok: false, text: '', error: 'missing url/key/projectId' };
  }
  try {
    const args: Record<string, unknown> = { project_id: projectId };
    if (filters?.memoryType) args.memory_type = filters.memoryType;
    if (filters?.tags && filters.tags.length > 0) args.tags = filters.tags;
    if (typeof filters?.limit === 'number') args.limit = filters.limit;
    const resp = await postMcp<ToolsCallResult>(url, apiKey, 'tools/call', {
      name: 'hivemind_list_memories',
      arguments: args,
    });
    if (resp.error) return { ok: false, text: '', error: resp.error.message };
    const content = resp.result?.content ?? [];
    const text = content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n\n')
      .trim();
    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: '', error: (err as Error).message };
  }
}

export interface HivemindTraverseResult {
  ok: boolean;
  text: string;
  error?: string;
}

/** Traverse the memory graph from a seed memory id. */
export async function hivemindTraverse(
  url: string,
  apiKey: string,
  memoryId: string,
  depth = 2,
  relationship: string = 'all',
): Promise<HivemindTraverseResult> {
  if (!url || !apiKey || !memoryId) {
    return { ok: false, text: '', error: 'missing url/key/memoryId' };
  }
  try {
    const resp = await postMcp<ToolsCallResult>(url, apiKey, 'tools/call', {
      name: 'hivemind_traverse_graph',
      arguments: { memory_id: memoryId, depth, relationship },
    });
    if (resp.error) return { ok: false, text: '', error: resp.error.message };
    const content = resp.result?.content ?? [];
    const text = content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n\n')
      .trim();
    return { ok: true, text };
  } catch (err) {
    return { ok: false, text: '', error: (err as Error).message };
  }
}
