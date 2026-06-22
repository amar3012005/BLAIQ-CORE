// Tenant-level spokesperson store — a reusable on-brand presenter the crew can
// cast into any project (image studio) or video render (the Director's casting).
// Stored tenant-scoped on disk (image file + JSON registry) so it survives
// across projects and feeds both pipelines — no DB migration required.

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

const TENANT_ASSETS_DIR = process.env.OD_DATA_DIR
  ? path.join(process.env.OD_DATA_DIR, 'tenant-assets')
  : path.join(process.cwd(), '.od', 'tenant-assets');

export interface SpokespersonEntry { id: string; name: string; file: string; created_at: number; }
export interface SpokespersonDto { id: string; name: string; url: string; created_at: number; }

export function spokesDir(tenantId: string): string {
  return path.join(TENANT_ASSETS_DIR, tenantId, 'spokespersons');
}

export async function readSpokesRegistry(dir: string): Promise<SpokespersonEntry[]> {
  try {
    const raw = await fs.readFile(path.join(dir, 'registry.json'), 'utf8');
    const parsed = JSON.parse(raw) as { items?: SpokespersonEntry[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export async function writeSpokesRegistry(dir: string, items: SpokespersonEntry[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'registry.json'), JSON.stringify({ items }, null, 2));
}

export function spokesDto(e: SpokespersonEntry): SpokespersonDto {
  return { id: e.id, name: e.name, url: `/api/v1/spokespersons/${e.id}/image`, created_at: e.created_at };
}

export function isSpokespersonId(id: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(id);
}

// Save a spokesperson from a base64 PNG data URI; returns the new entry.
export async function saveSpokesperson(tenantId: string, name: string, imageData: string): Promise<SpokespersonEntry> {
  const m = imageData.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
  if (!m || !m[1]) throw new Error('image_data (png/jpeg data URI) required');
  const dir = spokesDir(tenantId);
  const id = randomUUID();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.png`), Buffer.from(m[1], 'base64'));
  const items = await readSpokesRegistry(dir);
  const entry: SpokespersonEntry = {
    id,
    name: (name || 'Spokesperson').toString().trim().slice(0, 80) || 'Spokesperson',
    file: `${id}.png`,
    created_at: Date.now(),
  };
  items.unshift(entry);
  await writeSpokesRegistry(dir, items.slice(0, 50));
  return entry;
}

export async function listSpokespersons(tenantId: string): Promise<SpokespersonDto[]> {
  return (await readSpokesRegistry(spokesDir(tenantId))).map(spokesDto);
}

// Read a pinned spokesperson's image bytes (null if missing / bad id).
export async function readSpokespersonImage(tenantId: string, id: string): Promise<Buffer | null> {
  if (!isSpokespersonId(id)) return null;
  try {
    return await fs.readFile(path.join(spokesDir(tenantId), `${id}.png`));
  } catch {
    return null;
  }
}

// Convenience: a pinned spokesperson as a data URI (for use as an LLM image ref).
export async function spokespersonDataUri(tenantId: string, id: string): Promise<string | null> {
  const buf = await readSpokespersonImage(tenantId, id);
  return buf ? `data:image/png;base64,${buf.toString('base64')}` : null;
}

// Rename a pinned spokesperson. Returns false if the id is unknown.
export async function renameSpokesperson(tenantId: string, id: string, name: string): Promise<boolean> {
  if (!isSpokespersonId(id)) return false;
  const dir = spokesDir(tenantId);
  const items = await readSpokesRegistry(dir);
  const entry = items.find((e) => e.id === id);
  if (!entry) return false;
  entry.name = (name || 'Spokesperson').toString().trim().slice(0, 80) || 'Spokesperson';
  await writeSpokesRegistry(dir, items);
  return true;
}

// Delete a pinned spokesperson (registry entry + image file). Idempotent.
export async function deleteSpokesperson(tenantId: string, id: string): Promise<boolean> {
  if (!isSpokespersonId(id)) return false;
  const dir = spokesDir(tenantId);
  const items = await readSpokesRegistry(dir);
  const next = items.filter((e) => e.id !== id);
  if (next.length === items.length) return false;
  await writeSpokesRegistry(dir, next);
  try { await fs.unlink(path.join(dir, `${id}.png`)); } catch { /* already gone */ }
  return true;
}
