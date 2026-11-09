import { describe, it, expect } from "vitest";
import {
  sanitizeBrandNames,
  auditAdQuestionBias,
  synthesizeCivicProposition,
  runAdDecomposerPipeline,
} from "@/lib/ai/adDecomposer";
import fs from "node:fs";
import path from "node:path";

describe("Ad Decomposer & Cynic Referee Pipeline (TASK-VAL-DECOMPOSER-EDGE)", () => {
  describe("Brand Sanitization (Agent 1 Preprocessor)", () => {
    it("strips commercial brand names and replaces with neutral advertiser terminology", () => {
      const dirty = "Massive McDonald's illuminated arch billboard at Exit 4 next to Wendy's";
      const { sanitized, removedBrands } = sanitizeBrandNames(dirty);

      expect(sanitized.toLowerCase()).not.toContain("mcdonald's");
      expect(sanitized.toLowerCase()).not.toContain("wendy's");
      expect(sanitized).toContain("commercial advertiser");
      expect(removedBrands).toContain("mcdonald's");
      expect(removedBrands).toContain("wendy's");
    });

    it("strips URLs and phone numbers from raw OCR text", () => {
      const dirty = "Bet now at https://draftkings.com or call 1-800-555-0199 for sportsbook bonuses";
      const { sanitized } = sanitizeBrandNames(dirty);

      expect(sanitized).not.toContain("https://draftkings.com");
      expect(sanitized).not.toContain("1-800-555-0199");
    });
  });

  describe("Cynic Referee Bias Audit (Agent 2)", () => {
    it("flags candidate questions containing commercial brand names (bias >= 0.15)", async () => {
      const biased = "Should McDonald's be banned from placing digital billboards near schools?";
      const audit = await auditAdQuestionBias(biased);

      expect(audit.cynic_bias_score).toBeGreaterThanOrEqual(0.15);
      expect(audit.feedback).toContain("commercial brand reference");
    });

    it("flags candidate questions containing loaded emotional terms (bias >= 0.15)", async () => {
      const biased = "Should corrupt advertising corporations stop erecting tyrannical, eyesore billboards?";
      const audit = await auditAdQuestionBias(biased);

      expect(audit.cynic_bias_score).toBeGreaterThanOrEqual(0.15);
    });

    it("passes clean, balanced civic questions (bias < 0.15)", async () => {
      const neutral =
        "Should municipal night-sky ordinances impose dynamic nighttime nit limits and automated curfew dimming on high-intensity digital display corridors?";
      const audit = await auditAdQuestionBias(neutral);

      expect(audit.cynic_bias_score).toBeLessThan(0.15);
      expect(audit.feedback).toContain("Passed");
    });
  });

  describe("End-to-End Pipeline Execution", () => {
    it("decomposes EXCESSIVE_LUMINANCE complaint into objective local poll passing Cynic audit", async () => {
      const result = await runAdDecomposerPipeline({
        ocrRawText: "Glow in the dark Pepsi Max 10,000 nits blinding drivers at night",
        flaggedCategories: ["EXCESSIVE_LUMINANCE"],
      });

      expect(result.passed).toBe(true);
      expect(result.scopeTier).toBe("LOCAL");
      expect(result.cynic_bias_score).toBeLessThan(0.15);
      expect(result.question.toLowerCase()).not.toContain("pepsi");
      expect(result.question).toContain("night");
    });

    it("decomposes SCHOOL_BUFFER_BREACH complaint into objective zoning proposition", async () => {
      const result = await runAdDecomposerPipeline({
        ocrRawText: "DraftKings sportsbook ad placed directly across from elementary school playground",
        flaggedCategories: ["SCHOOL_BUFFER_BREACH"],
      });

      expect(result.passed).toBe(true);
      expect(result.scopeTier).toBe("LOCAL");
      expect(result.cynic_bias_score).toBeLessThan(0.15);
      expect(result.question.toLowerCase()).not.toContain("draftkings");
      expect(result.question).toContain("school");
    });

    it("decomposes TRAFFIC_SIGHTLINE_HAZARD complaint into safety distance proposition", async () => {
      const result = await runAdDecomposerPipeline({
        ocrRawText: "Flashing digital screen blocks sightline of incoming highway merge traffic",
        flaggedCategories: ["TRAFFIC_SIGHTLINE_HAZARD"],
      });

      expect(result.passed).toBe(true);
      expect(result.scopeTier).toBe("LOCAL");
      expect(result.cynic_bias_score).toBeLessThan(0.15);
      expect(result.question).toContain("intersection");
    });
  });

  describe("Edge Function Implementation Verification", () => {
    it("verifies the valerie-ad-decomposer edge function file exists and implements Deno.serve", () => {
      const fnPath = path.resolve(process.cwd(), "supabase/functions/valerie-ad-decomposer/index.ts");
      expect(fs.existsSync(fnPath)).toBe(true);

      const code = fs.readFileSync(fnPath, "utf-8");
      expect(code).toContain("Deno.serve");
      expect(code).toContain("ad_compliance_audits");
      expect(code).toContain("scope_tier");
      expect(code).toContain("DELIBERATING");
    });
  });
});
