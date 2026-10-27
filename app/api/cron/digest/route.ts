/**
 * Project Valerie: Scheduled Civic Digest Dispatcher (Vercel Cron Worker)
 * File: app/api/cron/digest/route.ts
 * Work Item: [TASK-VAL-CRON-DISPATCH] / [STORY-VAL-EMAIL-NOTIF-INFRA]
 *
 * Dispatches personalized 60/30/10 civic deliberation intake feeds via the
 * Resend Batch API from `The Votary <digest@valerie.sunshade.icu>`.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { generateEmailActionToken } from "@/lib/auth/emailTokens";
import { parseDigestPayload } from "@/lib/valerie/digestEngine";
import { renderCivicDocketHtml, type DocketItem } from "@/components/email/TheCivicDocket";
import {
  getNotificationDynamicSettings,
  sendBatchWithRetry,
  type NotificationDynamicSettings,
} from "@/lib/valerie/notificationSettings";

// =============================================================================
// Helper Functions & Types
// =============================================================================

export { getNotificationDynamicSettings, sendBatchWithRetry, type NotificationDynamicSettings };

export interface UserDigestPreferenceRow {
  user_id: string;
  email_cadence: "daily" | "weekly" | "off";
  proximity_alerts_enabled: boolean;
  digest_day_of_week: number;
  last_digest_sent_at: string | null;
  unsubscribe_token: string;
}

export interface PreparedDigestEmail {
  userId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}

/**
 * Determines whether a user is eligible for a digest dispatch on the given date.
 */
export function isUserEligibleForDigest(
  pref: Pick<UserDigestPreferenceRow, "email_cadence" | "digest_day_of_week" | "last_digest_sent_at">,
  currentDate: Date = new Date()
): boolean {
  if (!pref || pref.email_cadence === "off") {
    return false;
  }

  const nowMs = currentDate.getTime();
  const lastSentMs = pref.last_digest_sent_at
    ? new Date(pref.last_digest_sent_at).getTime()
    : 0;

  if (pref.email_cadence === "daily") {
    const hoursSinceLast = (nowMs - lastSentMs) / (1000 * 60 * 60);
    return !pref.last_digest_sent_at || hoursSinceLast >= 20;
  }

  if (pref.email_cadence === "weekly") {
    const dayOfWeek = currentDate.getUTCDay();
    const daysSinceLast = (nowMs - lastSentMs) / (1000 * 60 * 60 * 24);
    return (
      dayOfWeek === pref.digest_day_of_week &&
      (!pref.last_digest_sent_at || daysSinceLast >= 6)
    );
  }

  return false;
}

/**
 * Core processor for assembling, compiling, and batch dispatching civic digests.
 */
