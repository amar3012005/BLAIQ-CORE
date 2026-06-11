// Minimal HTTP MCP client for the Poool ERP MCP gateway.
//
// Mirrors the hivemind-client pattern: JSON-RPC 2.0 over HTTP with SSE
// envelope fallback. The Poool MCP exposes a small surface (`poool_api_*`
// for the OCA-style ORM, plus Prism BSL `query_model` for analytics) — we
// wrap each as a typed helper so the Ops Brain and daemon-side
// admin/erp probes never hand-build JSON-RPC envelopes.

interface McpJsonRpcResponse<T = unknown> {
  jsonrpc?: '2.0';
  id?: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolsCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

let nextId = 1;

export interface PoolCallResult<T = unknown> {
  ok: boolean;
  data?: T | undefined;
  text: string;
  error?: string | undefined;
}

export async function pooolApiCall<T = unknown>(
  url: string,
  apiKey: string,
  method: string,
  params: unknown,
): Promise<McpJsonRpcResponse<T>> {
  const body = { jsonrpc: '2.0', id: nextId++, method, params };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
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

function unwrap<T = unknown>(resp: McpJsonRpcResponse<ToolsCallResult>): PoolCallResult<T> {
  if (resp.error) return { ok: false, text: '', error: resp.error.message };
  const content = resp.result?.content ?? [];
  const text = content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n\n')
    .trim();
  const data = resp.result?.structuredContent as T | undefined;
  return { ok: true, text, data };
}

async function callTool<T = unknown>(
  url: string,
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<PoolCallResult<T>> {
  if (!url) return { ok: false, text: '', error: 'missing url' };
  try {
    const resp = await pooolApiCall<ToolsCallResult>(url, apiKey, 'tools/call', {
      name,
      arguments: args,
    });
    return unwrap<T>(resp);
  } catch (err) {
    return { ok: false, text: '', error: (err as Error).message };
  }
}

export function pooolApiSearch<T = unknown>(
  url: string,
  apiKey: string,
  model: string,
  filters: unknown,
  scopes?: string[],
  limit?: number,
  offset?: number,
): Promise<PoolCallResult<T>> {
  const args: Record<string, unknown> = { model, filters };
  if (scopes) args.scopes = scopes;
  if (typeof limit === 'number') args.limit = limit;
  if (typeof offset === 'number') args.offset = offset;
  return callTool<T>(url, apiKey, 'poool_api_search', args);
}

export function pooolApiRead<T = unknown>(
  url: string,
  apiKey: string,
  model: string,
  id: number | string,
): Promise<PoolCallResult<T>> {
  return callTool<T>(url, apiKey, 'poool_api_read', { model, id });
}

export function pooolApiList<T = unknown>(
  url: string,
  apiKey: string,
  model: string,
  scopes?: string[],
  limit?: number,
  page?: number,
): Promise<PoolCallResult<T>> {
  const args: Record<string, unknown> = { model };
  if (scopes) args.scopes = scopes;
  if (typeof limit === 'number') args.limit = limit;
  if (typeof page === 'number') args.page = page;
  return callTool<T>(url, apiKey, 'poool_api_list', args);
}

export function pooolQueryAnalytics<T = unknown>(
  url: string,
  apiKey: string,
  modelName: string,
  dimensions: string[],
  measures: string[],
  filters?: unknown,
): Promise<PoolCallResult<T>> {
  const args: Record<string, unknown> = {
    model_name: modelName,
    dimensions,
    measures,
  };
  if (filters !== undefined) args.filters = filters;
  return callTool<T>(url, apiKey, 'query_model', args);
}
