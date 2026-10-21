/**
 * Project Valerie: Herald Autonomous Headline Agent & Adversarial De-Spinning Pipeline
 * File: supabase/functions/valerie-herald-agent/index.ts
 * Work Item: TASK-VAL-HERALD-EDGE-AGENT
 * Parent Story: STORY-VAL-HERALD-AUTONOMOUS
 *
 * ARCHITECTURAL PILLARS:
 * 1. Scheduled Ingestion & Controversy Variance Filtering:
 *    - Ingests breaking political, legal, environmental, and civic stories.
 *    - Computes cross-source sentiment variance; selects clusters with dispersion >= 0.65.
 * 2. Semantic Deduplication (pgvector):
 *    - Generates 1536-dim embedding (text-embedding-3-small).
 *    - Queries valerie.news_ingest_queue & valerie.topic_clusters via cosine distance (<=>).
 *    - Merges duplicates if similarity > 0.90 within 72-hour sliding window.
 * 3. Adversarial Dual-Agent IRT Decomposition:
 *    - Agent 1 (The Decomposer): Extracts 3 orthogonal propositions (PRINCIPLE, ETHICS_LAW, REALPOLITIK).
 *    - Agent 2 (The Cynic Referee): Blind audit for partisan framing ('red-penning') or leading premises.
 *      Rejection threshold: cynic_bias_score >= 0.15 (triggers up to 2 rewrites before 'cynic_rejected').
 * 4. Tooltip Pre-Warming & Auto-Publication:
 *    - Pre-warms SHA-256 content_cache definitions and links PatchWork/Speak for the Dead UUIDs.
 *    - Inserts passing polls directly into valerie.polls (is_active = true) and updates ingest lineage.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cosineSimilarity,
  cosineDistance,
  l2Normalize,
  VECTOR_DIM,
} from "../valerie-cluster-engine/vector-math.ts";
import {
  prewarmAndLink,
  generateDeterministicEmbedding,
  formatVectorForPg,
} from "./prewarmAndLink.ts";

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  sentiment_score?: number; // -1.0 to 1.0
  published_at?: string;
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
  status: "auto_published" | "merged_duplicate" | "cynic_rejected" | "skipped_low_controversy" | "failed" | "already_claimed";
  controversy_dispersion: number;
  duplicate_of_id?: string;
  published_poll_ids?: string[];
  decomposed_axes?: DecomposedAxis[];
  reason?: string;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

/**
 * Calculates cross-source sentiment variance (dispersion) across multiple coverage perspectives.
 */
export function calculateControversyDispersion(articles: NewsArticle[]): number {
  if (articles.length < 2) return 0.0;
  const scores = articles.map((a) => (typeof a.sentiment_score === "number" ? a.sentiment_score : 0.0));
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / (scores.length - 1);
  // Normalize dispersion to 0.0 - 1.0 scale
  return Math.min(1.0, Math.sqrt(variance) * 1.5);
}

/**
 * Generates 1536-D embedding using text-embedding-3-small or fallback generator.
 */
export async function getEventEmbedding(
  text: string,
  openaiApiKey?: string
): Promise<number[]> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text,
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const emb = json.data?.[0]?.embedding;
        if (Array.isArray(emb) && emb.length === VECTOR_DIM) {
          return emb;
        }
      }
    } catch {
      // Fallback
    }
  }

  return generateDeterministicEmbedding(text);
}

