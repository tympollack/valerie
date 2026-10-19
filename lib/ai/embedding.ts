/**
 * Project Valerie: 1536-Dimensional Semantic Vector & Embedding Utilities
 * File: lib/ai/embedding.ts
 *
 * Provides OpenAI text-embedding-3-small vector generation with deterministic
 * hyperspherical fallback for tests, offline development, and unit synthesis.
 */

export const VECTOR_DIM = 1536;

/**
 * Normalizes vector to unit length (L2 norm = 1.0).
 */
export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Deterministic fallback 1536-D pseudo-embedding generator for test/offline environments.
 * Uses 32-bit FNV-1a hashing and harmonic sinusoids to create stable, repeatable embeddings.
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
 * Formats a numeric array into PostgreSQL vector format: "[0.1,0.2,...]"
 */
export function formatVectorForPg(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Parses vector from array, string, or returns null.
 */
export function parseVectorSafely(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    return raw.every((n) => typeof n === "number") ? raw : null;
  }
  if (typeof raw === "string") {
    try {
      const trimmed = raw.trim();
      const cleaned = trimmed.startsWith("[") && trimmed.endsWith("]")
        ? trimmed
        : `[${trimmed}]`;
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length === VECTOR_DIM) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Generates a 1536-D embedding using text-embedding-3-small or fallback.
 */
export async function generateEmbedding(
  text: string,
  openaiApiKey?: string
): Promise<number[]> {
  const key = openaiApiKey || process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
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
      // Fallback on network or API failure
    }
  }

  return generateDeterministicEmbedding(text);
}
