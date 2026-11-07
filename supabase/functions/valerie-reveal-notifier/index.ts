/**
 * Project Valerie: Commit-and-Reveal Expiration Alert Worker (Edge Function)
 * File: supabase/functions/valerie-reveal-notifier/index.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS] / [TASK-VAL-REVEAL-NOTIF-TRIGGER]
 *
 * Dispatches automated transactional alerts when a citizen's commit-lock expires,
 * inviting them to review unlocked community deliberation distributions.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PendingRevealCandidate {
  userId: string;
  pollId: string;
  questionText?: string;
  lockedUntil: string;
  likertScore?: number;
  confidenceScore?: number;
  stanceArchetype?: string;
  consensusTrajectory?: string;
  totalVotes?: number;
  consensusPct?: number;
  controversyScore?: number;
}

export interface RevealNotificationSettings {
  enabled: boolean;
  fromEmail: string;
  fromName: string;
  maxDailyAlertsPerUser: number;
}

export const DEFAULT_REVEAL_SETTINGS: RevealNotificationSettings = {
  enabled: true,
  fromEmail: "digest@mail.votary.app",
  fromName: "The Votary",
  maxDailyAlertsPerUser: 2,
};

export function classifyCallerStance(likertScore: number, confidenceScore: number): string {
  const conf = Math.max(0, Math.min(100, Math.round(confidenceScore)));
  if (conf >= 75) {
    if (likertScore < 0) return "Principled Dissent";
    if (likertScore === 0) return "Deliberate Equilibrium";
    return "Bedrock Conviction";
  } else if (conf >= 40) {
    if (likertScore < 0) return "Grounded Skepticism";
    if (likertScore === 0) return "Balanced Inquiry";
    return "Grounded Support";
  } else {
    if (likertScore < 0) return "Provisional Concern";
    if (likertScore === 0) return "Agnostic Observer";
    return "Provisional Curiosity";
  }
}

export function computeCommunityTrajectory(
  responses: Array<{ likert_score?: number; confidence_score?: number }>
): { trajectory: string; totalVotes: number; consensusPct: number; controversyScore: number } {
  const total = responses.length;
  if (total === 0) {
    return {
      trajectory: "Deliberation Synthesized · Results Unlocked",
      totalVotes: 0,
      consensusPct: 0,
      controversyScore: 0,
    };
  }

  let sumLikert = 0;
  let affirmativeCount = 0;
  let opposeCount = 0;
  let neutralCount = 0;

  for (const r of responses) {
    const l = r.likert_score ?? 0;
    sumLikert += l;
    if (l > 0) affirmativeCount++;
    else if (l < 0) opposeCount++;
    else neutralCount++;
  }

  const mean = sumLikert / total;
  const affirmativePct = Math.round((affirmativeCount / total) * 100);
  const opposePct = Math.round((opposeCount / total) * 100);
  const neutralPct = Math.round((neutralCount / total) * 100);

  let variance = 0;
  for (const r of responses) {
    variance += Math.pow((r.likert_score ?? 0) - mean, 2);
  }
  const stdDev = Math.sqrt(variance / total);
  const controversyScore = Math.min(100, Math.round(stdDev * 50));

  let trajectory = "Consensus Synthesis · Bivariate Distribution Ready";
  if (total < 3) {
    trajectory = "Early Deliberation Cohort · Results Unlocked";
  } else if (mean >= 0.7) {
    trajectory = `Resolute Affirmation (${affirmativePct}% Support)`;
  } else if (mean <= -0.7) {
    trajectory = `Principled Rejection (${opposePct}% Oppose)`;
  } else if (stdDev >= 1.1) {
    trajectory = "Polarized Bivariate Distribution (Ideological Dispersion)";
  } else if (Math.abs(mean) <= 0.3) {
    trajectory = "Deliberative Equilibrium · Balanced Community Perspective";
  } else {
    trajectory = `Emerging Civic Consensus (${Math.max(affirmativePct, opposePct)}% Convergence)`;
  }

  return {
    trajectory,
    totalVotes: total,
    consensusPct: Math.max(affirmativePct, opposePct, neutralPct),
    controversyScore,
  };
}

export async function getRevealNotificationSettings(
  adminClient: SupabaseClient
): Promise<RevealNotificationSettings> {
  const settings: RevealNotificationSettings = { ...DEFAULT_REVEAL_SETTINGS };
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
        }
      }
    }
  } catch {
    /* Fallback to defaults */
  }
  return settings;
}

