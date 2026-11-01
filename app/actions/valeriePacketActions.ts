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

export interface PacketPollItem {
  id: string;
  question_text: string;
  axis_category?: string;
  material_domain?: string;
  material_consequence_score?: number;
  cluster_id?: string | null;
  target_locale_code?: string | null;
  h3_res7?: string | null;
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
    const supabase = await createClient();

    // Invoke valerie.assemble_cluster_packet RPC
    const target =
      typeof (supabase as any).schema === "function"
        ? (supabase as any).schema("valerie")
        : supabase;

    const { data, error } = await target.rpc("assemble_cluster_packet", {
      p_user_id: options.userId || null,
      p_h3_cell: options.h3Cell || null,
    });

    if (error) {
      console.warn("[Project Valerie] assemble_cluster_packet RPC error, falling back to query:", error);
      return await fallbackPacketQuery(supabase, options);
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
 */
async function fallbackPacketQuery(
  supabase: any,
  options: { h3Cell?: string | null; userId?: string | null }
): Promise<GetClusterPacketResult> {
  try {
    const target =
      typeof supabase.schema === "function" ? supabase.schema("valerie") : supabase;

    const { data: polls, error } = await target
      .from("polls")
      .select("id, question_text, axis_category, detected_locales, target_locale_code, h3_res7, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error || !Array.isArray(polls) || polls.length === 0) {
      return { success: true, data: EMPTY_PACKET };
    }

    const anchor = polls[0];
    const companions = polls.slice(1);

    return {
      success: true,
      data: {
        packet_id: `fallback-${anchor.id}`,
        is_surge: false,
        anchor_poll: anchor,
        companion_polls: companions,
        total_packet_polls: polls.length,
      },
    };
  } catch {
    return { success: true, data: EMPTY_PACKET };
  }
}
