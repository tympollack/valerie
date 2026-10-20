/**
 * Project Valerie: Multi-Scale Locale Sentiment Rollup & RPC Action
 * File: app/actions/valerieLocaleActions.ts
 * Work Item: TASK-VAL-UI-LOCALE-SWITCHER / STORY-VAL-LOCALE-HEATMAP-UI
 *
 * Exposes server actions for querying multi-scale K-anonymous geographic
 * sentiment aggregates, proximity blast-radius divergence, and temporal shockwave decay.
 */

"use server";

import { createClient } from "@/lib/supabase/server";

export type LocaleGranularity = "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL";

export const VALID_GRANULARITIES: readonly LocaleGranularity[] = [
  "LOCAL",
  "STATE",
  "NATIONAL",
  "GLOBAL",
] as const;

export interface LocaleSentimentRecord {
  locale_bucket: string;
  participant_count: number;
  vote_count: number;
  flag_count: number;
  mean_likert: number | null;
  mean_confidence: number | null;
  weighted_salience: number | null;
  is_inside_blast_radius: boolean;
  shockwave_24h_likert: number | null;
  settled_likert: number | null;
}

export interface FetchLocaleResultsResult {
  success: boolean;
  granularity: LocaleGranularity;
  fallbackApplied?: boolean;
  fallbackReason?: string;
  data: LocaleSentimentRecord[];
  error?: string;
}

function parseNumeric(val: unknown): number | null {
  if (val == null) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function normalizeRecord(raw: any): LocaleSentimentRecord {
  return {
    locale_bucket: String(raw.locale_bucket ?? "UNKNOWN"),
    participant_count: Number(raw.participant_count ?? 0),
    vote_count: Number(raw.vote_count ?? 0),
    flag_count: Number(raw.flag_count ?? 0),
    mean_likert: parseNumeric(raw.mean_likert),
    mean_confidence: parseNumeric(raw.mean_confidence),
    weighted_salience: parseNumeric(raw.weighted_salience),
    is_inside_blast_radius: Boolean(raw.is_inside_blast_radius),
    shockwave_24h_likert: parseNumeric(raw.shockwave_24h_likert),
    settled_likert: parseNumeric(raw.settled_likert),
  };
}

/**
 * Fetches K-anonymous locale aggregates from valerie.get_poll_results_by_locale.
 * Automatically cascades sparse local buckets (<10 participants) to State or National tiers.
 */
export async function fetchPollResultsByLocale(
  pollId: string,
  requestedGranularity: LocaleGranularity = "NATIONAL"
): Promise<FetchLocaleResultsResult> {
  if (!pollId || typeof pollId !== "string") {
    return {
      success: false,
      granularity: requestedGranularity,
      data: [],
      error: "Poll ID is required.",
    };
  }

  const upperGranularity = (requestedGranularity.toUpperCase() as LocaleGranularity);
  if (!VALID_GRANULARITIES.includes(upperGranularity)) {
    return {
      success: false,
      granularity: requestedGranularity,
      data: [],
      error: `Invalid granularity: ${requestedGranularity}. Must be LOCAL, STATE, NATIONAL, or GLOBAL.`,
    };
  }

  try {
    const supabase = await createClient();

    // Defense-in-depth: Reveal gate verification at Server Action boundary
    if (typeof (supabase as any).auth?.getUser === "function") {
      const { data: authData } = await (supabase as any).auth.getUser();
      const currentUser = authData?.user;

      if (currentUser) {
        const [voteRes, flagRes] = await Promise.all([
          (supabase as any)
            .schema("valerie")
            .from("poll_responses")
            .select("locked_until")
            .eq("poll_id", pollId)
            .eq("user_id", currentUser.id)
            .maybeSingle(),
          (supabase as any)
            .schema("valerie")
            .from("poll_flags")
            .select("locked_until")
            .eq("poll_id", pollId)
            .eq("user_id", currentUser.id)
            .maybeSingle(),
        ]);

        const voteLock = voteRes?.data?.locked_until;
        const flagLock = flagRes?.data?.locked_until;

        if (!voteLock && !flagLock) {
          return {
            success: false,
            granularity: upperGranularity,
            data: [],
            error: "NO_PARTICIPATION: You must vote or challenge before community results unlock.",
          };
        }

        const effectiveLock = new Date(voteLock || flagLock).getTime();
        if (Date.now() < effectiveLock) {
          return {
            success: false,
            granularity: upperGranularity,
            data: [],
            error: `LOCK_WINDOW_ACTIVE: Results remain sealed until ${new Date(effectiveLock).toISOString()}`,
          };
        }
      }
    }

    // 1. Initial RPC query at requested granularity tier
    const { data: rawRows, error: rpcError } = await supabase
      .schema("valerie")
      .rpc("get_poll_results_by_locale", {
        p_poll_id: pollId,
        p_granularity: upperGranularity,
      });

    if (rpcError) {
      return {
        success: false,
        granularity: upperGranularity,
        data: [],
        error: rpcError.message || "Failed to fetch locale aggregates.",
      };
    }

    const records: LocaleSentimentRecord[] = Array.isArray(rawRows)
      ? rawRows.map(normalizeRecord)
      : [];

    // 2. K-Anonymity fallback check: If LOCAL was requested but returned 0 rows, cascade to parent tiers
    if (upperGranularity === "LOCAL" && records.length === 0) {
      // Cascade to STATE tier
      const { data: stateRows, error: stateError } = await supabase
        .schema("valerie")
        .rpc("get_poll_results_by_locale", {
          p_poll_id: pollId,
          p_granularity: "STATE",
        });

      if (!stateError && Array.isArray(stateRows) && stateRows.length > 0) {
        return {
          success: true,
          granularity: "STATE",
          fallbackApplied: true,
          fallbackReason:
            "Local participation (<10 responses) is omitted by K-anonymity privacy rules. Rolled up to State / Province tier.",
          data: stateRows.map(normalizeRecord),
        };
      }

      // Cascade to NATIONAL tier
      const { data: nationalRows, error: nationalError } = await supabase
        .schema("valerie")
        .rpc("get_poll_results_by_locale", {
          p_poll_id: pollId,
          p_granularity: "NATIONAL",
        });

      if (!nationalError && Array.isArray(nationalRows) && nationalRows.length > 0) {
        return {
          success: true,
          granularity: "NATIONAL",
          fallbackApplied: true,
          fallbackReason:
            "Local and regional participation are omitted by K-anonymity privacy rules. Rolled up to National tier.",
          data: nationalRows.map(normalizeRecord),
        };
      }
    }

    return {
      success: true,
      granularity: upperGranularity,
      fallbackApplied: false,
      data: records,
    };
  } catch (err: any) {
    return {
      success: false,
      granularity: upperGranularity,
      data: [],
      error: err?.message || "An unexpected error occurred while loading locale metrics.",
    };
  }
}
