import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useValerieTooltip, calculateSha256 } from "./useValerieTooltip";
import { tooltipCache } from "@/lib/cache/hashLookup";

// Mock Supabase client
const mockMaybeSingle = vi.fn();
const mockRpc = vi.fn();
const mockUpsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    schema: (schemaName: string) => ({
      from: (tableName: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: mockMaybeSingle,
          }),
        }),
        upsert: mockUpsert,
      }),
      rpc: mockRpc,
    }),
    rpc: mockRpc,
    functions: {
      invoke: vi.fn().mockRejectedValue(new Error("No edge function deployed")),
    },
  }),
}));

describe("useValerieTooltip hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tooltipCache.clear();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("calculates accurate client-side SHA-256 hashes", async () => {
    const hash1 = await calculateSha256("pedestrian-only zone:en:general");
    expect(hash1).toBeDefined();
    expect(hash1.length).toBe(64);

    const hash2 = await calculateSha256("pedestrian-only zone:en:general");
    expect(hash1).toBe(hash2);
  });

  it("fetches definition and populates state on complete cache miss", async () => {
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

    // Second call for same word should hit in-memory LRU cache
    await act(async () => {
      await result.current.fetchTooltip("congestion pricing");
    });

    expect(fetchSpy.mock.calls.length).toBe(initialFetchCalls);
    expect(result.current.definition).toBe("Cached definition content.");
  });

  it("resolves from Supabase valerie.content_cache exact match before calling AI endpoints", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        cached_translation: "Database exact match definition.",
        original_text_hash: "exact-hash-match",
      },
      error: null,
    });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useValerieTooltip());

    let data: any;
    await act(async () => {
      data = await result.current.fetchTooltip("likert scale");
    });

    expect(data?.definition).toBe("Database exact match definition.");
    expect(data?.source).toBe("cache");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.definition).toBe("Database exact match definition.");
  });

  it("resolves from valerie.match_semantic_cache when similarity >= 0.96 without invoking AI completion", async () => {
    // Exact cache miss
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // Semantic cache hit >= 0.96
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          cached_translation: "Semantically matched definition for similar concept.",
          original_text_hash: "semantic-hash-match",
          similarity: 0.975,
        },
      ],
      error: null,
    });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useValerieTooltip());

    let data: any;
    await act(async () => {
      data = await result.current.fetchTooltip("car-free downtown streets");
    });

    expect(data?.definition).toBe("Semantically matched definition for similar concept.");
    expect(data?.source).toBe("cache");
    expect(data?.similarity).toBe(0.975);
    expect(mockRpc).toHaveBeenCalledWith(
      "match_semantic_cache",
      expect.objectContaining({ p_threshold: 0.96 })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
