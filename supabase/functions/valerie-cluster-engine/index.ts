/**
 * Project Valerie: Vector Dynamic Topic Clustering Engine & Genealogy
 * File: supabase/functions/valerie-cluster-engine/index.ts
 *
 * PURPOSE
 * -------
 * Supabase Edge Function running on Deno. Triggered post-vote commit to:
 *   1. Extract & synthesize 1536-D sentiment vectors combining bivariate scores
 *      (Likert -2..2, Confidence 0..100) with OpenAI response embeddings.
 *   2. Compute cosine distance against active centroids in valerie.topic_clusters.
 *   3. Perform dynamic split thresholding: bifurcates parent cluster when variance
 *      breaches tolerance, deactivates parent, inserts 2 child nodes, and logs
 *      immutable audit records to valerie.cluster_events.
 *   4. Incrementally maintains running centroids and variance on the unit hypersphere.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  VECTOR_DIM,
  cosineDistance,
  cosineSimilarity,
  l2Normalize,
  combineEmbeddingWithBivariateScores,
  synthesizeVectorFromScoresAndText,
  updateCentroid,
  calculateIncrementalVariance,
  computeBifurcatedCentroids,
} from "./vector-math.ts";

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface ClusterEngineRequest {
  poll_id?: string;
  response_id?: string;
  user_id?: string;
  likert_score: number;
  confidence_score: number;
  comment?: string;
  question_text?: string;
  variance_tolerance?: number; // default 0.35
  split_delta?: number;        // default 0.35
  manual_vector?: number[];    // optional override for testing/direct embeddings
}

export interface ClusterRecord {
  id: string;
  cluster_name: string;
  centroid_vector: number[] | string;
  parent_cluster_id: string | null;
  is_active: boolean;
  member_count: number;
  variance: number;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

/**
 * Parses vector representation from Supabase pgvector column (array or string '[0.1, 0.2, ...]').
 */
export function parseVector(val: number[] | string): number[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/^\[|\]$/g, "");
    if (!cleaned) return new Array(VECTOR_DIM).fill(0);
    return cleaned.split(",").map((num) => parseFloat(num.trim()));
  }
  return new Array(VECTOR_DIM).fill(0);
}

/**
 * Formats a vector into pgvector string literal format '[x1,x2,...]' for SQL writes.
 */
export function formatVectorForPg(vec: number[]): string {
  return `[${vec.map((v) => Number(v.toFixed(7))).join(",")}]`;
}

/**
 * Generates or extracts 1536-D sentiment vector.
 */
export async function generateSentimentVector(
  req: ClusterEngineRequest,
  openAiApiKey?: string
): Promise<number[]> {
  if (req.manual_vector && req.manual_vector.length === VECTOR_DIM) {
    return l2Normalize(req.manual_vector);
  }

  const promptText = `Topic: ${req.question_text || "Civic Poll"}. Sentiment: Likert score ${req.likert_score} (range -2 to +2), Confidence ${req.confidence_score}%. Comment: ${req.comment || "Neutral stance"}`;

  if (openAiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: promptText,
          dimensions: VECTOR_DIM,
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const baseEmbedding = json.data[0]?.embedding;
        if (Array.isArray(baseEmbedding) && baseEmbedding.length === VECTOR_DIM) {
          return combineEmbeddingWithBivariateScores(
            baseEmbedding,
            req.likert_score,
            req.confidence_score
          );
        }
      }
    } catch (err) {
      console.warn("[valerie-cluster-engine] OpenAI embeddings call failed, using deterministic fallback:", err);
    }
  }

  // Deterministic mathematical fallback
  return synthesizeVectorFromScoresAndText(
    promptText,
    req.likert_score,
    req.confidence_score,
    VECTOR_DIM
  );
}

/**
 * Core Clustering & Dynamic Split Logic (Pure & Testable)
 */
