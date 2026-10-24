/**
 * Project Valerie: 60/30/10 Content Curation & Intake Engine Server Actions
 * File: app/actions/valerieDigestActions.ts
 * Work Item: [TASK-VAL-DIGEST-RPC] / [STORY-VAL-DIGEST-ENGINE]
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/app/actions/auth";
import { DigestPayload, parseDigestPayload } from "@/lib/valerie/digestEngine";

export interface FetchDigestOptions {
  limit?: number;
  userIdOverride?: string;
}

/**
 * Fetches the personalized 60/30/10 civic intake feed for the current user.
 * Dispatches to valerie.assemble_digest_payload RPC.
 */
export async function getPersonalizedDigest(
  options?: FetchDigestOptions
): Promise<{ success: boolean; data: DigestPayload; error?: string }> {
  try {
    const limit = options?.limit ?? 5;
    const userContext = await getCurrentUserContext().catch(() => null);
    const userId = options?.userIdOverride ?? userContext?.userId ?? null;

    const supabase = await createClient();

    const { data: rawDigest, error: rpcError } = await supabase
      .schema("valerie")
      .rpc("assemble_digest_payload", {
        p_user_id: userId,
        p_limit: limit,
      });

    if (rpcError) {
      console.warn("[Project Valerie] assemble_digest_payload RPC error:", rpcError);
      return {
        success: false,
        data: {
          items: [],
          summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
        },
        error: rpcError.message,
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
