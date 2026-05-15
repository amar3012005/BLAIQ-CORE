// Postgres async port of critique/persistence.ts.

import type { PoolClient } from 'pg';
import {
  CRITIQUE_RUN_STATUSES,
  type CritiquePersistedStatus,
  type CritiqueRoundSummary,
  type CritiqueRunStatus,
} from '@open-design/contracts/critique';

export { CRITIQUE_RUN_STATUSES };
export type { CritiquePersistedStatus, CritiqueRoundSummary, CritiqueRunStatus };

const ALL_VALID_STATUSES: ReadonlySet<string> = new Set<CritiquePersistedStatus>([
  ...CRITIQUE_RUN_STATUSES,
  'running',
]);

export interface CritiqueRunRow {
  id: string;
  projectId: string;
  conversationId: string | null;
  artifactPath: string | null;
  status: CritiquePersistedStatus;
  score: number | null;
  rounds: CritiqueRoundSummary[];
  transcriptPath: string | null;
  protocolVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface CritiqueRunInsert {
  id: string;
  projectId: string;
  conversationId?: string | null;
  artifactPath?: string | null;
  status: CritiquePersistedStatus;
  score?: number | null;
  rounds?: CritiqueRoundSummary[];
  transcriptPath?: string | null;
  protocolVersion: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface CritiqueRunPatch {
  status?: CritiqueRunStatus;
  score?: number | null;
  rounds?: CritiqueRoundSummary[];
  transcriptPath?: string | null;
  artifactPath?: string | null;
  updatedAt?: number;
}

interface RoundsPayload {
  rounds: CritiqueRoundSummary[];
  recoveryReason?: string;
}

function serializeRoundsPayload(
  rounds: CritiqueRoundSummary[],
  recoveryReason?: string,
): string {
  if (recoveryReason === undefined) return JSON.stringify(rounds);
  const payload: RoundsPayload = { rounds, recoveryReason };
  return JSON.stringify(payload);
}

function parseRoundsPayload(json: string): {
  rounds: CritiqueRoundSummary[];
  recoveryReason?: string;
} {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return { rounds: parsed as CritiqueRoundSummary[] };
    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const rounds = Array.isArray(obj['rounds'])
        ? (obj['rounds'] as CritiqueRoundSummary[])
        : [];
      if (typeof obj['recoveryReason'] === 'string') {
        return { rounds, recoveryReason: obj['recoveryReason'] };
      }
      return { rounds };
    }
    return { rounds: [] };
  } catch {
    return { rounds: [] };
  }
}

