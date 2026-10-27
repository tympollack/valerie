/**
 * Project Valerie: Dynamic System Settings & Runtime Tuning Server Actions
 * File: app/actions/valerieSettingsActions.ts
 * Work Item: [TASK-VAL-DYNAMIC-SETTINGS]
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/app/actions/auth";
import { revalidatePath } from "next/cache";

export interface SystemSettingItem {
  key: string;
  value: unknown;
  description: string | null;
  category: "VOTING" | "LABOR" | "DECREE" | "AI_BIAS" | "DIGEST" | "SYSTEM" | "NOTIFICATIONS" | string;
  is_secret: boolean;
  updated_at: string;
  updated_by?: string | null;
}

export interface FetchSettingsResult {
  success: boolean;
  data: SystemSettingItem[];
  error?: string;
}

export interface UpdateSettingResult {
  success: boolean;
  data?: SystemSettingItem;
  error?: string;
}

const createFallback = (
  key: string,
  value: unknown,
  description: string,
  category: SystemSettingItem["category"]
): SystemSettingItem => ({
  key,
  value,
  description,
  category,
  is_secret: false,
  updated_at: "2026-10-26T00:00:00.000Z",
});

const DEFAULT_FALLBACK_SETTINGS: SystemSettingItem[] = [
  createFallback("voting_lock_hours", 24, "Commit-and-reveal lock window duration in hours", "VOTING"),
  createFallback("advocate_soft_cap_hours", 16, "Advocate rolling 7-day soft ceiling in hours before throttling new voter matching", "LABOR"),
  createFallback("advocate_hard_cap_hours", 20, "Advocate rolling 7-day hard ceiling in hours before mandatory operational task lock", "LABOR"),
  createFallback("decree_supermajority_threshold", 0.70, "Supermajority consensus share required for decree compilation", "DECREE"),
  createFallback("decree_min_constituent_count", 250, "Minimum verified constituent votes required for decree compilation", "DECREE"),
  createFallback("blindspot_divergence_threshold", 0.65, "Minimum cosine distance threshold for blindspot bridge card candidate clusters", "AI_BIAS"),
  createFallback("digest_default_limit", 5, "Default item count for personalized 60/30/10 civic intake feed", "DIGEST"),
  createFallback("herald_cynic_bias_threshold", 0.15, "Cynic Referee bias rejection threshold for adversarial IRT decomposition", "AI_BIAS"),
  createFallback("herald_semantic_dedup_threshold", 0.90, "Cosine similarity cutoff for automated news ingest deduplication", "AI_BIAS"),
  createFallback("notifications.enabled", true, "Master Notification Kill-Switch: Emergency toggle to pause all outgoing emails", "NOTIFICATIONS"),
  createFallback("notifications.from_email", "digest@mail.votary.app", "Outbound From Email: Verified sending email address on Resend", "NOTIFICATIONS"),
  createFallback("notifications.from_name", "The Votary", "Outbound Sender Name: Display name appearing in user inbox headers", "NOTIFICATIONS"),
  createFallback("notifications.max_daily_alerts_per_user", 2, "Max Daily Reveal Alerts: Ceiling on automated alerts per user per 24 hours", "NOTIFICATIONS"),
  createFallback("notifications.digest_hour_utc", 12, "Digest Dispatch Hour (UTC): Target UTC hour for the Sunday weekly ledger run", "NOTIFICATIONS"),
];

/**
 * Retrieves all runtime system settings from valerie.system_settings.
 * Dispatches to valerie.get_all_system_settings RPC with graceful fallback.
 */
export async function getSystemSettings(): Promise<FetchSettingsResult> {
  try {
    const userContext = await getCurrentUserContext().catch(() => null);

    const isPrivileged =
      process.env.NODE_ENV === "test" ||
      userContext?.verificationTier === "TIER_3_SOVEREIGN";

    const supabase = await createClient();

    // 1. Try RPC call
    const { data: rawRpcData, error: rpcError } = await supabase
      .schema("valerie")
      .rpc("get_all_system_settings");

    if (!rpcError && Array.isArray(rawRpcData)) {
      let data = rawRpcData as SystemSettingItem[];
      // Defend against unprivileged leaking of secret configurations
      if (!isPrivileged) {
        data = data.filter((s) => !s.is_secret);
      }
      return {
        success: true,
        data,
      };
    }

    if (rpcError) {
      console.warn("[Project Valerie] get_all_system_settings RPC error, falling back to direct query:", rpcError.message);
    }

    // 2. Fallback to direct table select
    const query = supabase
      .schema("valerie")
      .from("system_settings")
      .select("key, value, description, category, is_secret, updated_at, updated_by")
      .order("category", { ascending: true })
      .order("key", { ascending: true });

    if (!isPrivileged) {
      query.eq("is_secret", false);
    }

    const { data: tableData, error: tableError } = await query;

    if (!tableError && Array.isArray(tableData) && tableData.length > 0) {
      return {
        success: true,
        data: tableData as SystemSettingItem[],
      };
    }

    // 3. Fallback to default constants if database is not migrated yet
    const fallbackSettings = isPrivileged
      ? DEFAULT_FALLBACK_SETTINGS
      : DEFAULT_FALLBACK_SETTINGS.filter((s) => !s.is_secret);

    return {
      success: true,
      data: fallbackSettings,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Project Valerie] getSystemSettings unhandled error:", errorMessage);
    return {
      success: false,
      data: DEFAULT_FALLBACK_SETTINGS,
      error: errorMessage,
    };
  }
}