export async function processDigestDispatch(
  adminClient: SupabaseClient,
  resend: Resend,
  options: {
    appBaseUrl?: string;
    fromEmail?: string;
    currentDate?: Date;
    batchSize?: number;
    forceDispatch?: boolean;
  } = {}
) {
  // 1. Query live system settings (TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS)
  const settings = await getNotificationDynamicSettings(adminClient);

  if (!settings.enabled) {
    console.warn("[Project Valerie] Digest dispatch halted: notifications.enabled is false (paused_by_admin).");
    return {
      status: "paused_by_admin" as const,
      totalEligible: 0,
      totalDispatched: 0,
      errors: [] as string[],
    };
  }

  const currentDate = options.currentDate || new Date();
  const isHourMatch = Boolean(
    options.forceDispatch ||
    options.currentDate !== undefined ||
    currentDate.getUTCHours() === settings.digestHourUtc
  );

  if (!isHourMatch) {
    return {
      status: "skipped_off_hour" as const,
      targetHourUtc: settings.digestHourUtc,
      currentHourUtc: currentDate.getUTCHours(),
      totalEligible: 0,
      totalDispatched: 0,
      errors: [] as string[],
    };
  }

  const dynamicSender = `${settings.fromName} <${settings.fromEmail}>`;
  const fromEmail = options.fromEmail || (process.env.RESEND_FROM_EMAIL ? process.env.RESEND_FROM_EMAIL : dynamicSender);
  const appBaseUrl = options.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || "https://votary.app";
  const batchSize = options.batchSize || 100;

  // 1. Query all users with active digest subscriptions (with pagination support)
  const target =
    typeof (adminClient as any).schema === "function"
      ? (adminClient as any).schema("valerie").from("user_digest_preferences")
      : adminClient.from("user_digest_preferences");

  const allPrefs: UserDigestPreferenceRow[] = [];
  const queryBatchSize = 1000;
  let offset = 0;

  while (true) {
    const query = target
      .select(
        "user_id, email_cadence, proximity_alerts_enabled, digest_day_of_week, last_digest_sent_at, unsubscribe_token"
      )
      .in("email_cadence", ["daily", "weekly"]);

    if (typeof query.range === "function") {
      const { data: pageData, error: prefsError } = await query.range(
        offset,
        offset + queryBatchSize - 1
      );

      if (prefsError) {
        throw new Error(`Failed to load digest preferences: ${prefsError.message}`);
      }

      if (!pageData || pageData.length === 0) {
        break;
      }

      allPrefs.push(...(pageData as UserDigestPreferenceRow[]));

      if (pageData.length < queryBatchSize) {
        break;
      }
      offset += queryBatchSize;
    } else {
      const { data: fallbackData, error: fallbackError } = await query;
      if (fallbackError) {
        throw new Error(`Failed to load digest preferences: ${fallbackError.message}`);
      }
      if (fallbackData) {
        allPrefs.push(...(fallbackData as UserDigestPreferenceRow[]));
      }
      break;
    }
  }
  const eligiblePrefs = allPrefs.filter((p) => isUserEligibleForDigest(p, currentDate));

  let totalDispatched = 0;
  const errors: string[] = [];

  // 2. Process in batches of up to batchSize
  for (let i = 0; i < eligiblePrefs.length; i += batchSize) {
    const chunk = eligiblePrefs.slice(i, i + batchSize);
    const preparedEmails: PreparedDigestEmail[] = [];
    const chunkUserIds: string[] = [];

    for (const pref of chunk) {
      try {
        // Resolve user's registered email address
        const { data: userData, error: userError } =
          await adminClient.auth.admin.getUserById(pref.user_id);

        if (userError || !userData?.user?.email) {
          continue;
        }

        const userEmail = userData.user.email;

        // Fetch curated 60/30/10 payload
        const { data: rawDigest } =
          typeof (adminClient as any).schema === "function"
            ? await (adminClient as any)
                .schema("valerie")
                .rpc("assemble_digest_payload", { p_user_id: pref.user_id, p_limit: 5 })
            : await adminClient.rpc("assemble_digest_payload", {
                p_user_id: pref.user_id,
                p_limit: 5,
              });

        const parsed = parseDigestPayload(rawDigest);

        // Map items with signed 1-click action deep links
        const docketItems: DocketItem[] = await Promise.all(
          parsed.items.map(async (item) => {
            const token = await generateEmailActionToken(
              pref.user_id,
              item.poll_id,
              "vote"
            );
            return {
              poll_id: item.poll_id,
              question_text: item.question_text,
              category: item.category,
              category_ratio: item.category_ratio,
              scope_tier: item.scope_tier,
              deepLink: `${appBaseUrl}/poll/${item.poll_id}?action_token=${token}`,
            };
          })
        );

        const unsubscribeUrl = `${appBaseUrl}/api/digest/unsubscribe?token=${pref.unsubscribe_token}`;
        const preferencesUrl = `${appBaseUrl}/settings`;

        const html = renderCivicDocketHtml({
          items: docketItems,
          unsubscribeUrl,
          preferencesUrl,
          generatedDate: currentDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        });

        preparedEmails.push({
          userId: pref.user_id,
          from: fromEmail,
          to: userEmail,
          subject: "The Civic Docket: Your Deliberation Queue",
          html,
        });

        chunkUserIds.push(pref.user_id);
      } catch (err: unknown) {
        errors.push(`Error preparing digest for user ${pref.user_id}: ${err}`);
      }
    }

    if (preparedEmails.length === 0) {
      continue;
    }

    // Dispatch batch via Resend Batch API
    try {
      await sendBatchWithRetry(
        resend,
        preparedEmails.map((e) => ({
          from: e.from,
          to: e.to,
          subject: e.subject,
          html: e.html,
        }))
      );

      // Update last_digest_sent_at timestamp
      const { error: updateError } = await target
        .update({
          last_digest_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in("user_id", chunkUserIds);

      if (updateError) {
        console.error("[Project Valerie] Failed to update last_digest_sent_at:", updateError);
        errors.push(`Timestamp update failed for chunk starting at ${i}: ${updateError.message}`);
      }

      totalDispatched += preparedEmails.length;
    } catch (sendErr: unknown) {
      errors.push(`Batch dispatch failed for chunk starting at ${i}: ${sendErr}`);
    }
  }

  return {
    totalEligible: eligiblePrefs.length,
    totalDispatched,
    errors,
  };
}

// =============================================================================
// API Route Handler
// =============================================================================

export async function POST(request: NextRequest) {
  // 1. Protect route with CRON_SECRET authorization header
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing CRON_SECRET." },
      { status: 401 }
    );
  }

  // 2. Verify platform secrets
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase service configuration." },
      { status: 500 }
    );
  }

  if (!resendApiKey) {
    return NextResponse.json(
      { error: "Missing Resend API configuration." },
      { status: 500 }
    );
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const resend = new Resend(resendApiKey);
    const force = request.nextUrl.searchParams.get("force") === "true";

    const result = await processDigestDispatch(adminClient, resend, { forceDispatch: force });

    if ((result as any).status === "paused_by_admin") {
      return NextResponse.json({
        success: true,
        status: "paused_by_admin",
        message: "Notification delivery is currently paused by administrator kill-switch.",
        data: result,
      });
    }

    if ((result as any).status === "skipped_off_hour") {
      return NextResponse.json({
        success: true,
        status: "skipped_off_hour",
        message: "Digest dispatch skipped: off target dispatch hour.",
        data: result,
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Digest dispatcher execution failed: ${msg}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
