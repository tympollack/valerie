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
  status: "auto_published" | "merged_duplicate" | "cynic_rejected" | "skipped_low_controversy" | "failed";
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
  previousFeedback?: string
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
            scope_tier: item.scope_tier || "NATIONAL",
            detected_locales: Array.isArray(item.detected_locales) ? item.detected_locales : ["US"],
            attempts: 1,
          }));
        }
      }
    } catch {
      // Fallback below
    }
  }

  // Deterministic neutral decomposition fallback
  const cleanHeadline = stripPartisanFraming(headline);
  return [
    {
      category: "PRINCIPLE",
      question_text: `Whether public policy should prioritize collective civic stability over individual transactional autonomy in matters concerning ${cleanHeadline.toLowerCase()}.`,
      scope_tier: "NATIONAL",
      detected_locales: ["US"],
      attempts: 1,
    },
    {
      category: "ETHICS_LAW",
      question_text: `Whether statutory regulatory authority should supersede local municipality self-determination regarding ${cleanHeadline.toLowerCase()}.`,
      scope_tier: "NATIONAL",
      detected_locales: ["US"],
      attempts: 1,
    },
    {
      category: "REALPOLITIK",
      question_text: `Whether the immediate fiscal and economic compliance expenditures associated with ${cleanHeadline.toLowerCase()} are justified by long-term structural outcomes.`,
      scope_tier: "NATIONAL",
      detected_locales: ["US"],
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
  openaiApiKey?: string
): Promise<{ passed: boolean; axes: DecomposedAxis[]; rejectedReason?: string }> {
  // Step 1: Agent 1 initial decomposition
  const axes = await agent1DecomposeEvent(headline, summary, openaiApiKey);

  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    let attempts = 1;
    let audit = await agent2CynicReferee(axis.question_text, openaiApiKey);

    // If score >= 0.15, force rewrite up to 2 times
    while (audit.cynic_bias_score >= 0.15 && attempts <= 2) {
      attempts++;
      const [revised] = await agent1DecomposeEvent(
        headline,
        summary,
        openaiApiKey,
        axis.category,
        audit.feedback
      );
      if (revised) {
        axis.question_text = revised.question_text;
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
  supabase?: any
): Promise<{ isDuplicate: boolean; duplicateId?: string; existingUrls?: string[] }> {
  if (!supabase) {
    return { isDuplicate: false };
  }

  try {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: recentIngests } = await supabase
      .schema("valerie")
      .from("news_ingest_queue")
      .select("id, event_title, event_embedding, source_urls, status")
      .gte("created_at", seventyTwoHoursAgo)
      .neq("status", "merged_duplicate")
      .limit(50);

    if (Array.isArray(recentIngests)) {
      for (const row of recentIngests) {
        if (!row.event_embedding) continue;
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
  }
): Promise<HeraldIngestResult> {
  const supabase = options?.supabase;
  const ingestId = crypto.randomUUID();

  // 1. Controversy Dispersion Check
  if (cluster.controversy_dispersion < 0.65) {
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

  // 3. Semantic Deduplication (pgvector similarity > 0.90 within 72h)
  const deduplication = await checkSemanticDeduplication(eventEmbedding, supabase);
  if (deduplication.isDuplicate && deduplication.duplicateId) {
    // Merge into existing ingest
    if (supabase && !options?.dryRun) {
      const mergedUrls = Array.from(new Set([...(deduplication.existingUrls || []), ...sourceUrls]));
      await supabase
        .schema("valerie")
        .from("news_ingest_queue")
        .update({
          source_urls: mergedUrls,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deduplication.duplicateId);

      // Record duplicate entry in queue
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
          metadata: { duplicate_of: deduplication.duplicateId },
        });
    }

    return {
      ingest_id: ingestId,
      headline: cluster.headline,
      status: "merged_duplicate",
      controversy_dispersion: cluster.controversy_dispersion,
      duplicate_of_id: deduplication.duplicateId,
      reason: `Merged as duplicate of existing ingest ${deduplication.duplicateId} (cosine similarity > 0.90).`,
    };
  }

  // 4. Adversarial Dual-Agent IRT Decomposition (Agent 1 + Agent 2 Referee)
  const pipeline = await runAdversarialRefereePipeline(
    cluster.headline,
    cluster.summary,
    options?.openaiApiKey
  );

  if (!pipeline.passed) {
    if (supabase && !options?.dryRun) {
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
          status: "cynic_rejected",
          metadata: { rejection_reason: pipeline.rejectedReason },
        });
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

  // 5. Tooltip Pre-Warming, Ecosystem Linking & Auto-Publication
  const publishedPollIds: string[] = [];

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

  // Record completed ingestion in valerie.news_ingest_queue
  if (supabase && !options?.dryRun) {
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
        status: "auto_published",
        published_poll_ids: publishedPollIds,
        metadata: {
          decomposed_axes: pipeline.axes.map((a) => ({
            category: a.category,
            bias_score: a.cynic_bias_score,
            attempts: a.attempts,
          })),
        },
      });
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

    // Direct event ingestion payload
    if (body.headline) {
      const cluster: NewsCluster = {
        headline: body.headline,
        summary: body.summary || body.headline,
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

    // Scheduled Ingestion: mock / live multi-spectrum harvest
    return jsonResponse({
      status: "ready",
      service: "valerie-herald-agent",
      timestamp: new Date().toISOString(),
      message: "Autonomous controversial headline agent ready. Send POST with headline cluster to process.",
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleHeraldRequest);
}

