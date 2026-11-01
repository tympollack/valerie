/**
 * Project Valerie: Commit-and-Reveal Expiration Alert Worker (Edge Function)
 * File: supabase/functions/valerie-reveal-notifier/index.ts
 * Work Item: [TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS] / [TASK-VAL-REVEAL-NOTIF-TRIGGER]
 *
 * Dispatches automated transactional alerts when a citizen's commit-lock expires,
 * inviting them to review unlocked community deliberation distributions.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getRevealNotificationSettings,
  filterAlertsUnderCeiling,
  generateRevealToken,
  renderRevealAlertHtml,
  classifyCallerStance,
  computeCommunityTrajectory,
  processRevealNotifier,
  type PendingRevealCandidate,
} from "../../lib/valerie/revealNotifier.ts";

export {
  getRevealNotificationSettings,
  filterAlertsUnderCeiling,
  generateRevealToken,
  renderRevealAlertHtml,
  classifyCallerStance,
  computeCommunityTrajectory,
  processRevealNotifier,
  type PendingRevealCandidate,
};

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
