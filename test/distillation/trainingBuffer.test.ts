import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

let capturedUpsertPayload: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          upsert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            capturedUpsertPayload = payload;
            return Promise.resolve({ error: null });
          }),
        }),
      }),
    })
  ),
}));

import { POST } from "@/app/api/simplify-word/route";

describe("Teacher-Student Training Buffer Pipeline (TASK-VAL-TRAIN-BUFFER)", () => {
  describe("LoRA Dataset Export Format (JSONL schema compliance)", () => {
    interface LoRAPair {
      prompt: string;
      completion: string;
      task_type: "TOOLTIP_SIMPLIFY" | "SENTIMENT_CLASSIFY" | "CLUSTER_NAMING";
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }

    function formatLoraJsonl(
      pairs: Array<{ prompt_input: string; completion_output: string; task_type: string }>,
      limit?: number
    ): string {
      const slice = limit ? pairs.slice(0, limit) : pairs;
      return slice
        .map((p) =>
          JSON.stringify({
            prompt: p.prompt_input,
            completion: p.completion_output,
            task_type: p.task_type,
            messages: [
              { role: "user", content: p.prompt_input },
              { role: "assistant", content: p.completion_output },
            ],
          })
        )
        .join("\n");
    }

    it("generates newline-delimited JSON with valid syntax per line", () => {
      const mockPairs = [
        {
          prompt_input: "pedestrian-only zone",
          completion_output: "An urban area restricted to foot traffic where motorized vehicles are prohibited.",
          task_type: "TOOLTIP_SIMPLIFY",
        },
        {
          prompt_input: "congestion pricing",
          completion_output: "A fee charged to motorists entering busy downtown zones during peak traffic hours.",
          task_type: "TOOLTIP_SIMPLIFY",
        },
      ];

      const jsonl = formatLoraJsonl(mockPairs);
      const lines = jsonl.split("\n");
      expect(lines).toHaveLength(2);

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
        const parsed: LoRAPair = JSON.parse(line);
        expect(parsed).toHaveProperty("prompt");
        expect(parsed).toHaveProperty("completion");
        expect(parsed).toHaveProperty("task_type", "TOOLTIP_SIMPLIFY");
        expect(parsed.messages).toHaveLength(2);
        expect(parsed.messages[0]).toEqual({ role: "user", content: parsed.prompt });
        expect(parsed.messages[1]).toEqual({ role: "assistant", content: parsed.completion });
      }
    });

    it("enforces batch limit constraints on export", () => {
      const mockPairs = Array.from({ length: 15 }, (_, i) => ({
        prompt_input: `concept-${i}`,
        completion_output: `Definition for concept ${i} with sufficient text length.`,
        task_type: "TOOLTIP_SIMPLIFY",
      }));

      const exported = formatLoraJsonl(mockPairs, 5);
      const lines = exported.split("\n").filter(Boolean);
      expect(lines).toHaveLength(5);
    });

    it("supports all required task_type domains", () => {
      const allowedTaskTypes = ["TOOLTIP_SIMPLIFY", "SENTIMENT_CLASSIFY", "CLUSTER_NAMING"] as const;
      for (const task of allowedTaskTypes) {
        const item = {
          prompt_input: "sample input",
          completion_output: "sample output",
          task_type: task,
        };
        const parsed = JSON.parse(formatLoraJsonl([item]));
        expect(parsed.task_type).toBe(task);
      }
    });
  });

  describe("Buffer Trigger Ingestion Logic", () => {
    function simulateTriggerBuffer(
      newRow: {
        original_text?: string | null;
        original_text_hash: string;
        cached_translation?: string | null;
        target_language?: string | null;
        target_reading_level?: string | null;
      },
      existingPairs: Array<{ task_type: string; completion_output: string }> = []
    ) {
      if (!newRow.cached_translation || newRow.cached_translation.trim().length <= 10) {
        return null;
      }

      const promptInput =
        newRow.original_text ||
        `Define and simplify the concept (${newRow.original_text_hash}) in ${
          newRow.target_language || "en"
        } at ${newRow.target_reading_level || "general"} reading level.`;

      const isDuplicate = existingPairs.some(
        (p) => p.task_type === "TOOLTIP_SIMPLIFY" && p.completion_output === newRow.cached_translation
      );

      if (isDuplicate) {
        return null;
      }

      return {
        task_type: "TOOLTIP_SIMPLIFY",
        prompt_input: promptInput,
        completion_output: newRow.cached_translation,
        quality_score: 1.0,
        is_exported: false,
      };
    }

    it("buffers substantive definitions (>10 chars) into training pairs", () => {
      const result = simulateTriggerBuffer({
        original_text: "carbon tax",
        original_text_hash: "abc123hash",
        cached_translation: "A fee imposed on fossil fuels based on greenhouse gas emissions.",
      });

      expect(result).not.toBeNull();
      expect(result?.prompt_input).toBe("carbon tax");
      expect(result?.completion_output).toContain("greenhouse gas emissions");
      expect(result?.quality_score).toBe(1.0);
      expect(result?.is_exported).toBe(false);
    });

    it("rejects trivial or empty cached translations", () => {
      const tooShort = simulateTriggerBuffer({
        original_text: "hi",
        original_text_hash: "hash",
        cached_translation: "ok",
      });
      expect(tooShort).toBeNull();
    });

    it("deduplicates identical completions to avoid redundant fine-tuning data", () => {
      const existing = [
        {
          task_type: "TOOLTIP_SIMPLIFY",
          completion_output: "Existing identical definition text here.",
        },
      ];

      const duplicate = simulateTriggerBuffer(
        {
          original_text: "another term",
          original_text_hash: "hash2",
          cached_translation: "Existing identical definition text here.",
        },
        existing
      );

      expect(duplicate).toBeNull();
    });
  });

  describe("API Integration: content_cache write with original_text", () => {
    it("persists original_text alongside hash in content_cache upsert", async () => {
      capturedUpsertPayload = null;

      const req = new NextRequest("http://localhost:3000/api/simplify-word", {
        method: "POST",
        body: JSON.stringify({
          word: "commit-and-reveal",
          targetLanguage: "en",
          targetReadingLevel: "general",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify that original_text was included in the upsert
      expect(capturedUpsertPayload).not.toBeNull();
      expect((capturedUpsertPayload as any)?.original_text).toBe("commit-and-reveal");
    });
  });
});