export function stripPartisanFraming(text: string): string {
  const partisanPattern = /\b(corrupt|draconian|tyrannical|reckless|disastrous|unhinged|evil|common\s+sense|obviously|clearly|weaponized|radical|threat\s+to\s+democracy|unjust|authoritarian|woke|fascist|crooked)\b/gi;
  return text
    .replace(/^Breaking:\s*/i, "")
    .replace(partisanPattern, "")
    .replace(/[!]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Agent 1: The Decomposer
 * Deconstructs the breaking news event into 3 orthogonal propositions:
 * 1. PRINCIPLE (core value axioms)
 * 2. ETHICS_LAW (statutory/constitutional framework)
 * 3. REALPOLITIK (economic/pragmatic trade-offs)
 */
export async function agent1DecomposeEvent(
  headline: string,
  summary: string,
  openaiApiKey?: string,
  retryCategory?: string,
  previousFeedback?: string,
  scopeTier: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL" = "NATIONAL",
  detectedLocales: string[] = ["US"]
): Promise<DecomposedAxis[]> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: `You are Agent 1 (The Decomposer) for Project Valerie. Deconstruct the breaking headline into 3 orthogonal propositions for bivariate polling:
1. "PRINCIPLE" (foundational philosophy or value premise)
2. "ETHICS_LAW" (constitutional rights, statutory authority, or legal boundaries)
3. "REALPOLITIK" (implementation trade-offs, economic costs, or administrative feasibility)

CRITICAL RULES:
- Phrased for a -2 (Strongly Disagree) to +2 (Strongly Agree) Likert slider.
- NEVER use loaded partisan adjectives, emotional phrasing, or biased framing.
- Format strictly as a JSON array of 3 objects with properties: "category", "question_text", "scope_tier" ('LOCAL'|'STATE'|'NATIONAL'|'GLOBAL'), and "detected_locales" (array of strings). Zero commentary.`,
            },
            {
              role: "user",
              content: `Headline: "${headline}"\nSummary: "${summary}"${
                retryCategory ? `\nREVISE CATEGORY '${retryCategory}': Previous attempt rejected for: ${previousFeedback}. Rephrase with complete neutrality.` : ""
              }`,
            },
          ],
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "[]";
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          return parsed.slice(0, 3).map((item) => ({
            category: item.category,
            question_text: item.question_text,
            scope_tier: item.scope_tier || scopeTier,
            detected_locales: Array.isArray(item.detected_locales) && item.detected_locales.length > 0 ? item.detected_locales : detectedLocales,
            attempts: 1,
          }));
        }
      }
    } catch {
      // Fallback below
    }
  }

  // Deterministic neutral decomposition fallback preserving actual jurisdiction
  const cleanHeadline = stripPartisanFraming(headline);
  return [
    {
      category: "PRINCIPLE",
      question_text: `Whether public policy should prioritize collective civic stability over individual transactional autonomy in matters concerning ${cleanHeadline.toLowerCase()}.`,
      scope_tier: scopeTier,
      detected_locales: detectedLocales,
      attempts: 1,
    },
    {
      category: "ETHICS_LAW",
      question_text: `Whether statutory regulatory authority should supersede local municipality self-determination regarding ${cleanHeadline.toLowerCase()}.`,
      scope_tier: scopeTier,
      detected_locales: detectedLocales,
      attempts: 1,
    },
    {
      category: "REALPOLITIK",
      question_text: `Whether the immediate fiscal and economic compliance expenditures associated with ${cleanHeadline.toLowerCase()} are justified by long-term structural outcomes.`,
      scope_tier: scopeTier,
      detected_locales: detectedLocales,
      attempts: 1,
    },
  ];
}

/**
 * Agent 2: The Cynic Referee
 * Audits drafted questions BLIND to the source headline.
 * Detects partisan framing, emotional connotation ('red-penning'), or leading premises.
 * Outputs cynic_bias_score (0.0 to 1.0).
 */
export async function agent2CynicReferee(
  questionText: string,
  openaiApiKey?: string
): Promise<{ cynic_bias_score: number; feedback: string }> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.0,
          messages: [
            {
              role: "system",
              content:
                "You are Agent 2 (The Red-Pen Cynic Referee) for Valerie. You audit questions BLIND to their origin. Your job is to strictly detect any partisan framing, emotional adjectives, leading premises, or subtle slant. Return ONLY a valid JSON object: {\"cynic_bias_score\": <number from 0.0 to 1.0>, \"feedback\": \"<concise explanation>\"}.",
            },
            {
              role: "user",
              content: `Audit this proposition for bias:\n"${questionText}"`,
            },
          ],
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "{}";
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.cynic_bias_score === "number") {
          return {
            cynic_bias_score: Math.max(0.0, Math.min(1.0, parsed.cynic_bias_score)),
            feedback: parsed.feedback || "Evaluated by Cynic Referee",
          };
        }
      }
    } catch {
      // Fallback
    }
  }

  // Heuristic Red-Pen Cynic audit
  const biasedTerms = [
    "obviously",
    "clearly",
    "reckless",
    "draconian",
    "tyrannical",
    "disastrous",
    "common sense",
    "corrupt",
    "unhinged",
    "evil",
    "threat to democracy",
    "extremist",
    "woke",
    "fascist",
  ];

  const lower = questionText.toLowerCase();
  let score = 0.04;
  const detected: string[] = [];

  for (const term of biasedTerms) {
    if (lower.includes(term)) {
      score += 0.35;
      detected.push(term);
    }
  }

  return {
    cynic_bias_score: Math.min(1.0, score),
    feedback: detected.length > 0 ? `Flagged loaded markers: ${detected.join(", ")}` : "Passed neutral framing checks",
  };
}

