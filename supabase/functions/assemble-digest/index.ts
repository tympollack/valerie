/**
 * Project Valerie: 60/30/10 Content Curation & Intake Engine Edge Function
 * File: supabase/functions/assemble-digest/index.ts
 * Work Item: [TASK-VAL-DIGEST-RPC] / [STORY-VAL-DIGEST-ENGINE]
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
    }

    // Parse parameters
    let userId: string | null = null;
    let limit = 5;

    const authHeader = req.headers.get("Authorization") || "";
    const isServiceRoleCaller =
      Boolean(supabaseServiceKey) &&
      authHeader === `Bearer ${supabaseServiceKey}`;

    // Caller client forwards incoming authorization header to enforce caller RLS
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    if (authHeader) {
      const {
        data: { user },
      } = await callerClient.auth.getUser();
      if (user?.id) {
        userId = user.id;
      }
    }

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (typeof body.limit === "number") {
          limit = body.limit;
        }
        // Only allow userId override if caller holds exact service_role bearer credentials
        if (body.userId && typeof body.userId === "string" && isServiceRoleCaller) {
          userId = body.userId;
        }
      } catch {
        // No or invalid JSON body; use defaults
      }
    } else if (req.method === "GET") {
      const url = new URL(req.url);
      const limitParam = url.searchParams.get("limit");
      if (limitParam) {
        const parsed = parseInt(limitParam, 10);
        if (!isNaN(parsed)) limit = parsed;
      }
    }

    // Bound limit strictly between 1 and 20 to prevent oversized queries
    const boundedLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 5, 1), 20);

    // Call valerie.assemble_digest_payload RPC using callerClient to preserve caller context
    const dbClient = isServiceRoleCaller && supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : callerClient;

    const { data: digest, error } = await dbClient
      .schema("valerie")
      .rpc("assemble_digest_payload", {
        p_user_id: userId,
        p_limit: boundedLimit,
      });

    if (error) {
      // Fallback query if RPC is temporarily unavailable during staging migration sync
      const { data: fallbackPolls, error: fallbackError } = await dbClient
        .schema("valerie")
        .from("polls")
        .select("id, question_text, scope_tier, axis_category, target_locale_code, detected_locales, related_ecosystem_refs, cluster_id")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(boundedLimit);

      if (fallbackError || !fallbackPolls || fallbackPolls.length === 0) {
        return jsonResponse({ error: error.message }, 500);
      }

      const fallbackDigest = fallbackPolls.map((poll, idx) => ({
        category: idx === 0 ? "BLINDSPOT_BRIDGE" : idx === 1 ? "CIVIC_ANCHOR" : "PERSONA_MATCH",
        category_ratio: idx === 0 ? "10%" : idx === 1 ? "30%" : "60%",
        poll_id: poll.id,
        question_text: poll.question_text,
        scope_tier: poll.scope_tier || "NATIONAL",
        axis_category: poll.axis_category || null,
        target_locale_code: poll.target_locale_code || null,
        detected_locales: poll.detected_locales || [],
        related_ecosystem_refs: poll.related_ecosystem_refs || {},
        is_reveal_ready: false,
        cluster_id: poll.cluster_id || null,
      }));

      return jsonResponse({ data: fallbackDigest, status: "fallback" });
    }

    return jsonResponse({ data: digest, status: "success" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
