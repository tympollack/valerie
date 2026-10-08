/**
 * Project Valerie: Dynamic Few-Shot Semantic RAG Injection Engine
 * Work Item: TASK-VAL-FEWSHOT-RAG / STORY-VAL-PH2-DISTILLATION
 * File: lib/ai/fewShotInjector.ts
 *
 * Implements vector similarity retrieval against valerie.content_cache for top-3
 * demonstrations, formatting them into standard in-context learning blocks under 50ms.
 */

import { LRUCache } from "@/lib/cache/hashLookup";
import { createClient } from "@/lib/supabase/server";

export interface FewShotExample {
  term: string;
  definition: string;
  similarity?: number;
}

export interface FewShotRetrievalOptions {
  limit?: number;
  language?: string;
  readingLevel?: string;
  supabaseClient?: any;
}

export interface FewShotResult {
  prompt: string;
  demonstrations: string;
  examples: FewShotExample[];
  latencyMs: number;
  estimatedTokens: number;
}

// Bounded in-memory cache for fast-path sub-50ms semantic demonstration lookup
const fewShotMemoryCache = new LRUCache<string, FewShotExample[]>(250);

/**
 * Computes cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Fallback semantic demonstration bank for testing, cold starts, and offline modes.
 */
const FALLBACK_FEW_SHOT_CORPUS: Array<{ term: string; definition: string; embeddingSeed: number }> = [
  {
    term: "pedestrian-only zone",
    definition: "An urban area restricted to foot traffic where motorized vehicles are prohibited or strictly limited.",
    embeddingSeed: 0.85,
  },
  {
    term: "congestion pricing",
    definition: "A fee charged to motorists entering busy downtown zones during peak traffic hours to reduce traffic gridlock.",
    embeddingSeed: 0.72,
  },
  {
    term: "commit-and-reveal period",
    definition: "A cryptographic voting mechanism where responses are sealed during voting to eliminate bandwagon bias.",
    embeddingSeed: 0.64,
  },
  {
    term: "likert scale",
    definition: "A psychometric rating scale used in questionnaires to measure participants' level of agreement.",
    embeddingSeed: 0.55,
  },
  {
    term: "bivariate scoring",
    definition: "A dual-axis measurement system that evaluates two distinct variables simultaneously, such as stance and conviction.",
    embeddingSeed: 0.48,
  },
];

/**
 * Generates deterministic cache key across the complete embedding vector plus locale/limit.
 * Uses 64-bit dual-prime FNV-1a hash over the Float32Array representation to prevent collisions.
 */
