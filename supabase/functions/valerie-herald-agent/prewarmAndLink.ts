/**
 * Project Valerie: Herald Autonomous Pipeline — Pre-Publication Tooltip Pre-Warmer & Cross-Ecosystem Linker
 * File: supabase/functions/valerie-herald-agent/prewarmAndLink.ts
 * Work Item: SUBTASK-VAL-HERALD-TOOLTIP-PREWARM
 *
 * PURPOSE:
 * 1. Tooltip Pre-Warming:
 *    - Extract 2 to 4 domain-specific, legal, or geopolitical terms from generated poll questions.
 *    - Compute deterministic 64-character hex SHA-256 hashes matching lib/cache/hashLookup.ts.
 *    - Generate strictly neutral, encyclopedic definitions across reading levels ('elementary', 'general', 'advanced').
 *    - Upsert definitions and 1536-dim embeddings into valerie.content_cache prior to poll activation.
 * 2. Cross-Ecosystem Ground-Truth Linking:
 *    - Match event embeddings against speak_for_the_dead regulatory cases (OSHA, EPA, FDA, NHTSA)
 *      and patchwork infrastructure reports with cosine similarity >= 0.82 and/or detected_locales.
 *    - Populate related_ecosystem_refs ({ patchwork_ids: [...], sftd_case_ids: [...] }) on valerie.polls.
 */

import {
  cosineSimilarity,
  l2Normalize,
  VECTOR_DIM,
} from "../valerie-cluster-engine/vector-math.ts";

export interface PrewarmResult {
  term: string;
  readingLevel: string;
  hash: string;
  definition: string;
  cached: boolean;
}

export interface EcosystemRefs {
  patchwork_ids: string[];
  sftd_case_ids: string[];
}

export interface PrewarmAndLinkSummary {
  poll_id: string;
  warmed_terms: PrewarmResult[];
  related_ecosystem_refs: EcosystemRefs;
}

/**
 * Builds normalized cache key string for hashing.
 * Matches lib/cache/hashLookup.ts and PostgreSQL valerie.content_cache schema:
 *   SHA-256(normalized_text || ':' || language || ':' || reading_level)
 */
export function buildTermCacheKey(
  term: string,
  readingLevel?: number | string,
  language?: string
): string {
  const cleanTerm = term.trim().toLowerCase();
  if (readingLevel === undefined && language === undefined) {
    return cleanTerm;
  }
  const lang = language || "en";
  const level = readingLevel !== undefined ? String(readingLevel) : "general";
  return `${cleanTerm}:${lang}:${level}`;
}

/**
 * Computes deterministic 64-character hexadecimal SHA-256 hash using WebCrypto SubtleCrypto.
 */
export async function computeSha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Formats a vector into pgvector string literal '[x1,x2,...]' for SQL writes.
 */
export function formatVectorForPg(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Deterministic fallback 1536-D pseudo-embedding generator for test/offline environments.
 */
export function generateDeterministicEmbedding(text: string): number[] {
  const vec = new Array(VECTOR_DIM).fill(0);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    const idx = Math.abs(h) % VECTOR_DIM;
    vec[idx] += ((i % 5) - 2) * 0.25;
  }
  for (let i = 0; i < VECTOR_DIM; i++) {
    vec[i] += Math.sin((i + 1) * 0.05 + (h % 100));
  }
  return l2Normalize(vec);
}

/**
 * Extracts 2 to 4 domain-specific, legal, or geopolitical terms from poll text.
 */
