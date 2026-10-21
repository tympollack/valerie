/**
 * Project Valerie: Psychometric Flagging & Commit Gate Server Actions
 * File: app/actions/valerieFlagActions.ts
 * Work Item: TASK-VAL-FLAG-SERVER-ACTION / STORY-VAL-BRIDGING-FLAGS-UI
 *
 * Implements the flagPollWithCommitGate Server Action so users who object
 * to a poll's premise or framing can record their structured diagnostic flag,
 * lock their 24-hour Commit-and-Reveal results gate, snapshot their latent belief
 * vector, and trigger cross-spectrum consensus evaluations.
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { extractAntiSybilProof, extractSSOToken } from "@/lib/auth/ssoHandshake";
import {
  generateEmbedding,
  generateDeterministicEmbedding,
  formatVectorForPg,
  parseVectorSafely,
  VECTOR_DIM,
} from "@/lib/ai/embedding";
import { resolveVoterLocale, type ResolvedVoterLocale } from "@/lib/geo/resolveVoterLocale";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

// =============================================================================
// Types & Interfaces
// =============================================================================

export type FlagReason =
  | "LOADED_FRAMING"
  | "FALSE_DICHOTOMY"
  | "DISPUTED_PREMISE"
  | "LOCALE_MISMATCH";

export const VALID_FLAG_REASONS: readonly FlagReason[] = [
  "LOADED_FRAMING",
  "FALSE_DICHOTOMY",
  "DISPUTED_PREMISE",
  "LOCALE_MISMATCH",
] as const;

export interface FlagPollPayload {
  pollId: string;
  flagReason: FlagReason | string;
  suggestedAxisComment?: string;
  // Optional test/simulation override
  thetaVectorOverride?: number[];
}

export interface FlagPollResult {
  success: boolean;
  lockedUntil?: string; // ISO 8601 — 24-hour reveal timestamp
  error?: string;
  flagId?: string;
  rollbackAction?: string;
}

export interface CoarseLocaleBuckets {
  country_iso: string | null;
  admin1_code: string | null;
  admin2_code: string | null;
  h3_res7: string | null;
}

// =============================================================================
// Helper: Resolve Coarse Geographic Buckets (Zero Raw Lat/Lng)
// =============================================================================

export async function resolveCoarseLocaleBuckets(
  userMeta?: Record<string, unknown>,
  appMeta?: Record<string, unknown>
): Promise<CoarseLocaleBuckets> {
  const profile = { user_metadata: userMeta, app_metadata: appMeta };
  return resolveVoterLocale(undefined, profile);
}

// =============================================================================
// Helper: Resolve Caller's Latent Belief Vector (user_theta_snapshot)
// =============================================================================

export async function resolveUserThetaVector(
  supabase: any,
  userId: string,
  userRecord?: Record<string, unknown>,
  override?: number[]
): Promise<number[]> {
  // Disallow caller-provided override unless running in a test harness
  if (
    process.env.NODE_ENV === "test" &&
    override &&
    override.length === VECTOR_DIM &&
    override.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return override;
  }

  // 1. Check user claims/metadata for pre-calculated latent theta
  const appMeta = (userRecord?.app_metadata as Record<string, unknown>) || {};
  const userMeta = (userRecord?.user_metadata as Record<string, unknown>) || {};

  const candidateRaw =
    appMeta.user_theta ||
    userMeta.user_theta ||
    appMeta.theta_vector ||
    userMeta.theta_vector ||
    userRecord?.user_theta;

  const parsed = parseVectorSafely(candidateRaw);
  if (parsed) {
    return parsed;
  }

  // 2. Derive belief vector from historical voting patterns if available
  const { data: pastResponses, error: historyError } = await supabase
    .schema("valerie")
    .from("poll_responses")
    .select("likert_score, confidence_score, comment")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (historyError) {
    throw new Error(`Failed to read voter response history for belief vector: ${historyError.message}`);
  }

  if (pastResponses && pastResponses.length > 0) {
    const avgLikert =
      pastResponses.reduce((sum: number, r: any) => sum + (r.likert_score ?? 0), 0) /
      pastResponses.length;
    const avgConf =
      pastResponses.reduce((sum: number, r: any) => sum + (r.confidence_score ?? 50), 0) /
      pastResponses.length;
    const seedText = `user-theta:${userId}:${pastResponses.length}:${avgLikert.toFixed(2)}:${avgConf.toFixed(0)}`;
    return generateDeterministicEmbedding(seedText);
  }

  // 3. Deterministic user anchor fallback (only for genuine first-time voters with 0 past responses)
  return generateDeterministicEmbedding(`valerie-user-prior:${userId}`);
}

// =============================================================================
// Helper: Asynchronous Consensus & Auto-Rollback Evaluator
// =============================================================================

export async function evaluateFlagConsensusAsync(pollId: string): Promise<string | null> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    console.warn("[Project Valerie] Skipping evaluate_poll_flag_consensus: missing service role key.");
    return null;
  }

  try {
    const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey);
    const { data: consensusAction, error: rpcError } =
      typeof (adminClient as any).schema === "function"
        ? await (adminClient as any)
            .schema("valerie")
            .rpc("evaluate_poll_flag_consensus", { p_poll_id: pollId })
        : await adminClient.rpc("evaluate_poll_flag_consensus", { p_poll_id: pollId });

    if (rpcError) {
      console.warn("[Project Valerie] evaluate_poll_flag_consensus error:", rpcError);
      return null;
    }

    // Trigger Axis-4 follow-up poll spawner webhook if threshold reached
    if (consensusAction === "SPAWN_AXIS_4") {
      const webhookUrl = process.env.VALERIE_CLUSTER_ENGINE_WEBHOOK_URL;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ action: "SPAWN_AXIS_4", poll_id: pollId }),
        }).catch((err) => {
          console.warn("[Project Valerie] Axis-4 webhook dispatch warning:", err);
        });
      } else {
        adminClient.functions
          .invoke("valerie-cluster-engine", {
            body: { action: "SPAWN_AXIS_4", poll_id: pollId },
          })
          .catch((err) => {
            console.warn("[Project Valerie] Cluster engine invocation warning:", err);
          });
      }
    }

    return consensusAction as string;
  } catch (err) {
    console.warn("[Project Valerie] Asynchronous consensus check failed:", err);
    return null;
  }
}

// =============================================================================
// Public Server Action: flagPollWithCommitGate
// =============================================================================

/**
 * Records a user's structured objection to a poll's premise or framing.
 * Satisfies the 24-hour Commit-and-Reveal gate and triggers cross-spectrum consensus evaluations.
 */