export function filterAlertsUnderCeiling(
  candidates: PendingRevealCandidate[],
  maxDailyPerUser: number,
  existingCounts?: Map<string, number>
): PendingRevealCandidate[] {
  const userCounts = new Map<string, number>(existingCounts ? Array.from(existingCounts.entries()) : []);
  const allowed: PendingRevealCandidate[] = [];

  for (const candidate of candidates) {
    const current = userCounts.get(candidate.userId) || 0;
    if (current < maxDailyPerUser) {
      userCounts.set(candidate.userId, current + 1);
      allowed.push(candidate);
    }
  }

  return allowed;
}

function base64UrlEncode(str: string): string {
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

export async function generateRevealToken(
  userId: string,
  pollId: string,
  secret: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    pollId,
    action: "reveal",
    iss: "valerie.sunshade.icu",
    iat: now,
    exp: now + 48 * 3600,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(signature));

  return `${dataToSign}.${sigB64}`;
}

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderRevealAlertHtml(params: {
  pollTitle: string;
  revealUrl: string;
  unsubscribeUrl: string;
  stanceArchetype?: string;
  consensusTrajectory?: string;
  lockedUntil?: string;
  metrics?: { totalVotes?: number; consensusPct?: number; controversyScore?: number };
}): string {
  const safeTitle = escapeHtml(params.pollTitle);
  const safeRevealUrl = escapeHtml(params.revealUrl);
  const safeUnsubscribeUrl = escapeHtml(params.unsubscribeUrl);
  const stance = escapeHtml(params.stanceArchetype || "Registered Voter");
  const trajectory = escapeHtml(params.consensusTrajectory || "Deliberation Synthesized · Bivariate Distribution Ready");

  const metricsHtml = params.metrics
    ? `<div style="margin-top:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:#94a3b8;">
        ${params.metrics.totalVotes !== undefined ? `<span style="margin-right:12px;">Votes: <strong>${params.metrics.totalVotes}</strong></span>` : ""}
        ${params.metrics.consensusPct !== undefined ? `<span style="margin-right:12px;">Consensus: <strong>${params.metrics.consensusPct}%</strong></span>` : ""}
        ${params.metrics.controversyScore !== undefined ? `<span>Dispersion: <strong>${params.metrics.controversyScore}</strong></span>` : ""}
      </div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Results Unlocked</title></head>
<body style="margin:0;padding:32px 16px;background-color:#020617;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background-color:#090d16;border:1px solid #164e63;border-radius:12px;overflow:hidden;">
    <div style="padding:28px 24px 20px;border-bottom:1px solid #164e63;background-color:#082f49;">
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;font-weight:700;letter-spacing:0.15em;color:#22d3ee;text-transform:uppercase;margin-bottom:6px;">COMMIT LOCK EXPIRED // RESULTS UNLOCKED</div>
      <h1 style="font-size:22px;font-weight:800;color:#f8fafc;margin:0 0 4px;letter-spacing:-0.02em;">Results Unlocked: Commit-Lock Expired</h1>
      <div style="font-size:12px;color:#94a3b8;">24-Hour Blind Voting Window Concluded</div>
    </div>
    <div style="padding:24px 24px 16px;">
      <p style="color:#94a3b8;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin:0 0 8px 0;">Concluded Deliberation</p>
      <h2 style="font-size:18px;font-weight:700;line-height:1.4;color:#f8fafc;margin:0 0 16px 0;">${safeTitle}</h2>
      <p style="color:#cbd5e1;font-size:14px;line-height:1.6;margin:0 0 20px 0;">Your 24-hour blind voting window has concluded for this deliberation. Community bivariate consensus charts, stance clustering, and premise challenges are now fully visible.</p>
      <div style="background-color:#0b1220;border:1px solid #1e293b;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Your Registered Stance Archetype</div><span style="display:inline-block;background-color:#083344;color:#22d3ee;border:1px solid #06b6d4;font-size:13px;font-weight:700;padding:3px 10px;border-radius:4px;">${stance}</span></div>
        <div style="padding-top:10px;border-top:1px solid #1e293b;"><div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Community Consensus Trajectory</div><div style="font-size:14px;font-weight:600;color:#38bdf8;">${trajectory}</div>${metricsHtml}</div>
      </div>
      <div style="text-align:center;margin-bottom:8px;"><a href="${safeRevealUrl}" style="display:inline-block;background-color:#06b6d4;color:#020617;font-weight:800;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(6,182,212,0.4);">View Bivariate Reveal Heatmap &rarr;</a></div>
    </div>
    <div style="padding:20px 24px;border-top:1px solid #164e63;background-color:#030712;font-size:12px;line-height:1.6;color:#64748b;">
      <p style="margin:0 0 6px 0;"><strong>The Votary</strong> &bull; Project Valerie Autonomous Civic Governance</p><p style="margin:0;"><a href="${safeUnsubscribeUrl}" style="color:#22d3ee;text-decoration:underline;">Unsubscribe from reveal alerts</a></p>
    </div>
  </div>
</body></html>`;
}

