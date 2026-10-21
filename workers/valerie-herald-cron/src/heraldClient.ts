/**
 * Valerie Herald Agent Client & Ingest Dispatcher
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 *
 * Interfaces with the deployed valerie-herald-agent Edge Function:
 * 1. Dispatches qualifying controversial news clusters for IRT decomposition.
 * 2. Triggers queue drains for pending background items.
 * 3. Enforces strict network timeouts, credential redaction, and error resiliency.
 */

import type { Env, NewsCluster, HeraldIngestResult, CronRunSummary } from "./types";

const SENSITIVE_PARAM_REGEX = /([a-z0-9_-]*(?:token|password|authorization|cookie|service_role_key|api_key|secret|key))\s*[:=]\s*([^\s,"'&]+)/gi;
const BEARER_TOKEN_REGEX = /(Bearer\s+)[A-Za-z0-9_\-.]+/gi;
const JWT_TOKEN_REGEX = /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+/g;

/**
 * Redacts tokens, passwords, bearer tokens, headers, and JWTs from logs and error strings.
 */
export function sanitizeLogContent(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "string" ? val : JSON.stringify(val);
  return str
    .replace(BEARER_TOKEN_REGEX, "$1[REDACTED]")
    .replace(JWT_TOKEN_REGEX, "[REDACTED_JWT]")
    .replace(SENSITIVE_PARAM_REGEX, "$1: [REDACTED]");
}

/**
 * Builds request headers for communicating with valerie-herald-agent.
 */
export function buildHeraldHeaders(env: Env): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Valerie-Herald-Cron-Worker/1.0",
  };

  if (env.CRON_SECRET) {
    headers["x-cron-secret"] = env.CRON_SECRET;
  }

  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    headers["Authorization"] = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  }

  return headers;
}

/**
 * Dispatches a single news cluster to valerie-herald-agent.
 */
export async function dispatchClusterToHerald(
  cluster: NewsCluster,
  env: Env,
  timeoutMs = 15000,
  dryRun = false
): Promise<HeraldIngestResult> {
  const endpoint = env.HERALD_AGENT_ENDPOINT;
  if (!endpoint) {
    return {
      ingest_id: crypto.randomUUID(),
      headline: cluster.headline,
      status: "failed",
      controversy_dispersion: cluster.controversy_dispersion,
      reason: "HERALD_AGENT_ENDPOINT environment variable is not configured.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      ...cluster,
      dryRun,
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: buildHeraldHeaders(env),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        ingest_id: crypto.randomUUID(),
        headline: cluster.headline,
        status: "failed",
        controversy_dispersion: cluster.controversy_dispersion,
        reason: `Herald agent returned HTTP ${res.status}: ${sanitizeLogContent(errText.slice(0, 300))}`,
      };
    }

    const data = (await res.json()) as HeraldIngestResult;
    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ingest_id: crypto.randomUUID(),
      headline: cluster.headline,
      status: "failed",
      controversy_dispersion: cluster.controversy_dispersion,
      reason: `Dispatch exception: ${sanitizeLogContent(msg)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Triggers background queue sweep on valerie-herald-agent without new cluster payload.
 */
export async function triggerQueueDrain(env: Env, timeoutMs = 15000): Promise<unknown> {
  const endpoint = env.HERALD_AGENT_ENDPOINT;
  if (!endpoint) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: buildHeraldHeaders(env),
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    return await res.json();
  } catch (err: unknown) {
    console.warn(`[Herald] Queue drain failed: ${sanitizeLogContent(String(err))}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
