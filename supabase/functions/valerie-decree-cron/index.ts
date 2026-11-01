/**
 * Project Valerie: Automated Sovereign Decree Compilation Cron Worker (Edge Function)
 * File: supabase/functions/valerie-decree-cron/index.ts
 * Work Item: [TASK-VAL-DECREE-COMPILER-RUNNER] / [STORY-VAL-DECREE-INACTION]
 *
 * Runs scheduled checks across unlocked polls to package >=70% supermajorities
 * into cryptographically sealed sovereign decrees.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  processDecreeCompiler,
  getDecreeCompilerSettings,
  DEFAULT_DECREE_SETTINGS,
  type DecreeCompilerSettings,
  type DecreeCompilationResult,
  type DecreeCompilerSummary,
} from "../../lib/valerie/decreeCompilerRunner.ts";

export {
  processDecreeCompiler,
  getDecreeCompilerSettings,
  DEFAULT_DECREE_SETTINGS,
  type DecreeCompilerSettings,
  type DecreeCompilationResult,
  type DecreeCompilerSummary,
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
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized worker invocation: missing or invalid worker secret" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const result = await processDecreeCompiler(adminClient);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