/**
 * Runs the Adversarial Referee Loop between Agent 1 and Agent 2.
 * Enforces cynic_bias_score < 0.15 with up to 2 rewrites.
 */
export async function runAdversarialRefereePipeline(
  headline: string,
  summary: string,
  openaiApiKey?: string,
  scopeTier: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL" = "NATIONAL",
  detectedLocales: string[] = ["US"]
): Promise<{ passed: boolean; axes: DecomposedAxis[]; rejectedReason?: string }> {
  // Step 1: Agent 1 initial decomposition
  const axes = await agent1DecomposeEvent(
    headline,
    summary,
    openaiApiKey,
    undefined,
    undefined,
    scopeTier,
    detectedLocales
  );

  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    let attempts = 1;
    let audit = await agent2CynicReferee(axis.question_text, openaiApiKey);

    // If score >= 0.15, force rewrite up to 2 times
    while (audit.cynic_bias_score >= 0.15 && attempts <= 2) {
      attempts++;
      const revisedAxes = await agent1DecomposeEvent(
        headline,
        summary,
        openaiApiKey,
        axis.category,
        audit.feedback,
        scopeTier,
        detectedLocales
      );
      const matchingRevised = revisedAxes.find((a) => a.category === axis.category) || revisedAxes[0];
      if (matchingRevised) {
        axis.question_text = matchingRevised.question_text;
      }
      audit = await agent2CynicReferee(axis.question_text, openaiApiKey);
    }

    axis.cynic_bias_score = audit.cynic_bias_score;
    axis.cynic_feedback = audit.feedback;
    axis.attempts = attempts;

    if (audit.cynic_bias_score >= 0.15) {
      return {
        passed: false,
        axes,
        rejectedReason: `Axis ${axis.category} failed cynic audit after ${attempts} attempts (score: ${audit.cynic_bias_score.toFixed(3)} >= 0.15): ${audit.feedback}`,
      };
    }
  }

  return {
    passed: true,
    axes,
  };
}

/**
 * Checks for duplicate event in valerie.news_ingest_queue within 72 hours via pgvector.
 */
export async function checkSemanticDeduplication(
  eventEmbedding: number[],
  supabase?: any,
  excludeIngestId?: string
): Promise<{ isDuplicate: boolean; duplicateId?: string; existingUrls?: string[]; clusterId?: string }> {
  if (!supabase) {
    return { isDuplicate: false };
  }

  try {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    // 1. Check recent news_ingest_queue entries within 72h
    const { data: recentIngests } = await supabase
      .schema("valerie")
      .from("news_ingest_queue")
      .select("id, event_title, event_embedding, source_urls, status")
      .gte("created_at", seventyTwoHoursAgo)
      .neq("status", "merged_duplicate")
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(100);

    if (Array.isArray(recentIngests)) {
      for (const row of recentIngests) {
        if (!row.event_embedding || row.id === excludeIngestId) continue;
        let rowVec: number[];
        if (Array.isArray(row.event_embedding)) {
          rowVec = row.event_embedding;
        } else if (typeof row.event_embedding === "string") {
          rowVec = row.event_embedding
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s: string) => parseFloat(s.trim()));
        } else {
          continue;
        }

        const sim = cosineSimilarity(eventEmbedding, rowVec);
        if (sim > 0.90) {
          const urls = Array.isArray(row.source_urls) ? row.source_urls : [];
          return {
            isDuplicate: true,
            duplicateId: row.id,
            existingUrls: urls,
          };
        }
      }
    }

    // 2. Check active centroids in valerie.topic_clusters
    const { data: activeClusters } = await supabase
      .schema("valerie")
      .from("topic_clusters")
      .select("id, cluster_name, centroid_vector")
      .eq("is_active", true)
      .limit(100);

    if (Array.isArray(activeClusters)) {
      for (const cluster of activeClusters) {
        if (!cluster.centroid_vector) continue;
        let clusterVec: number[];
        if (Array.isArray(cluster.centroid_vector)) {
          clusterVec = cluster.centroid_vector;
        } else if (typeof cluster.centroid_vector === "string") {
          clusterVec = cluster.centroid_vector
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map((s: string) => parseFloat(s.trim()));
        } else {
          continue;
        }

        const sim = cosineSimilarity(eventEmbedding, clusterVec);
        if (sim > 0.90) {
          return {
            isDuplicate: true,
            clusterId: cluster.id,
          };
        }
      }
    }
  } catch {
    // Database query fallback
  }

  return { isDuplicate: false };
}