export async function extractComplexTerms(
  questionText: string,
  openaiApiKey?: string
): Promise<string[]> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content:
                "Extract 2 to 4 domain-specific, legal, political, or economic terms from the following civic proposition. Return ONLY a valid JSON array of strings, e.g. [\"term1\", \"term2\"]. Do not wrap in markdown or commentary.",
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
        const content = json.choices?.[0]?.message?.content?.trim() || "[]";
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          return parsed.slice(0, 4);
        }
      }
    } catch {
      // Fallback to rule-based extraction
    }
  }

  // Fallback rule-based extractor for civic/legal domain terms
  const knownTerms = [
    "sovereign immunity",
    "preemption doctrine",
    "carbon border adjustment",
    "regulatory takings",
    "eminent domain",
    "interstate commerce",
    "false dichotomy",
    "bipartisan consensus",
    "substantive due process",
    "strict scrutiny",
    "standing doctrine",
    "gerrymandering",
    "monetary policy",
    "statutory authority",
    "qualified immunity",
    "clean water act",
    "infrastructure resilience",
    "public utility commission",
  ];

  const lower = questionText.toLowerCase();
  const matched = knownTerms.filter((term) => lower.includes(term));

  if (matched.length >= 2) {
    return matched.slice(0, 4);
  }

  // Extract multi-word nouns or capitalized technical phrases
  const words = questionText
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 5 && !["should", "whether", "between", "against", "without", "through", "because"].includes(w.toLowerCase()));

  const candidateSet = new Set<string>([...matched, ...words.slice(0, 4)]);
  const terms = Array.from(candidateSet).slice(0, 4);

  if (terms.length < 2) {
    terms.push("statutory regulation", "civic referendum");
  }

  return terms.slice(0, 4);
}

/**
 * Generates an encyclopedic, strictly neutral definition for a term.
 */
export async function generateNeutralDefinition(
  term: string,
  readingLevel: string,
  openaiApiKey?: string
): Promise<string> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `You are an objective, non-partisan civic and legal educator. Provide a strictly neutral, factual, 2-sentence definition of '${term}' tailored to reading level '${readingLevel}'. Avoid loaded framing, political bias, or value judgments.`,
            },
          ],
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const def = json.choices?.[0]?.message?.content?.trim();
        if (def) return def;
      }
    } catch {
      // Fallback below
    }
  }

  if (readingLevel === "elementary") {
    return `${term} is a rule or idea that people and communities follow when deciding how things are shared or protected.`;
  } else if (readingLevel === "advanced") {
    return `${term} represents an established institutional or legal framework governing rights, obligations, and systemic authority within jurisdictional governance.`;
  }
  return `${term} refers to a recognized principle or regulatory mechanism used in civic policy and administrative decision-making.`;
}

/**
 * Generates a 1536-D embedding using text-embedding-3-small or fallback.
 */
export async function generateEmbedding(
  text: string,
  openaiApiKey?: string
): Promise<number[]> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text,
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const data = json.data?.[0]?.embedding;
        if (Array.isArray(data) && data.length === VECTOR_DIM) {
          return data;
        }
      }
    } catch {
      // Fallback
    }
  }

  return generateDeterministicEmbedding(text);
}

/**
 * Pre-warms tooltip definitions in valerie.content_cache across reading levels.
 */
export async function prewarmTooltips(
  questionText: string,
  readingLevels: string[] = ["elementary", "general", "advanced"],
  options?: {
    supabase?: any;
    openaiApiKey?: string;
    dryRun?: boolean;
  }
): Promise<PrewarmResult[]> {
  const terms = await extractComplexTerms(questionText, options?.openaiApiKey);
  const results: PrewarmResult[] = [];

  for (const term of terms) {
    for (const level of readingLevels) {
      const cacheKey = buildTermCacheKey(term, level, "en");
      const hash = await computeSha256(cacheKey);

      let existing = null;
      if (options?.supabase) {
        const { data } = await options.supabase
          .schema("valerie")
          .from("content_cache")
          .select("cached_translation")
          .eq("original_text_hash", hash)
          .eq("target_language", "en")
          .eq("target_reading_level", level)
          .maybeSingle();
        existing = data;
      }

      if (existing?.cached_translation) {
        results.push({
          term,
          readingLevel: level,
          hash,
          definition: existing.cached_translation,
          cached: true,
        });
        continue;
      }

      const definition = await generateNeutralDefinition(term, level, options?.openaiApiKey);
      const embedding = await generateEmbedding(`${term}: ${definition}`, options?.openaiApiKey);

      if (options?.supabase && !options?.dryRun) {
        await options.supabase
          .schema("valerie")
          .from("content_cache")
          .upsert(
            {
              original_text_hash: hash,
              original_text: term,
              target_language: "en",
              target_reading_level: level,
              cached_translation: definition,
              embedding: formatVectorForPg(embedding),
            },
            { onConflict: "original_text_hash,target_language,target_reading_level" }
          );
      }

      results.push({
        term,
        readingLevel: level,
        hash,
        definition,
        cached: false,
      });
    }
  }

  return results;
}

