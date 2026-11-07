/**
 * Project Valerie: Cluster Packet & Civic Surge Server Actions
 * File: app/actions/valeriePacketActions.ts
 * Work Item: [TASK-VAL-SURGE-PACKET-RPC] / [TASK-VAL-UI-PACKET-FLOW]
 * Parent Story: [STORY-VAL-CLUSTER-SURGE]
 *
 * Fetches multidimensional 3-axis deliberation packets (1 Anchor + 2 Companion axes)
 * and emergency civic surges (material_consequence_score >= 0.80) to concentrate
 * constituent participation without infinite doomscrolling.
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { extractSSOToken } from "@/lib/auth/ssoHandshake";
import { resolveVoterLocale, type ResolvedVoterLocale } from "@/lib/geo/resolveVoterLocale";
import { isPollEligibleForVoterLocale } from "@/lib/geo/voterEligibility";

export interface PacketPollItem {
  id: string;
  question_text: string;
  axis_category?: string;
  material_domain?: string;
  material_consequence_score?: number;
  cluster_id?: string | null;
  target_locale_code?: string | null;
  h3_res7?: string | null;
  related_ecosystem_refs?: Record<string, unknown> | null;
  created_at?: string;
}

export interface ClusterPacketPayload {
  packet_id: string | null;
  is_surge: boolean;
  cluster_id?: string | null;
  material_domain?: string | null;
  material_consequence_score?: number | null;
  anchor_poll: PacketPollItem | null;
  companion_polls: PacketPollItem[];
  total_packet_polls: number;
  message?: string;
}

export interface GetClusterPacketResult {
  success: boolean;
  data: ClusterPacketPayload;
  error?: string;
}

const EMPTY_PACKET: ClusterPacketPayload = {
  packet_id: null,
  is_surge: false,
  anchor_poll: null,
  companion_polls: [],
  total_packet_polls: 0,
  message: "No unvoted active deliberation polls available in district.",
};

/**
 * Fetches the active 3-axis deliberation packet for the current voter.
 * Prioritizes high-consequence breaking surges (material_consequence_score >= 0.80).
 */
