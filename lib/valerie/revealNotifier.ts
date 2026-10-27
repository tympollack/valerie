/**
 * Project Valerie: Commit-and-Reveal Alert Logic & Notification Formatting
 * File: lib/valerie/revealNotifier.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS]
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
}

/**
 * Loads dynamic notification configuration from valerie.system_settings.
 */
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
    // Non-blocking fallback to defaults
  }

  return settings;
}

/**
 * Enforces dynamic daily alert throttling limit per user.
 */
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

/**
 * Helper to encode standard base64url.
 */
function base64UrlEncode(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Helper to encode Uint8Array bytes to base64url.
 */
function base64UrlEncodeBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

/**
 * Generates an HMAC-SHA256 signed JWT for 1-click reveal access.
 */
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

/**
 * Renders HTML email notification for revealed results.
 */
export function renderRevealAlertHtml(params: {
  pollTitle: string;
  revealUrl: string;
  unsubscribeUrl: string;
}): string {
  const safeTitle = escapeHtml(params.pollTitle);
  const safeRevealUrl = escapeHtml(params.revealUrl);
  const safeUnsubscribeUrl = escapeHtml(params.unsubscribeUrl);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>Results Unlocked</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#020617;color:#f8fafc;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background-color:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:32px;">
    <div style="display:inline-block;padding:4px 8px;background-color:#042f2e;border:1px solid #14b8a6;border-radius:4px;color:#2dd4bf;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:16px;">
      Deliberation Concluded
    </div>
    <h1 style="font-size:22px;font-weight:700;line-height:1.3;color:#f8fafc;margin:0 0 16px 0;">
      Results Unlocked: Commit-Lock Expired
    </h1>
    <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px 0;">
      Your 24-hour blind voting window has concluded for: <strong>${safeTitle}</strong>.
      Community bivariate consensus charts and premise challenges are now fully visible.
    </p>
    <a href="${safeRevealUrl}" style="display:inline-block;background-color:#06b6d4;color:#020617;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">
      View Bivariate Reveal Heatmap &rarr;
    </a>
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;font-size:12px;color:#64748b;">
      <p>The Votary &bull; Project Valerie Autonomous Civic Governance</p>
      <p><a href="${safeUnsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from alerts</a></p>
    </div>
  </div>
 </body>
</html>`;
}
