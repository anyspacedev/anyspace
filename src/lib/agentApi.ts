import { agentApiInfo, type AgentApiInfo } from "./tauri";

let cached: AgentApiInfo | null = null;
let inflight: Promise<AgentApiInfo> | null = null;

/**
 * Fetch the loopback API URL + bearer token once and cache. Code-Agent
 * launchers (solo + team) read this to inject ANYSPACE_API_URL/TOKEN into
 * every spawned terminal's child env. Idempotent.
 */
export async function ensureAgentApi(): Promise<AgentApiInfo> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = agentApiInfo()
    .then((info) => {
      cached = info;
      return info;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function getCachedAgentApi(): AgentApiInfo | null {
  return cached;
}

/**
 * Build the env block we merge into a Code Agent's PTY spawn. The launcher
 * is responsible for setting ANYSPACE_PANE_ID + ANYSPACE_TAB_ID after it
 * knows which pane the agent will live in.
 */
export function agentApiEnv(): Record<string, string> {
  if (!cached) return {};
  return {
    ANYSPACE_API_URL: cached.url,
    ANYSPACE_API_TOKEN: cached.token,
  };
}
