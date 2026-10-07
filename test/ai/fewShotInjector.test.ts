import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cosineSimilarity,
  fetchTopSemanticExamples,
  formatFewShotDemonstrations,
  injectFewShotSystemPrompt,
  estimateTokenCount,
  buildDynamicFewShotPrompt,
  clearFewShotCache,
  type FewShotExample,
} from "@/lib/ai/fewShotInjector";

describe("Dynamic Few-Shot Semantic RAG Injection Engine (TASK-VAL-FEWSHOT-RAG)", () => {
  beforeEach(() => {
    clearFewShotCache();
  });

  describe("Vector Cosine Similarity Math", () => {
    it("computes 1.0 for identical vectors", () => {
      const vec = [0.2, 0.5, 0.8, 0.1];
      const similarity = cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it("computes 0.0 for orthogonal vectors", () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      const similarity = cosineSimilarity(vecA, vecB);
      expect(similarity).toBeCloseTo(0.0, 5);
    });

    it("handles zero vectors gracefully without NaN", () => {
      const vecA = [0, 0, 0];
      const vecB = [1, 2, 3];
      expect(cosineSimilarity(vecA, vecB)).toBe(0);
    });
  });

  describe("Top-3 Semantic Retrieval & RPC Contract", () => {
    it("retrieves exactly 3 semantic demonstrations via Supabase get_few_shot_context RPC", async () => {
      const mockRpcData = [
        {
          id: "1",
          original_text: "pedestrian-only zone",
          cached_translation: "An area restricted to foot traffic to improve safety and air quality.",
          similarity: 0.945,
        },
        {
          id: "2",
          original_text: "congestion pricing",
          cached_translation: "A peak-hour fee charged to vehicles to reduce downtown gridlock.",
          similarity: 0.892,
        },
        {
          id: "3",
          original_text: "commit-and-reveal",
          cached_translation: "A two-phase cryptographic voting protocol to eliminate herd bias.",
          similarity: 0.831,
        },
      ];

      const mockClient = {
        rpc: vi.fn().mockResolvedValue({
          data: mockRpcData,
          error: null,
        }),
      };

      const dummyEmbedding = Array.from({ length: 1536 }, () => 0.02);
      const examples = await fetchTopSemanticExamples(dummyEmbedding, {
        supabaseClient: mockClient,
        limit: 3,
        language: "en",
        readingLevel: "general",
      });

      expect(mockClient.rpc).toHaveBeenCalledWith("get_few_shot_context", {
        p_embedding: dummyEmbedding,
        p_limit: 3,
        p_target_language: "en",
        p_target_reading_level: "general",
      });

      expect(examples).toHaveLength(3);
      expect(examples[0].term).toBe("pedestrian-only zone");
      expect(examples[1].term).toBe("congestion pricing");
      expect(examples[2].term).toBe("commit-and-reveal");
    });

    it("falls back to semantic demonstration corpus when Supabase is unreachable", async () => {
      const mockClient = {
        rpc: vi.fn().mockRejectedValue(new Error("Database offline")),
        schema: vi.fn().mockImplementation(() => ({
          from: () => ({
            select: () => ({
              not: () => ({
                limit: vi.fn().mockRejectedValue(new Error("Network timeout")),
              }),
            }),
          }),
        })),
      };

      const dummyEmbedding = Array.from({ length: 1536 }, () => 0.01);
      const examples = await fetchTopSemanticExamples(dummyEmbedding, {
        supabaseClient: mockClient,
        limit: 3,
      });

      expect(examples).toHaveLength(3);
      expect(examples[0].definition).toBeDefined();
      expect(examples[1].definition).toBeDefined();
      expect(examples[2].definition).toBeDefined();
    });
  });

  describe("In-Context Demonstration Formatting", () => {
    it("formats retrieved matches strictly as 'Input: <term> -> Simplified: <definition>'", () => {
      const sampleExamples: FewShotExample[] = [
        {
          term: "likert scale",
          definition: "A symmetric scale used in surveys to measure level of agreement.",
        },
        {
          term: "bivariate scoring",
          definition: "A system evaluating both stance and conviction simultaneously.",
        },
        {
          term: "carbon offset",
          definition: "A reduction in emissions made to compensate for emissions elsewhere.",
        },
      ];

      const formatted = formatFewShotDemonstrations(sampleExamples);

      expect(formatted).toContain("### In-Context Few-Shot Demonstrations");
      expect(formatted).toContain("Input: likert scale -> Simplified: A symmetric scale used in surveys to measure level of agreement.");
      expect(formatted).toContain("Input: bivariate scoring -> Simplified: A system evaluating both stance and conviction simultaneously.");
      expect(formatted).toContain("Input: carbon offset -> Simplified: A reduction in emissions made to compensate for emissions elsewhere.");

      const lines = formatted.split("\n").filter((l) => l.startsWith("Input:"));
      expect(lines).toHaveLength(3);
    });

    it("returns empty string if no examples are provided", () => {
      expect(formatFewShotDemonstrations([])).toBe("");
    });
  });

  describe("System Prompt Injection", () => {
    it("injects few-shot demonstration block into base system prompt", () => {
      const basePrompt = "You are an objective civic educator.";
      const demonstrations = "### In-Context Few-Shot Demonstrations\nInput: a -> Simplified: b";

      const injected = injectFewShotSystemPrompt(basePrompt, demonstrations);
      expect(injected).toBe("You are an objective civic educator.\n\n### In-Context Few-Shot Demonstrations\nInput: a -> Simplified: b");
    });

    it("preserves base prompt unchanged if demonstrations are empty", () => {
      const basePrompt = "You are an objective civic educator.";
      expect(injectFewShotSystemPrompt(basePrompt, "")).toBe(basePrompt);
    });
  });

  describe("Latency Overhead & Token Benchmarking (<50ms constraint)", () => {
    it("executes retrieval, formatting, and injection under 50ms", async () => {
      const dummyEmbedding = Array.from({ length: 1536 }, () => 0.03);

      const result = await buildDynamicFewShotPrompt({
        baseSystemPrompt: "You are an educator.",
        embedding: dummyEmbedding,
      });

      expect(result.examples).toHaveLength(3);
      expect(result.prompt).toContain("### In-Context Few-Shot Demonstrations");
      expect(result.latencyMs).toBeLessThan(50);
      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeLessThan(500); // Reasonable token budget
    });

    it("serves subsequent queries from in-memory cache in sub-millisecond time", async () => {
      const dummyEmbedding = Array.from({ length: 1536 }, () => 0.05);

      // Prime the cache
      await buildDynamicFewShotPrompt({
        baseSystemPrompt: "Base prompt",
        embedding: dummyEmbedding,
      });

      // Second retrieval (cache hit)
      const cachedResult = await buildDynamicFewShotPrompt({
        baseSystemPrompt: "Base prompt",
        embedding: dummyEmbedding,
      });

      expect(cachedResult.examples).toHaveLength(3);
      expect(cachedResult.latencyMs).toBeLessThan(10);
    });

    it("estimates token count with realistic bounds", () => {
      const text = "Input: term -> Simplified: concise definition of term";
      const count = estimateTokenCount(text);
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(25);
    });
  });

  describe("Output Consistency on Ambiguous Civic Queries", () => {
    it("provides stable few-shot demonstration formatting for ambiguous civic concepts", async () => {
      const ambiguousTerms = [
        "quadratic voting",
        "liquid democracy",
        "zero-knowledge identity attestation",
      ];

      for (const term of ambiguousTerms) {
        const dummyEmbedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i * term.length));
        const result = await buildDynamicFewShotPrompt({
          baseSystemPrompt: "Explain this civic term neutrally.",
          embedding: dummyEmbedding,
        });

        // Verify structural invariant: prompt contains exactly 3 demonstrations formatted properly
        expect(result.examples).toHaveLength(3);
        const demoLines = result.demonstrations.split("\n").filter((l) => l.startsWith("Input:"));
        expect(demoLines).toHaveLength(3);
        for (const line of demoLines) {
          expect(line).toMatch(/^Input:\s.+?\s->\sSimplified:\s.+$/);
        }
      }
    });
  });
});
