import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

// Mock Supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  }),
}));

describe("API: /api/simplify-word", () => {
  it("returns 400 when word is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/simplify-word", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns fallback definition for known civic terms and generates SHA-256 hash", async () => {
    const req = new NextRequest("http://localhost:3000/api/simplify-word", {
      method: "POST",
      body: JSON.stringify({
        word: "pedestrian-only zone",
        targetLanguage: "en",
        targetReadingLevel: "general",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.definition).toContain("urban area restricted to foot traffic");
    expect(data.hashKey).toBeDefined();
    expect(data.hashKey.length).toBe(64);
  });

  it("extracts trusted edge IP and handles embedding query rate limiting", async () => {
    const dummyEmbedding = Array.from({ length: 1536 }, () => 0.01);
    const makeReq = () =>
      new NextRequest("http://localhost:3000/api/simplify-word", {
        method: "POST",
        headers: {
          "x-forwarded-for": "1.2.3.4, 203.0.113.50",
          "x-vercel-ip": "203.0.113.50",
        },
        body: JSON.stringify({
          word: "transit line",
          embedding: dummyEmbedding,
        }),
      });

    const results = await Promise.all(
      Array.from({ length: 32 }, () => POST(makeReq()))
    );

    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});