export async function flagPollWithCommitGate(payload: FlagPollPayload): Promise<FlagPollResult> {
  const supabase = await createClient();

  // 1. Session & Anti-Sybil human verification check
  let {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user) {
    const cookieStore = await cookies();
    const ssoToken = extractSSOToken(cookieStore);
    if (ssoToken) {
      const { data: ssoData, error: ssoError } = await supabase.auth.getUser(ssoToken);
      if (!ssoError && ssoData?.user) {
        user = ssoData.user;
        authError = null;
      }
    }
  }

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to flag or challenge this poll.",
    };
  }

  const antiSybilProof = extractAntiSybilProof(user);
  const userAppMeta = (user.app_metadata as Record<string, unknown>) || {};
  const userMetadata = (user.user_metadata as Record<string, unknown>) || {};

  const isHumanVerified = Boolean(
    antiSybilProof.isHuman ||
      antiSybilProof.antiSybilVerified ||
      userAppMeta.is_human_verified === true ||
      userMetadata.is_human_verified === true
  );

  if (!isHumanVerified || antiSybilProof.trustState !== "active") {
    return {
      success: false,
      error: "Single-human identity verification required. Please complete verification on the SunShade Hub.",
    };
  }

  // 2. Validate payload arguments
  const { pollId, flagReason, suggestedAxisComment, thetaVectorOverride } = payload;

  if (!pollId || typeof pollId !== "string") {
    return { success: false, error: "Poll ID is required." };
  }

  if (!VALID_FLAG_REASONS.includes(flagReason as FlagReason)) {
    return {
      success: false,
      error: `Invalid flag reason. Must be one of: ${VALID_FLAG_REASONS.join(", ")}.`,
    };
  }

  const cleanComment = suggestedAxisComment?.trim() || null;
  if (cleanComment && cleanComment.length > 500) {
    return {
      success: false,
      error: "Suggested axis comment must be 500 characters or fewer.",
    };
  }

  // 3. Resolve coarse locale buckets without persisting raw coordinates
  const localeBuckets = await resolveVoterLocale(undefined, user);

  // 4. Resolve caller's latent belief vector and comment embedding
  // Restrict thetaVectorOverride strictly to test environments to prevent client-side belief vector spoofing
  const effectiveThetaOverride =
    process.env.NODE_ENV === "test" ? thetaVectorOverride : undefined;

  const userTheta = await resolveUserThetaVector(
    supabase,
    user.id,
    user as unknown as Record<string, unknown>,
    effectiveThetaOverride
  );

  let commentEmbedding: number[] | null = null;
  if (cleanComment) {
    commentEmbedding = await generateEmbedding(cleanComment);
  }

  // 5. Insert structured flag record into valerie.poll_flags
  const { data, error: insertError } = await supabase
    .schema("valerie")
    .from("poll_flags")
    .insert({
      poll_id: pollId,
      user_id: user.id,
      flag_reason: flagReason,
      suggested_axis_comment: cleanComment,
      comment_embedding: commentEmbedding ? formatVectorForPg(commentEmbedding) : null,
      user_theta_snapshot: formatVectorForPg(userTheta),
      country_iso: localeBuckets.country_iso,
      admin1_code: localeBuckets.admin1_code,
      admin2_code: localeBuckets.admin2_code,
      h3_res7: localeBuckets.h3_res7,
    })
    .select("id, locked_until")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        success: false,
        error: "You have already submitted a premise challenge for this poll.",
      };
    }
    if (insertError.code === "42501") {
      return {
        success: false,
        error: "Premise challenge rejected: Your account must have active human verification.",
      };
    }
    console.error("[Project Valerie] Flag insert failed:", insertError);
    return {
      success: false,
      error: "Failed to record your premise challenge. Please try again.",
    };
  }

  const lockedUntil =
    data?.locked_until || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // 6. Trigger evaluate_poll_flag_consensus within request boundary to ensure serverless execution completes
  try {
    await evaluateFlagConsensusAsync(pollId);
  } catch (err) {
    console.warn("[Project Valerie] Background consensus evaluation warning:", err);
  }

  // Revalidate cache for this poll
  revalidatePath(`/polls/${pollId}`);

  return {
    success: true,
    lockedUntil,
    flagId: data?.id,
  };
}
