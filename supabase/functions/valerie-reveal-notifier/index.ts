/**
 * Project Valerie: Commit-and-Reveal Expiration Alert Worker (Edge Function)
 * File: supabase/functions/valerie-reveal-notifier/index.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS] / [TASK-VAL-REVEAL-NOTIF-TRIGGER]
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
  classifyCallerStance,
  computeCommunityTrajectory,
  type PendingRevealCandidate,
} from "../../lib/valerie/revealNotifier.ts";

export {
  getRevealNotificationSettings,
  filterAlertsUnderCeiling,
  generateRevealToken,
  renderRevealAlertHtml,
  classifyCallerStance,
  computeCommunityTrajectory,
  type PendingRevealCandidate,
};

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Core processor for scanning expired locks, compiling stances, and batch sending reveal alerts.
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

  // 2. Query expired, unnotified poll responses (locked_until <= now() AND reveal_notified = false)
  const nowIso = new Date().toISOString();

  const { data: responses, error: respError } = await (adminClient as any)
    .schema("valerie")
    .from("poll_responses")
    .select("user_id, poll_id, locked_until, likert_score, confidence_score, reveal_notified")
    .lte("locked_until", nowIso)
    .eq("reveal_notified", false)
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
      likertScore: r.likert_score,
      confidenceScore: r.confidence_score,
    }));

  // 4. Enforce dynamic alert ceiling (max 2 per user per day by default)
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

  // 5. Query poll metadata and aggregate consensus data
  const pollIds = Array.from(new Set(throttledCandidates.map((c) => c.pollId)));
  const { data: pollRows } = await (adminClient as any)
    .schema("valerie")
    .from("polls")
    .select("id, title")
    .in("id", pollIds);

  const pollTitleMap = new Map<string, string>();
  if (Array.isArray(pollRows)) {
    for (const p of pollRows) {
      pollTitleMap.set(p.id, p.title);
    }
  }

  // Fetch all unlocked responses for these polls to compute consensus trajectory
  const { data: allPollResponses } = await (adminClient as any)
    .schema("valerie")
    .from("poll_responses")
    .select("poll_id, likert_score, confidence_score")
    .in("poll_id", pollIds);

  const pollResponsesMap = new Map<string, Array<{ likert_score: number; confidence_score: number }>>();
  if (Array.isArray(allPollResponses)) {
    for (const apr of allPollResponses) {
      const list = pollResponsesMap.get(apr.poll_id) || [];
      list.push(apr);
      pollResponsesMap.set(apr.poll_id, list);
    }
  }

  // 6. Build email batch
  const emailsToSend: Array<{ from: string; to: string; subject: string; html: string }> = [];
  const candidateDispatchedPairs: Array<{ userId: string; pollId: string }> = [];

  for (const item of throttledCandidates) {
    try {
      const { data: userData } = await adminClient.auth.admin.getUserById(item.userId);
      if (!userData?.user?.email) continue;

      const token = await generateRevealToken(item.userId, item.pollId, tokenSecret);
      const revealUrl = `${appBaseUrl}/poll/${item.pollId}?action_token=${token}`;
      const unsubToken = allowedUserMap.get(item.userId) || "default";
      const unsubscribeUrl = `${appBaseUrl}/api/digest/unsubscribe?token=${unsubToken}`;
      const pollTitle = pollTitleMap.get(item.pollId) || "Civic Deliberation Poll";

      const callerStance = classifyCallerStance(item.likertScore ?? 0, item.confidenceScore ?? 50);
      const responsesForPoll = pollResponsesMap.get(item.pollId) || [];
      const { trajectory, totalVotes, consensusPct, controversyScore } = computeCommunityTrajectory(responsesForPoll);

      emailsToSend.push({
        from: `${settings.fromName} <${settings.fromEmail}>`,
        to: userData.user.email,
        subject: "Results Unlocked: Commit-Lock Window Concluded",
        html: renderRevealAlertHtml({
          pollTitle,
          revealUrl,
          unsubscribeUrl,
          stanceArchetype: callerStance,
          consensusTrajectory: trajectory,
          lockedUntil: item.lockedUntil,
          metrics: {
            totalVotes,
            consensusPct,
            controversyScore,
          },
        }),
      });

      candidateDispatchedPairs.push({ userId: item.userId, pollId: item.pollId });
    } catch {
      // Continue next candidate
    }
  }

  // 7. Dispatch batch through Resend API
  let dispatchSucceeded = false;
  if (emailsToSend.length > 0 && resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailsToSend),
      });
      if (res.ok) {
        dispatchSucceeded = true;
      } else {
        console.error("[valerie-reveal-notifier] Resend dispatch returned non-200:", res.status);
      }
    } catch (err) {
      console.error("[valerie-reveal-notifier] Resend dispatch error:", err);
    }
  } else if (emailsToSend.length > 0 && !resendApiKey) {
    // In mock or development environments without an API key
    dispatchSucceeded = true;
  }

  // 8. Mark reveal_notified = true to prevent duplicate notifications
  if (dispatchSucceeded && candidateDispatchedPairs.length > 0) {
    for (const pair of candidateDispatchedPairs) {
      try {
        await (adminClient as any)
          .schema("valerie")
          .from("poll_responses")
          .update({ reveal_notified: true })
          .eq("poll_id", pair.pollId)
          .eq("user_id", pair.userId);
      } catch (err) {
        console.error("[valerie-reveal-notifier] Failed to mark reveal_notified:", err);
      }
    }
  }

  return {
    status: "success" as const,
    totalEligible: candidates.length,
    totalDispatched: dispatchSucceeded ? emailsToSend.length : 0,
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