export async function processRevealNotifier(
  adminClient: SupabaseClient,
  resendApiKey: string,
  options: { appBaseUrl?: string; tokenSecret?: string; markNotifiedInMock?: boolean } = {}
) {
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
    Deno.env.get("SUPABASE_JWT_SECRET");

  const effectiveSecret = tokenSecret || "valerie-action-test-secret-dev-only";

  const nowIso = new Date().toISOString();
  let responsesQuery = (adminClient as any)
    .schema("valerie")
    .from("poll_responses")
    .select("user_id, poll_id, locked_until, likert_score, confidence_score, reveal_notified")
    .lte("locked_until", nowIso)
    .eq("reveal_notified", false);

  if (typeof responsesQuery?.order === "function") {
    responsesQuery = responsesQuery.order("locked_until", { ascending: true });
  }

  const { data: responses, error: respError } = await responsesQuery.limit(500);

  if (respError) {
    return { status: "error" as const, totalEligible: 0, totalDispatched: 0, error: respError.message };
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    return { status: "success" as const, totalEligible: 0, totalDispatched: 0 };
  }

  const userIds = Array.from(new Set(responses.map((r: any) => r.user_id)));
  const { data: prefs, error: prefsError } = await (adminClient as any)
    .schema("valerie")
    .from("user_digest_preferences")
    .select("user_id, proximity_alerts_enabled, email_cadence, unsubscribe_token")
    .in("user_id", userIds)
    .eq("proximity_alerts_enabled", true)
    .neq("email_cadence", "off");

  if (prefsError) {
    console.error("[valerie-reveal-notifier] Preferences query error, halting to prevent discarding alerts:", prefsError);
    return {
      status: "error" as const,
      totalEligible: 0,
      totalDispatched: 0,
      error: `Preferences query failed: ${prefsError.message}`,
    };
  }

  const allowedUserMap = new Map<string, string>();
  if (Array.isArray(prefs)) {
    for (const p of prefs) {
      allowedUserMap.set(p.user_id, p.unsubscribe_token);
    }
  }

  // Permanently ineligible responses: user has proximity alerts disabled or email cadence off
  // Mark these notified with reveal_notified_at = null so they do not cause head-of-line blocking
  // and do not consume the user's daily email allowance (BUG_0001, BUG_0002)
  const permanentlyIneligible = responses.filter((r: any) => !allowedUserMap.has(r.user_id));
  if (permanentlyIneligible.length > 0) {
    for (const r of permanentlyIneligible) {
      try {
        const { error: ineligErr } = await (adminClient as any)
          .schema("valerie")
          .from("poll_responses")
          .update({ reveal_notified: true, reveal_notified_at: null })
          .eq("poll_id", r.poll_id)
          .eq("user_id", r.user_id);
        if (ineligErr) {
          console.error("[valerie-reveal-notifier] Failed to mark ineligible response:", ineligErr);
        }
      } catch (err) {
        console.error("[valerie-reveal-notifier] Ineligible update error:", err);
      }
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

  // Enforce rolling 24h ceiling against already-sent alerts
  const since24hIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const userDailySentCounts = new Map<string, number>();
  try {
    const { data: pastSentRows } = await (adminClient as any)
      .schema("valerie")
      .from("poll_responses")
      .select("user_id")
      .in("user_id", userIds)
      .eq("reveal_notified", true)
      .gte("reveal_notified_at", since24hIso);
    if (Array.isArray(pastSentRows)) {
      for (const row of pastSentRows) {
        userDailySentCounts.set(row.user_id, (userDailySentCounts.get(row.user_id) || 0) + 1);
      }
    }
  } catch {
    /* Fallback gracefully */
  }

  const throttledCandidates = filterAlertsUnderCeiling(candidates, settings.maxDailyAlertsPerUser, userDailySentCounts);
  if (throttledCandidates.length === 0) {
    return { status: "success" as const, totalEligible: candidates.length, totalDispatched: 0 };
  }

  const pollIds = Array.from(new Set(throttledCandidates.map((c) => c.pollId)));
  const { data: pollRows } = await (adminClient as any)
    .schema("valerie")
    .from("polls")
    .select("id, question_text, title")
    .in("id", pollIds);

  const pollTitleMap = new Map<string, string>();
  if (Array.isArray(pollRows)) {
    for (const p of pollRows) {
      pollTitleMap.set(p.id, p.question_text || p.title || "Civic Deliberation Poll");
    }
  }

  // Paged fetch for poll responses to avoid Supabase 1,000-row cap
  const pollResponsesMap = new Map<string, Array<{ likert_score: number; confidence_score: number }>>();
  for (const pid of pollIds) {
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    const list: Array<{ likert_score: number; confidence_score: number }> = [];
    while (hasMore && from < 10000) {
      const q = (adminClient as any).schema("valerie").from("poll_responses").select("likert_score, confidence_score");
      const eqQ = typeof q?.eq === "function" ? q.eq("poll_id", pid) : q;
      const finalQ = typeof eqQ?.range === "function" ? eqQ.range(from, from + pageSize - 1) : eqQ;
      const { data: page } = await finalQ;
      if (Array.isArray(page) && page.length > 0) {
        list.push(...page);
        from += page.length;
        if (page.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }
    pollResponsesMap.set(pid, list);
  }

  const emailsToSend: Array<{ from: string; to: string; subject: string; html: string }> = [];
  const candidateDispatchedPairs: Array<{ userId: string; pollId: string }> = [];

  for (const item of throttledCandidates) {
    try {
      const { data: userData } = await adminClient.auth.admin.getUserById(item.userId);
      if (!userData?.user?.email) {
        // Mark notified with reveal_notified_at = null so it does not count against daily allowance
        await (adminClient as any)
          .schema("valerie")
          .from("poll_responses")
          .update({ reveal_notified: true, reveal_notified_at: null })
          .eq("poll_id", item.pollId)
          .eq("user_id", item.userId);
        continue;
      }

      const token = await generateRevealToken(item.userId, item.pollId, effectiveSecret);
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
          metrics: { totalVotes, consensusPct, controversyScore },
        }),
      });

      candidateDispatchedPairs.push({ userId: item.userId, pollId: item.pollId });
    } catch {
      /* Continue next candidate */
    }
  }

  let dispatchSucceeded = false;
  if (emailsToSend.length > 0) {
    if (resendApiKey) {
      try {
        const res = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(emailsToSend),
        });
        if (res.ok) dispatchSucceeded = true;
      } catch (err) {
        console.error("[valerie-reveal-notifier] Resend dispatch error:", err);
      }
    } else if (options.markNotifiedInMock) {
      dispatchSucceeded = true;
    }
  }

  if (dispatchSucceeded && candidateDispatchedPairs.length > 0) {
    const sentAtIso = new Date().toISOString();
    for (const pair of candidateDispatchedPairs) {
      try {
        const { error: updateErr } = await (adminClient as any)
          .schema("valerie")
          .from("poll_responses")
          .update({ reveal_notified: true, reveal_notified_at: sentAtIso })
          .eq("poll_id", pair.pollId)
          .eq("user_id", pair.userId);
        if (updateErr) {
          console.error("[valerie-reveal-notifier] Failed to mark reveal_notified:", updateErr);
        }
      } catch (err) {
        console.error("[valerie-reveal-notifier] Failed to mark reveal_notified:", err);
      }
    }
  }

  const isSkippedDueToMissingKey = emailsToSend.length > 0 && !resendApiKey && !options.markNotifiedInMock;
  return {
    status: isSkippedDueToMissingKey ? ("skipped_missing_api_key" as const) : ("success" as const),
    totalEligible: candidates.length,
    totalDispatched: dispatchSucceeded ? emailsToSend.length : 0,
  };
}

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const cronSecret = Deno.env.get("CRON_SECRET") || Deno.env.get("WORKER_AUTH_TOKEN");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized worker invocation: missing or invalid worker secret" }), {
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