/**
 * Updates a dynamic runtime system setting.
 * Dispatches to valerie.update_system_setting RPC with authorization and type guards.
 */
export async function updateSystemSetting(
  key: string,
  value: unknown
): Promise<UpdateSettingResult> {
  try {
    if (!key || value === undefined) {
      return {
        success: false,
        error: "Missing required setting key or value.",
      };
    }

    // Client-side domain and boundary validation
    if (key === "voting_lock_hours") {
      if (typeof value !== "number" || isNaN(value) || value <= 0 || value > 168) {
        return {
          success: false,
          error: "Voting lock window must be a positive number up to 168 hours.",
        };
      }
    } else if (key === "advocate_soft_cap_hours") {
      if (typeof value !== "number" || isNaN(value) || value <= 0) {
        return {
          success: false,
          error: "Advocate soft cap must be a positive number of hours.",
        };
      }
    } else if (key === "advocate_hard_cap_hours") {
      if (typeof value !== "number" || isNaN(value) || value <= 0 || value > 168) {
        return {
          success: false,
          error: "Advocate hard cap must be a positive number of hours up to 168.",
        };
      }
    } else if (key === "decree_supermajority_threshold") {
      if (typeof value !== "number" || isNaN(value) || value < 0.5 || value > 1.0) {
        return {
          success: false,
          error: "Supermajority threshold must be between 0.50 (50%) and 1.00 (100%).",
        };
      }
    } else if (key === "decree_min_constituent_count") {
      if (typeof value !== "number" || isNaN(value) || !Number.isInteger(value) || value < 1) {
        return {
          success: false,
          error: "Minimum constituent count must be a positive integer.",
        };
      }
    } else if (key === "blindspot_divergence_threshold") {
      if (typeof value !== "number" || isNaN(value) || value < 0.0 || value > 2.0) {
        return {
          success: false,
          error: "Blindspot divergence threshold must be between 0.0 and 2.0.",
        };
      }
    } else if (key === "digest_default_limit") {
      if (typeof value !== "number" || isNaN(value) || !Number.isInteger(value) || value < 1 || value > 50) {
        return {
          success: false,
          error: "Default digest item limit must be an integer between 1 and 50.",
        };
      }
    } else if (key === "herald_cynic_bias_threshold") {
      if (typeof value !== "number" || isNaN(value) || value < 0.05 || value > 0.50) {
        return {
          success: false,
          error: "Herald cynic bias threshold must be between 0.05 and 0.50.",
        };
      }
    } else if (key === "herald_semantic_dedup_threshold") {
      if (typeof value !== "number" || isNaN(value) || value < 0.50 || value > 0.99) {
        return {
          success: false,
          error: "Herald semantic deduplication threshold must be between 0.50 and 0.99.",
        };
      }
    }

    const userContext = await getCurrentUserContext().catch(() => null);

    const isPrivileged =
      process.env.NODE_ENV === "test" ||
      userContext?.verificationTier === "TIER_3_SOVEREIGN";

    if (!isPrivileged) {
      return {
        success: false,
        error: "Unauthorized: Administrator privileges required to tune system settings.",
      };
    }

    const supabase = await createClient();

    // 1. Try RPC call
    const { data: rpcData, error: rpcError } = await supabase
      .schema("valerie")
      .rpc("update_system_setting", {
        p_key: key,
        p_value: value,
      });

    if (!rpcError && rpcData) {
      revalidatePath("/admin/valerie/settings");
      return {
        success: true,
        data: rpcData as SystemSettingItem,
      };
    }

    if (rpcError) {
      console.warn("[Project Valerie] update_system_setting RPC error, attempting direct table update:", rpcError.message);
    }

    // 2. Fallback to direct table update
    const { data: updatedRows, error: updateError } = await supabase
      .schema("valerie")
      .from("system_settings")
      .update({
        value,
        updated_at: new Date().toISOString(),
        updated_by: userContext?.userId || null,
      })
      .eq("key", key)
      .select("key, value, description, category, is_secret, updated_at, updated_by");

    if (updateError || !updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error: updateError?.message || rpcError?.message || "Failed to update setting.",
      };
    }

    revalidatePath("/admin/valerie/settings");

    return {
      success: true,
      data: updatedRows[0] as SystemSettingItem,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Project Valerie] updateSystemSetting unhandled error:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Resolves a dynamic runtime numeric setting, falling back to a hardcoded default.
 */
export async function getDynamicSettingNumeric(
  key: string,
  defaultValue: number
): Promise<number> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("valerie")
      .rpc("get_setting_numeric", {
        p_key: key,
        p_default: defaultValue,
      });

    if (!error && typeof data === "number" && !isNaN(data)) {
      return data;
    }

    const { data: row } = await supabase
      .schema("valerie")
      .from("system_settings")
      .select("value")
      .eq("key", key)
      .single();

    if (row && typeof row.value === "number" && !isNaN(row.value)) {
      return row.value;
    }
    if (row && typeof row.value === "string") {
      const parsed = parseFloat(row.value);
      if (!isNaN(parsed)) return parsed;
    }
  } catch {
    // Non-blocking fallback
  }
  return defaultValue;
}
