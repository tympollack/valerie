import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPollResultsByLocale } from "@/app/actions/valerieLocaleActions";

let mockRpcResult: Record<string, any> = {};
let mockAuthUser: any = undefined;
let mockVoteRecord: any = undefined;
let mockFlagRecord: any = undefined;

const mockRpc = vi.fn(async (funcName: string, args: any) => {
  const key = `${funcName}:${args?.p_granularity || "NATIONAL"}`;
  if (mockRpcResult[key]) {
    return mockRpcResult[key];
  }
  return { data: [], error: null };
});

const mockFrom = vi.fn((table: string) => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (table === "poll_responses") return { data: mockVoteRecord, error: null };
          if (table === "poll_flags") return { data: mockFlagRecord, error: null };
          return { data: null, error: null };
        }),
      })),
    })),
  })),
}));

const mockSchema = vi.fn(() => ({
  rpc: mockRpc,
  from: mockFrom,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    schema: mockSchema,
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockAuthUser }, error: null })),
    },
  })),
}));

describe("valerieLocaleActions: fetchPollResultsByLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcResult = {};
    mockAuthUser = { id: "user-123" };
    mockVoteRecord = { locked_until: new Date(Date.now() - 10000).toISOString() };
    mockFlagRecord = null;
  });

  it("validates pollId and granularity inputs", async () => {
    const missingId = await fetchPollResultsByLocale("");
    expect(missingId.success).toBe(false);
    expect(missingId.error).toContain("Poll ID is required");

    const invalidGran = await fetchPollResultsByLocale("poll-123", "INVALID" as any);
    expect(invalidGran.success).toBe(false);
    expect(invalidGran.error).toContain("Invalid granularity");
  });

  it("successfully fetches national locale results from valerie.get_poll_results_by_locale", async () => {
    mockRpcResult["get_poll_results_by_locale:NATIONAL"] = {
      data: [
        {
          locale_bucket: "US",
          participant_count: "45",
          vote_count: "40",
          flag_count: "5",
          mean_likert: "1.25",
          mean_confidence: "78.4",
          weighted_salience: "1.32",
          is_inside_blast_radius: false,
          shockwave_24h_likert: "1.50",
          settled_likert: "1.10",
        },
      ],
      error: null,
    };

    const res = await fetchPollResultsByLocale("poll-123", "NATIONAL");

    expect(res.success).toBe(true);
    expect(res.granularity).toBe("NATIONAL");
    expect(res.fallbackApplied).toBe(false);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].locale_bucket).toBe("US");
    expect(res.data[0].participant_count).toBe(45);
    expect(res.data[0].weighted_salience).toBe(1.32);
    expect(res.data[0].shockwave_24h_likert).toBe(1.5);
    expect(res.data[0].settled_likert).toBe(1.1);
  });

  it("automatically cascades sparse LOCAL buckets (<10) to STATE parent tier", async () => {
    // LOCAL returns empty array due to K-anonymity (N < 10)
    mockRpcResult["get_poll_results_by_locale:LOCAL"] = {
      data: [],
      error: null,
    };

    // STATE has sufficient aggregated participation
    mockRpcResult["get_poll_results_by_locale:STATE"] = {
      data: [
        {
          locale_bucket: "US-OH",
          participant_count: "24",
          vote_count: "20",
          flag_count: "4",
          mean_likert: "0.85",
          mean_confidence: "65.0",
          weighted_salience: "0.90",
          is_inside_blast_radius: true,
          shockwave_24h_likert: "1.10",
          settled_likert: "0.75",
        },
      ],
      error: null,
    };

    const res = await fetchPollResultsByLocale("poll-sparse-1", "LOCAL");

    expect(res.success).toBe(true);
    expect(res.granularity).toBe("STATE");
    expect(res.fallbackApplied).toBe(true);
    expect(res.fallbackReason).toContain("K-anonymity privacy rules");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].locale_bucket).toBe("US-OH");
    expect(res.data[0].is_inside_blast_radius).toBe(true);
  });

  it("cascades sparse LOCAL and STATE buckets to NATIONAL parent tier", async () => {
    mockRpcResult["get_poll_results_by_locale:LOCAL"] = { data: [], error: null };
    mockRpcResult["get_poll_results_by_locale:STATE"] = { data: [], error: null };
    mockRpcResult["get_poll_results_by_locale:NATIONAL"] = {
      data: [
        {
          locale_bucket: "US",
          participant_count: "50",
          vote_count: "48",
          flag_count: "2",
          mean_likert: "1.0",
          mean_confidence: "80.0",
          weighted_salience: "1.0",
          is_inside_blast_radius: false,
          shockwave_24h_likert: "1.0",
          settled_likert: "1.0",
        },
      ],
      error: null,
    };

    const res = await fetchPollResultsByLocale("poll-sparse-2", "LOCAL");

    expect(res.success).toBe(true);
    expect(res.granularity).toBe("NATIONAL");
    expect(res.fallbackApplied).toBe(true);
    expect(res.data[0].locale_bucket).toBe("US");
  });

  it("returns error message when Supabase RPC returns database error", async () => {
    mockRpcResult["get_poll_results_by_locale:NATIONAL"] = {
      data: null,
      error: { message: "LOCK_WINDOW_ACTIVE: Results remain sealed until 2026-10-21" },
    };

    const res = await fetchPollResultsByLocale("poll-locked", "NATIONAL");

    expect(res.success).toBe(false);
    expect(res.error).toContain("LOCK_WINDOW_ACTIVE");
  });

  describe("Security & Participation Gate Verification", () => {
    it("enforces authentication requirement on anonymous callers (SEC_0004)", async () => {
      mockAuthUser = null;
      const res = await fetchPollResultsByLocale("poll-123", "NATIONAL");
      expect(res.success).toBe(false);
      expect(res.error).toContain("AUTH_REQUIRED");
    });

    it("enforces participation requirement when user has neither voted nor challenged", async () => {
      mockVoteRecord = null;
      mockFlagRecord = null;
      const res = await fetchPollResultsByLocale("poll-123", "NATIONAL");
      expect(res.success).toBe(false);
      expect(res.error).toContain("NO_PARTICIPATION");
    });

    it("enforces active challenge lock even when earlier vote lock is expired (SEC_0005)", async () => {
      mockVoteRecord = { locked_until: new Date(Date.now() - 3600000).toISOString() }; // Expired 1h ago
      mockFlagRecord = { locked_until: new Date(Date.now() + 86400000).toISOString() }; // Active 24h challenge
      const res = await fetchPollResultsByLocale("poll-123", "NATIONAL");
      expect(res.success).toBe(false);
      expect(res.error).toContain("LOCK_WINDOW_ACTIVE");
    });
  });
});