function normalizeRow(raw: Record<string, any>): CritiqueRunRow {
  const { rounds } = parseRoundsPayload(raw.roundsJson);
  return {
    id: raw.id,
    projectId: raw.projectId,
    conversationId: raw.conversationId,
    artifactPath: raw.artifactPath,
    status: raw.status as CritiquePersistedStatus,
    score: raw.score == null ? null : Number(raw.score),
    rounds,
    transcriptPath: raw.transcriptPath,
    protocolVersion: Number(raw.protocolVersion),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
}

const COLS = `
  id,
  project_id      AS "projectId",
  conversation_id AS "conversationId",
  artifact_path   AS "artifactPath",
  status,
  score,
  rounds_json     AS "roundsJson",
  transcript_path AS "transcriptPath",
  protocol_version AS "protocolVersion",
  created_at      AS "createdAt",
  updated_at      AS "updatedAt"
`;

export async function insertCritiqueRun(
  client: PoolClient,
  tenantId: string,
  input: CritiqueRunInsert,
): Promise<CritiqueRunRow> {
  if (!ALL_VALID_STATUSES.has(input.status)) {
    throw new RangeError(
      `Invalid critique run status: "${input.status}". Must be one of: ${[
        ...ALL_VALID_STATUSES,
      ].join(', ')}`,
    );
  }
  const now = Date.now();
  const rounds = input.rounds ?? [];
  await client.query(
    `INSERT INTO critique_runs
       (id, tenant_id, project_id, conversation_id, artifact_path, status, score,
        rounds_json, transcript_path, protocol_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.id,
      tenantId,
      input.projectId,
      input.conversationId ?? null,
      input.artifactPath ?? null,
      input.status,
      input.score ?? null,
      serializeRoundsPayload(rounds),
      input.transcriptPath ?? null,
      input.protocolVersion,
      input.createdAt ?? now,
      input.updatedAt ?? now,
    ],
  );
  const row = await getCritiqueRun(client, input.id);
  if (row === null) throw new Error(`Failed to fetch critique run after insert: ${input.id}`);
  return row;
}

export async function getCritiqueRun(
  client: PoolClient,
  id: string,
): Promise<CritiqueRunRow | null> {
  const res = await client.query(`SELECT ${COLS} FROM critique_runs WHERE id = $1`, [id]);
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

export async function updateCritiqueRun(
  client: PoolClient,
  id: string,
  patch: CritiqueRunPatch,
): Promise<CritiqueRunRow | null> {
  const existing = await getCritiqueRun(client, id);
  if (existing === null) return null;

  const now = Date.now();
  const updatedAt = patch.updatedAt ?? now;
  const status = patch.status ?? existing.status;
  const score = 'score' in patch ? patch.score ?? null : existing.score;
  const rounds = patch.rounds ?? existing.rounds;
  const transcriptPath =
    'transcriptPath' in patch ? patch.transcriptPath ?? null : existing.transcriptPath;
  const artifactPath =
    'artifactPath' in patch ? patch.artifactPath ?? null : existing.artifactPath;

  await client.query(
    `UPDATE critique_runs
        SET status = $1,
            score = $2,
            rounds_json = $3,
            transcript_path = $4,
            artifact_path = $5,
            updated_at = $6
      WHERE id = $7`,
    [status, score, serializeRoundsPayload(rounds), transcriptPath, artifactPath, updatedAt, id],
  );

  return getCritiqueRun(client, id);
}

export async function listCritiqueRunsByProject(
  client: PoolClient,
  projectId: string,
): Promise<CritiqueRunRow[]> {
  const res = await client.query(
    `SELECT ${COLS}
       FROM critique_runs
      WHERE project_id = $1
      ORDER BY updated_at DESC`,
    [projectId],
  );
  return res.rows.map(normalizeRow);
}

export async function deleteCritiqueRun(client: PoolClient, id: string): Promise<void> {
  await client.query(`DELETE FROM critique_runs WHERE id = $1`, [id]);
}

export async function markRunInterruptedRecovery(
  client: PoolClient,
  id: string,
  recoveryReason: string,
  now: number = Date.now(),
): Promise<boolean> {
  const existing = await client.query(
    `SELECT ${COLS} FROM critique_runs WHERE id = $1 AND status = 'running'`,
    [id],
  );
  if ((existing.rowCount ?? 0) === 0) return false;
  const { rounds } = parseRoundsPayload(existing.rows[0].roundsJson);
  const newPayload = serializeRoundsPayload(rounds, recoveryReason);
  const result = await client.query(
    `UPDATE critique_runs
        SET status = 'interrupted',
            rounds_json = $1,
            updated_at = $2
      WHERE id = $3 AND status = 'running'`,
    [newPayload, now, id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function reconcileStaleRuns(
  client: PoolClient,
  options: { staleAfterMs: number; now?: number },
): Promise<number> {
  const now = options.now ?? Date.now();
  const cutoff = now - options.staleAfterMs;
  const staleRows = await client.query(
    `SELECT ${COLS}
       FROM critique_runs
      WHERE status = 'running'
        AND updated_at < $1`,
    [cutoff],
  );
  if ((staleRows.rowCount ?? 0) === 0) return 0;
  for (const raw of staleRows.rows) {
    const { rounds } = parseRoundsPayload(raw.roundsJson);
    const newPayload = serializeRoundsPayload(rounds, 'daemon_restart');
    await client.query(
      `UPDATE critique_runs
          SET status = 'interrupted',
              rounds_json = $1,
              updated_at = $2
        WHERE id = $3`,
      [newPayload, now, raw.id],
    );
  }
  return staleRows.rowCount ?? 0;
}
