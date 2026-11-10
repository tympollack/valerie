import { describe, it, expect } from "vitest";
import { t, formatNumber, formatPercent, formatDate } from "@/lib/i18n";

describe("Type-Safe i18n Engine (TASK-VAL-I18N-CORE)", () => {
  it("resolves nested translation keys accurately from English dictionary", () => {
    const header = t("decree.pdf.documentHeader");
    expect(header).toBe("SOVEREIGN CITIZEN DECREE & LEGAL LANDOWNER DOSSIER");

    const btn = t("common.actions.downloadPdf");
    expect(btn).toBe("Download Certified Legal Dossier (PDF)");

    const clause = t("legal.commercialLeaseNuisance.clauseTitle");
    expect(clause).toContain("Commercial Lease Section 14.3");
  });

  it("safely interpolates single and multiple template tokens", () => {
    const text = t("decree.view.verifiedSample", { count: "1,450" });
    expect(text).toBe("Verified Sample: 1,450");

    const line = t("decree.pdf.supermajorityLine", {
      conviction: "84.2",
      margin: "2.1",
      confidence: "95",
    });
    expect(line).toBe("Supermajority Conviction: 84.2%   |   Margin of Error: ±2.1% (CI: 95%)");
  });

  it("handles missing interpolation tokens gracefully without crashing", () => {
    const text = t("decree.view.verifiedSample");
    expect(text).toBe("Verified Sample: {{count}}");
  });

  it("falls back to key string when an unrecognized key is requested", () => {
    const missing = t("common.actions.nonExistentKey" as any);
    expect(missing).toBe("common.actions.nonExistentKey");
  });

  describe("Locale-Aware Formatters", () => {
    it("formats numbers with proper thousands separators", () => {
      expect(formatNumber(1250000, "en-US")).toBe("1,250,000");
    });

    it("formats percentage ratios accurately", () => {
      expect(formatPercent(0.842, "en-US", 1)).toBe("84.2%");
      expect(formatPercent(0.7, "en-US", 0)).toBe("70%");
    });

    it("formats dates into readable strings", () => {
      const formatted = formatDate("2026-11-09T12:00:00Z", "en-US");
      expect(formatted).toContain("2026");
    });
  });
});
