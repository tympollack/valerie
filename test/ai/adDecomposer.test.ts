import { describe, it, expect } from "vitest";
import {
  sanitizeBrandNames,
  auditAdQuestionBias,
  synthesizeCivicProposition,
  runAdDecomposerPipeline,
  inferCategoriesFromOcr,
  resolveRes7FromRes8,
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

  describe("Category Inference from Raw OCR (Analysis Feedback 1)", () => {
    it("infers EXCESSIVE_LUMINANCE from night glare and illumination keywords", () => {
      const categories = inferCategoriesFromOcr("Intense 10,000 nits blinding glare at night causing driver discomfort");
      expect(categories).toContain("EXCESSIVE_LUMINANCE");
    });

    it("infers SCHOOL_BUFFER_BREACH from school and playground proximity", () => {
      const categories = inferCategoriesFromOcr("Billboard erected right across from elementary school playground");
      expect(categories).toContain("SCHOOL_BUFFER_BREACH");
    });

    it("infers TRAFFIC_SIGHTLINE_HAZARD from highway merge and blind spot keywords", () => {
      const categories = inferCategoriesFromOcr("Dynamic sign obstructs vision at dangerous highway merge intersection");
      expect(categories).toContain("TRAFFIC_SIGHTLINE_HAZARD");
    });
  });

  describe("H3 Resolution 7 Voter Parent Derivation (Bug 1)", () => {
    it("resolves res7 parent from res8 cell for voter eligibility alignment", () => {
      // Valid res8 cell
      const res8 = "8828308281fffff";
      const res7 = resolveRes7FromRes8(res8);
      expect(res7).toBeDefined();
      expect(typeof res7).toBe("string");
      expect(res7).not.toBe(res8);
    });

    it("returns null gracefully on empty or invalid H3 cell", () => {
      expect(resolveRes7FromRes8(null)).toBeNull();
      expect(resolveRes7FromRes8("invalid_h3")).toBeNull();
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
        h3IndexRes8: "8828308281fffff",
      });

      expect(result.passed).toBe(true);
      expect(result.scopeTier).toBe("LOCAL");
      expect(result.cynic_bias_score).toBeLessThan(0.15);
      expect(result.question.toLowerCase()).not.toContain("pepsi");
      expect(result.h3_res7).toBeDefined();
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

    it("falls back to OCR-inferred category when flaggedCategories is empty", async () => {
      const result = await runAdDecomposerPipeline({
        ocrRawText: "Excessive nighttime glare blinding residential neighborhood windows",
        flaggedCategories: [],
      });

      expect(result.passed).toBe(true);
      expect(result.violationFocus).toContain("EXCESSIVE_LUMINANCE");
      expect(result.cynic_bias_score).toBeLessThan(0.15);
    });
  });

  describe("Edge Function Implementation Verification", () => {
    it("verifies the valerie-ad-decomposer edge function implements admin auth, H3 res-8 validation, and atomic audit claim", () => {
      const fnPath = path.resolve(process.cwd(), "supabase/functions/valerie-ad-decomposer/index.ts");
      expect(fs.existsSync(fnPath)).toBe(true);

      const code = fs.readFileSync(fnPath, "utf-8");
      expect(code).toContain("Deno.serve");
      expect(code).toContain("Authorization");
      expect(code).toContain("app_metadata");
      expect(code).toContain("403");
      expect(code).toContain("isValidCell");
      expect(code).toContain("getResolution");
      expect(code).toContain("ad_compliance_audits");
      expect(code).toContain("DISMISSED");
      expect(code).toContain("decomposed_poll_id");
      expect(code).toContain('.is("decomposed_poll_id", null)');
      expect(code).toContain("h3_res7");
      expect(code).toContain("bestScore >= 0.15");
    });
  });
});
