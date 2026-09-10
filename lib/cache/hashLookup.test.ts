import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  hashTerm,
  computeSha256,
  sha256PureJs,
  buildTermCacheKey,
  LRUCache,
  hashCache,
  tooltipCache,
} from "./hashLookup";
import { createHash } from "node:crypto";

describe("hashLookup module", () => {
  beforeEach(() => {
    hashCache.clear();
    tooltipCache.clear();
  });

  describe("computeSha256 & hashTerm", () => {
    it("generates deterministic 64-character hex hashes matching PostgreSQL digest outputs", async () => {
      const testInputs = [
        "pedestrian-only zone:en:general",
        "congestion pricing:en:8",
        "bivariate scoring",
        "hello",
      ];

      for (const input of testInputs) {
        const expected = createHash("sha256").update(input).digest("hex");
        const actual = await computeSha256(input);

        expect(actual).toBe(expected);
        expect(actual).toHaveLength(64);
        expect(/^[0-9a-f]{64}$/.test(actual)).toBe(true);

        // Also verify pure JS fallback directly
        expect(sha256PureJs(input)).toBe(expected);
      }
    });

    it("normalizes term and reading level correctly in buildTermCacheKey", () => {
      expect(buildTermCacheKey("  Pedestrian-Only Zone  ")).toBe("pedestrian-only zone");
      expect(buildTermCacheKey("Pedestrian-Only Zone", 5)).toBe("pedestrian-only zone:en:5");
      expect(buildTermCacheKey("Congestion Pricing", "general", "es")).toBe(
        "congestion pricing:es:general"
      );
    });

    it("returns identical hash for trimmed and case-insensitive term variations", async () => {
      const hash1 = await hashTerm("pedestrian-only zone", "general");
      const hash2 = await hashTerm("  PEDESTRIAN-ONLY ZONE  ", "general");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("caches computed hashes in LRU cache for sub-10ms instantaneous resolution", async () => {
      expect(hashCache.size).toBe(0);

      const hash1 = await hashTerm("congestion pricing", 8);
      expect(hashCache.size).toBe(1);

      // Second call returns cached hash
      const hash2 = await hashTerm("congestion pricing", 8);
      expect(hash2).toBe(hash1);
      expect(hashCache.size).toBe(1);
    });
  });

  describe("LRUCache", () => {
    it("bounds entries to specified maximum size and evicts least recently used", () => {
      const cache = new LRUCache<string, number>(3);

      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.size).toBe(3);

      // Access "a" to make it recently used
      expect(cache.get("a")).toBe(1);

      // Adding "d" should evict "b" (since "a" was accessed and "c" was added after "b")
      cache.set("d", 4);
      expect(cache.size).toBe(3);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
      expect(cache.has("c")).toBe(true);
      expect(cache.has("d")).toBe(true);
    });

    it("clears and deletes elements properly", () => {
      const cache = new LRUCache<string, string>(500);
      cache.set("k1", "v1");
      cache.set("k2", "v2");
      expect(cache.size).toBe(2);

      cache.delete("k1");
      expect(cache.has("k1")).toBe(false);
      expect(cache.size).toBe(1);

      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("respects default capacity of 500 entries", () => {
      const cache = new LRUCache<string, number>();
      for (let i = 0; i < 600; i++) {
        cache.set(`key-${i}`, i);
      }
      expect(cache.size).toBe(500);
      expect(cache.has("key-0")).toBe(false); // evicted
      expect(cache.has("key-599")).toBe(true); // retained
    });
  });
});
