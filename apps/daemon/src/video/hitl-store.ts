// In-memory HITL (human-in-the-loop) gate store for the video pipeline.
//
// The video pipeline pauses at well-known gates (discovery, script approval,
// references approval, frames approval) and awaits a user reply posted from
// the frontend. The pipeline's await-promise resolver is registered here
// keyed by `${projectId}:${gate}` so the HTTP POST handler can resolve it.

export type HitlGate = 'discovery' | 'script' | 'references' | 'frames';

export interface HitlReply {
  approve: boolean;          // user accepts current output
  notes?: string;            // free-form feedback / change request
  answers?: Record<string, string>; // per-question answers for the discovery gate
}

interface Pending {
  resolve: (r: HitlReply) => void;
  reject: (err: Error) => void;
  expiresAt: number;
}

const pending = new Map<string, Pending>();

function key(projectId: string, gate: HitlGate): string {
  return `${projectId}:${gate}`;
}

export function waitForReply(
  projectId: string,
  gate: HitlGate,
  timeoutMs = 30 * 60 * 1000, // 30 min default — user might take time
): Promise<HitlReply> {
  return new Promise<HitlReply>((resolve, reject) => {
    const k = key(projectId, gate);
    // If there's a stale entry, reject it.
    const prev = pending.get(k);
    if (prev) prev.reject(new Error('superseded by new HITL gate'));
    const timer = setTimeout(() => {
      pending.delete(k);
      reject(new Error(`HITL gate ${gate} timed out`));
    }, timeoutMs);
    pending.set(k, {
      resolve: (r) => { clearTimeout(timer); pending.delete(k); resolve(r); },
      reject: (e) => { clearTimeout(timer); pending.delete(k); reject(e); },
      expiresAt: Date.now() + timeoutMs,
    });
  });
}

export function submitReply(projectId: string, gate: HitlGate, reply: HitlReply): boolean {
  const k = key(projectId, gate);
  const entry = pending.get(k);
  if (!entry) return false;
  entry.resolve(reply);
  return true;
}

export function cancelAll(projectId: string): void {
  for (const [k, entry] of pending.entries()) {
    if (k.startsWith(`${projectId}:`)) entry.reject(new Error('cancelled'));
  }
}
