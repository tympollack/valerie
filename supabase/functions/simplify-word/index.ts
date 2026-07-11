/**
 * Project Valerie: Educational Incubator — simplify-word Edge Function
 * File: supabase/functions/simplify-word/index.ts
 *
 * PURPOSE
 * -------
 * Takes a complex civic/political term from the UI, returns a simplified
 * definition sourced from GPT-4o-mini. Definitions are cached in
 * valerie.content_cache (keyed by SHA-256 hash) to avoid redundant API calls.
 *
 * REQUEST  (POST, JSON body)
 * -------
 *   { word: string, targetLanguage?: string, targetReadingLevel?: string }
 *
 * RESPONSE (JSON)
 * --------
 *   { definition: string, source: "cache" | "openai" }
 *   { error: string }  (on failure)
 *
 * DATA FLOW
 * ---------
 * 1. Validate JWT from Authorization header — reject unauthenticated callers.
 * 2. Hash the (word + language + readingLevel) tuple with SHA-256.
 * 3. Query valerie.content_cache for a matching hash → cache HIT → return early.
 * 4. Cache MISS → call OpenAI gpt-4o-mini with a non-partisan educator prompt.
 * 5. Write the definition to valerie.content_cache via service_role (bypasses RLS).
 * 6. Return the definition with source: "openai".
 *
 * ENVIRONMENT VARIABLES (set in supabase/functions/.env or Supabase Vault)
 * ---------------------
 *   SUPABASE_URL              — project URL
 *   SUPABASE_ANON_KEY         — public anon key (for JWT verification)
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (for DB writes, bypasses RLS)
 *   OPENAI_API_KEY            — OpenAI secret key
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS headers — required for browser clients calling Edge Functions directly
// ---------------------------------------------------------------------------
const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------------------
// SHA-256 helper — Deno exposes crypto.subtle globally (no import needed)
// ---------------------------------------------------------------------------
async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// OpenAI call — non-partisan civic educator persona
// ---------------------------------------------------------------------------
async function fetchDefinitionFromOpenAI(
  word: string,
  targetLanguage: string,
  targetReadingLevel: string,
  apiKey: string,
): Promise<string> {
  // Project Valerie prompt design principles:
  //  • Persona is "objective civic educator," not a partisan analyst
  //  • Temperature 0.2 → factual, stable, consistent across repeated calls
  //  • Max 2–3 sentences prevents over-explanation
  //  • Reading level and language are injected for personalization
  const systemPrompt = [
    "You are an objective, non-partisan civic and political educator.",
    "Your sole purpose is to explain complex concepts in simple, factual language",
    "that a curious reader can understand — free from advocacy, bias, or editorializing.",
    `Calibrate your response for a ${targetReadingLevel}-level reader.`,
    `Respond in the language with BCP-47 tag: ${targetLanguage}.`,
    "Limit your response to 2–3 sentences. No bullet points, no headers.",
  ].join(" ");

  const userPrompt =
    `Define the following civic, political, or social concept in plain language: "${word}". ` +
    "Provide a neutral, educational definition with no political slant or advocacy.";

  const openAIRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:       "gpt-4o-mini",
      max_tokens:  200,
      temperature: 0.2,   // Low temperature = consistent, factual output
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    }),
  });

  if (!openAIRes.ok) {
    const errText = await openAIRes.text();
    throw new Error(`OpenAI API error ${openAIRes.status}: ${errText}`);
  }

  const openAIData = await openAIRes.json();
  const definition: string | undefined =
    openAIData.choices?.[0]?.message?.content?.trim();

  if (!definition) {
    throw new Error("OpenAI returned an empty completion.");
  }

  return definition;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  // Handle browser CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  // --- 1. Authenticate the caller -------------------------------------------
  // All tooltip requests must come from a signed-in user. We spin up an anon
  // client using the caller's JWT to let Supabase verify it server-side.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header." }, 401);
  }

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon   = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseSvcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAIKey      = Deno.env.get("OPENAI_API_KEY");

  // Verify the caller's JWT by fetching their user record
  const anonClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized. Please sign in." }, 401);
  }

  // --- 2. Parse + validate request body ------------------------------------
  let word: string;
  let targetLanguage: string;
  let targetReadingLevel: string;

  try {
    const body = await req.json();
    word               = (body.word ?? "").toString().trim();
    targetLanguage     = (body.targetLanguage ?? "en").toString().trim().slice(0, 10);
    targetReadingLevel = (body.targetReadingLevel ?? "general").toString().trim().slice(0, 20);
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!word || word.length > 200) {
    return jsonResponse(
      { error: "The 'word' field is required and must be ≤200 characters." },
      400,
    );
  }

  // --- 3. Derive cache key -------------------------------------------------
  // Normalize to lowercase + trimmed before hashing to maximize cache hits
  // for equivalent inputs with differing case.
  const cacheInput  = `${word.toLowerCase()}:${targetLanguage}:${targetReadingLevel}`;
  const contentHash = await sha256Hex(cacheInput);

  // Service role client — used for both cache read and write to bypass RLS
  const svcClient = createClient(supabaseUrl, supabaseSvcKey);

  // --- 4. Cache lookup ------------------------------------------------------
  const { data: cached, error: cacheReadError } = await svcClient
    .schema("valerie")
    .from("content_cache")
    .select("cached_translation")
    .eq("original_text_hash",   contentHash)
    .eq("target_language",      targetLanguage)
    .eq("target_reading_level", targetReadingLevel)
    .maybeSingle(); // returns null instead of error when no row found

  if (cacheReadError) {
    // Non-fatal: log the error and fall through to OpenAI
    console.error("[Project Valerie] Cache read error:", cacheReadError.message);
  }

  if (cached?.cached_translation) {
    // Cache HIT — return immediately, zero OpenAI cost
    return jsonResponse({ definition: cached.cached_translation, source: "cache" });
  }

  // --- 5. Cache MISS — call OpenAI -----------------------------------------
  if (!openAIKey) {
    return jsonResponse(
      { error: "AI definitions are temporarily unavailable." },
      503,
    );
  }

  let definition: string;
  try {
    definition = await fetchDefinitionFromOpenAI(
      word,
      targetLanguage,
      targetReadingLevel,
      openAIKey,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Project Valerie] OpenAI call failed:", message);
    return jsonResponse({ error: "Failed to generate definition." }, 502);
  }

  // --- 6. Write to cache (async, non-blocking failure) ---------------------
  // upsert handles the rare race condition where two concurrent requests
  // for the same word both miss the cache and both try to insert.
  const { error: cacheWriteError } = await svcClient
    .schema("valerie")
    .from("content_cache")
    .upsert(
      {
        original_text_hash:   contentHash,
        target_language:      targetLanguage,
        target_reading_level: targetReadingLevel,
        cached_translation:   definition,
      },
      { onConflict: "original_text_hash,target_language,target_reading_level" },
    );

  if (cacheWriteError) {
    // Non-fatal: the definition is still returned to the user
    console.warn("[Project Valerie] Cache write failed:", cacheWriteError.message);
  }

  return jsonResponse({ definition, source: "openai" });
});
