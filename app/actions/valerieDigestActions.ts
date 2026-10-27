/**
 * Project Valerie: 60/30/10 Content Curation & Intake Engine Server Actions
 * File: app/actions/valerieDigestActions.ts
 * Work Item: [TASK-VAL-DIGEST-RPC] / [STORY-VAL-DIGEST-ENGINE]
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/app/actions/auth";
import { getDynamicSettingNumeric } from "@/app/actions/valerieSettingsActions";
import { DigestPayload, parseDigestPayload } from "@/lib/valerie/digestEngine";

export interface FetchDigestOptions {
  limit?: number;
  userIdOverride?: string;
}

/**
 * Fetches the personalized 60/30/10 civic intake feed for the current user.
 * Dispatches to valerie.assemble_digest_payload RPC with graceful fallback.
 */
export async function getPersonalizedDigest(
  options?: FetchDigestOptions
): Promise<{ success: boolean; data: DigestPayload; error?: string }> {
  try {
    let defaultLimit = 5;
    if (options?.limit === undefined) {
      try {
        defaultLimit = await getDynamicSettingNumeric("digest_default_limit", 5);
      } catch {
        defaultLimit = 5;
      }
    }
    const rawLimit = options?.limit ?? defaultLimit;
    const boundedLimit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : defaultLimit, 1), 20);

    const userContext = await getCurrentUserContext().catch(() => null);

    // SEC_0002 Guard: Only allow userIdOverride in test harness or when caller has admin privilege
    const isPrivileged =
      process.env.NODE_ENV === "test" ||
      userContext?.verificationTier === "TIER_3_SOVEREIGN";

    const effectiveUserId = isPrivileged && options?.userIdOverride
      ? options.userIdOverride
      : userContext?.userId ?? null;

    const supabase = await createClient();

    const { data: rawDigest, error: rpcError } = await supabase
      .schema("valerie")
      .rpc("assemble_digest_payload", {
        p_user_id: effectiveUserId,
        p_limit: boundedLimit,
      });

    if (rpcError) {
      console.warn("[Project Valerie] assemble_digest_payload RPC error, attempting fallback query:", rpcError);

      // Fallback: Query active polls directly from valerie.polls
      const { data: fallbackPolls, error: fallbackError } = await supabase
        .schema("valerie")
        .from("polls")
        .select("id, question_text, scope_tier, axis_category, target_locale_code, detected_locales, related_ecosystem_refs, cluster_id")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(boundedLimit);

      if (fallbackError || !fallbackPolls || fallbackPolls.length === 0) {
        return {
          success: false,
          data: {
            items: [],
            summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
          },
          error: rpcError.message,
        };
      }

      // Map fallback polls into 60/30/10 categorized items
      const fallbackItems = fallbackPolls.map((poll, idx) => {
        let category: "BLINDSPOT_BRIDGE" | "CIVIC_ANCHOR" | "PERSONA_MATCH" = "PERSONA_MATCH";
        let ratio = "60%";
        if (idx === 0) {
          category = "BLINDSPOT_BRIDGE";
          ratio = "10%";
        } else if (idx === 1) {
          category = "CIVIC_ANCHOR";
          ratio = "30%";
        }
        return {
          category,
          category_ratio: ratio,
          poll_id: poll.id,
          question_text: poll.question_text,
          scope_tier: poll.scope_tier || "NATIONAL",
          axis_category: poll.axis_category || null,
          target_locale_code: poll.target_locale_code || null,
          detected_locales: poll.detected_locales || [],
          related_ecosystem_refs: (poll.related_ecosystem_refs as Record<string, unknown>) || {},
          is_reveal_ready: false,
          cluster_id: poll.cluster_id || null,
        };
      });

      return {
        success: true,
        data: parseDigestPayload(fallbackItems),
      };
    }

    const payload = parseDigestPayload(rawDigest);

    return {
      success: true,
      data: payload,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Project Valerie] getPersonalizedDigest unhandled error:", errorMessage);
    return {
      success: false,
      data: {
        items: [],
        summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
      },
      error: errorMessage,
    };
  }
}
