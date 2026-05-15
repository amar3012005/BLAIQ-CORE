import { expandConfiguredEnv } from './paths.js';
import { buildSandboxedSpawnEnv } from '../agents/sandboxed-spawn.js';

type RuntimeEnvMap = NodeJS.ProcessEnv | Record<string, string>;

// Build the env passed to spawn() for a given agent adapter.
//
// The claude adapter strips ANTHROPIC_API_KEY so Claude Code's own auth
// resolution (claude login / Pro/Max plan) wins instead of silently
// falling back to API-key billing whenever the daemon happened to be
// launched from a shell that exported the key for SDK or scripting use.
// See issue #398.
//
// However, when ANTHROPIC_BASE_URL is set the user is intentionally
// routing Claude Code to a custom endpoint (e.g. a Kimi/Moonshot proxy).
// In that case claude login is meaningless, so preserve the API key so
// the child can authenticate against the custom base URL.
//
// Windows env-var names are case-insensitive at the kernel level
// (`GetEnvironmentVariable`), but spreading `process.env` into a plain
// object loses Node's case-insensitive accessor — `Anthropic_Api_Key`
// would survive a literal `delete env.ANTHROPIC_API_KEY` and still reach
// the child. Iterate keys and compare case-insensitively to close that.
export function spawnEnvForAgent(
  agentId: string,
  baseEnv: RuntimeEnvMap,
  configuredEnv: unknown = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...expandConfiguredEnv(configuredEnv),
  };
  applyClaudeAuthHandling(agentId, env);
  return env;
}

/**
 * Multi-tenant spawn env builder. Replaces spawnEnvForAgent when the
 * daemon runs in hosted mode. Forces a sandboxed env scoped to the
 * tenant + project so one tenant's spawn cannot read another tenant's
 * env, CWD, or HOME.
 *
 * Callers (runs.ts) MUST use this variant in multi-tenant mode. Any
 * call site that still goes through spawnEnvForAgent leaks the daemon
 * env to the child and is a security bug.
 */
export function spawnEnvForTenantAgent(
  agentId: string,
  tenantId: string,
  projectId: string,
  configuredEnv: unknown = {},
): { env: NodeJS.ProcessEnv; cwd: string } {
  const { env, cwd } = buildSandboxedSpawnEnv({
    tenantId,
    projectId,
    extraValues: expandConfiguredEnv(configuredEnv) as Record<string, string | undefined>,
  });
  applyClaudeAuthHandling(agentId, env);
  return { env, cwd };
}

function applyClaudeAuthHandling(agentId: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (agentId !== 'claude') return env;
  const hasCustomBaseUrl = Object.keys(env).some(
    (k) =>
      k.toUpperCase() === 'ANTHROPIC_BASE_URL' &&
      typeof env[k] === 'string' &&
      env[k].trim() !== '',
  );
  if (hasCustomBaseUrl) return env;
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ANTHROPIC_API_KEY') delete env[key];
  }
  return env;
}