/**
 * Ingests a single news story cluster through the full Herald pipeline.
 */
export async function processHeraldIngest(
  cluster: NewsCluster,
  options?: {
    supabase?: any;
    openaiApiKey?: string;
    dryRun?: boolean;
    existingIngestId?: string;
  }
): Promise<HeraldIngestResult> {
  const supabase = options?.supabase;
  const ingestId = options?.existingIngestId || crypto.randomUUID();

  // 1. Controversy Dispersion Check
  if (cluster.controversy_dispersion < 0.65) {
    if (supabase && options?.existingIngestId && !options?.dryRun) {
      await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .update({
          status: "skipped_low_controversy",
          metadata: {
            reason: `Controversy dispersion (${cluster.controversy_dispersion.toFixed(3)}) is below the required 0.65 threshold.`,
            evaluated_at: new Date().toISOString(),
          },
        })
        .eq("id", ingestId);
    }

    return {
      ingest_id: ingestId,
      headline: cluster.headline,
      status: "skipped_low_controversy",
      controversy_dispersion: cluster.controversy_dispersion,
      reason: `Controversy dispersion (${cluster.controversy_dispersion.toFixed(3)}) is below the required 0.65 threshold.`,
    };
  }

  // 2. Generate Event Embedding
  const coreEventText = `${cluster.headline} ${cluster.summary}`;
  const eventEmbedding = await getEventEmbedding(coreEventText, options?.openaiApiKey);
  const sourceUrls = cluster.sources.map((s) => s.url);

  // 3. Semantic Deduplication (pgvector similarity > 0.90 within 72h or against active clusters)
  const deduplication = await checkSemanticDeduplication(eventEmbedding, supabase, options?.existingIngestId);
  if (deduplication.isDuplicate) {
    const dupId = deduplication.duplicateId || deduplication.clusterId;
    if (supabase && !options?.dryRun) {
      if (deduplication.duplicateId) {
        const mergedUrls = Array.from(new Set([...(deduplication.existingUrls || []), ...sourceUrls]));
        await supabase
          .schema("valerie")
          .from("news_ingest_queue")
          .update({
            source_urls: mergedUrls,
            updated_at: new Date().toISOString(),
          })
          .eq("id", deduplication.duplicateId);
      }

      if (options?.existingIngestId) {
        await supabase
          .schema("valerie")
          .from("news_ingest_queue")
          .update({
            status: "merged_duplicate",
            metadata: { duplicate_of: dupId },
            updated_at: new Date().toISOString(),
          })
          .eq("id", ingestId);
      } else {
        await supabase
          .schema("valerie")
          .from("news_ingest_queue")
          .insert({
            id: ingestId,
            event_title: cluster.headline,
            event_description: cluster.summary,
            event_embedding: formatVectorForPg(eventEmbedding),
            source_urls: sourceUrls,
            controversy_score: cluster.controversy_dispersion,
            status: "merged_duplicate",
            metadata: { duplicate_of: dupId },
          });
      }
    }

    return {
      ingest_id: ingestId,
      headline: cluster.headline,
      status: "merged_duplicate",
      controversy_dispersion: cluster.controversy_dispersion,
      duplicate_of_id: dupId,
      reason: `Merged as duplicate of existing ingest or cluster ${dupId} (cosine similarity > 0.90).`,
    };
  }

  // Stage Ingest Queue Record as 'processing' (ensures atomicity, vector persistence, and traceability)
  if (supabase && !options?.dryRun) {
    if (options?.existingIngestId) {
      // Atomically claim pending row to prevent concurrent workers from duplicating publications (BUG_0002)
      // Also persist the event embedding so queued stories participate in deduplication (ANALYSIS_0002)
      const { data: claimedRows, error: claimErr } = await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .update({
          status: "processing",
          event_embedding: formatVectorForPg(eventEmbedding),
          metadata: {
            scope_tier: cluster.scope_tier,
            detected_locales: cluster.detected_locales,
            started_at: new Date().toISOString(),
          },
        })
        .eq("id", ingestId)
        .eq("status", "pending")
        .select("id");

      if (claimErr || !claimedRows || claimedRows.length === 0) {
        return {
          ingest_id: ingestId,
          headline: cluster.headline,
          status: "already_claimed",
          controversy_dispersion: cluster.controversy_dispersion,
          reason: `Queue record ${ingestId} was already claimed by another worker or is no longer pending.`,
        };
      }
    } else {
      await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .insert({
          id: ingestId,
          event_title: cluster.headline,
          event_description: cluster.summary,
          event_embedding: formatVectorForPg(eventEmbedding),
          source_urls: sourceUrls,
          controversy_score: cluster.controversy_dispersion,
          status: "processing",
          metadata: {
            scope_tier: cluster.scope_tier,
            detected_locales: cluster.detected_locales,
            started_at: new Date().toISOString(),
          },
        });
    }
  }

  // 4. Adversarial Dual-Agent IRT Decomposition (Agent 1 + Agent 2 Referee)
  const pipeline = await runAdversarialRefereePipeline(
    cluster.headline,
    cluster.summary,
    options?.openaiApiKey,
    cluster.scope_tier,
    cluster.detected_locales
  );

  if (!pipeline.passed) {
    if (supabase && !options?.dryRun) {
      await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .update({
          status: "cynic_rejected",
          metadata: {
            rejection_reason: pipeline.rejectedReason,
            axes: pipeline.axes,
          },
        })
        .eq("id", ingestId);
    }

    return {
      ingest_id: ingestId,
      headline: cluster.headline,
      status: "cynic_rejected",
      controversy_dispersion: cluster.controversy_dispersion,
      decomposed_axes: pipeline.axes,
      reason: pipeline.rejectedReason,
    };
  }

  // 5. Tooltip Pre-Warming, Ecosystem Linking & Auto-Publication with Rollback Guard
  const publishedPollIds: string[] = [];

  try {
    for (const axis of pipeline.axes) {
      const pollId = crypto.randomUUID();

      // Pre-warm tooltip cache and link ecosystem UUIDs (PatchWork & Speak for the Dead)
      const { related_ecosystem_refs } = await prewarmAndLink(
        pollId,
        axis.question_text,
        eventEmbedding,
        axis.detected_locales,
        {
          supabase,
          openaiApiKey: options?.openaiApiKey,
          dryRun: options?.dryRun,
        }
      );

      // Insert active poll into valerie.polls
      if (supabase && !options?.dryRun) {
        const { error: pollError } = await supabase
          .schema("valerie")
          .from("polls")
          .insert({
            id: pollId,
            question_text: axis.question_text,
            is_active: true,
            scope_tier: axis.scope_tier,
            target_locale_code: axis.detected_locales[0] || null,
            detected_locales: axis.detected_locales,
            source_ingest_id: ingestId,
            source_urls: sourceUrls,
            axis_category: axis.category,
            related_ecosystem_refs,
          });

        if (pollError) {
          throw new Error(`Failed to insert poll: ${pollError.message}`);
        }
      }

      publishedPollIds.push(pollId);
    }

    // Complete ingestion: update status to 'auto_published'
    if (supabase && !options?.dryRun) {
      await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .update({
          status: "auto_published",
          published_poll_ids: publishedPollIds,
          metadata: {
            decomposed_axes: pipeline.axes.map((a) => ({
              category: a.category,
              bias_score: a.cynic_bias_score,
              attempts: a.attempts,
            })),
            completed_at: new Date().toISOString(),
          },
        })
        .eq("id", ingestId);
    }
  } catch (publishError: any) {
    // Rollback on partial publication failure: deactivate published polls and mark queue row as 'failed'
    if (supabase && !options?.dryRun) {
      if (publishedPollIds.length > 0) {
        await supabase
          .schema("valerie")
          .from("polls")
          .update({ is_active: false })
          .in("id", publishedPollIds);
      }

      await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .update({
          status: "failed",
          metadata: {
            error: publishError?.message || String(publishError),
            failed_at: new Date().toISOString(),
          },
        })
        .eq("id", ingestId);
    }
    throw publishError;
  }

  return {
    ingest_id: ingestId,
    headline: cluster.headline,
    status: "auto_published",
    controversy_dispersion: cluster.controversy_dispersion,
    published_poll_ids: publishedPollIds,
    decomposed_axes: pipeline.axes,
  };
}

