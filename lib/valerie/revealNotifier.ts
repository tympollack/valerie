/**
 * Project Valerie: Commit-and-Reveal Alert Logic & Notification Formatting
 * File: lib/valerie/revealNotifier.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS] / [TASK-VAL-REVEAL-NOTIF-TRIGGER]
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
    return { trajectory: "Deliberation Synthesized · Results Unlocked", totalVotes: 0, consensusPct: 0, controversyScore: 0 };
  }

  let sumLikert = 0;
  let affirmativeCount = 0;
  for (const r of responses) {
    const l = r.likert_score ?? 0;
    sumLikert += l;
    if (l > 0) affirmativeCount++;
  }

  const mean = sumLikert / total;
  const affirmativePct = Math.round((affirmativeCount / total) * 100);

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
    trajectory = `Principled Rejection (${100 - affirmativePct}% Oppose)`;
  } else if (stdDev >= 1.1) {
    trajectory = "Polarized Bivariate Distribution (Ideological Dispersion)";
  } else if (Math.abs(mean) <= 0.3) {
    trajectory = "Deliberative Equilibrium · Balanced Community Perspective";
  } else {
    trajectory = `Emerging Civic Consensus (${Math.max(affirmativePct, 100 - affirmativePct)}% Convergence)`;
  }

  return {
    trajectory,
    totalVotes: total,
    consensusPct: Math.max(affirmativePct, 100 - affirmativePct),
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
        if (row.key === "notifications.enabled") settings.enabled = row.value === true || row.value === "true";
        else if (row.key === "notifications.from_email" && row.value) settings.fromEmail = String(row.value).replace(/^"|"$/g, "");
        else if (row.key === "notifications.from_name" && row.value) settings.fromName = String(row.value).replace(/^"|"$/g, "");
        else if (row.key === "notifications.max_daily_alerts_per_user") settings.maxDailyAlertsPerUser = Number(row.value) || settings.maxDailyAlertsPerUser;
      }
    }
  } catch {
    // Non-blocking fallback to defaults
  }
  return settings;
}

export function filterAlertsUnderCeiling(
  candidates: PendingRevealCandidate[],
  maxDailyPerUser: number
): PendingRevealCandidate[] {
  const userCounts = new Map<string, number>();
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
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return base64UrlEncode(binary);
}

export async function generateRevealToken(userId: string, pollId: string, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: userId, pollId, action: "reveal", iss: "valerie.sunshade.icu", iat: now, exp: now + 48 * 3600 };

  const dataToSign = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  return `${dataToSign}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function escapeHtml(str: string): string {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Results Unlocked</title></head>
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
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Your Registered Stance Archetype</div>
          <span style="display:inline-block;background-color:#083344;color:#22d3ee;border:1px solid #06b6d4;font-size:13px;font-weight:700;padding:3px 10px;border-radius:4px;">${stance}</span>
        </div>
        <div style="padding-top:10px;border-top:1px solid #1e293b;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Community Consensus Trajectory</div>
          <div style="font-size:14px;font-weight:600;color:#38bdf8;">${trajectory}</div>
          ${metricsHtml}
        </div>
      </div>
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${safeRevealUrl}" style="display:inline-block;background-color:#06b6d4;color:#020617;font-weight:800;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(6,182,212,0.4);">View Bivariate Reveal Heatmap &rarr;</a>
      </div>
    </div>
    <div style="padding:20px 24px;border-top:1px solid #164e63;background-color:#030712;font-size:12px;line-height:1.6;color:#64748b;">
      <p style="margin:0 0 6px 0;"><strong>The Votary</strong> &bull; Project Valerie Autonomous Civic Governance</p>
      <p style="margin:0;"><a href="${safeUnsubscribeUrl}" style="color:#22d3ee;text-decoration:underline;">Unsubscribe from reveal alerts</a></p>
    </div>
  </div>
</body>
</html>`;
}

export async function processRevealNotifier(
  adminClient: SupabaseClient,
  resendApiKey: string,
  options: { appBaseUrl?: string; tokenSecret?: string } = {}
) {
  const settings = await getRevealNotificationSettings(adminClient);
  if (!settings.enabled) {
    return { status: "paused_by_admin" as const, totalEligible: 0, totalDispatched: 0, message: "Reveal alert worker halted: notifications.enabled is false." };
  }

  const appBaseUrl = options.appBaseUrl || (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_APP_URL) || "https://votary.app";
  const tokenSecret = options.tokenSecret || (typeof process !== "undefined" && (process.env?.ACTION_TOKEN_SECRET || process.env?.SUPABASE_JWT_SECRET)) || "valerie-email-action-token-secret-default";
  const nowIso = new Date().toISOString();

  const { data: responses, error: respError } = await (adminClient as any)
    .schema("valerie")
    .from("poll_responses")
    .select("user_id, poll_id, locked_until, likert_score, confidence_score, reveal_notified")
    .lte("locked_until", nowIso)
    .eq("reveal_notified", false)
    .limit(500);

  if (respError || !Array.isArray(responses) || responses.length === 0) {
    return { status: "success" as const, totalEligible: 0, totalDispatched: 0, error: respError?.message };
  }

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
    for (const p of prefs) allowedUserMap.set(p.user_id, p.unsubscribe_token);
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

  const throttledCandidates = filterAlertsUnderCeiling(candidates, settings.maxDailyAlertsPerUser);
  if (throttledCandidates.length === 0) {
    return { status: "success" as const, totalEligible: candidates.length, totalDispatched: 0 };
  }

  const pollIds = Array.from(new Set(throttledCandidates.map((c) => c.pollId)));
  const { data: pollRows } = await (adminClient as any).schema("valerie").from("polls").select("id, title").in("id", pollIds);
  const pollTitleMap = new Map<string, string>();
  if (Array.isArray(pollRows)) {
    for (const p of pollRows) pollTitleMap.set(p.id, p.title);
  }

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
          metrics: { totalVotes, consensusPct, controversyScore },
        }),
      });

      candidateDispatchedPairs.push({ userId: item.userId, pollId: item.pollId });
    } catch {
      // Continue next candidate
    }
  }

  let dispatchSucceeded = false;
  if (emailsToSend.length > 0 && resendApiKey) {
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
  } else if (emailsToSend.length > 0 && !resendApiKey) {
    dispatchSucceeded = true;
  }

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