export async function processClusterIngestion(
  supabaseClient: any,
  request: ClusterEngineRequest,
  openAiApiKey?: string,
  callerId?: string
) {
  const tolerance = request.variance_tolerance ?? 0.35;
  const splitDelta = request.split_delta ?? 0.35;

  // 1. Generate L2-normalized 1536-D sentiment vector
  const sentimentVector = await generateSentimentVector(request, openAiApiKey);
  const formattedSentimentVec = formatVectorForPg(sentimentVector);

  // 2. Fetch all active clusters
  const { data: activeRows, error: fetchErr } = await supabaseClient
    .schema("valerie")
    .from("topic_clusters")
    .select("id, cluster_name, centroid_vector, parent_cluster_id, is_active, member_count, variance")
    .eq("is_active", true);

  if (fetchErr) {
    throw new Error(`Failed to fetch active topic clusters: ${fetchErr.message}`);
  }

  const activeClusters: ClusterRecord[] = (activeRows || []).map((row: any) => ({
    ...row,
    centroid_vector: parseVector(row.centroid_vector),
    variance: Number(row.variance || 0),
    member_count: Number(row.member_count || 1),
  }));

  // 3. Cold Start: If no active clusters exist, seed initial cluster
  if (activeClusters.length === 0) {
    const seedName = request.comment?.trim()
      ? `Cohort: ${request.comment.trim().slice(0, 28)}...`
      : `Cohort: Sentiment ${request.likert_score > 0 ? "+" : ""}${request.likert_score} (Conf ${request.confidence_score}%)`;

    const { data: newCluster, error: insertErr } = await supabaseClient
      .schema("valerie")
      .from("topic_clusters")
      .insert({
        cluster_name: seedName,
        centroid_vector: formattedSentimentVec,
        is_active: true,
        member_count: 1,
        variance: 0.0,
      })
      .select()
      .single();

    if (insertErr) {
      throw new Error(`Failed to seed initial cluster: ${insertErr.message}`);
    }

    // Link response if response_id provided
    if (request.response_id) {
      await supabaseClient
        .schema("valerie")
        .from("poll_responses")
        .update({
          cluster_id: newCluster.id,
          sentiment_vector: formattedSentimentVec,
        })
        .eq("id", request.response_id);
    }

    return {
      action: "INITIAL_SEED",
      cluster_id: newCluster.id,
      cluster_name: newCluster.cluster_name,
      cosine_distance: 0.0,
      variance: 0.0,
    };
  }

  // 4. Find closest centroid via Cosine Distance
  let bestCluster = activeClusters[0];
  let minDistance = cosineDistance(bestCluster.centroid_vector as number[], sentimentVector);

  for (let i = 1; i < activeClusters.length; i++) {
    const dist = cosineDistance(activeClusters[i].centroid_vector as number[], sentimentVector);
    if (dist < minDistance) {
      minDistance = dist;
      bestCluster = activeClusters[i];
    }
  }

  // 5. Evaluate dynamic split threshold
  const parentCentroid = bestCluster.centroid_vector as number[];
  const estimatedVariance = calculateIncrementalVariance(
    bestCluster.variance,
    minDistance,
    bestCluster.member_count
  );

  const shouldSplit = estimatedVariance > tolerance || (minDistance > tolerance * 1.5 && bestCluster.member_count >= 2);

  if (shouldSplit) {
    // Dynamic Split Execution
    const { childA, childB } = computeBifurcatedCentroids(parentCentroid, sentimentVector, splitDelta);

    // Determine closer child for the current sample
    const distA = cosineDistance(childA, sentimentVector);
    const distB = cosineDistance(childB, sentimentVector);
    const assignedChildIndex = distA <= distB ? "A" : "B";

    // Deactivate parent cluster
    const { error: deactivateErr } = await supabaseClient
      .schema("valerie")
      .from("topic_clusters")
      .update({ is_active: false })
      .eq("id", bestCluster.id);

    if (deactivateErr) {
      throw new Error(`Failed to deactivate parent cluster ${bestCluster.id}: ${deactivateErr.message}`);
    }

    // Insert Child Clusters
    const childRecords = [
      {
        cluster_name: `${bestCluster.cluster_name} (Branch A)`,
        centroid_vector: formatVectorForPg(childA),
        parent_cluster_id: bestCluster.id,
        is_active: true,
        member_count: Math.max(1, Math.ceil(bestCluster.member_count / 2)),
        variance: Number((bestCluster.variance * 0.5).toFixed(6)),
      },
      {
        cluster_name: `${bestCluster.cluster_name} (Branch B)`,
        centroid_vector: formatVectorForPg(childB),
        parent_cluster_id: bestCluster.id,
        is_active: true,
        member_count: Math.max(1, Math.floor(bestCluster.member_count / 2) + 1),
        variance: Number((minDistance * 0.4).toFixed(6)),
      },
    ];

    const { data: createdChildren, error: insertChildrenErr } = await supabaseClient
      .schema("valerie")
      .from("topic_clusters")
      .insert(childRecords)
      .select();

    if (insertChildrenErr || !createdChildren || createdChildren.length < 2) {
      throw new Error(`Failed to create child clusters: ${insertChildrenErr?.message}`);
    }

    const childAId = createdChildren[0].id;
    const childBId = createdChildren[1].id;
    const assignedClusterId = assignedChildIndex === "A" ? childAId : childBId;

    // Log SPLIT event to valerie.cluster_events
    const { data: eventData, error: eventErr } = await supabaseClient
      .schema("valerie")
      .from("cluster_events")
      .insert({
        event_type: "SPLIT",
        source_cluster_ids: [bestCluster.id],
        target_cluster_ids: [childAId, childBId],
        executed_by: callerId || null,
        reason: `Dynamic variance tolerance breached (${estimatedVariance.toFixed(4)} > ${tolerance})`,
        metadata: {
          parent_cluster_id: bestCluster.id,
          trigger_distance: minDistance,
          trigger_variance: estimatedVariance,
          tolerance_threshold: tolerance,
          split_delta: splitDelta,
        },
      })
      .select()
      .single();

    if (eventErr) {
      console.error("[valerie-cluster-engine] Failed to log SPLIT cluster event:", eventErr);
    }

    // Link response
    if (request.response_id) {
      await supabaseClient
        .schema("valerie")
        .from("poll_responses")
        .update({
          cluster_id: assignedClusterId,
          sentiment_vector: formattedSentimentVec,
        })
        .eq("id", request.response_id);
    }

    return {
      action: "SPLIT",
      parent_cluster_id: bestCluster.id,
      child_cluster_ids: [childAId, childBId],
      assigned_cluster_id: assignedClusterId,
      event_id: eventData?.id,
      trigger_distance: minDistance,
      new_variance: estimatedVariance,
    };
  }

  // 6. Within Tolerance: Incrementally update centroid & variance
  const updatedCentroid = updateCentroid(parentCentroid, bestCluster.member_count, sentimentVector);
  const updatedCount = bestCluster.member_count + 1;

  const { error: updateClusterErr } = await supabaseClient
    .schema("valerie")
    .from("topic_clusters")
    .update({
      centroid_vector: formatVectorForPg(updatedCentroid),
      member_count: updatedCount,
      variance: Number(estimatedVariance.toFixed(6)),
    })
    .eq("id", bestCluster.id);

  if (updateClusterErr) {
    throw new Error(`Failed to update cluster ${bestCluster.id}: ${updateClusterErr.message}`);
  }

  // Link response
  if (request.response_id) {
    await supabaseClient
      .schema("valerie")
      .from("poll_responses")
      .update({
        cluster_id: bestCluster.id,
        sentiment_vector: formattedSentimentVec,
      })
      .eq("id", request.response_id);
  }

  return {
    action: "ASSIGNED",
    cluster_id: bestCluster.id,
    cluster_name: bestCluster.cluster_name,
    cosine_distance: minDistance,
    updated_variance: estimatedVariance,
    member_count: updatedCount,
  };
}

// ---------------------------------------------------------------------------
// Main Edge Function Handler
// ---------------------------------------------------------------------------
export async function handleClusterRequest(req: Request): Promise<Response> {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase configuration." }, 500);
    }

    // Authenticate caller (supports user JWT or service key)
    const authHeader = req.headers.get("Authorization");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    let callerId: string | undefined;

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      if (userData?.user) {
        callerId = userData.user.id;
      }
    }

    const payload: ClusterEngineRequest = await req.json();

    if (
      typeof payload.likert_score !== "number" ||
      typeof payload.confidence_score !== "number"
    ) {
      return jsonResponse(
        { error: "Invalid payload. likert_score (-2..2) and confidence_score (0..100) are required." },
        400
      );
    }

    const result = await processClusterIngestion(
      supabaseAdmin,
      payload,
      openAiApiKey,
      callerId
    );

    return jsonResponse({ success: true, ...result });
  } catch (err: any) {
    console.error("[valerie-cluster-engine] Error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleClusterRequest);
}

