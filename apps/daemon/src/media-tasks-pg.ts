// Postgres async port of media-tasks.ts.
// Shapes and exported names parallel the SQLite version so server.ts can
// switch via env at boot.

import type { PoolClient } from 'pg';

export type MediaTaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'interrupted';

export interface MediaTaskError {
  message: string;
  status?: number;
  code?: string;
}

export interface MediaTaskRow {
  id: string;
  projectId: string;
  status: MediaTaskStatus;
  surface?: string;
  model?: string;
  progress: string[];
  file: unknown | null;
  error: MediaTaskError | null;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MediaTaskInsert {
  id: string;
  projectId: string;
  status?: MediaTaskStatus;
  surface?: string;
  model?: string;
  progress?: string[];
  file?: unknown | null;
  error?: MediaTaskError | null;
  startedAt?: number;
  endedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface MediaTaskPatch {
  status?: MediaTaskStatus;
  surface?: string | null;
  model?: string | null;
  progress?: string[];
  file?: unknown | null;
  error?: MediaTaskError | null;
  startedAt?: number;
  endedAt?: number | null;
  updatedAt?: number;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'done',
  'failed',
  'interrupted',
]);

const TERMINAL_STATUSES = new Set(['done', 'failed', 'interrupted']);

const COLS = `
  id,
  project_id AS "projectId",
  status,
  surface,
  model,
  progress_json AS "progressJson",
  file_json AS "fileJson",
  error_json AS "errorJson",
  started_at AS "startedAt",
  ended_at AS "endedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export async function insertMediaTask(
  client: PoolClient,
  tenantId: string,
  input: MediaTaskInsert,
): Promise<MediaTaskRow> {
  const now = Date.now();
  const status = input.status ?? 'queued';
  assertValidStatus(status);
  const startedAt = input.startedAt ?? now;
  await client.query(
    `INSERT INTO media_tasks
       (id, tenant_id, project_id, status, surface, model, progress_json, file_json,
        error_json, started_at, ended_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.id,
      tenantId,
      input.projectId,
      status,
      input.surface ?? null,
      input.model ?? null,
      JSON.stringify(input.progress ?? []),
      jsonOrNull(input.file ?? null),
      jsonOrNull(input.error ?? null),
      startedAt,
      input.endedAt ?? null,
      input.createdAt ?? startedAt,
      input.updatedAt ?? now,
    ],
  );
  const row = await getMediaTask(client, input.id);
  if (row === null) throw new Error(`Failed to fetch media task after insert: ${input.id}`);
  return row;
}