export async function getClusterPacketAction(options: {
  h3Cell?: string | null;
  userId?: string | null;
} = {}): Promise<GetClusterPacketResult> {
  try {
    const cookieStore = await cookies();
    const ssoToken = extractSSOToken(cookieStore);
    const supabase = await createClient(ssoToken);

    // Securely resolve voter ID from authenticated session (SEC_0001 guard)
    let verifiedUserId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        verifiedUserId = user.id;
      }
    } catch {
      // Unauthenticated visitor
    }

    // If caller provided a userId, ensure caller is authenticated and matches verifiedUserId (SEC_0001 guard)
    if (options.userId && options.userId !== verifiedUserId) {
      console.warn("[Project Valerie] Blocked attempt to query another user's deliberation packet");
      return { success: false, data: EMPTY_PACKET, error: "Unauthorized user query." };
    }

    // Securely resolve geographic tier from trusted edge headers (SEC_0002 guard)
    let verifiedH3: string | null = null;
    let resolvedLocale: ResolvedVoterLocale | null = null;
    try {
      resolvedLocale = await resolveVoterLocale();
      verifiedH3 = resolvedLocale?.h3_res7 || options.h3Cell || null;
    } catch {
      verifiedH3 = options.h3Cell || null;
      if (options.h3Cell) {
        resolvedLocale = { country_iso: null, admin1_code: null, admin2_code: null, h3_res7: options.h3Cell };
      }
    }

    // Invoke valerie.assemble_cluster_packet RPC
    const target =
      typeof (supabase as any).schema === "function"
        ? (supabase as any).schema("valerie")
        : supabase;

    const { data, error } = await target.rpc("assemble_cluster_packet", {
      p_user_id: verifiedUserId || null,
      p_h3_cell: verifiedH3,
    });

    if (error) {
      console.warn("[Project Valerie] assemble_cluster_packet RPC error, falling back to query:", error);
      return await fallbackPacketQuery(supabase, {
        userId: verifiedUserId || null,
        h3Cell: verifiedH3,
        voterLocale: resolvedLocale,
      });
    }

    if (data && typeof data === "object") {
      const payload = data as ClusterPacketPayload;
      return {
        success: true,
        data: {
          packet_id: payload.packet_id ?? null,
          is_surge: Boolean(payload.is_surge),
          cluster_id: payload.cluster_id ?? null,
          material_domain: payload.material_domain ?? null,
          material_consequence_score: payload.material_consequence_score ?? null,
          anchor_poll: payload.anchor_poll ?? null,
          companion_polls: Array.isArray(payload.companion_polls) ? payload.companion_polls : [],
          total_packet_polls: Number(payload.total_packet_polls) || (payload.anchor_poll ? 1 : 0),
          message: payload.message,
        },
      };
    }

    return {
      success: true,
      data: EMPTY_PACKET,
    };
  } catch (err: unknown) {
    console.error("[Project Valerie] Exception in getClusterPacketAction:", err);
    return {
      success: false,
      data: EMPTY_PACKET,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Graceful fallback query when RPC is pending database deployment in staging/local environments.
 * Strictly respects unvoted eligibility, thematic cluster linkage, and geographic tiering (BUG_0002, BUG_0003, BUG_0005).
 */
async function fallbackPacketQuery(
  supabase: any,
  options: {
    h3Cell?: string | null;
    userId?: string | null;
    voterLocale?: {
      country_iso?: string | null;
      admin1_code?: string | null;
      admin2_code?: string | null;
      h3_res7?: string | null;
    } | null;
  }
): Promise<GetClusterPacketResult> {
  try {
    const target =
      typeof supabase.schema === "function" ? supabase.schema("valerie") : supabase;

    // Check for already voted polls to prevent duplicate ballot presentation
    let votedPollIds: string[] = [];
    if (options.userId) {
      const { data: userVotes } = await target
        .from("poll_responses")
        .select("poll_id")
        .eq("user_id", options.userId);
      if (Array.isArray(userVotes) && userVotes.length > 0) {
        votedPollIds = userVotes.map((v: any) => v.poll_id).filter(Boolean);
      }
    }

    let query = target
      .from("polls")
      .select("id, question_text, axis_category, detected_locales, target_locale_code, h3_res7, related_ecosystem_refs, cluster_id, material_domain, created_at")
      .eq("is_active", true);

    if (votedPollIds.length > 0) {
      query = query.not("id", "in", `(${votedPollIds.join(",")})`);
    }

    if (options.h3Cell) {
      query = query.or(`h3_res7.eq.${options.h3Cell},h3_res7.is.null`);
    }

    const { data: anchorRows, error: anchorError } = await query
      .order("created_at", { ascending: false })
      .limit(25);

    if (anchorError || !Array.isArray(anchorRows) || anchorRows.length === 0) {
      return { success: true, data: EMPTY_PACKET };
    }

    const effectiveLocale =
      options.voterLocale ??
      (options.h3Cell
        ? { h3_res7: options.h3Cell, country_iso: null, admin1_code: null, admin2_code: null }
        : null);

    const eligibleAnchors = anchorRows.filter((p: any) =>
      isPollEligibleForVoterLocale(p, effectiveLocale)
    );

    if (eligibleAnchors.length === 0) {
      return { success: true, data: EMPTY_PACKET };
    }

    const anchor = eligibleAnchors[0];
    let companions: PacketPollItem[] = [];

    // Query up to 2 companions sharing the anchor's cluster_id or material_domain (BUG_0007)
    if (anchor.cluster_id || anchor.material_domain) {
      let companionQuery = target
        .from("polls")
        .select("id, question_text, axis_category, detected_locales, target_locale_code, h3_res7, related_ecosystem_refs, cluster_id, material_domain, created_at")
        .eq("is_active", true)
        .neq("id", anchor.id);

      const excludeIds = votedPollIds.length > 0 ? [...votedPollIds, anchor.id] : [anchor.id];
      companionQuery = companionQuery.not("id", "in", `(${excludeIds.join(",")})`);

      if (options.h3Cell) {
        companionQuery = companionQuery.or(`h3_res7.eq.${options.h3Cell},h3_res7.is.null`);
      }

      if (anchor.cluster_id && anchor.material_domain) {
        companionQuery = companionQuery.or(`cluster_id.eq.${anchor.cluster_id},material_domain.eq.${anchor.material_domain}`);
      } else if (anchor.cluster_id) {
        companionQuery = companionQuery.eq("cluster_id", anchor.cluster_id);
      } else if (anchor.material_domain) {
        companionQuery = companionQuery.eq("material_domain", anchor.material_domain);
      }

      const { data: companionRows } = await companionQuery
        .order("created_at", { ascending: false })
        .limit(10);

      if (Array.isArray(companionRows)) {
        companions = companionRows
          .filter((p: any) => isPollEligibleForVoterLocale(p, effectiveLocale))
          .slice(0, 2);
      }
    }

    return {
      success: true,
      data: {
        packet_id: `fallback-${anchor.id}`,
        is_surge: false,
        anchor_poll: anchor,
        companion_polls: companions,
        total_packet_polls: 1 + companions.length,
      },
    };
  } catch {
    return { success: true, data: EMPTY_PACKET };
  }
}
