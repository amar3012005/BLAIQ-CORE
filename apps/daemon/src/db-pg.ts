// Postgres async port of db.ts for the multi-tenant production deploy.
//
// Design notes:
//   - Every function takes a `PoolClient` checked out via `withTenant`
//     (see db/pool.ts). RLS policies enforce that the session's
//     `app.tenant_id` GUC matches each row's tenant_id, so callers
//     cannot accidentally cross-leak.
//   - Insert/upsert helpers accept a `tenantId` parameter so writes
//     stamp the right tenant; reads rely on RLS (no explicit
//     `WHERE tenant_id = $X` needed because the GUC binds it).
//   - Function names and return shapes mirror db.ts so the
//     refactor of server.ts callers is a mechanical `await` + tenant
//     wrap.
//   - SQLite placeholders (`?`) translated to Postgres ($1, $2, ...).
//   - `INSERT OR REPLACE` translated to `ON CONFLICT ... DO UPDATE`.
//   - Timestamps remain BIGINT ms (`Date.now()`).

import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

type DbRow = Record<string, any>;

function rows(value: unknown[]): DbRow[] {
  return value.map((item) => (item && typeof item === 'object' ? (item as DbRow) : {}));
}

function stringifyJsonObjectOrNull(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

function parseJsonOrUndef(s: unknown): any {
  if (typeof s !== 'string' || !s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// ============================================================================
// projects
// ============================================================================

const PROJECT_COLS = `id, name, skill_id AS "skillId",
  design_system_id AS "designSystemId",
  pending_prompt AS "pendingPrompt",
  metadata_json AS "metadataJson",
  custom_instructions AS "customInstructions",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export async function listProjects(client: PoolClient) {
  const res = await client.query(
    `SELECT ${PROJECT_COLS} FROM projects ORDER BY updated_at DESC`,
  );
  return res.rows.map(normalizeProject);
}

export async function getProject(client: PoolClient, id: string) {
  const res = await client.query(
    `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? normalizeProject(res.rows[0]) : null;
}

export async function insertProject(
  client: PoolClient,
  tenantId: string,
  p: DbRow,
) {
  await client.query(
    `INSERT INTO projects
       (id, tenant_id, name, skill_id, design_system_id, pending_prompt,
        metadata_json, custom_instructions, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      p.id,
      tenantId,
      p.name,
      p.skillId ?? null,
      p.designSystemId ?? null,
      p.pendingPrompt ?? null,
      p.metadata ? JSON.stringify(p.metadata) : null,
      p.customInstructions ?? null,
      p.createdAt,
      p.updatedAt,
    ],
  );
  return getProject(client, p.id);
}

export async function updateProject(client: PoolClient, id: string, patch: DbRow) {
  const existing = await getProject(client, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  await client.query(
    `UPDATE projects
        SET name = $1,
            skill_id = $2,
            design_system_id = $3,
            pending_prompt = $4,
            metadata_json = $5,
            custom_instructions = $6,
            updated_at = $7
      WHERE id = $8`,
    [
      merged.name,
      merged.skillId ?? null,
      merged.designSystemId ?? null,
      merged.pendingPrompt ?? null,
      merged.metadata ? JSON.stringify(merged.metadata) : null,
      merged.customInstructions ?? null,
      merged.updatedAt,
      id,
    ],
  );
  return getProject(client, id);
}

export async function deleteProject(client: PoolClient, id: string) {
  await client.query(`DELETE FROM projects WHERE id = $1`, [id]);
}

function normalizeProject(row: DbRow) {
  let metadata;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(row.metadataJson);
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    skillId: row.skillId,
    designSystemId: row.designSystemId,
    pendingPrompt: row.pendingPrompt ?? undefined,
    metadata,
    customInstructions: row.customInstructions ?? undefined,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export async function listLatestProjectRunStatuses(client: PoolClient) {
  const res = await client.query(
    `SELECT c.project_id AS "projectId",
            m.run_id AS "runId",
            m.run_status AS status,
            COALESCE(m.ended_at, m.started_at, m.created_at) AS "updatedAt"
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.run_status IS NOT NULL
      ORDER BY "updatedAt" DESC`,
  );
  const latestByProject = new Map<string, DbRow>();
  for (const row of res.rows as DbRow[]) {
    if (!latestByProject.has(row.projectId)) {
      latestByProject.set(row.projectId, {
        value: normalizeProjectRunStatus(row.status),
        updatedAt: Number(row.updatedAt),
        runId: row.runId ?? undefined,
      });
    }
  }
  return latestByProject;
}

export async function listProjectsAwaitingInput(client: PoolClient) {
  const res = await client.query(
    `SELECT latest."projectId"
       FROM (
         SELECT c.project_id AS "projectId",
                m.conversation_id AS "conversationId",
                m.created_at AS "createdAt",
                m.position AS position,
                ROW_NUMBER() OVER (
                  PARTITION BY c.project_id
                  ORDER BY m.created_at DESC, m.position DESC
                ) AS "rowNum"
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE m.role = 'assistant'
            AND LOWER(m.content) LIKE '%<question-form%'
       ) latest
      WHERE latest."rowNum" = 1
        AND NOT EXISTS (
          SELECT 1
            FROM messages reply
           WHERE reply.conversation_id = latest."conversationId"
             AND reply.role = 'user'
             AND (
               reply.created_at > latest."createdAt"
               OR (reply.created_at = latest."createdAt" AND reply.position > latest.position)
             )
        )`,
  );
  return new Set((res.rows as DbRow[]).map((row) => row.projectId));
}

function normalizeProjectRunStatus(status: unknown) {
  if (status === 'starting') return 'running';
  if (status === 'cancelled') return 'canceled';
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'canceled'
  ) {
    return status;
  }
  return 'not_started';
}

// ============================================================================
// templates
// ============================================================================

export async function listTemplates(client: PoolClient) {
  const res = await client.query(
    `SELECT id, name, description, source_project_id AS "sourceProjectId",
            files_json AS "filesJson", created_at AS "createdAt"
       FROM templates
      ORDER BY created_at DESC`,
  );
  return res.rows.map(normalizeTemplate);
}

export async function getTemplate(client: PoolClient, id: string) {
  const res = await client.query(
    `SELECT id, name, description, source_project_id AS "sourceProjectId",
            files_json AS "filesJson", created_at AS "createdAt"
       FROM templates WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? normalizeTemplate(res.rows[0]) : null;
}

export async function findTemplateByNameAndProject(
  client: PoolClient,
  name: string,
  sourceProjectId: string,
) {
  const res = await client.query(
    `SELECT id, name, description, source_project_id AS "sourceProjectId",
            files_json AS "filesJson", created_at AS "createdAt"
       FROM templates
      WHERE name = $1 AND source_project_id = $2`,
    [name, sourceProjectId],
  );
  return res.rows[0] ? normalizeTemplate(res.rows[0]) : null;
}

export async function insertTemplate(
  client: PoolClient,
  tenantId: string,
  t: DbRow,
) {
  await client.query(
    `INSERT INTO templates
       (id, tenant_id, name, description, source_project_id, files_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      t.id,
      tenantId,
      t.name,
      t.description ?? null,
      t.sourceProjectId ?? null,
      JSON.stringify(t.files ?? []),
      t.createdAt,
    ],
  );
  return getTemplate(client, t.id);
}

export async function updateTemplate(
  client: PoolClient,
  id: string,
  t: { description: string | null; files: unknown[] },
) {
  await client.query(
    `UPDATE templates SET description = $1, files_json = $2 WHERE id = $3`,
    [t.description, JSON.stringify(t.files), id],
  );
  return getTemplate(client, id);
}

export async function deleteTemplate(client: PoolClient, id: string) {
  await client.query(`DELETE FROM templates WHERE id = $1`, [id]);
}

function normalizeTemplate(row: DbRow) {
  let files: unknown[] = [];
  try {
    files = JSON.parse(row.filesJson || '[]');
  } catch {
    files = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    sourceProjectId: row.sourceProjectId ?? undefined,
    files,
    createdAt: Number(row.createdAt),
  };
}

// ============================================================================
// conversations
// ============================================================================

export async function listConversations(client: PoolClient, projectId: string) {
  const res = await client.query(
    `WITH project_conversations AS (
        SELECT id, project_id AS "projectId", title,
               created_at AS "createdAt", updated_at AS "updatedAt"
          FROM conversations
         WHERE project_id = $1
      ),
      latest_runs AS (
        SELECT "conversationId",
               "latestRunStatus",
               "latestRunStartedAt",
               "latestRunEndedAt",
               "latestRunEventsJson"
          FROM (
            SELECT m.conversation_id AS "conversationId",
                   m.run_status AS "latestRunStatus",
                   m.started_at AS "latestRunStartedAt",
                   m.ended_at AS "latestRunEndedAt",
                   m.events_json AS "latestRunEventsJson",
                   ROW_NUMBER() OVER (
                     PARTITION BY m.conversation_id
                     ORDER BY m.position DESC
                   ) AS rn
              FROM messages m
              JOIN project_conversations c ON c.id = m.conversation_id
             WHERE m.role = 'assistant'
               AND m.run_status IS NOT NULL
          ) ranked
         WHERE rn = 1
      )
      SELECT c.id, c."projectId", c.title, c."createdAt", c."updatedAt",
             lr."latestRunStatus", lr."latestRunStartedAt",
             lr."latestRunEndedAt", lr."latestRunEventsJson"
        FROM project_conversations c
        LEFT JOIN latest_runs lr ON lr."conversationId" = c.id
       ORDER BY c."updatedAt" DESC`,
    [projectId],
  );
  return rows(res.rows).map(normalizeConversation);
}

export async function getConversation(client: PoolClient, id: string) {
  const res = await client.query(
    `SELECT id, project_id AS "projectId", title,
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM conversations WHERE id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    ...normalizeConversation(r),
    latestRun: (await latestConversationRunSummary(client, r.id)) ?? undefined,
  };
}

function normalizeConversation(r: DbRow) {
  const latestRun = conversationRunSummaryFromRow({
    runStatus: r.latestRunStatus,
    startedAt: r.latestRunStartedAt,
    endedAt: r.latestRunEndedAt,
    eventsJson: r.latestRunEventsJson,
  });
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title ?? null,
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    latestRun: latestRun ?? undefined,
  };
}

async function latestConversationRunSummary(client: PoolClient, conversationId: string) {
  const res = await client.query(
    `SELECT run_status AS "runStatus",
            started_at AS "startedAt",
            ended_at AS "endedAt",
            events_json AS "eventsJson"
       FROM messages
      WHERE conversation_id = $1
        AND role = 'assistant'
        AND run_status IS NOT NULL
      ORDER BY position DESC
      LIMIT 1`,
    [conversationId],
  );
  return conversationRunSummaryFromRow(res.rows[0]);
}

function conversationRunSummaryFromRow(row: DbRow | undefined) {
  if (!row || typeof row.runStatus !== 'string') return null;
  const startedAt = row.startedAt == null ? undefined : Number(row.startedAt);
  const endedAt = row.endedAt == null ? undefined : Number(row.endedAt);
  const usageDurationMs = latestUsageDurationMs(row.eventsJson);
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? Math.max(0, (endedAt as number) - (startedAt as number))
      : usageDurationMs;
  return {
    status: row.runStatus,
    ...(Number.isFinite(startedAt) ? { startedAt } : {}),
    ...(Number.isFinite(endedAt) ? { endedAt } : {}),
    ...(typeof durationMs === 'number' && Number.isFinite(durationMs)
      ? { durationMs }
      : {}),
  };
}

function latestUsageDurationMs(eventsJson: unknown): number | undefined {
  if (typeof eventsJson !== 'string' || eventsJson.length === 0) return undefined;
  try {
    const events = JSON.parse(eventsJson);
    if (!Array.isArray(events)) return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event &&
        typeof event === 'object' &&
        event.kind === 'usage' &&
        typeof event.durationMs === 'number' &&
        Number.isFinite(event.durationMs)
      ) {
        return Math.max(0, event.durationMs);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function insertConversation(
  client: PoolClient,
  tenantId: string,
  c: DbRow,
) {
  await client.query(
    `INSERT INTO conversations
       (id, tenant_id, project_id, title, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.id, tenantId, c.projectId, c.title ?? null, c.createdAt, c.updatedAt],
  );
  return getConversation(client, c.id);
}

export async function updateConversation(client: PoolClient, id: string, patch: DbRow) {
  const existing = await getConversation(client, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  await client.query(
    `UPDATE conversations
        SET title = $1, updated_at = $2 WHERE id = $3`,
    [merged.title ?? null, merged.updatedAt, id],
  );
  return getConversation(client, id);
}

export async function deleteConversation(client: PoolClient, id: string) {
  await client.query(`DELETE FROM conversations WHERE id = $1`, [id]);
}

// ============================================================================
// messages
// ============================================================================

const MESSAGE_SELECT = `
  id, role, content,
  agent_id AS "agentId", agent_name AS "agentName",
  run_id AS "runId", run_status AS "runStatus",
  last_run_event_id AS "lastRunEventId",
  events_json AS "eventsJson",
  attachments_json AS "attachmentsJson",
  comment_attachments_json AS "commentAttachmentsJson",
  produced_files_json AS "producedFilesJson",
  feedback_json AS "feedbackJson",
  created_at AS "createdAt", started_at AS "startedAt", ended_at AS "endedAt",
  position`;

export async function listMessages(client: PoolClient, conversationId: string) {
  const res = await client.query(
    `SELECT ${MESSAGE_SELECT}
       FROM messages
      WHERE conversation_id = $1
      ORDER BY position ASC`,
    [conversationId],
  );
  return res.rows.map(normalizeMessage);
}

export async function upsertMessage(
  client: PoolClient,
  tenantId: string,
  conversationId: string,
  m: DbRow,
) {
  const existing = await client.query(
    `SELECT position FROM messages WHERE id = $1`,
    [m.id],
  );
  const now = Date.now();
  if ((existing.rowCount ?? 0) > 0) {
    await client.query(
      `UPDATE messages
          SET role = $1, content = $2, agent_id = $3, agent_name = $4,
              run_id = $5, run_status = $6, last_run_event_id = $7,
              events_json = $8, attachments_json = $9, comment_attachments_json = $10,
              produced_files_json = $11, feedback_json = $12, started_at = $13, ended_at = $14
        WHERE id = $15`,
      [
        m.role,
        m.content,
        m.agentId ?? null,
        m.agentName ?? null,
        m.runId ?? null,
        m.runStatus ?? null,
        m.lastRunEventId ?? null,
        m.events ? JSON.stringify(m.events) : null,
        m.attachments ? JSON.stringify(m.attachments) : null,
        m.commentAttachments ? JSON.stringify(m.commentAttachments) : null,
        m.producedFiles ? JSON.stringify(m.producedFiles) : null,
        m.feedback ? JSON.stringify(m.feedback) : null,
        m.startedAt ?? null,
        m.endedAt ?? null,
        m.id,
      ],
    );
  } else {
    const max = await client.query<{ m: number | null }>(
      `SELECT COALESCE(MAX(position), -1) AS m FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    const position = (max.rows[0]?.m ?? -1) + 1;
    await client.query(
      `INSERT INTO messages
         (id, tenant_id, conversation_id, role, content, agent_id, agent_name,
          run_id, run_status, last_run_event_id, events_json,
          attachments_json, comment_attachments_json, produced_files_json,
          feedback_json, started_at, ended_at, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        m.id,
        tenantId,
        conversationId,
        m.role,
        m.content,
        m.agentId ?? null,
        m.agentName ?? null,
        m.runId ?? null,
        m.runStatus ?? null,
        m.lastRunEventId ?? null,
        m.events ? JSON.stringify(m.events) : null,
        m.attachments ? JSON.stringify(m.attachments) : null,
        m.commentAttachments ? JSON.stringify(m.commentAttachments) : null,
        m.producedFiles ? JSON.stringify(m.producedFiles) : null,
        m.feedback ? JSON.stringify(m.feedback) : null,
        m.startedAt ?? null,
        m.endedAt ?? null,
        position,
        now,
      ],
    );
  }
  await client.query(
    `UPDATE conversations SET updated_at = $1 WHERE id = $2`,
    [now, conversationId],
  );
  const out = await client.query(
    `SELECT ${MESSAGE_SELECT} FROM messages WHERE id = $1`,
    [m.id],
  );
  return out.rows[0] ? normalizeMessage(out.rows[0]) : null;
}

export async function deleteMessage(client: PoolClient, id: string) {
  await client.query(`DELETE FROM messages WHERE id = $1`, [id]);
}

function normalizeMessage(row: DbRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    agentId: row.agentId ?? undefined,
    agentName: row.agentName ?? undefined,
    runId: row.runId ?? undefined,
    runStatus: row.runStatus ?? undefined,
    lastRunEventId: row.lastRunEventId ?? undefined,
    events: parseJsonOrUndef(row.eventsJson),
    attachments: parseJsonOrUndef(row.attachmentsJson),
    commentAttachments: parseJsonOrUndef(row.commentAttachmentsJson),
    producedFiles: parseJsonOrUndef(row.producedFilesJson),
    feedback: parseJsonOrUndef(row.feedbackJson),
    createdAt: row.createdAt == null ? undefined : Number(row.createdAt),
    startedAt: row.startedAt == null ? undefined : Number(row.startedAt),
    endedAt: row.endedAt == null ? undefined : Number(row.endedAt),
  };
}

// ============================================================================
// tabs
// ============================================================================

export async function listTabs(client: PoolClient, projectId: string) {
  const res = await client.query(
    `SELECT name, position, is_active AS "isActive"
       FROM tabs WHERE project_id = $1 ORDER BY position ASC`,
    [projectId],
  );
  const tabRows = res.rows as DbRow[];
  const active = tabRows.find((r) => r.isActive) ?? null;
  return {
    tabs: tabRows.map((r) => r.name as string),
    active: active ? (active.name as string) : null,
  };
}

export async function setTabs(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  names: string[],
  activeName: string | null,
) {
  await client.query(`DELETE FROM tabs WHERE project_id = $1`, [projectId]);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i]!;
    await client.query(
      `INSERT INTO tabs (tenant_id, project_id, name, position, is_active)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, projectId, name, i, name === activeName ? 1 : 0],
    );
  }
  return listTabs(client, projectId);
}

// ============================================================================
// deployments
// ============================================================================

const DEPLOYMENT_COLS = `id, project_id AS "projectId", file_name AS "fileName",
  provider_id AS "providerId", url, deployment_id AS "deploymentId",
  deployment_count AS "deploymentCount", target, status,
  status_message AS "statusMessage", reachable_at AS "reachableAt",
  provider_metadata_json AS "providerMetadataJson",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listDeployments(client: PoolClient, projectId: string) {
  const res = await client.query(
    `SELECT ${DEPLOYMENT_COLS}
       FROM deployments
      WHERE project_id = $1
      ORDER BY updated_at DESC`,
    [projectId],
  );
  return res.rows.map(normalizeDeployment);
}

export async function getDeployment(
  client: PoolClient,
  projectId: string,
  fileName: string,
  providerId: string,
) {
  const res = await client.query(
    `SELECT ${DEPLOYMENT_COLS}
       FROM deployments
      WHERE project_id = $1 AND file_name = $2 AND provider_id = $3`,
    [projectId, fileName, providerId],
  );
  return res.rows[0] ? normalizeDeployment(res.rows[0]) : null;
}

export async function getDeploymentById(
  client: PoolClient,
  projectId: string,
  id: string,
) {
  const res = await client.query(
    `SELECT ${DEPLOYMENT_COLS}
       FROM deployments
      WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return res.rows[0] ? normalizeDeployment(res.rows[0]) : null;
}

export async function upsertDeployment(
  client: PoolClient,
  tenantId: string,
  deployment: DbRow,
) {
  const existing = await getDeployment(
    client,
    deployment.projectId,
    deployment.fileName,
    deployment.providerId,
  );
  const now = Date.now();
  const inputProviderMetadata =
    deployment.providerMetadata === undefined
      ? existing?.providerMetadata
      : deployment.providerMetadata;
  const providerMetadata =
    deployment.cloudflarePages && typeof deployment.cloudflarePages === 'object'
      ? {
          ...(inputProviderMetadata && typeof inputProviderMetadata === 'object' && !Array.isArray(inputProviderMetadata)
            ? inputProviderMetadata
            : {}),
          cloudflarePages: deployment.cloudflarePages,
        }
      : inputProviderMetadata;
  const next = {
    id: existing?.id ?? deployment.id,
    projectId: deployment.projectId,
    fileName: deployment.fileName,
    providerId: deployment.providerId,
    url: deployment.url,
    deploymentId: deployment.deploymentId ?? null,
    deploymentCount:
      typeof deployment.deploymentCount === 'number'
        ? deployment.deploymentCount
        : (existing?.deploymentCount ?? 0) + 1,
    target: deployment.target ?? 'preview',
    status: deployment.status ?? existing?.status ?? 'ready',
    statusMessage: deployment.statusMessage ?? null,
    reachableAt: deployment.reachableAt ?? null,
    providerMetadata,
    createdAt: existing?.createdAt ?? deployment.createdAt ?? now,
    updatedAt: deployment.updatedAt ?? now,
  };
  const providerMetadataJson = stringifyJsonObjectOrNull(next.providerMetadata);
  await client.query(
    `INSERT INTO deployments
       (id, tenant_id, project_id, file_name, provider_id, url, deployment_id,
        deployment_count, target, status, status_message, reachable_at,
        provider_metadata_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (project_id, file_name, provider_id) DO UPDATE SET
       url = EXCLUDED.url,
       deployment_id = EXCLUDED.deployment_id,
       deployment_count = EXCLUDED.deployment_count,
       target = EXCLUDED.target,
       status = EXCLUDED.status,
       status_message = EXCLUDED.status_message,
       reachable_at = EXCLUDED.reachable_at,
       provider_metadata_json = EXCLUDED.provider_metadata_json,
       updated_at = EXCLUDED.updated_at`,
    [
      next.id,
      tenantId,
      next.projectId,
      next.fileName,
      next.providerId,
      next.url,
      next.deploymentId,
      next.deploymentCount,
      next.target,
      next.status,
      next.statusMessage,
      next.reachableAt,
      providerMetadataJson,
      next.createdAt,
      next.updatedAt,
    ],
  );
  return getDeployment(client, next.projectId, next.fileName, next.providerId);
}

function normalizeDeployment(row: DbRow) {
  const providerMetadata = parseJsonOrUndef(row.providerMetadataJson);
  const normalizedProviderMetadata =
    providerMetadata && typeof providerMetadata === 'object' && !Array.isArray(providerMetadata)
      ? providerMetadata
      : undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    fileName: row.fileName,
    providerId: row.providerId,
    url: row.url,
    deploymentId: row.deploymentId ?? undefined,
    deploymentCount: Number(row.deploymentCount ?? 1),
    target: 'preview',
    status: row.status || 'ready',
    statusMessage: row.statusMessage ?? undefined,
    reachableAt: row.reachableAt == null ? undefined : Number(row.reachableAt),
    cloudflarePages:
      normalizedProviderMetadata?.cloudflarePages &&
      typeof normalizedProviderMetadata.cloudflarePages === 'object' &&
      !Array.isArray(normalizedProviderMetadata.cloudflarePages)
        ? normalizedProviderMetadata.cloudflarePages
        : undefined,
    providerMetadata: normalizedProviderMetadata,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

// ============================================================================
// preview comments
// ============================================================================

const PREVIEW_COMMENT_STATUSES = new Set([
  'open',
  'attached',
  'applying',
  'needs_review',
  'resolved',
  'failed',
]);

const PREVIEW_COMMENT_COLS = `
  id, project_id AS "projectId", conversation_id AS "conversationId",
  file_path AS "filePath", element_id AS "elementId", selector, label,
  text, position_json AS "positionJson", html_hint AS "htmlHint",
  selection_kind AS "selectionKind", member_count AS "memberCount",
  pod_members_json AS "podMembersJson",
  note, status, created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listPreviewComments(
  client: PoolClient,
  projectId: string,
  conversationId: string,
) {
  const res = await client.query(
    `SELECT ${PREVIEW_COMMENT_COLS}
       FROM preview_comments
      WHERE project_id = $1 AND conversation_id = $2
      ORDER BY updated_at DESC`,
    [projectId, conversationId],
  );
  return res.rows.map(normalizePreviewComment);
}

export async function upsertPreviewComment(
  client: PoolClient,
  tenantId: string,
  projectId: string,
  conversationId: string,
  input: DbRow,
) {
  const target = input?.target ?? {};
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (!note) throw new Error('comment note required');
  const filePath = cleanRequiredString(target.filePath, 'filePath');
  const elementId = cleanRequiredString(target.elementId, 'elementId');
  const selector = cleanRequiredString(target.selector, 'selector');
  const label = cleanRequiredString(target.label, 'label');
  const text = typeof target.text === 'string' ? compactWhitespace(target.text).slice(0, 160) : '';
  const htmlHint = typeof target.htmlHint === 'string' ? compactWhitespace(target.htmlHint).slice(0, 180) : '';
  const position = normalizePosition(target.position);
  const selectionKind = target.selectionKind === 'pod' ? 'pod' : 'element';
  const podMembers = selectionKind === 'pod' ? normalizePodMembers(target.podMembers) : [];
  const memberCount = selectionKind === 'pod'
    ? (podMembers.length > 0
        ? podMembers.length
        : Number.isFinite(target.memberCount)
          ? Math.max(0, Math.round(target.memberCount))
          : 0)
    : 0;
  const now = Date.now();
  const existing = await client.query<{ id: string; createdAt: number }>(
    `SELECT id, created_at AS "createdAt"
       FROM preview_comments
      WHERE project_id = $1 AND conversation_id = $2 AND file_path = $3 AND element_id = $4`,
    [projectId, conversationId, filePath, elementId],
  );
  const id = existing.rows[0]?.id ?? randomCommentId();
  const createdAt = existing.rows[0]?.createdAt ?? now;
  await client.query(
    `INSERT INTO preview_comments
       (id, tenant_id, project_id, conversation_id, file_path, element_id, selector, label,
        text, position_json, html_hint, selection_kind, member_count, pod_members_json,
        note, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (project_id, conversation_id, file_path, element_id) DO UPDATE SET
       selector = EXCLUDED.selector,
       label = EXCLUDED.label,
       text = EXCLUDED.text,
       position_json = EXCLUDED.position_json,
       html_hint = EXCLUDED.html_hint,
       selection_kind = EXCLUDED.selection_kind,
       member_count = EXCLUDED.member_count,
       pod_members_json = EXCLUDED.pod_members_json,
       note = EXCLUDED.note,
       status = 'open',
       updated_at = EXCLUDED.updated_at`,
    [
      id,
      tenantId,
      projectId,
      conversationId,
      filePath,
      elementId,
      selector,
      label,
      text,
      JSON.stringify(position),
      htmlHint,
      selectionKind,
      selectionKind === 'pod' ? memberCount : null,
      selectionKind === 'pod' ? JSON.stringify(podMembers) : null,
      note,
      'open',
      createdAt,
      now,
    ],
  );
  return getPreviewComment(client, projectId, conversationId, id);
}

export async function updatePreviewCommentStatus(
  client: PoolClient,
  projectId: string,
  conversationId: string,
  id: string,
  status: string,
) {
  if (!PREVIEW_COMMENT_STATUSES.has(status)) throw new Error('invalid comment status');
  const now = Date.now();
  await client.query(
    `UPDATE preview_comments
        SET status = $1, updated_at = $2
      WHERE id = $3 AND project_id = $4 AND conversation_id = $5`,
    [status, now, id, projectId, conversationId],
  );
  return getPreviewComment(client, projectId, conversationId, id);
}

export async function deletePreviewComment(
  client: PoolClient,
  projectId: string,
  conversationId: string,
  id: string,
) {
  const result = await client.query(
    `DELETE FROM preview_comments
      WHERE id = $1 AND project_id = $2 AND conversation_id = $3`,
    [id, projectId, conversationId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function getPreviewComment(
  client: PoolClient,
  projectId: string,
  conversationId: string,
  id: string,
) {
  const res = await client.query(
    `SELECT ${PREVIEW_COMMENT_COLS}
       FROM preview_comments
      WHERE id = $1 AND project_id = $2 AND conversation_id = $3`,
    [id, projectId, conversationId],
  );
  return res.rows[0] ? normalizePreviewComment(res.rows[0]) : null;
}

function normalizePreviewComment(row: DbRow) {
  const podMembers = parseJsonOrUndef(row.podMembersJson);
  const normalizedPodMembers = Array.isArray(podMembers) ? podMembers : undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId,
    filePath: row.filePath,
    elementId: row.elementId,
    selector: row.selector,
    label: row.label,
    text: row.text,
    position: parseJsonOrUndef(row.positionJson) ?? { x: 0, y: 0, width: 0, height: 0 },
    htmlHint: row.htmlHint,
    selectionKind: row.selectionKind === 'pod' ? 'pod' : 'element',
    memberCount:
      normalizedPodMembers && normalizedPodMembers.length > 0
        ? normalizedPodMembers.length
        : Number.isFinite(row.memberCount)
          ? row.memberCount
          : undefined,
    podMembers: normalizedPodMembers,
    note: row.note,
    status: row.status,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function cleanRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`);
  return value.trim();
}

function normalizePodMembers(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((member) => {
      if (!member || typeof member !== 'object') return null;
      const elementId = cleanRequiredString(member.elementId, 'podMember.elementId');
      const selector = cleanRequiredString(member.selector, 'podMember.selector');
      const label = cleanRequiredString(member.label, 'podMember.label');
      return {
        elementId,
        selector,
        label,
        text:
          typeof member.text === 'string'
            ? compactWhitespace(member.text).slice(0, 160)
            : '',
        position: normalizePosition(member.position),
        htmlHint:
          typeof member.htmlHint === 'string'
            ? compactWhitespace(member.htmlHint).slice(0, 180)
            : '',
      };
    })
    .filter(Boolean);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePosition(input: unknown) {
  const value: DbRow = input && typeof input === 'object' ? (input as DbRow) : {};
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    width: finiteNumber(value.width),
    height: finiteNumber(value.height),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

function randomCommentId(): string {
  return `cmt_${randomUUID().slice(0, 8)}`;
}

// ============================================================================
// routines
// ============================================================================

const ROUTINE_COLS = `id, name, prompt,
  schedule_kind AS "scheduleKind", schedule_value AS "scheduleValue",
  schedule_json AS "scheduleJson",
  project_mode AS "projectMode", project_id AS "projectId",
  skill_id AS "skillId", agent_id AS "agentId",
  enabled, created_at AS "createdAt", updated_at AS "updatedAt"`;

const ROUTINE_RUN_COLS = `id, routine_id AS "routineId", trigger, status,
  project_id AS "projectId", conversation_id AS "conversationId",
  agent_run_id AS "agentRunId", started_at AS "startedAt",
  completed_at AS "completedAt", summary, error`;

export async function listRoutines(client: PoolClient) {
  const res = await client.query(
    `SELECT ${ROUTINE_COLS} FROM routines ORDER BY created_at ASC`,
  );
  return res.rows.map(normalizeRoutine);
}

export async function getRoutine(client: PoolClient, id: string) {
  const res = await client.query(
    `SELECT ${ROUTINE_COLS} FROM routines WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? normalizeRoutine(res.rows[0]) : null;
}

export async function insertRoutine(
  client: PoolClient,
  tenantId: string,
  r: DbRow,
) {
  await client.query(
    `INSERT INTO routines
       (id, tenant_id, name, prompt, schedule_kind, schedule_value, schedule_json,
        project_mode, project_id, skill_id, agent_id, enabled,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      r.id,
      tenantId,
      r.name,
      r.prompt,
      r.scheduleKind,
      r.scheduleValue,
      r.scheduleJson ?? null,
      r.projectMode,
      r.projectId ?? null,
      r.skillId ?? null,
      r.agentId ?? null,
      r.enabled ? 1 : 0,
      r.createdAt,
      r.updatedAt,
    ],
  );
  return getRoutine(client, r.id);
}

export async function updateRoutine(client: PoolClient, id: string, patch: DbRow) {
  const existing = await getRoutine(client, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  await client.query(
    `UPDATE routines
        SET name = $1, prompt = $2,
            schedule_kind = $3, schedule_value = $4, schedule_json = $5,
            project_mode = $6, project_id = $7,
            skill_id = $8, agent_id = $9,
            enabled = $10, updated_at = $11
      WHERE id = $12`,
    [
      merged.name,
      merged.prompt,
      merged.scheduleKind,
      merged.scheduleValue,
      merged.scheduleJson ?? null,
      merged.projectMode,
      merged.projectId ?? null,
      merged.skillId ?? null,
      merged.agentId ?? null,
      merged.enabled ? 1 : 0,
      merged.updatedAt,
      id,
    ],
  );
  return getRoutine(client, id);
}

export async function deleteRoutine(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM routines WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

function normalizeRoutine(row: DbRow) {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    scheduleKind: row.scheduleKind,
    scheduleValue: row.scheduleValue,
    scheduleJson: row.scheduleJson ?? null,
    projectMode: row.projectMode,
    projectId: row.projectId ?? null,
    skillId: row.skillId ?? null,
    agentId: row.agentId ?? null,
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export async function listRoutineRuns(client: PoolClient, routineId: string, limit = 20) {
  const res = await client.query(
    `SELECT ${ROUTINE_RUN_COLS}
       FROM routine_runs
      WHERE routine_id = $1
      ORDER BY started_at DESC
      LIMIT $2`,
    [routineId, limit],
  );
  return res.rows.map(normalizeRoutineRun);
}

export async function getLatestRoutineRun(client: PoolClient, routineId: string) {
  const res = await client.query(
    `SELECT ${ROUTINE_RUN_COLS}
       FROM routine_runs
      WHERE routine_id = $1
      ORDER BY started_at DESC
      LIMIT 1`,
    [routineId],
  );
  return res.rows[0] ? normalizeRoutineRun(res.rows[0]) : null;
}

export async function getRoutineRun(client: PoolClient, id: string) {
  const res = await client.query(
    `SELECT ${ROUTINE_RUN_COLS} FROM routine_runs WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? normalizeRoutineRun(res.rows[0]) : null;
}

export async function insertRoutineRun(
  client: PoolClient,
  tenantId: string,
  r: DbRow,
) {
  await client.query(
    `INSERT INTO routine_runs
       (id, tenant_id, routine_id, trigger, status, project_id, conversation_id,
        agent_run_id, started_at, completed_at, summary, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      r.id,
      tenantId,
      r.routineId,
      r.trigger,
      r.status,
      r.projectId,
      r.conversationId,
      r.agentRunId,
      r.startedAt,
      r.completedAt ?? null,
      r.summary ?? null,
      r.error ?? null,
    ],
  );
  return getRoutineRun(client, r.id);
}

export async function updateRoutineRun(client: PoolClient, id: string, patch: DbRow) {
  const existing = await getRoutineRun(client, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
  };
  await client.query(
    `UPDATE routine_runs
        SET status = $1, completed_at = $2, summary = $3, error = $4
      WHERE id = $5`,
    [
      merged.status,
      merged.completedAt ?? null,
      merged.summary ?? null,
      merged.error ?? null,
      id,
    ],
  );
  return getRoutineRun(client, id);
}

function normalizeRoutineRun(row: DbRow) {
  return {
    id: row.id,
    routineId: row.routineId,
    trigger: row.trigger,
    status: row.status,
    projectId: row.projectId,
    conversationId: row.conversationId,
    agentRunId: row.agentRunId,
    startedAt: Number(row.startedAt),
    completedAt: row.completedAt == null ? null : Number(row.completedAt),
    summary: row.summary ?? null,
    error: row.error ?? null,
  };
}
