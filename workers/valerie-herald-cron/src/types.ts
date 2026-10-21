/**
 * Type definitions for Valerie Herald Cloudflare Cron Worker
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 * Parent Story: STORY-VAL-HERALD-AUTONOMOUS
 */

export interface ScheduledEvent {
  cron: string;
  type: string;
  scheduledTime: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface KVNamespace {
  get(key: string, type?: "text" | "json" | "arrayBuffer" | "stream"): Promise<any>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: any): Promise<any>;
}

export interface Env {
  HERALD_AGENT_ENDPOINT?: string;
  CRON_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  WATCHDOG_TRIGGER_SECRET?: string;
  TRIGGER_SECRET?: string;
  MIN_CONTROVERSY_DISPERSION?: string;
  DEFAULT_SCOPE_TIER?: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL";
  DEFAULT_LOCALE?: string;
  GDELT_QUERY?: string;
  MAX_ARTICLES_PER_CLUSTER?: string;
  MAX_CLUSTERS_PER_RUN?: string;
  NEWS_FEED_URLS?: string;
  WATCHDOG_STATE?: KVNamespace;
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  sentiment_score?: number; // -1.0 to 1.0
  published_at?: string;
  domain?: string;
  snippet?: string;
}

export interface NewsCluster {
  headline: string;
  summary: string;
  sources: NewsArticle[];
  controversy_dispersion: number;
  detected_locales: string[];
  scope_tier: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL";
}

export interface DecomposedAxis {
  category: "PRINCIPLE" | "ETHICS_LAW" | "REALPOLITIK";
  question_text: string;
  scope_tier: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL";
  detected_locales: string[];
  cynic_bias_score?: number;
  cynic_feedback?: string;
  attempts?: number;
}

export interface HeraldIngestResult {
  ingest_id: string;
  headline: string;
  status: "auto_published" | "merged_duplicate" | "cynic_rejected" | "skipped_low_controversy" | "failed";
  controversy_dispersion: number;
  duplicate_of_id?: string;
  published_poll_ids?: string[];
  decomposed_axes?: DecomposedAxis[];
  reason?: string;
}

export interface CronRunSummary {
  success: boolean;
  timestamp: string;
  duration_ms: number;
  clusters_evaluated: number;
  clusters_dispatched: number;
  polls_published: number;
  results: HeraldIngestResult[];
  errors: string[];
  dry_run?: boolean;
}
