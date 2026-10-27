/**
 * Project Valerie: Dynamic Notification System Settings Loader
 * File: lib/valerie/notificationSettings.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS]
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";

export interface NotificationDynamicSettings {
  enabled: boolean;
  fromEmail: string;
  fromName: string;
  maxDailyAlertsPerUser: number;
  digestHourUtc: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationDynamicSettings = {
  enabled: true,
  fromEmail: "digest@mail.votary.app",
  fromName: "The Votary",
  maxDailyAlertsPerUser: 2,
  digestHourUtc: 12,
};

/**
 * Loads runtime notification keys from valerie.system_settings with safe defaults.
 */
export async function getNotificationDynamicSettings(
  adminClient: SupabaseClient
): Promise<NotificationDynamicSettings> {
  const settings: NotificationDynamicSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };

  if (process.env.RESEND_FROM_EMAIL) {
    settings.fromEmail = process.env.RESEND_FROM_EMAIL;
  }

  try {
    const target =
      typeof (adminClient as any).schema === "function"
        ? (adminClient as any).schema("valerie").from("system_settings")
        : adminClient.from("system_settings");

    const { data } = await target
      .select("key, value")
      .in("key", [
        "notifications.enabled",
        "notifications.from_email",
        "notifications.from_name",
        "notifications.max_daily_alerts_per_user",
        "notifications.digest_hour_utc",
      ]);

    if (Array.isArray(data)) {
      for (const row of data) {
        if (row.key === "notifications.enabled") {
          settings.enabled = row.value === true || row.value === "true";
        } else if (row.key === "notifications.from_email" && row.value) {
          settings.fromEmail = String(row.value).replace(/^"|"$/g, "");
        } else if (row.key === "notifications.from_name" && row.value) {
          settings.fromName = String(row.value).replace(/^"|"$/g, "");
        } else if (row.key === "notifications.max_daily_alerts_per_user") {
          settings.maxDailyAlertsPerUser = Number(row.value) || settings.maxDailyAlertsPerUser;
        } else if (row.key === "notifications.digest_hour_utc") {
          settings.digestHourUtc = Number(row.value) || settings.digestHourUtc;
        }
      }
    }
  } catch {
    // Non-blocking fallback to defaults
  }

  return settings;
}

/**
 * Dispatches an email batch via Resend with exponential backoff on rate limits.
 */
export async function sendBatchWithRetry(
  resend: Resend,
  batch: Array<{ from: string; to: string; subject: string; html: string }>,
  maxRetries: number = 3,
  initialDelayMs: number = 500
): Promise<unknown> {
  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxRetries) {
    try {
      const response = await resend.batch.send(batch);
      if (response.error) {
        const errorMsg = String(response.error.message || "");
        const isRateLimit =
          response.error.name === "rate_limit_exceeded" ||
          errorMsg.toLowerCase().includes("rate limit") ||
          (response.error as any).statusCode === 429;

        if (isRateLimit && attempt < maxRetries - 1) {
          attempt++;
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw new Error(response.error.message || "Resend batch dispatch failed");
      }
      return response.data;
    } catch (err: unknown) {
      const isRateLimit =
        (err as any)?.status === 429 ||
        (err as any)?.statusCode === 429 ||
        String((err as any)?.message).toLowerCase().includes("rate limit");

      if (isRateLimit && attempt < maxRetries - 1) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}
