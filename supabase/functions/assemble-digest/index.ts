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

    const authHeader = req.headers.get("Authorization");
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    if (authHeader) {
      const { data: { user } } = await client.auth.getUser();
      if (user?.id) {
        userId = user.id;
      }
    }

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.limit && typeof body.limit === "number") {
          limit = body.limit;
        }
        if (body.userId && typeof body.userId === "string") {
          // Only allow override if caller is service_role
          if (supabaseServiceKey && authHeader?.includes(supabaseServiceKey)) {
            userId = body.userId;
          }
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

    // Call valerie.assemble_digest_payload RPC
    const dbClient = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : client;

    const { data: digest, error } = await dbClient
      .schema("valerie")
      .rpc("assemble_digest_payload", {
        p_user_id: userId,
        p_limit: limit,
      });

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ data: digest, status: "success" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
