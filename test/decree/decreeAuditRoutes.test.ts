import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getOembed, OPTIONS as optionsOembed } from "@/app/api/v1/oembed/decree/route";
import { GET as getPdfDownload } from "@/app/api/decree/[id]/pdf/route";

const mockDecreeRecord = {
  id: "d0000000-0000-0000-0000-000000000001",
  poll_id: "p0000000-0000-0000-0000-000000000001",
  decree_title: "High-Luminance Ad Curfew Decree",
  mandate_text: "Prohibit dynamic digital billboard displays between 10 PM and 6 AM.",
  calibrated_consensus_share: 0.824,
  verified_citizen_count: 1420,
  merkle_root_hash: "a3b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9",
  status: "SEALED",
  created_at: "2026-11-09T10:00:00Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "sovereign_decrees") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: string) => ({
            single: vi.fn().mockImplementation(async () => {
              if (val === mockDecreeRecord.id) {
                return { data: mockDecreeRecord, error: null };
              }
              return { data: null, error: { message: "Not found" } };
            }),
          })),
        };
      }
      if (table === "polls") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: mockDecreeRecord.poll_id, target_locale_code: "US-MA" },
            error: null,
          }),
        };
      }
      if (table === "ad_compliance_audits") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    }),
  })),
}));

describe("Public Decree Verification Routes (TASK-VAL-ZONING-RECORD)", () => {
  describe("oEmbed 1.0 Endpoint (/api/v1/oembed/decree)", () => {
    it("handles OPTIONS preflight with 204 and CORS headers", async () => {
      const res = await optionsOembed();
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("returns 400 when url query parameter is missing", async () => {
      const req = new Request("https://valerie.sunshade.icu/api/v1/oembed/decree");
      const res = await getOembed(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("url");
    });

    it("returns 400 when decree URL path format is invalid", async () => {
      const req = new Request("https://valerie.sunshade.icu/api/v1/oembed/decree?url=https://other.com/foo/bar");
      const res = await getOembed(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Invalid decree URL");
    });

    it("returns 404 when decree is not found", async () => {
      const req = new Request("https://valerie.sunshade.icu/api/v1/oembed/decree?url=https://valerie.sunshade.icu/decree/nonexistent-id");
      const res = await getOembed(req);
      expect(res.status).toBe(404);
    });

    it("returns compliant oEmbed 1.0 JSON payload with live tamper-evident consensus badge", async () => {
      const req = new Request(`https://valerie.sunshade.icu/api/v1/oembed/decree?url=https://valerie.sunshade.icu/decree/${mockDecreeRecord.id}`);
      const res = await getOembed(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const json = await res.json();
      expect(json.version).toBe("1.0");
      expect(json.type).toBe("rich");
      expect(json.title).toContain(mockDecreeRecord.decree_title);
      expect(json.author_name).toBe("Verified Citizen Deliberation Assembly");
      expect(json.html).toContain(mockDecreeRecord.decree_title);
      expect(json.html).toContain("82.4% Supermajority");
      expect(json.merkle_root_hash).toBe(mockDecreeRecord.merkle_root_hash);
    });
  });

  describe("Certified Dossier PDF Download Route (/api/decree/[id]/pdf)", () => {
    it("returns 404 when requested decree does not exist", async () => {
      const req = new Request("https://valerie.sunshade.icu/api/decree/not-found/pdf");
      const res = await getPdfDownload(req, {
        params: Promise.resolve({ id: "not-found" }),
      });

      expect(res.status).toBe(404);
    });

    it("generates and downloads certified legal PDF with proper headers", async () => {
      const req = new Request(`https://valerie.sunshade.icu/api/decree/${mockDecreeRecord.id}/pdf`);
      const res = await getPdfDownload(req, {
        params: Promise.resolve({ id: mockDecreeRecord.id }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toContain(`sovereign-decree-${mockDecreeRecord.id}.pdf`);
      expect(res.headers.get("X-Tamper-Evidence-Merkle-Root")).toBe(mockDecreeRecord.merkle_root_hash);

      const arrayBuffer = await res.arrayBuffer();
      const text = Buffer.from(arrayBuffer).toString("utf-8");
      expect(text.startsWith("%PDF-1.4")).toBe(true);
      expect(text).toContain(mockDecreeRecord.merkle_root_hash);
    });
  });
});
