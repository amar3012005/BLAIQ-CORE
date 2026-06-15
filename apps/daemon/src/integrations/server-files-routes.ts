// BLAIQ daemon server-files routes — the "Server" track of the job workflow.
// Creates and lists per-job delivery folders on the daemon's data volume
// (BLAIQ_SERVER_FILES_ROOT, default <OD_DATA_DIR>/clients). This stands in for
// the agency's delivery server/NAS; pointing it at a real SFTP target later is
// a config swap behind the same two endpoints.
//
//   POST /api/v1/org/server/folder  { client, job_number }  -> { ok, path }
//   GET  /api/v1/org/server/files?path=<abs-under-root>      -> { ok, files[] }
//
// Auth: session (web) or the ops-brain trust fallback (server-to-server).

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../db/tenant-context.js';

function filesRoot(): string {
  const fromEnv = process.env.BLAIQ_SERVER_FILES_ROOT;
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  const dataDir = process.env.OD_DATA_DIR || '/data';
  return path.resolve(dataDir, 'clients');
}

function requireTenant(req: Request, res: Response): string | null {
  const tenantId =
    (req as AuthenticatedRequest).tenantId ??
    (req as AuthenticatedRequest).user?.tenantId ??
    (req.header('x-tenant-id') ?? undefined);
  if (!tenantId || typeof tenantId !== 'string') {
    res.status(401).json({ error: 'tenant context missing' });
    return null;
  }
  return tenantId;
}

// Collapse a user-supplied path segment to a single safe folder name: keep it
// a basename, strip traversal, allow only sane filename characters.
function safeSegment(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value : '';
  const base = path.basename(raw).replace(/[^\w.\- ]+/g, '_').trim();
  return base.length > 0 ? base : fallback;
}

async function handleCreateFolder(req: Request, res: Response): Promise<void> {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;
  const body = (req.body ?? {}) as { client?: unknown; job_number?: unknown };
  const client = safeSegment(body.client, 'Unsorted');
  const jobNumber = safeSegment(body.job_number, '');
  if (!jobNumber) {
    res.status(400).json({ ok: false, error: 'job_number is required' });
    return;
  }
  // Per-tenant root so tenants never see each other's folders.
  const dir = path.join(filesRoot(), tenantId, client, jobNumber);
  try {
    await fs.mkdir(dir, { recursive: true });
    // Drop a marker so the folder is non-empty and the listing has something
    // to show even before any deliverables land.
    const marker = path.join(dir, '_job.txt');
    try {
      await fs.access(marker);
    } catch {
      await fs.writeFile(marker, `BLAIQ job folder\nclient: ${client}\njob: ${jobNumber}\n`, 'utf8');
    }
    res.status(200).json({ ok: true, path: dir });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

async function handleListFiles(req: Request, res: Response): Promise<void> {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;
  const root = filesRoot();
  const tenantRoot = path.join(root, tenantId);
  const requested = typeof req.query.path === 'string' && req.query.path.length > 0
    ? path.resolve(req.query.path)
    : tenantRoot;
  // Sandbox: only ever list inside this tenant's root.
  if (requested !== tenantRoot && !requested.startsWith(tenantRoot + path.sep)) {
    res.status(403).json({ ok: false, error: 'path outside tenant root' });
    return;
  }
  try {
    const entries = await fs.readdir(requested, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (e) => {
        const full = path.join(requested, e.name);
        let size = 0;
        let mtime = 0;
        try {
          const st = await fs.stat(full);
          size = st.size;
          mtime = Math.round(st.mtimeMs);
        } catch {
          /* ignore */
        }
        return { name: e.name, dir: e.isDirectory(), size, mtime };
      }),
    );
    files.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    res.status(200).json({ ok: true, path: requested, files });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      res.status(200).json({ ok: true, path: requested, files: [] });
      return;
    }
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

export function registerServerFilesRoutes(app: Express): void {
  app.post('/api/v1/org/server/folder', (req: Request, res: Response): void => {
    void handleCreateFolder(req, res);
  });
  app.get('/api/v1/org/server/files', (req: Request, res: Response): void => {
    void handleListFiles(req, res);
  });
}
