/**
 * Cloudflare Cron Worker: Valerie Autonomous Herald News Ingestor
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 * Parent Story: STORY-VAL-HERALD-AUTONOMOUS
 *
 * ARCHITECTURAL RESPONSIBILITIES:
 * 1. Cron Trigger Handler:
 *    - Ingests breaking civic, legal, political, and socio-technical news events from GDELT 2.0 & RSS feeds.
 *    - Clusters coverage across diverse sources and computes cross-source controversy variance.
 *    - Filters clusters exceeding dispersion threshold (controversy >= 0.65).
 *    - Dispatches qualified clusters directly to valerie-herald-agent Edge Function for adversarial
 *      de-spinning (Decomposer + Cynic Referee) and auto-publication into valerie.polls.
 * 2. HTTP Fetch Handler:
 *    - Serves sanitized health/readiness probe on root / and /health.
 *    - Serves authenticated manual execution endpoint on /trigger guarded by TRIGGER_SECRET or CRON_SECRET.
 *    - Provides dryRun capability for safe staging verification without database side-effects.
 */

import type { Env, NewsArticle, NewsCluster, CronRunSummary, ScheduledEvent, ExecutionContext } from "./types";
import { fetchGdeltNews } from "./gdelt";
import { fetchRssFeed, DEFAULT_RSS_FEEDS } from "./rss";
import { clusterNewsArticles } from "./clustering";
import { dispatchClusterToHerald, triggerQueueDrain, sanitizeLogContent } from "./heraldClient";

/**
 * Orchestrates one full ingest and dispatch cycle.
 */
export async function executeHeraldCronCycle(
  env: Env,
  dryRun = false,
  overrideArticles?: NewsArticle[]
): Promise<CronRunSummary> {
  const startTime = Date.now();
  const minDispersion = parseFloat(env.MIN_CONTROVERSY_DISPERSION || "0.65");
  const maxClusters = parseInt(env.MAX_CLUSTERS_PER_RUN || "3", 10);
  const errors: string[] = [];

  let articles: NewsArticle[] = overrideArticles ? [...overrideArticles] : [];

  // 1. Harvest articles from GDELT 2.0 (if not overridden by test/mock)
  if (!overrideArticles) {
    const gdeltQuery = env.GDELT_QUERY || "civic OR policy OR legislation OR congress OR court OR election";

    try {
      const gdeltArticles = await fetchGdeltNews(gdeltQuery, 30);
      articles.push(...gdeltArticles);
    } catch (err: unknown) {
      const msg = `GDELT fetch error: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(sanitizeLogContent(msg));
    }

    // 2. Supplement / Fallback from RSS feeds if GDELT returned fewer than 5 items
    if (articles.length < 5) {
      const feedUrls = env.NEWS_FEED_URLS
        ? env.NEWS_FEED_URLS.split(",").map((s) => s.trim()).filter(Boolean)
        : DEFAULT_RSS_FEEDS;

      for (const feedUrl of feedUrls) {
        try {
          const feedArticles = await fetchRssFeed(feedUrl);
          articles.push(...feedArticles);
        } catch (err: unknown) {
          errors.push(sanitizeLogContent(`RSS fetch error (${feedUrl}): ${String(err)}`));
        }
      }
    }
  }

  // 3. Cluster articles and compute cross-source controversy dispersion
  const clusters = clusterNewsArticles(articles);
  const qualifyingClusters = clusters
    .filter((c) => c.controversy_dispersion >= minDispersion)
    .slice(0, maxClusters);

  const results = [];
  let publishedPolls = 0;

  // 4. Dispatch qualifying clusters to valerie-herald-agent
  for (const cluster of qualifyingClusters) {
    const res = await dispatchClusterToHerald(cluster, env, 15000, dryRun);
    results.push(res);
    if (res.status === "auto_published" && Array.isArray(res.published_poll_ids)) {
      publishedPolls += res.published_poll_ids.length;
    }
  }

  // 5. If no new clusters qualified, trigger drain of any pending items in valerie.news_ingest_queue
  if (qualifyingClusters.length === 0 && !dryRun) {
    await triggerQueueDrain(env);
  }

  return {
    success: errors.length === 0 || results.length > 0,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    clusters_evaluated: clusters.length,
    clusters_dispatched: qualifyingClusters.length,
    polls_published: publishedPolls,
    results,
    errors,
    dry_run: dryRun,
  };
}

export default {
  /**
   * Cloudflare Cron Trigger Handler
   * Triggers automatically according to wrangler.jsonc schedule (e.g. 0 *\/2 * * *)
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      executeHeraldCronCycle(env).then((summary) => {
        console.log(
          JSON.stringify({
            level: "info",
            event: "VALERIE_HERALD_CRON_COMPLETED",
            dispatched: summary.clusters_dispatched,
            published_polls: summary.polls_published,
            duration_ms: summary.duration_ms,
            timestamp: summary.timestamp,
          })
        );
      })
    );
  },

  /**
   * HTTP Fetch Handler
   * Serves public health probe and authenticated manual /trigger endpoint
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Manual Ingestion Trigger: /trigger
    if (url.pathname === "/trigger") {
      const authHeader = request.headers.get("authorization") || "";
      const cronSecretHeader = request.headers.get("x-cron-secret") || "";
      const triggerKeyHeader = request.headers.get("x-trigger-secret") || "";

      const expectedSecret = env.TRIGGER_SECRET || env.WATCHDOG_TRIGGER_SECRET || env.CRON_SECRET;

      if (!expectedSecret) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Manual trigger is disabled because TRIGGER_SECRET is not configured." }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }

      const isAuthorized =
        cronSecretHeader === expectedSecret ||
        triggerKeyHeader === expectedSecret ||
        authHeader === `Bearer ${expectedSecret}`;

      if (!isAuthorized) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Missing or invalid trigger secret." }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      let isDryRun = url.searchParams.get("dryRun") === "true";
      let overrideArticles: NewsArticle[] | undefined;

      if (request.method === "POST") {
        try {
          const body = (await request.json()) as { dryRun?: boolean; articles?: NewsArticle[] };
          if (typeof body.dryRun === "boolean") isDryRun = body.dryRun;
          if (Array.isArray(body.articles)) overrideArticles = body.articles;
        } catch {
          // No body or plain POST
        }
      }

      const summary = await executeHeraldCronCycle(env, isDryRun, overrideArticles);

      return new Response(JSON.stringify(summary, null, 2), {
        status: summary.success ? 200 : 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Public Health & Schedule Probe: / or /health
    return new Response(
      JSON.stringify(
        {
          service: "valerie-herald-cron",
          version: "1.0.0",
          schedule: "0 */2 * * *",
          description: "Cloudflare Cron Worker for Valerie Autonomous Controversial Headline Agent",
          min_controversy_dispersion: env.MIN_CONTROVERSY_DISPERSION || "0.65",
          herald_agent_configured: Boolean(env.HERALD_AGENT_ENDPOINT),
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  },
};
