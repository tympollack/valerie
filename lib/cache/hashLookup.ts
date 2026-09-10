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

  // 3. Fallback standards-compliant pure-JS SHA-256 for non-secure browser contexts
  return sha256PureJs(input);
}

function rightRotate(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

/**
 * Standards-compliant SHA-256 algorithm in pure TypeScript/JavaScript.
 * Guarantees identical 64-character hex digests matching PostgreSQL digest outputs
 * even when running in non-secure HTTP browser contexts without WebCrypto SubtleCrypto.
 */
export function sha256PureJs(ascii: string): string {
  let i: number, j: number;
  let result = "";
  const words: number[] = [];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // UTF-8 encoding
  const utf8 = unescape(encodeURIComponent(ascii));
  for (i = 0; i < utf8.length; i++) {
    words[i >> 2] |= (utf8.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }
  const byteLength = utf8.length;
  words[byteLength >> 2] |= 0x80 << (24 - (byteLength % 4) * 8);
  words[(((byteLength + 8) >> 6) + 1) * 16 - 1] = byteLength * 8;

  for (i = 0; i < words.length; i += 16) {
    const w: number[] = [];
    for (j = 0; j < 16; j++) w[j] = words[i + j] | 0;
    for (j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  for (i = 0; i < 8; i++) {
    result += (hash[i] >>> 0).toString(16).padStart(8, "0");
  }
  return result;
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
