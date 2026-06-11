// BLAIQ daemon ClickUp routes — provides Ops Brain (and the BLAIQ web UI)
// with deep bidirectional ClickUp integration on top of the Composio
// connector configured at apps/daemon/src/connectors/composio-descriptions.ts.
//
// Endpoints (all under /api/v1/org/clickup):
//   POST /task   — create a ClickUp task via CLICKUP_CREATE_TASK.
//   GET  /lists  — list available ClickUp lists for project pickers.
//   POST /sync   — return recent tasks across configured lists for the
//                  Ops Brain poller to upsert into ops.tasks.
//
// All endpoints require an authenticated tenant (X-Tenant-Id is injected
// by the admin proxy or by the standard Supabase auth middleware on the
// BLAIQ web surface). Writes bypass the connector safety policy in
// connectors/service.ts because ClickUp task creation is intentionally a
// mutating call — we call the Composio provider directly with the stored
// per-tenant credentials.

import type { Express, Request, Response } from 'express';

import type { BoundedJsonObject, BoundedJsonValue } from '../live-artifacts/schema.js';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { composioConnectorProvider } from '../connectors/composio.js';
import { connectorService, ConnectorServiceError } from '../connectors/service.js';

const CLICKUP_CONNECTOR_ID = 'clickup';

const CLICKUP_TOOL_CREATE_TASK = 'CLICKUP_CREATE_TASK';
const CLICKUP_TOOL_GET_LISTS = 'CLICKUP_GET_LISTS';
const CLICKUP_TOOL_GET_TASKS = 'CLICKUP_GET_TASKS';

interface CreateTaskBody {
  list_id?: unknown;
  name?: unknown;
  description?: unknown;
  assignees?: unknown;
}

interface SyncBody {
  list_ids?: unknown;
  updated_since?: unknown;
}

function requireTenant(req: Request, res: Response): string | null {
  const tenantId = (req as AuthenticatedRequest).tenantId
    ?? (req as AuthenticatedRequest).user?.tenantId
    ?? (req.header('x-tenant-id') ?? undefined);
  if (!tenantId || typeof tenantId !== 'string') {
    res.status(401).json({ error: 'tenant context missing' });
    return null;
  }
  return tenantId;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length > 0 ? items : undefined;
}

function reportConnectorError(res: Response, err: unknown): void {
  if (err instanceof ConnectorServiceError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details ?? null });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error('[clickup-routes] error:', message);
  res.status(502).json({ error: 'CLICKUP_UPSTREAM_ERROR', message });
}

async function executeClickupTool(toolName: string, input: BoundedJsonObject, signal?: AbortSignal): Promise<BoundedJsonObject> {
  const definition = await connectorService.getHydratedDefinition(CLICKUP_CONNECTOR_ID, signal);
  if (!definition) {
    throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'ClickUp connector is not registered', 404);
  }
  const tool = definition.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', `ClickUp tool ${toolName} is not exposed`, 404, { toolName });
  }
  const credential = connectorService.getCredential(CLICKUP_CONNECTOR_ID);
  if (!credential) {
    throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'ClickUp is not connected for this workspace', 403);
  }
  return composioConnectorProvider.execute(definition, tool, input, credential.credentials, signal);
}

async function handleCreateTask(req: Request, res: Response): Promise<void> {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;

  const body = (req.body ?? {}) as CreateTaskBody;
  const listId = asString(body.list_id);
  const name = asString(body.name);
  if (!listId || !name) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'list_id and name are required' });
    return;
  }

  const input: BoundedJsonObject = { list_id: listId, name };
  const description = asString(body.description);
  if (description !== undefined) input.description = description;
  const assignees = asStringArray(body.assignees);
  if (assignees !== undefined) input.assignees = assignees;

  try {
    const output = await executeClickupTool(CLICKUP_TOOL_CREATE_TASK, input);
    const data = (output.data ?? {}) as BoundedJsonObject;
    const externalId = asString(data.id);
    res.status(200).json({
      ok: true,
      tenant_id: tenantId,
      external_id: externalId ?? null,
      task: data,
    });
  } catch (err) {
    reportConnectorError(res, err);
  }
}

async function handleListLists(req: Request, res: Response): Promise<void> {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;

  try {
    const output = await executeClickupTool(CLICKUP_TOOL_GET_LISTS, {});
    const data = (output.data ?? {}) as BoundedJsonObject;
    const lists = Array.isArray(data.lists) ? (data.lists as BoundedJsonValue[]) : [];
    res.status(200).json({ ok: true, tenant_id: tenantId, lists });
  } catch (err) {
    reportConnectorError(res, err);
  }
}

async function handleSync(req: Request, res: Response): Promise<void> {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;

  const body = (req.body ?? {}) as SyncBody;
  let listIds = asStringArray(body.list_ids);
  if (!listIds) {
    // No explicit list filter — discover them so the poller can still work.
    try {
      const listsOutput = await executeClickupTool(CLICKUP_TOOL_GET_LISTS, {});
      const listsData = (listsOutput.data ?? {}) as BoundedJsonObject;
      const raw = Array.isArray(listsData.lists) ? (listsData.lists as BoundedJsonValue[]) : [];
      listIds = raw
        .map((item) => (item !== null && typeof item === 'object' && !Array.isArray(item) ? asString((item as BoundedJsonObject).id) : undefined))
        .filter((id): id is string => id !== undefined);
    } catch (err) {
      reportConnectorError(res, err);
      return;
    }
  }

  const aggregated: BoundedJsonValue[] = [];
  try {
    for (const listId of listIds ?? []) {
      const input: BoundedJsonObject = { list_id: listId };
      const updatedSince = asString(body.updated_since);
      if (updatedSince !== undefined) input.date_updated_gt = updatedSince;
      const output = await executeClickupTool(CLICKUP_TOOL_GET_TASKS, input);
      const data = (output.data ?? {}) as BoundedJsonObject;
      const tasks = Array.isArray(data.tasks) ? (data.tasks as BoundedJsonValue[]) : [];
      for (const task of tasks) aggregated.push(task);
    }
  } catch (err) {
    reportConnectorError(res, err);
    return;
  }

  res.status(200).json({
    ok: true,
    tenant_id: tenantId,
    count: aggregated.length,
    tasks: aggregated,
  });
}

export function registerClickupRoutes(app: Express): void {
  app.post('/api/v1/org/clickup/task', (req: Request, res: Response): void => {
    void handleCreateTask(req, res);
  });
  app.get('/api/v1/org/clickup/lists', (req: Request, res: Response): void => {
    void handleListLists(req, res);
  });
  app.post('/api/v1/org/clickup/sync', (req: Request, res: Response): void => {
    void handleSync(req, res);
  });
}
