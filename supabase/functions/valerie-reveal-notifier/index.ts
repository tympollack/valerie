/**
 * Project Valerie: Commit-and-Reveal Expiration Alert Worker (Edge Function)
 * File: supabase/functions/valerie-reveal-notifier/index.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS]
 *
 * Dispatches automated transactional alerts when a citizen's commit-lock expires,
 * inviting them to review unlocked community deliberation distributions.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getRevealNotificationSettings,
  filterAlertsUnderCeiling,
  generateRevealToken,
  renderRevealAlertHtml,
  type PendingRevealCandidate,
} from "../../lib/valerie/revealNotifier.ts";

export {
  getRevealNotificationSettings,
  filterAlertsUnderCeiling,
  generateRevealToken,
  renderRevealAlertHtml,
  type PendingRevealCandidate,
};

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Core processor for scanning expired locks and batch sending reveal alerts.
 */
export async function processRevealNotifier(
  adminClient: SupabaseClient,
  resendApiKey: string,
  options: {
    appBaseUrl?: string;
    tokenSecret?: string;
  } = {}
) {
  // 1. Dynamic settings lookup
  const settings = await getRevealNotificationSettings(adminClient);

  if (!settings.enabled) {
    return {
      status: "paused_by_admin" as const,
      totalEligible: 0,
      totalDispatched: 0,
      message: "Reveal alert worker halted: notifications.enabled is false.",
    };
  }

  const appBaseUrl = options.appBaseUrl || Deno.env.get("NEXT_PUBLIC_APP_URL") || "https://votary.app";
  const tokenSecret =
    options.tokenSecret ||
    Deno.env.get("ACTION_TOKEN_SECRET") ||
    Deno.env.get("SUPABASE_JWT_SECRET") ||
    Deno.env.get("JWT_SECRET") ||
    "valerie-email-action-token-secret-default";

  // 2. Query expired poll responses within recent window (default: last 1 hour for periodic worker)
  const windowHours = (options as any).windowHours || 1;
  const windowStart = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const { data: responses, error: respError } = await (adminClient as any)
    .schema("valerie")
    .from("poll_responses")
    .select("user_id, poll_id, locked_until")
    .lte("locked_until", nowIso)
    .gte("locked_until", windowStart)
    .limit(500);

  if (respError || !Array.isArray(responses) || responses.length === 0) {
    return {
      status: "success" as const,
      totalEligible: 0,
      totalDispatched: 0,
      error: respError?.message,
    };
  }

  // 3. Filter for users with proximity alerts enabled and not unsubscribed
  const userIds = Array.from(new Set(responses.map((r: any) => r.user_id)));
  const { data: prefs } = await (adminClient as any)
    .schema("valerie")
    .from("user_digest_preferences")
    .select("user_id, proximity_alerts_enabled, email_cadence, unsubscribe_token")
    .in("user_id", userIds)
    .eq("proximity_alerts_enabled", true)
    .neq("email_cadence", "off");

  const allowedUserMap = new Map<string, string>();
  if (Array.isArray(prefs)) {
    for (const p of prefs) {
      allowedUserMap.set(p.user_id, p.unsubscribe_token);
    }
  }

  const candidates: PendingRevealCandidate[] = responses
    .filter((r: any) => allowedUserMap.has(r.user_id))
    .map((r: any) => ({
      userId: r.user_id,
      pollId: r.poll_id,
      lockedUntil: r.locked_until,
    }));

  // 4. Enforce dynamic alert ceiling
  const throttledCandidates = filterAlertsUnderCeiling(
    candidates,
    settings.maxDailyAlertsPerUser
  );

  if (throttledCandidates.length === 0) {
    return {
      status: "success" as const,
      totalEligible: candidates.length,
      totalDispatched: 0,
    };
  }

  // 5. Build and dispatch email batch
  const emailsToSend: Array<{ from: string; to: string; subject: string; html: string }> = [];

  for (const item of throttledCandidates) {
    try {
      const { data: userData } = await adminClient.auth.admin.getUserById(item.userId);
      if (!userData?.user?.email) continue;

      const token = await generateRevealToken(item.userId, item.pollId, tokenSecret);
      const revealUrl = `${appBaseUrl}/poll/${item.pollId}?action_token=${token}`;
      const unsubToken = allowedUserMap.get(item.userId) || "default";
      const unsubscribeUrl = `${appBaseUrl}/api/digest/unsubscribe?token=${unsubToken}`;

      emailsToSend.push({
        from: `${settings.fromName} <${settings.fromEmail}>`,
        to: userData.user.email,
        subject: "Results Unlocked: Commit-Lock Window Concluded",
        html: renderRevealAlertHtml({
          pollTitle: "Civic Deliberation Poll",
          revealUrl,
          unsubscribeUrl,
        }),
      });
    } catch {
      // Continue next candidate
    }
  }

  if (emailsToSend.length > 0 && resendApiKey) {
    try {
      await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailsToSend),
      });
    } catch (err) {
      console.error("[valerie-reveal-notifier] Resend dispatch error:", err);
    }
  }

  return {
    status: "success" as const,
    totalEligible: candidates.length,
    totalDispatched: emailsToSend.length,
  };
}

// =============================================================================
// Edge Function HTTP Handler
// =============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const cronSecret = Deno.env.get("CRON_SECRET") || Deno.env.get("WORKER_AUTH_TOKEN");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized worker invocation" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const result = await processRevealNotifier(adminClient, resendApiKey);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