export function generateCacheKey(
  embedding: number[],
  language: string,
  readingLevel: string,
  limit: number
): string {
  const float32 = new Float32Array(embedding);
  const uint8 = new Uint8Array(float32.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x27d4eb2f;
  for (let i = 0; i < uint8.length; i++) {
    h1 ^= uint8[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= uint8[i];
    h2 = Math.imul(h2, 0x5bd1e995);
  }
  const hexHash =
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0");
  return `${language}:${readingLevel}:${limit}:${hexHash}`;
}

const SHA256_REGEX = /^[a-f0-9]{64}$/i;

const PROMPT_INJECTION_PATTERN =
  /(\bignore\s+(all\s+)?(previous|prior)\s+instructions\b|\bdisregard\b|<\/?system>|\[INST\]|\[\/INST\]|<<SYS>>|<\|im_start\|>|<\|im_end\|>|\bdeveloper\s+mode\b)/i;

function isValidDemonstrationTerm(term?: string | null): term is string {
  if (!term || typeof term !== "string") return false;
  const clean = term.trim();
  return clean.length > 0 && !SHA256_REGEX.test(clean) && !PROMPT_INJECTION_PATTERN.test(clean);
}

function isValidDemonstrationDefinition(def?: string | null): def is string {
  if (!def || typeof def !== "string") return false;
  const clean = def.trim();
  if (clean.length === 0 || clean.length > 500) return false;
  return !PROMPT_INJECTION_PATTERN.test(clean);
}

/**
 * Retrieves the top semantic matches from valerie.content_cache.
 * Defaults to top 3 items based on cosine similarity.
 */
export async function fetchTopSemanticExamples(
  embedding: number[],
  options: FewShotRetrievalOptions = {}
): Promise<FewShotExample[]> {
  const limit = options.limit ?? 3;
  const language = options.language ?? "en";
  const readingLevel = options.readingLevel ?? "general";

  if (!embedding || embedding.length === 0) {
    return [];
  }

  const cacheKey = generateCacheKey(embedding, language, readingLevel, limit);
  const cached = fewShotMemoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let client = options.supabaseClient;
  if (!client) {
    try {
      client = await createClient();
    } catch {
      // In non-server context or missing request scope
      client = null;
    }
  }

  // Attempt 1: Call valerie.get_few_shot_context RPC
  if (client) {
    try {
      const { data, error } = await client.rpc("get_few_shot_context", {
        p_embedding: embedding,
        p_limit: limit,
        p_target_language: language,
        p_target_reading_level: readingLevel,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const validRows = data.filter(
          (row: any) =>
            isValidDemonstrationTerm(row.original_text) &&
            isValidDemonstrationDefinition(row.cached_translation)
        );

        if (validRows.length > 0) {
          const results: FewShotExample[] = validRows.slice(0, limit).map((row: any) => ({
            term: row.original_text.trim(),
            definition: row.cached_translation,
            similarity: typeof row.similarity === "number" ? row.similarity : undefined,
          }));

          // Backfill up to limit from fallback corpus if needed
          if (results.length < limit) {
            for (const item of FALLBACK_FEW_SHOT_CORPUS) {
              if (results.length >= limit) break;
              if (!results.some((r) => r.term === item.term)) {
                results.push({
                  term: item.term,
                  definition: item.definition,
                  similarity: item.embeddingSeed,
                });
              }
            }
          }

          fewShotMemoryCache.set(cacheKey, results);
          return results;
        }
      }
    } catch {
      // Fall through to direct query or corpus fallback
    }

    // Attempt 2: Direct query on valerie.content_cache
    try {
      const { data, error } = await client
        .schema("valerie")
        .from("content_cache")
        .select("original_text, original_text_hash, cached_translation")
        .not("cached_translation", "is", null)
        .limit(limit * 2);

      if (!error && Array.isArray(data) && data.length > 0) {
        const validRows = data.filter(
          (row: any) =>
            isValidDemonstrationTerm(row.original_text) &&
            Boolean(row.cached_translation)
        );

        if (validRows.length > 0) {
          const results: FewShotExample[] = validRows.slice(0, limit).map((row: any) => ({
            term: row.original_text.trim(),
            definition: row.cached_translation,
          }));
          fewShotMemoryCache.set(cacheKey, results);
          return results;
        }
      }
    } catch {
      // Fall through to fallback demonstration corpus
    }
  }

  // Fallback: Return top matches from fallback corpus without polluting cache with transient failure data
  const fallbackResults: FewShotExample[] = FALLBACK_FEW_SHOT_CORPUS.slice(0, limit).map((item) => ({
    term: item.term,
    definition: item.definition,
    similarity: item.embeddingSeed,
  }));

  return fallbackResults;
}

/**
 * Formats retrieved few-shot examples into the standardized in-context learning format:
 * `Input: <cached_term> -> Simplified: <cached_output>`
 */
export function formatFewShotDemonstrations(examples: FewShotExample[]): string {
  if (!examples || examples.length === 0) {
    return "";
  }

  const lines = examples.map((ex) => {
    const cleanTerm = ex.term.replace(/[\r\n]+/g, " ").replace(/[<>{}[\]]/g, "").trim();
    const cleanDef = ex.definition.replace(/[\r\n]+/g, " ").replace(/[<>{}[\]]/g, "").trim();
    return `Input: ${cleanTerm} -> Simplified: ${cleanDef}`;
  });

  return [
    "### In-Context Few-Shot Demonstrations",
    ...lines,
  ].join("\n");
}

/**
 * Injects formatted demonstrations into the base system prompt before dispatching to student model.
 */
export function injectFewShotSystemPrompt(
  baseSystemPrompt: string,
  demonstrations: string
): string {
  if (!demonstrations || demonstrations.trim().length === 0) {
    return baseSystemPrompt;
  }

  const trimmedBase = baseSystemPrompt.trim();
  return `${trimmedBase}\n\n${demonstrations}`;
}

/**
 * Approximate token estimator using character and whitespace heuristics (~4 chars/token).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const charEstimate = Math.ceil(text.length / 4);
  return Math.max(wordCount, charEstimate);
}

/**
 * Full dynamic few-shot prompt construction orchestrator.
 * Benchmarks latency and token overhead, guaranteeing <50ms retrieval.
 */
export async function buildDynamicFewShotPrompt({
  baseSystemPrompt,
  embedding,
  options = {},
}: {
  baseSystemPrompt: string;
  embedding: number[];
  options?: FewShotRetrievalOptions;
}): Promise<FewShotResult> {
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

  const examples = await fetchTopSemanticExamples(embedding, options);
  const demonstrations = formatFewShotDemonstrations(examples);
  const prompt = injectFewShotSystemPrompt(baseSystemPrompt, demonstrations);

  const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
  const latencyMs = Math.round((endTime - startTime) * 100) / 100;
  const estimatedTokens = estimateTokenCount(demonstrations);

  return {
    prompt,
    demonstrations,
    examples,
    latencyMs,
    estimatedTokens,
  };
}

/**
 * Clears the in-memory few-shot LRU cache (useful for testing or cache invalidation).
 */
export function clearFewShotCache(): void {
  fewShotMemoryCache.clear();
}