export async function getMediaTask(
  client: PoolClient,
  id: string,
): Promise<MediaTaskRow | null> {
  const res = await client.query(`SELECT ${COLS} FROM media_tasks WHERE id = $1`, [id]);
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

export async function updateMediaTask(
  client: PoolClient,
  id: string,
  patch: MediaTaskPatch,
): Promise<MediaTaskRow | null> {
  const existing = await getMediaTask(client, id);
  if (existing === null) return null;
  const status = patch.status ?? existing.status;
  assertValidStatus(status);
  const updatedAt = patch.updatedAt ?? Date.now();
  await client.query(
    `UPDATE media_tasks
        SET status = $1,
            surface = $2,
            model = $3,
            progress_json = $4,
            file_json = $5,
            error_json = $6,
            started_at = $7,
            ended_at = $8,
            updated_at = $9
      WHERE id = $10`,
    [
      status,
      'surface' in patch ? patch.surface ?? null : existing.surface ?? null,
      'model' in patch ? patch.model ?? null : existing.model ?? null,
      JSON.stringify(patch.progress ?? existing.progress),
      'file' in patch ? jsonOrNull(patch.file ?? null) : jsonOrNull(existing.file),
      'error' in patch ? jsonOrNull(patch.error ?? null) : jsonOrNull(existing.error),
      patch.startedAt ?? existing.startedAt,
      'endedAt' in patch ? patch.endedAt ?? null : existing.endedAt,
      updatedAt,
      id,
    ],
  );
  return getMediaTask(client, id);
}

export async function listMediaTasksByProject(
  client: PoolClient,
  projectId: string,
  options: { includeTerminal?: boolean } = {},
): Promise<MediaTaskRow[]> {
  const includeTerminal = options.includeTerminal === true;
  const res = await client.query(
    `SELECT ${COLS}
       FROM media_tasks
      WHERE project_id = $1
      ORDER BY started_at DESC`,
    [projectId],
  );
  return res.rows
    .map(normalizeRow)
    .filter((row) => includeTerminal || !TERMINAL_STATUSES.has(row.status));
}

export async function listRecentMediaTasks(
  client: PoolClient,
  options: { terminalTtlMs: number; now?: number },
): Promise<MediaTaskRow[]> {
  const now = options.now ?? Date.now();
  const cutoff = now - options.terminalTtlMs;
  const res = await client.query(
    `SELECT ${COLS}
       FROM media_tasks
      WHERE status IN ('queued', 'running')
         OR COALESCE(ended_at, updated_at) >= $1
      ORDER BY started_at DESC`,
    [cutoff],
  );
  return res.rows.map(normalizeRow);
}

export async function deleteMediaTask(client: PoolClient, id: string): Promise<void> {
  await client.query(`DELETE FROM media_tasks WHERE id = $1`, [id]);
}

export async function reconcileMediaTasksOnBoot(
  client: PoolClient,
  options: { terminalTtlMs: number; now?: number },
): Promise<{ interrupted: number; deleted: number }> {
  const now = options.now ?? Date.now();
  const cutoff = now - options.terminalTtlMs;
  const interruptedError: MediaTaskError = {
    message: 'media task interrupted by daemon restart',
    status: 5,
    code: 'DAEMON_RESTART',
  };
  const interrupted = await client.query(
    `UPDATE media_tasks
        SET status = 'interrupted',
            error_json = $1,
            ended_at = COALESCE(ended_at, $2),
            updated_at = $3
      WHERE status IN ('queued', 'running')`,
    [JSON.stringify(interruptedError), now, now],
  );
  const deleted = await client.query(
    `DELETE FROM media_tasks
      WHERE status IN ('done', 'failed', 'interrupted')
        AND COALESCE(ended_at, updated_at) < $1`,
    [cutoff],
  );
  return {
    interrupted: interrupted.rowCount ?? 0,
    deleted: deleted.rowCount ?? 0,
  };
}

function normalizeRow(raw: Record<string, any>): MediaTaskRow {
  const row: MediaTaskRow = {
    id: raw.id,
    projectId: raw.projectId,
    status: raw.status as MediaTaskStatus,
    progress: parseArray(raw.progressJson),
    file: parseJson(raw.fileJson),
    error: normalizeError(parseJson(raw.errorJson)),
    startedAt: Number(raw.startedAt),
    endedAt: raw.endedAt == null ? null : Number(raw.endedAt),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
  if (raw.surface !== null && raw.surface !== undefined) row.surface = raw.surface;
  if (raw.model !== null && raw.model !== undefined) row.model = raw.model;
  return row;
}

function assertValidStatus(status: string): void {
  if (!VALID_STATUSES.has(status)) {
    throw new RangeError(`Invalid media task status: "${status}"`);
  }
}

function parseArray(json: string | null): string[] {
  const parsed = parseJson(json);
  return Array.isArray(parsed)
    ? parsed.filter((line): line is string => typeof line === 'string')
    : [];
}

function normalizeError(value: unknown): MediaTaskError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const message = typeof obj.message === 'string' ? obj.message : '';
  if (!message) return null;
  const error: MediaTaskError = { message };
  if (typeof obj.status === 'number') error.status = obj.status;
  if (typeof obj.code === 'string') error.code = obj.code;
  return error;
}

function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function jsonOrNull(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}
