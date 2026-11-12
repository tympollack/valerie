/**
 * Project Valerie: Ad Decomposer & Cynic Referee Edge Function
 * File: supabase/functions/valerie-ad-decomposer/index.ts
 * Work Item: [TASK-VAL-DECOMPOSER-EDGE] / [STORY-VAL-AD-DECOMPOSER]
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cellToParent, isValidCell, getResolution } from "https://esm.sh/h3-js@4.5.0";

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

const KNOWN_BRAND_PATTERNS = [
  /\b(mcdonald'?s|burger king|wendy'?s|starbucks|dunkin'?|taco bell|subway)\b/gi,
  /\b(coca[\s-]?cola|pepsi|bud light|coors|heineken|corona)\b/gi,
  /\b(apple|google|samsung|amazon|meta|microsoft|verizon|t-mobile|at&t)\b/gi,
  /\b(chevrolet|ford|toyota|honda|geico|progressive|state farm)\b/gi,
  /\b(nike|adidas|target|walmart|home depot|cvs|walgreens)\b/gi,
  /\b(casinos?|draftkings|fanduel|betmgm)\b/gi,
];

const BIASED_TERMS = [
  "corrupt",
  "tyrannical",
  "reckless",
  "eyesore",
  "greedy",
  "evil",
  "blight",
  "destroying",
  "obviously",
  "clearly",
  "monstrous",
  "predatory",
];

function sanitizeBrandNames(rawText: string): { sanitized: string; removedBrands: string[] } {
  let sanitized = rawText;
  const removedBrands: string[] = [];

  for (const pattern of KNOWN_BRAND_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      for (const m of matches) {
        if (!removedBrands.includes(m.toLowerCase())) {
          removedBrands.push(m.toLowerCase());
        }
      }
      sanitized = sanitized.replace(pattern, "commercial advertiser");
    }
  }

  sanitized = sanitized.replace(/(https?:\/\/[^\s]+|www\.[^\s]+|\b\d{3}[-.\s]??\d{3}[-.\s]??\d{4}\b)/gi, "");
  return { sanitized: sanitized.trim(), removedBrands };
}

function inferCategoriesFromOcr(ocrText: string): string[] {
  const lower = ocrText.toLowerCase();
  const categories: string[] = [];

  if (/\b(glare|luminance|bright|night|nits|illumination|blinding|light|flash)\b/i.test(lower)) {
    categories.push("EXCESSIVE_LUMINANCE");
  }
  if (/\b(sightline|vision|blind spot|traffic|merge|intersection|distraction|roadway|highway|hazard)\b/i.test(lower)) {
    categories.push("TRAFFIC_SIGHTLINE_HAZARD");
  }
  if (/\b(school|playground|children|elementary|students?|kindergarten|buffer|daycare)\b/i.test(lower)) {
    categories.push("SCHOOL_BUFFER_BREACH");
  }
  if (/\b(distress|anxiety|existential|overstimulation|mental|sensory|stress)\b/i.test(lower)) {
    categories.push("UNASSISTED_EXISTENTIAL_DISTRESS");
  }
  if (/\b(density|cluster|corridor|equity|overburdened|billboard density|clutter)\b/i.test(lower) || categories.length === 0) {
    categories.push("CORRIDOR_EQUITY_DISPARITY");
  }

  return categories;
}

function resolveRes7FromRes8(h3Index?: string | null): string | null {
  if (!h3Index || typeof h3Index !== "string") return null;
  const trimmed = h3Index.trim();
  if (!trimmed || !isValidCell(trimmed) || getResolution(trimmed) !== 8) {
    return null;
  }
  try {
    return cellToParent(trimmed, 7);
  } catch {
    return null;
  }
}

async function auditAdQuestionBias(
  questionText: string,
  openaiApiKey?: string
): Promise<{ cynic_bias_score: number; feedback: string }> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.0,
          messages: [
            {
              role: "system",
              content:
                "You are an adversarial Red-Pen Cynic Referee for Project Valerie. Audit the provided question for brand targeting, emotional bias, leading premises, or non-neutral framing. Return ONLY JSON: {\"cynic_bias_score\": <number 0.0 to 1.0>, \"feedback\": \"<brief reason>\"}.",
            },
            {
              role: "user",
              content: questionText,
            },
          ],
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "{}";
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.cynic_bias_score === "number") {
          return {
            cynic_bias_score: Math.max(0.0, Math.min(1.0, parsed.cynic_bias_score)),
            feedback: parsed.feedback || "Evaluated by Cynic Referee LLM",
          };
        }
      }
    } catch {
      // Fall through to heuristic
    }
  }

  const lower = questionText.toLowerCase();
  let biasScore = 0.04;

  for (const pattern of KNOWN_BRAND_PATTERNS) {
    if (pattern.test(lower)) {
      biasScore += 0.35;
      return {
        cynic_bias_score: Math.min(1.0, biasScore),
        feedback: "Contains specific commercial brand reference",
      };
    }
  }

  for (const term of BIASED_TERMS) {
    if (lower.includes(term)) {
      biasScore += 0.30;
    }
  }

  if (!questionText.trim().endsWith("?")) biasScore += 0.15;

  return {
    cynic_bias_score: Math.min(1.0, biasScore),
    feedback: biasScore >= 0.15 ? "Detected biased framing" : "Passed neutrality audit",
  };
}

function synthesizeCivicProposition(
  _sanitizedCopy: string,
  categories: string[],
  attempt: number
): string {
  const primaryCategory = categories[0] || "CORRIDOR_EQUITY_DISPARITY";

  switch (primaryCategory) {
    case "EXCESSIVE_LUMINANCE":
      return attempt === 1
        ? "Should municipal night-sky ordinances impose dynamic nighttime nit limits and automated curfew dimming on high-intensity digital display corridors?"
        : "Should local zoning authorities restrict illuminated digital billboard output between 10 PM and 6 AM along residential-adjacent transit corridors?";

    case "TRAFFIC_SIGHTLINE_HAZARD":
      return attempt === 1
        ? "Should municipal traffic safety guidelines prohibit high-contrast dynamic digital signage within 300 feet of highway merge intersections?"
        : "Should local road commission standards require minimum sightline setback distances for dynamic advertising along high-collision roadway segments?";

    case "SCHOOL_BUFFER_BREACH":
      return attempt === 1
        ? "Should district zoning boards enforce a mandatory 1,000-foot buffer zone prohibiting commercial billboard placement around primary and secondary school perimeters?"
        : "Should municipal land-use regulations restrict commercial outdoor advertising within designated pedestrian school-walkway zones?";

    case "UNASSISTED_EXISTENTIAL_DISTRESS":
      return attempt === 1
        ? "Should public advertising standards require visual breathing corridors and cap the density of high-stimulation commercial screens in pedestrian plazas?"
        : "Should municipal aesthetic review boards limit high-frequency visual messaging displays in dense civic gathering areas?";

    case "CORRIDOR_EQUITY_DISPARITY":
    default:
      return attempt === 1
        ? "Should municipal planning commissions cap aggregate outdoor advertising square footage per resident in historically overburdened commercial corridors?"
        : "Should local zoning laws require parity in billboard density across commercial and residential neighborhood districts?";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Missing Supabase service environment variables" }, 500);
    }

    // Security: Authenticate caller token (cron secret, service_role, or verified admin user)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const cronSecretHeader = req.headers.get("x-cron-secret")?.trim() || "";
    const expectedCronSecret = Deno.env.get("CRON_SECRET")?.trim() || "";
    const isCronAuthorized = Boolean(expectedCronSecret && cronSecretHeader === expectedCronSecret);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const isServiceRole = Boolean(token && token === supabaseServiceKey);

    if (!isCronAuthorized && !isServiceRole) {
      if (!token) {
        return jsonResponse({ error: "Missing required authorization bearer token" }, 401);
      }

      const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !user) {
        return jsonResponse({ error: "Unauthorized: Invalid or expired caller token" }, 401);
      }

      // Strictly inspect app_metadata (never client-writable user_metadata)
      const role = user.app_metadata?.role;
      const isAdmin = user.app_metadata?.is_admin === true;
      if (role !== "admin" && role !== "service_role" && !isAdmin) {
        return jsonResponse(
          { error: "Forbidden: Administrative privileges required to decompose audits or publish polls" },
          403
        );
      }
    }

    let auditId: string | null = null;
    let priorAuditStatus: string | null = null;
    let ocrRawText = "";
    let flaggedCategories: string[] = [];
    let h3IndexRes8: string | null = null;
    let parcelId: string | null = null;
    let patchworkPortId: string | null = null;

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      auditId = body.audit_id || null;
      ocrRawText = body.ocr_raw_text || "";
      flaggedCategories = Array.isArray(body.flagged_categories) ? body.flagged_categories : [];
      h3IndexRes8 = body.h3_index_res8 || null;
      parcelId = body.parcel_id || null;
      patchworkPortId = body.patchwork_port_id || null;
    } else {
      const url = new URL(req.url);
      auditId = url.searchParams.get("audit_id");
    }

    // If auditId provided, fetch and validate source audit record
    if (auditId) {
      const { data: audit, error: auditErr } = await supabase
        .schema("valerie")
        .from("ad_compliance_audits")
        .select("*")
        .eq("id", auditId)
        .single();

      if (auditErr || !audit) {
        return jsonResponse({ error: `Ad audit record '${auditId}' not found` }, 404);
      }

      if (audit.status === "DISMISSED") {
        return jsonResponse({ error: `Cannot decompose a dismissed audit '${auditId}'` }, 400);
      }

      // Guard against repeated calls creating orphaned polls
      if (audit.decomposed_poll_id) {
        const { data: existingPoll } = await supabase
          .schema("valerie")
          .from("polls")
          .select("id, question_text, scope_tier, h3_res7, target_locale_code, is_active, created_at")
          .eq("id", audit.decomposed_poll_id)
          .maybeSingle();

        if (existingPoll) {
          // Recover inactive poll if prior attempt was interrupted
          if (!existingPoll.is_active) {
            await supabase
              .schema("valerie")
              .from("polls")
              .update({ is_active: true })
              .eq("id", existingPoll.id);
            existingPoll.is_active = true;
          }

          return jsonResponse({
            success: true,
            poll: existingPoll,
            message: "Audit is already linked to active decomposed poll",
            status: audit.status,
          });
        }
      }

      priorAuditStatus = audit.status;
      ocrRawText = audit.ocr_raw_text || ocrRawText;
      flaggedCategories = audit.flagged_categories?.length ? audit.flagged_categories : flaggedCategories;
      h3IndexRes8 = audit.h3_index_res8 || h3IndexRes8;
      parcelId = audit.parcel_id || parcelId;
      patchworkPortId = audit.patchwork_port_id || patchworkPortId;
    }

    if (!ocrRawText && flaggedCategories.length === 0) {
      return jsonResponse(
        { error: "Provide either audit_id or ocr_raw_text and flagged_categories" },
        400
      );
    }

    // Require valid resolution-8 H3 index before publishing any LOCAL poll (prevents global fallback leak)
    const normalizedH3Res8 = typeof h3IndexRes8 === "string" ? h3IndexRes8.trim() : "";
    const h3Res7 = resolveRes7FromRes8(normalizedH3Res8);
    if (!normalizedH3Res8 || !h3Res7) {
      return jsonResponse(
        { error: "A valid resolution-8 H3 index (h3_index_res8) is required to publish a LOCAL poll" },
        400
      );
    }

    // Infer categories from OCR copy if not explicitly provided
    if (flaggedCategories.length === 0 && ocrRawText) {
      flaggedCategories = inferCategoriesFromOcr(ocrRawText);
    }

    // Run dual-agent pipeline
    const { sanitized } = sanitizeBrandNames(ocrRawText);
    let attempts = 0;
    let chosenQuestion = "";
    let bestScore = 1.0;

    while (attempts < 3) {
      attempts++;
      const candidate = synthesizeCivicProposition(sanitized, flaggedCategories, attempts);
      const audit = await auditAdQuestionBias(candidate, openaiApiKey);

      if (audit.cynic_bias_score < bestScore) {
        bestScore = audit.cynic_bias_score;
        chosenQuestion = candidate;
      }

      if (audit.cynic_bias_score < 0.15) {
        chosenQuestion = candidate;
        bestScore = audit.cynic_bias_score;
        break;
      }
    }

    // Reject non-neutral questions (cutoff: < 0.15)
    if (bestScore >= 0.15 || !chosenQuestion) {
      return jsonResponse(
        {
          success: false,
          error: "Candidate questions failed Cynic neutrality audit (bias >= 0.15)",
          cynic_bias_score: bestScore,
          attempts,
        },
        422
      );
    }

    // Insert new active poll into valerie.polls
    const { data: newPoll, error: pollErr } = await supabase
      .schema("valerie")
      .from("polls")
      .insert({
        question_text: chosenQuestion,
        scope_tier: "LOCAL",
        h3_res7: h3Res7,
        target_locale_code: `h3:${normalizedH3Res8}`,
        is_active: true,
        material_domain: "CIVIC_INFRASTRUCTURE",
        material_consequence_score: 0.8,
        related_ecosystem_refs: {
          ad_compliance_audit_id: auditId,
          patchwork_port_id: patchworkPortId,
          parcel_id: parcelId,
          flagged_categories: flaggedCategories,
        },
      })
      .select("id, question_text, scope_tier, h3_res7, target_locale_code, is_active, created_at")
      .single();

    if (pollErr || !newPoll) {
      return jsonResponse({ error: `Failed to insert poll: ${pollErr?.message}` }, 500);
    }

    // If an audit record was targeted, atomically claim decomposed_poll_id IS NULL to prevent concurrent orphans
    if (auditId) {
      const { data: claimedAudit, error: claimErr } = await supabase
        .schema("valerie")
        .from("ad_compliance_audits")
        .update({
          decomposed_poll_id: newPoll.id,
          status: "DELIBERATING",
          updated_at: new Date().toISOString(),
        })
        .eq("id", auditId)
        .is("decomposed_poll_id", null)
        .neq("status", "DISMISSED")
        .select("id, decomposed_poll_id, status")
        .maybeSingle();

      if (claimErr) {
        await supabase.schema("valerie").from("polls").delete().eq("id", newPoll.id);
        return jsonResponse(
          { error: `Failed to link decomposed poll to audit record: ${claimErr.message}` },
          500
        );
      }

      if (!claimedAudit) {
        // Another concurrent request already claimed this audit (or it was dismissed); discard unlinked poll
        await supabase.schema("valerie").from("polls").delete().eq("id", newPoll.id);

        const { data: latestAudit } = await supabase
          .schema("valerie")
          .from("ad_compliance_audits")
          .select("status, decomposed_poll_id")
          .eq("id", auditId)
          .maybeSingle();

        if (latestAudit?.status === "DISMISSED") {
          return jsonResponse({ error: `Cannot decompose a dismissed audit '${auditId}'` }, 400);
        }

        if (latestAudit?.decomposed_poll_id) {
          const { data: existingPoll } = await supabase
            .schema("valerie")
            .from("polls")
            .select("id, question_text, scope_tier, h3_res7, target_locale_code, is_active, created_at")
            .eq("id", latestAudit.decomposed_poll_id)
            .maybeSingle();

          if (existingPoll) {
            // Recover inactive poll if prior attempt was interrupted
            if (!existingPoll.is_active) {
              await supabase
                .schema("valerie")
                .from("polls")
                .update({ is_active: true })
                .eq("id", existingPoll.id);
              existingPoll.is_active = true;
            }

            return jsonResponse({
              success: true,
              poll: existingPoll,
              message: "Audit is already linked to active decomposed poll",
              status: latestAudit.status,
            });
          }
        }

        return jsonResponse(
          { error: `Audit '${auditId}' could not be claimed concurrently` },
          409
        );
      }
    }

    return jsonResponse({
      success: true,
      poll: newPoll,
      cynic_bias_score: bestScore,
      attempts,
      status: "DELIBERATING",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
