// Sandboxed environment builder for agent subprocesses in the
// multi-tenant deploy.
//
// Why this exists: the local daemon spawns CLIs (claude, codex, qoder,
// copilot, etc.) with the caller's full environment so the CLI picks up
// user creds, PATH, NVM dirs, etc. In a hosted multi-tenant container
// this is dangerous:
//
//   - One tenant's API key must not leak into another tenant's spawn.
//   - Arbitrary env from a request body must never reach the child.
//   - The child must not write outside the tenant's project dir.
//
// `buildSandboxedSpawnEnv` returns a minimal env containing only:
//   - PATH (from the daemon's own process)
//   - HOME (pointed at a tenant-scoped scratch dir, not the OS user's home)
//   - NODE_ENV
//   - Shared LLM provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...)
//   - Any explicit allowlisted vars the caller passes
//   - OD_TENANT_ID, OD_PROJECT_ID so child telemetry can attribute usage
//
// CWD is always the tenant's project dir; `resolveTenantPath` blocks
// `..` traversal at the API boundary.

import path from 'node:path';
import fs from 'node:fs';
import { projectRoot } from '../storage/tenant-paths.js';

const SHARED_LLM_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  // Route the bundled Claude Code CLI through a custom provider (e.g. OpenRouter's
  // Anthropic-compatible endpoint) so agent missions run server-side without an
  // interactive `claude login`. Forwarded into the tenant sandbox so the spawned
  // CLI can authenticate + pick the provider model.
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'DISABLE_INTERLEAVED_THINKING',
  'MAX_THINKING_TOKENS',
];

// Vars that are always safe to forward from the daemon's own env.
const PASSTHROUGH = ['PATH', 'NODE_ENV', 'LANG', 'LC_ALL', 'TZ'];

export interface SandboxedSpawn {
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export function buildSandboxedSpawnEnv(input: {
  tenantId: string;
  projectId: string;
  /**
   * Extra env keys the caller knows are safe (e.g. agent-specific
   * config like CLAUDE_MODEL). Only vars whose values come from the
   * daemon's trusted env or static config should be added here; never
   * forward unvalidated request-body strings.
   */
  extraAllowlist?: string[];
  /**
   * Vars whose values are computed at the call site and known to be
   * safe (no request-body interpolation). Whitelisted by key name.
   */
  extraValues?: Record<string, string | undefined>;
}): SandboxedSpawn {
  const cwd = projectRoot(input.tenantId, input.projectId);
  // Create the project scratch dir on first spawn so child processes
  // can `chdir` into it. Other writes funnel through resolveTenantPath.
  fs.mkdirSync(cwd, { recursive: true });

  const tenantHome = path.join(cwd, '.home');
  fs.mkdirSync(tenantHome, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    HOME: tenantHome,
    OD_TENANT_ID: input.tenantId,
    OD_PROJECT_ID: input.projectId,
  };

  for (const key of PASSTHROUGH) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  for (const key of SHARED_LLM_KEYS) {
    const v = process.env[key];
    if (v !== undefined && v.length > 0) env[key] = v;
  }
  if (input.extraAllowlist) {
    for (const key of input.extraAllowlist) {
      if (!isSafeEnvKey(key)) continue;
      const v = process.env[key];
      if (v !== undefined) env[key] = v;
    }
  }
  if (input.extraValues) {
    for (const [key, value] of Object.entries(input.extraValues)) {
      if (!isSafeEnvKey(key)) continue;
      if (typeof value === 'string' && value.length > 0) env[key] = value;
    }
  }

  return { env, cwd };
}

function isSafeEnvKey(key: string): boolean {
  // POSIX env var names: [A-Z_][A-Z0-9_]*. Reject `LD_PRELOAD`,
  // `DYLD_*`, `NODE_OPTIONS` (could inject `--require`), and other
  // loader-related vars that can pwn the child.
  if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) return false;
  if (key === 'LD_PRELOAD' || key === 'LD_LIBRARY_PATH') return false;
  if (key.startsWith('DYLD_')) return false;
  if (key === 'NODE_OPTIONS') return false;
  return true;
}