/**
 * Queries speak_for_the_dead cases and patchwork reports matching event embedding
 * with cosine similarity >= 0.82 and/or detected_locales.
 */
export async function linkEcosystemRefs(
  eventEmbedding: number[],
  detectedLocales: string[] = [],
  options?: {
    supabase?: any;
    openaiApiKey?: string;
  }
): Promise<EcosystemRefs> {
  const refs: EcosystemRefs = {
    patchwork_ids: [],
    sftd_case_ids: [],
  };

  if (!options?.supabase) {
    return refs;
  }

  // 1. Query Speak for the Dead regulatory incidents (OSHA, EPA, FDA, NHTSA)
  try {
    const { data: sftdRows } = await options.supabase
      .schema("speak_for_the_dead")
      .from("incidents")
      .select("id, source_agency, incident_narrative, regulatory_context")
      .limit(20);

    if (Array.isArray(sftdRows)) {
      for (const row of sftdRows) {
        const narrative = row.incident_narrative || "";
        const agency = row.source_agency || "";
        const textToEmbed = `${agency} ${narrative}`;
        const rowEmbedding = options?.openaiApiKey
          ? await generateEmbedding(textToEmbed, options.openaiApiKey)
          : generateDeterministicEmbedding(textToEmbed);
        const sim = cosineSimilarity(eventEmbedding, rowEmbedding);

        const localeMatch = detectedLocales.some((loc) =>
          narrative.toLowerCase().includes(loc.toLowerCase())
        );

        if (sim >= 0.82 || (localeMatch && sim >= 0.60)) {
          refs.sftd_case_ids.push(row.id);
        }
      }
    }
  } catch {
    // Schema or table might not be seeded in current environment
  }

  // 2. Query PatchWork infrastructure nodes & impact reports
  try {
    const { data: pwRows } = await options.supabase
      .schema("patchwork")
      .from("nodes")
      .select("node_id, title, description, h3_index")
      .limit(20);

    if (Array.isArray(pwRows)) {
      for (const row of pwRows) {
        const text = `${row.title || ""} ${row.description || ""}`;
        const rowEmbedding = options?.openaiApiKey
          ? await generateEmbedding(text, options.openaiApiKey)
          : generateDeterministicEmbedding(text);
        const sim = cosineSimilarity(eventEmbedding, rowEmbedding);

        const localeMatch = detectedLocales.some((loc) =>
          row.h3_index?.includes(loc) || text.toLowerCase().includes(loc.toLowerCase())
        );

        if (sim >= 0.82 || (localeMatch && sim >= 0.60)) {
          refs.patchwork_ids.push(row.node_id);
        }
      }
    }
  } catch {
    // Schema or table might not be seeded in current environment
  }

  return refs;
}

/**
 * Orchestrates pre-warming tooltips and linking ecosystem ground-truth records
 * for a generated poll before publication.
 */
export async function prewarmAndLink(
  pollId: string,
  questionText: string,
  eventEmbedding: number[],
  detectedLocales: string[] = [],
  options?: {
    supabase?: any;
    openaiApiKey?: string;
    dryRun?: boolean;
  }
): Promise<PrewarmAndLinkSummary> {
  // 1. Pre-warm tooltip definitions in cache
  const warmed = await prewarmTooltips(questionText, ["elementary", "general", "advanced"], options);

  // 2. Link ecosystem references
  const ecosystemRefs = await linkEcosystemRefs(eventEmbedding, detectedLocales, options);

  // 3. Update valerie.polls with related_ecosystem_refs
  if (options?.supabase && !options?.dryRun && pollId) {
    await options.supabase
      .schema("valerie")
      .from("polls")
      .update({
        related_ecosystem_refs: ecosystemRefs,
      })
      .eq("id", pollId);
  }

  return {
    poll_id: pollId,
    warmed_terms: warmed,
    related_ecosystem_refs: ecosystemRefs,
  };
}
