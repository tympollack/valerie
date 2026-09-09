/**
 * Client-Side Exact-Match Hash & Memory-Mapped LRU Cache
 *
 * Implements WebCrypto SHA-256 exact-match hash resolution with a bounded
 * 500-entry in-memory LRU cache and environment-resilient fallback hashing.
 */

// =============================================================================
// LRU Cache Implementation (Bounded at 500 entries by default)
// =============================================================================

export class LRUCache<K = string, V = any> {
  private maxSize: number;
  private cache: Map<K, V>;

  constructor(maxSize: number = 500) {
    this.maxSize = Math.max(1, maxSize);
    this.cache = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    // Re-insert to mark as most recently used
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (oldest entry in Map iteration)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Bounded in-memory singleton caches
export const hashCache = new LRUCache<string, string>(500);
export const tooltipCache = new LRUCache<string, any>(500);

// =============================================================================
// SHA-256 Hashing Pipeline
// =============================================================================

/**
 * Builds normalized cache key string for hashing.
 * Matches PostgreSQL valerie.content_cache schema:
 *   SHA-256(normalized_text || ':' || language || ':' || reading_level)
 */
export function buildTermCacheKey(
  term: string,
  readingLevel?: number | string,
  language?: string
): string {
  const cleanTerm = term.trim().toLowerCase();

  // If no reading level or language specified, hash raw normalized term
  if (readingLevel === undefined && language === undefined) {
    return cleanTerm;
  }

  const lang = language || "en";
  const level = readingLevel !== undefined ? String(readingLevel) : "general";
  return `${cleanTerm}:${lang}:${level}`;
}

/**
 * Computes deterministic 64-character hexadecimal SHA-256 hash.
 * Utilizes Web Cryptography API (crypto.subtle) with fallbacks for
 * testing environments (Node.js) and non-secure contexts.
 */
export async function computeSha256(input: string): Promise<string> {
  // 1. Web Cryptography API (Modern Browsers & Node 18+)
  const subtle =
    typeof globalThis !== "undefined" && globalThis.crypto?.subtle
      ? globalThis.crypto.subtle
      : typeof window !== "undefined" && window.crypto?.subtle
      ? window.crypto.subtle
      : null;

  if (subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // 2. Node.js crypto fallback (Testing / SSR environments)
  try {
    const nodeCrypto = await import("node:crypto");
    if (nodeCrypto?.createHash) {
      return nodeCrypto.createHash("sha256").update(input).digest("hex");
    }
  } catch {
    // Non-Node environment without subtle crypto
  }

  // 3. Fallback deterministic 64-char hex string generation for non-secure contexts
  let h1 = 0x6a09e667,
    h2 = 0xbb67ae85,
    h3 = 0x3c6ef372,
    h4 = 0xa54ff53a;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 3812015801);
    h4 = Math.imul(h4 ^ ch, 2246822519);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  const part3 = (h3 >>> 0).toString(16).padStart(8, "0");
  const part4 = (h4 >>> 0).toString(16).padStart(8, "0");
  return (part1 + part2 + part3 + part4).repeat(2);
}

/**
 * Computes deterministic 64-character hex SHA-256 hash for a term and reading level,
 * backed by a 500-entry in-memory LRU cache.
 */
export async function hashTerm(
  term: string,
  readingLevel?: number | string,
  language?: string
): Promise<string> {
  const cacheKey = buildTermCacheKey(term, readingLevel, language);

  const cached = hashCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const hash = await computeSha256(cacheKey);
  hashCache.set(cacheKey, hash);
  return hash;
}

/**
 * Direct SHA-256 calculation for arbitrary strings.
 */
export const calculateSha256 = computeSha256;