export async function handleHeraldRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

  const supabase = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : undefined;

  try {
    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    // 1. Authorization Verification (SEC_0001)
    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const expectedCronSecret = Deno.env.get("CRON_SECRET");

    const isCronAuthorized = Boolean(
      expectedCronSecret && cronSecretHeader === expectedCronSecret
    );
    const isServiceKeyAuthorized = Boolean(
      authHeader &&
      supabaseServiceKey &&
      authHeader.replace(/^Bearer\s+/i, "").trim() === supabaseServiceKey
    );

    let isUserAuthorized = false;
    if (!isCronAuthorized && !isServiceKeyAuthorized && authHeader && supabase) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const { data: userData } = await supabase.auth.getUser(token);
      const user = userData?.user;
      if (user) {
        // Enforce administrative authorization to prevent unauthorized poll publication
        // Strictly inspect app_metadata only, never user_metadata which is client-writable (SEC_0001)
        const role = user.app_metadata?.role;
        const isAdmin = user.app_metadata?.is_admin === true;
        if (role === "admin" || role === "service_role" || isAdmin) {
          isUserAuthorized = true;
        }
      }
    }

    if (!isCronAuthorized && !isServiceKeyAuthorized && !isUserAuthorized) {
      return jsonResponse({ error: "Unauthorized: Administrative privileges or cron secret required." }, 401);
    }

    // 2. Direct event ingestion payload with bounds validation (SEC_0002)
    if (body.headline) {
      if (
        typeof body.headline !== "string" ||
        body.headline.trim().length === 0 ||
        body.headline.length > 500
      ) {
        return jsonResponse(
          { error: "headline must be a non-empty string of at most 500 characters" },
          400
        );
      }
      if (body.summary && (typeof body.summary !== "string" || body.summary.length > 2500)) {
        return jsonResponse(
          { error: "summary must be a string of at most 2500 characters" },
          400
        );
      }
      if (body.sources && (!Array.isArray(body.sources) || body.sources.length > 20)) {
        return jsonResponse(
          { error: "sources must be an array of at most 20 items" },
          400
        );
      }

      const cluster: NewsCluster = {
        headline: body.headline.trim(),
        summary: (body.summary || body.headline).trim(),
        sources: Array.isArray(body.sources)
          ? body.sources
          : [
              { title: "Source A", source: "Spectrum-Left", url: "https://example.com/a", sentiment_score: -0.8 },
              { title: "Source B", source: "Spectrum-Right", url: "https://example.com/b", sentiment_score: 0.8 },
            ],
        controversy_dispersion:
          typeof body.controversy_dispersion === "number"
            ? body.controversy_dispersion
            : calculateControversyDispersion(
                body.sources || [
                  { title: "A", source: "A", url: "a", sentiment_score: -0.8 },
                  { title: "B", source: "B", url: "b", sentiment_score: 0.8 },
                ]
              ),
        detected_locales: Array.isArray(body.detected_locales) ? body.detected_locales : ["US"],
        scope_tier: body.scope_tier || "NATIONAL",
      };

      const result = await processHeraldIngest(cluster, {
        supabase,
        openaiApiKey,
        dryRun: body.dryRun === true,
      });

      return jsonResponse(result);
    }

    // 3. Scheduled Ingestion: process pending queue items or report status (BUG_0001)
    if (supabase) {
      const { data: pendingRows } = await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .select("id, event_title, event_description, controversy_score, source_urls, metadata")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(5);

      if (pendingRows && pendingRows.length > 0) {
        const batchResults: HeraldIngestResult[] = [];
        for (const row of pendingRows) {
          const cluster: NewsCluster = {
            headline: row.event_title,
            summary: row.event_description || row.event_title,
            sources: Array.isArray(row.source_urls)
              ? row.source_urls.map((u: string) => ({
                  title: row.event_title,
                  source: "IngestQueue",
                  url: u,
                  sentiment_score: 0.8,
                }))
              : [],
            controversy_dispersion: Number(row.controversy_score || 0.7),
            detected_locales: row.metadata?.detected_locales || ["US"],
            scope_tier: row.metadata?.scope_tier || "NATIONAL",
          };

          const res = await processHeraldIngest(cluster, {
            supabase,
            openaiApiKey,
            dryRun: body.dryRun === true,
            existingIngestId: row.id,
          });
          if (res.status !== "already_claimed") {
            batchResults.push(res);
          }
        }

        return jsonResponse({
          status: "processed_batch",
          processed_count: batchResults.length,
          results: batchResults,
        });
      }
    }

    return jsonResponse({
      status: "idle",
      service: "valerie-herald-agent",
      pending_count: 0,
      timestamp: new Date().toISOString(),
      message: "Autonomous controversial headline agent ready. Zero pending stories in queue.",
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleHeraldRequest);
}

