import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useValerieTooltip, calculateSha256 } from "./useValerieTooltip";

// Mock Supabase client
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

describe("useValerieTooltip hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates accurate client-side SHA-256 hashes", async () => {
    const hash1 = await calculateSha256("pedestrian-only zone:en:general");
    expect(hash1).toBeDefined();
    expect(hash1.length).toBe(64); // standard 256-bit hex length

    // Same input normalized should give exact same hash
    const hash2 = await calculateSha256("PEDESTRIAN-ONLY ZONE:en:general");
    expect(hash1).toBe(hash2);
  });

  it("fetches definition and populates state", async () => {
    // Mock global fetch for API fallback
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        definition: "An urban area restricted to foot traffic.",
        source: "gemini",
        hashKey: "mocked-hash-123",
      }),
    } as any);

    const { result } = renderHook(() => useValerieTooltip());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.definition).toBeNull();

    let data: any;
    await act(async () => {
      data = await result.current.fetchTooltip("pedestrian-only zone");
    });

    expect(data?.definition).toBe("An urban area restricted to foot traffic.");
    expect(data?.source).toBe("gemini");
    expect(result.current.definition).toBe("An urban area restricted to foot traffic.");
    expect(result.current.isLoading).toBe(false);
  });

  it("returns cached definition instantly on subsequent requests without re-fetching", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        definition: "Cached definition content.",
        source: "cache",
        hashKey: "cached-hash",
      }),
    } as any);
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useValerieTooltip());

    await act(async () => {
      await result.current.fetchTooltip("congestion pricing");
    });

    const initialFetchCalls = fetchSpy.mock.calls.length;

    // Second call for same word should hit in-memory client cache
    await act(async () => {
      await result.current.fetchTooltip("congestion pricing");
    });

    expect(fetchSpy.mock.calls.length).toBe(initialFetchCalls);
    expect(result.current.definition).toBe("Cached definition content.");
  });
});
